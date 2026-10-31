// notes@escator/noteBox.js
// GPL v3
// Copyright 2018-2021 Romain F. T.

const { Clutter, St, GLib, Gio, Meta } = imports.gi;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Common = Me.imports.common;
const Layouts = Me.imports.layouts;
const Menus = Me.imports.menus;
const Dialog = Me.imports.dialog;
const TextHistory = Me.imports.textHistory.TextHistory;

const Gettext = imports.gettext.domain('notes-extension');
const _ = Gettext.gettext;

// ~/.local/share/notes@maestroschan.fr
const PATH = Common.DATA_PATH;

const MIN_HEIGHT = 75;
const MIN_WIDTH = 200;

// duration of the expand/collapse animation of the double-click toggle
// (task 005 / ADR-0004)
const EXPAND_ANIM_MS = 250;
// a second press counts as a double click when it lands within the system
// double-click time and this distance of the first press
const DBL_CLICK_DIST_PX = 8;
// fallback double-click time when Clutter.Settings is unreachable
const DBL_CLICK_MS = 400;
// accumulated drag/resize path (px, Manhattan) a press-release gesture must
// cover to count as a real gesture: the hand jitter between the clicks of a
// double click (a few px) must not rebase the home rect
const GESTURE_MIN_DIST_PX = 6;

// duration of the fade-out used by fadeOutAndHide: the color filter's way of
// sending a note off the screen (task 004 phase 3)
const FILTER_FADE_MS = 300;

// X11 evdev keycodes (linux/input-event-codes.h) of the physical keys bound
// by the keyboard matrix in _onKeyPress: unlike a keyval, a keycode doesn't
// depend on the active XKB group, so the shortcuts work with Cyrillic active
// too (docs/tasks/003-own-keyboard-text-actions/02-architecture.md §3).
// Clutter delivers them unchanged on Wayland and offset by 8 (the X keycode)
// under X11 — _isKey accepts both.
const EVDEV_V = 55;
const EVDEV_C = 54;
const EVDEV_X = 53;
const EVDEV_Z = 52;
const EVDEV_A = 38;
const EVDEV_INSERT = 118;

//------------------------------------------------------------------------------

function stringFromArray(data){
	if (data instanceof Uint8Array) {
		return new TextDecoder().decode(data);
	} else {
		return data.toString();
	}
}

/*
 * This class stands for one note. The note's id corresponds to the name of
 * the file where its text is stored, and to its entry in the layout registry
 * (layouts.json, owned by the NotesManager). The manager decides the id, the
 * attributes (color, font size) and the geometry (x, y, w, h — global scene
 * coordinates, valid across all the monitors); the note itself only handles
 * the widgets, the user interactions, and the text file.
 * Almost all of the init process is done in the _buildNote() method. Then,
 * the other methods are here for managing note state through buttons, or to
 * interact with the NotesManager singleton.
 */
var NoteBox = class NoteBox {
	constructor (manager, spec) {
		this._manager = manager;
		this.id = spec.id;
		this._fontSize = spec.fontSize;
		this._x = Math.floor(spec.x);
		this._y = Math.floor(spec.y);
		// expanded mode (double-click toggle, task 005): _homeRect is the
		// snapshot the note collapses back to; the press tracker feeds the
		// double-click detector; _targetW/_targetH are the bookkeeping sizes
		// an in-flight animation can be snapped to
		this._expanded = false;
		this._homeRect = null;
		this._rectAnimating = false;
		this._targetW = 0;
		this._targetH = 0;
		this._lastPressTime = 0;
		this._lastPressX = 0;
		this._lastPressY = 0;
		this._gestureDistance = 0;
		if (spec.color && spec.color.split(',').length == 3) {
			this.customColor = spec.color;
		} else {
			let c = this._manager.settings.get_strv('first-note-rgb');
			c[0] = Math.round(c[0] * 255);
			c[1] = Math.round(c[1] * 255);
			c[2] = Math.round(c[2] * 255);
			this.customColor = c.toString();
		}
		this._buildNote(spec);
	}

	_buildNote (spec) {
		this.actor = new St.BoxLayout({
			reactive: true,
			vertical: true,
			min_height: MIN_HEIGHT,
			min_width: MIN_WIDTH,
			style_class: 'noteBoxStyle',
			track_hover: true,
		});

		this._fontColor = '';
		this.actor.width = Math.floor(spec.w);
		this.actor.height = Math.floor(spec.h);
		this._applyActorStyle();

		// This actually builds all the possible headerbars
		this._buildHeaderbar();

		//----------------------------------------------------------------------

		this._scrollView = new St.ScrollView({
			overlay_scrollbars: true,
			// if true, the scrollbar is inside the textfield, else it's outside
			x_expand: true,
			y_expand: true,
			clip_to_allocation: true,
		});

		this.noteEntry = new St.Entry({
			name: 'noteEntry',
			can_focus: true,
			track_hover: true,
			x_expand: true,
			// the entry must fill the scroll view: its natural height is a
			// single text line and is not reliably recomputed when the text
			// auto-wraps, so aligning to it clips every wrapped line
			style_class: 'notesTextField',
		});
		let clutterText = this.noteEntry.get_clutter_text();
		clutterText.set_single_line_mode(false);
		clutterText.set_activatable(false); // we can press Enter
		clutterText.set_line_wrap(true);
		clutterText.set_line_wrap_mode(imports.gi.Pango.WrapMode.WORD_CHAR);
		// a non-editable ClutterText only answers Ctrl+C / Ctrl+A when it is
		// selectable, and notes are read-only by default
		clutterText.set_selectable(true);

		// the connection happens before _loadText, whose initial set_text is
		// wrapped in a history suspend so it doesn't open a bogus undo step
		clutterText.connect('text-changed', this._onTextChanged.bind(this));

		// The text context menu (task 002) is built lazily on its first use.
		// A right click is intercepted here, before ClutterText's own
		// handling: letting ClutterText process button 3 would move the
		// cursor to the click point and drop the selection.
		//
		// In the read-only mode every press is swallowed as well: mutter's
		// press handler (clutter_text_press) runs for any button on a
		// selectable text and starts with an unconditional grab_key_focus,
		// so a click on a read-only note silently stole the key focus from
		// the note being edited (Ctrl+V then landed here and was swallowed
		// by the matrix, and each click left two clutter_input_focus
		// assertion warnings in the journal). Stopping the press before the
		// class handler also means no drag selection in the read-only mode —
		// selection there goes through the context menu instead
		// (decision 2026-10-21).
		this._textMenu = null;
		this._textMenuManager = null;
		clutterText.connect('button-press-event', (actor, event) => {
			if (event.get_button() == 3) {
				if (this._textMenu && this._textMenu.super_menu.isOpen) {
					this._textMenu.super_menu.close();
					return Clutter.EVENT_STOP;
				}
				this._openTextMenu(event.get_coords()[0], event.get_coords()[1]);
				return Clutter.EVENT_STOP;
			}
			if (!this._editing) {
				// the note still raises above its siblings: EVENT_STOP keeps
				// the event from reaching noteEntry's own press handler
				this._redraw();
				return Clutter.EVENT_STOP;
			}
			return Clutter.EVENT_PROPAGATE;
		});
		// Shift+F10 / Menu key: the menu is anchored at the text cursor
		this.noteEntry.connect('popup-menu', this._onTextPopupMenu.bind(this));

		this._entryBox = new St.BoxLayout({
			reactive: true,
			x_expand: true,
			y_expand: true,
		});

		this._entryBox.add_child(this.noteEntry);
		this._scrollView.add_actor(this._entryBox); // yes, actually add_actor
		this.actor.add_child(this._scrollView);

		//----------------------------------------------------------------------

		// The entry takes the key focus when hovered (autoFocus) or pressed, so
		// the user can keep typing without an extra click. The focus is taken
		// directly: GrabHelper's modal grab would swallow the first click
		// happening outside the entry (on the header buttons).
		//
		// The "Automatic focus" option is disabled for now: the notes always
		// take the key focus when pressed (the former setting defaulted to
		// false anyway, and updating it dynamically was never implemented).
		//if (this._manager.autoFocus) { // TODO dynamically update this setting
		//	this.noteEntry.connect('enter-event', this._getKeyFocus.bind(this));
		//} else {
			this.noteEntry.connect('button-press-event', this._getKeyFocus.bind(this));
			// this.noteEntry.connect('key-focus-in', this._redraw.bind(this)); // FIXME doesn't work
		//}
		// runs before the entry's own key handling (bubbling from the text or
		// on the entry itself): the whole keyboard matrix of task 003 is
		// served there, before St.Entry/ClutterText ever see the key (see
		// _onKeyPress)
		this.noteEntry.connect('key-press-event', this._onKeyPress.bind(this));

		// Notes are displayed read-only by default; clicking the edit button is
		// the only way to change this (the state isn't saved across sessions)
		this._editing = false;
		this.setEditMode(false);

		//----------------------------------------------------------------------

		// Each note sets its own actor where it should be. This isn't a problem
		// since the related setting isn't directly accessed, but is stored by
		// the notes manager instead, which prevents inconsistencies.
		this.loadIntoCorrectLayer();
		this._setNotePosition();
		this._loadText();
		// the text menu below replaces ShellEntry.addContextMenu (its FIXME
		// "doesn't work" is explained in the task 002 journal)
		this._initStyle();
		// a newly created note opens straight into the editing mode; done
		// after _loadText so the initial setEditMode(false) in the middle of
		// this method keeps its "don't wipe the file" guarantee
		if (spec.startInEditMode) {
			this.setEditMode(true);
		}

		this.grabX = this._x + 100;
		this.grabY = this._y + 10;
	}

	/*
	 * The headerbar contains the UI controls to manage the note:
	 * - The 'edit' button toggles the note between the read-only mode (the
	 *   default) and the editing mode.
	 * - The 'copy' button copies the note's text to the clipboard.
	 * - The 'paste' button appends the clipboard's text at the end of the
	 *   note, on a new line if the note already has some.
	 * - The 'delete' button asks the user to confirm if they really wants to
	 *   delete the note (see `dialog.js`), and if yes the object is destroyed,
	 *   and a method from the NotesManager is called to correctly delete the
	 *   corresponding files.
	 * - The 'move' button, which isn't styled as a button but looks like an
	 *   empty space. It simulates a kind of wacky window dragging.
	 * - The 'options' button, showing a menu defined in menus.js
	 * - The 'resize' button, which uses the same dragging mecanism as 'move',
	 *   to resize the note from its upper-right corner. A double click on it
	 *   resets the note to its starting size (task 005, 02-architecture §8).
	 */
	_buildHeaderbar () {
		// This is the regular header, as described above.
		this._buttonsBox = new St.BoxLayout({
			vertical: false,
			visible: true,
			reactive: true,
			x_expand: true,
			y_expand: false,
			style_class: 'noteHeaderStyle',
		});

		this._btnEdit = new Menus.NoteRoundButton(
			this,
			Common.getCustomIcon(Me.dir, 'edit'),
			_("Edit")
		);
		this._btnEdit.actor.connect('clicked', this._toggleEditMode.bind(this));
		this._buttonsBox.add_child(this._btnEdit.actor);

		this._btnCopy = new Menus.NoteRoundButton(
			this,
			Common.getCustomIcon(Me.dir, 'edit-copy'),
			_("Copy to clipboard")
		);
		this._btnCopy.actor.connect('clicked', this._copyToClipboard.bind(this));
		this._buttonsBox.add_child(this._btnCopy.actor);

		this._btnPaste = new Menus.NoteRoundButton(
			this,
			Common.getCustomIcon(Me.dir, 'edit-paste'),
			_("Paste from clipboard")
		);
		this._btnPaste.actor.connect('clicked', this._pasteFromClipboard.bind(this));
		this._buttonsBox.add_child(this._btnPaste.actor);

		this._btnDelete = new Menus.NoteRoundButton(
			this,
			'user-trash-symbolic',
			_("Delete")
		);
		this._btnDelete.actor.connect('clicked', this._openDeleteDialog.bind(this));
		this._buttonsBox.add_child(this._btnDelete.actor);

		this.moveBox = new St.Button({
			x_expand: true,
			style_class: 'notesTitleButton',
			// label: 'example title'
		});
		this._buttonsBox.add_child(this.moveBox);

		this._btnOptions = new Menus.NoteRoundButton(
			this,
			'view-more-symbolic',
			_("Note options")
		);
		this._btnOptions.addMenu();
		this._buttonsBox.add_child(this._btnOptions.actor);

		this._btnResize = new Menus.NoteRoundButton(
			this,
			'view-fullscreen-symbolic',
			_("Resize")
		);
		this._buttonsBox.add_child(this._btnResize.actor);

		this.moveBox.connect('button-press-event', this._onMovePress.bind(this));
		this.moveBox.connect('motion-event', this._onMoveMotion.bind(this));
		this.moveBox.connect('button-release-event', this._onRelease.bind(this));

		this._btnResize.actor.connect('button-press-event', this._onResizePress.bind(this));
		this._btnResize.actor.connect('motion-event', this._onResizeMotion.bind(this));
		this._btnResize.actor.connect('button-release-event', this._onRelease.bind(this));

		this.actor.add_child(this._buttonsBox);
	}

	/*
	 * Toggles between the read-only and editing modes: the entry is editable
	 * only in the editing mode; all the headerbar buttons work in both modes.
	 */
	_toggleEditMode () {
		this.setEditMode(!this._editing);
	}

	/*
	 * Also called by the NotesManager when the notes get hidden, so that they
	 * are always displayed read-only the next time they show up.
	 */
	setEditMode (editing) {
		// a mode switch is a discrete operation: whatever typing portion was
		// open becomes its own undo step (the history doesn't exist yet during
		// the initial calls from _buildNote)
		this.boundary();
		this._editing = editing;
		let clutterText = this.noteEntry.get_clutter_text();
		clutterText.set_editable(editing);
		clutterText.set_cursor_visible(editing);
		this.noteEntry.hint_text = editing ? _("Type here…") : '';

		this._btnEdit._setIcon(editing
			? 'object-select-symbolic' // the "done" checkmark from the theme
			: Common.getCustomIcon(Me.dir, 'edit'));

		if (editing) {
			this.noteEntry.grab_key_focus();
		} else {
			global.stage.set_key_focus(null);
			// the text is saved when leaving the editing mode, but the initial
			// call happening before _loadText must not wipe the saved file
			if (this._textLoaded) {
				this._saveText();
			}
		}
	}

	_copyToClipboard () {
		St.Clipboard.get_default().set_text(
			St.ClipboardType.CLIPBOARD,
			this.noteEntry.get_text()
		);
	}

	/*
	 * 'text-changed' handler: every user edit (typing, deletion, native
	 * paste…) feeds the history, which coalesces consecutive changes into
	 * undo portions. The suspend flag keeps history restorations and the
	 * initial text load out of the history.
	 */
	_onTextChanged () {
		if (!this._history) { return; }
		let clutterText = this.noteEntry.get_clutter_text();
		this._history.onChange(
			clutterText.get_text(),
			clutterText.get_cursor_position()
		);
		// an expanded note re-fits instantly around the new content (task 005)
		if (this._expanded) {
			this._expandNote(false);
		}
	}

	/*
	 * Restore the previous/next state, in both modes, without switching
	 * modes; nothing happens on an empty history. The restored text is
	 * written to disk right away. Called from _onKeyPress and (from Ф3) the
	 * text context menu.
	 */
	undo () {
		if (!this._history) { return; }
		let state = this._history.undo();
		if (state != null) {
			this._restoreHistoryState(state);
		}
	}

	redo () {
		if (!this._history) { return; }
		let state = this._history.redo();
		if (state != null) {
			this._restoreHistoryState(state);
		}
	}

	_restoreHistoryState (state) {
		let clutterText = this.noteEntry.get_clutter_text();
		this._history.suspend(() => {
			clutterText.set_text(state.text);
			clutterText.set_cursor_position(state.cursor);
		});
		this._saveText();
	}

	/*
	 * Closes the currently open undo portion, making it one undo step (no-op
	 * when the history doesn't exist yet, or when nothing is open). Called
	 * before discrete operations: mode switch, headerbar paste, Ctrl+V, the
	 * context menu's Cut/Copy/Paste.
	 */
	boundary () {
		if (this._history) {
			this._history.boundary();
		}
	}

	canUndo () {
		return this._history ? this._history.canUndo() : false;
	}

	canRedo () {
		return this._history ? this._history.canRedo() : false;
	}

	//-------------------------- text actions ------------------------------------

	/*
	 * The text actions shared by the text context menu and the keyboard
	 * shortcuts (task 003, see
	 * docs/tasks/003-own-keyboard-text-actions/02-architecture.md §1): one
	 * implementation per action; the callers only check their own
	 * preconditions (the menu through its item sensitivity, the keyboard
	 * through its key matrix) and invoke.
	 *
	 * Clutter.Text (GS 42) has no copy_clipboard/paste_clipboard/select_all:
	 * the clipboard is driven directly through St.Clipboard, and selection
	 * through set_selection — same approach as the upstream EntryMenu.
	 *
	 * Every mutating action opens an undo boundary first, so it stays one
	 * undo step: the text-changed handler then records the change itself.
	 */
	copySelection () {
		let clutterText = this.noteEntry.get_clutter_text();
		this.boundary();
		St.Clipboard.get_default().set_text(
			St.ClipboardType.CLIPBOARD,
			clutterText.get_selection()
		);
	}

	cutSelection () {
		let clutterText = this.noteEntry.get_clutter_text();
		this.boundary();
		St.Clipboard.get_default().set_text(
			St.ClipboardType.CLIPBOARD,
			clutterText.get_selection()
		);
		clutterText.delete_selection();
	}

	pasteClipboardAtCursor () {
		let clutterText = this.noteEntry.get_clutter_text();
		this.boundary();
		// the menu's modal grab took the key focus away from the text; give it
		// back so the cursor sits where the user left it (a no-op when the
		// entry already has the focus, i.e. when invoked from the keyboard)
		this.noteEntry.grab_key_focus();
		St.Clipboard.get_default().get_text(
			St.ClipboardType.CLIPBOARD,
			(clipboard, text) => {
				// the read is asynchronous: the note may be gone by then
				if (this.actor == null || !text) { return; }
				clutterText.delete_selection();
				clutterText.insert_text(text, clutterText.get_cursor_position());
			}
		);
	}

	selectAllText () {
		let clutterText = this.noteEntry.get_clutter_text();
		this.noteEntry.grab_key_focus();
		clutterText.set_selection(0, clutterText.get_text().length);
		// Closing the popup restores the key focus the menu had grabbed the
		// stage with — null here, since in the read-only mode no click gives
		// focus — and that drops the focus (and with it the matrix access)
		// the grab above has just taken. Both are re-done once the menu
		// teardown has settled; the redo is idempotent for every other
		// caller (task 003, acceptance)
		Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
			if (this.actor == null) { return; }
			this.noteEntry.grab_key_focus();
			clutterText.set_selection(0, clutterText.get_text().length);
		});
	}

	//-------------------------- text context menu ------------------------------

	/*
	 * Opens the text context menu anchored at the stage point (stageX,
	 * stageY); the menu and its manager are created on the first use.
	 */
	_openTextMenu (stageX, stageY) {
		if (!this._textMenu) {
			this._textMenu = new Menus.NoteTextContextMenu(this);
			// same compat shim as NoteRoundButton.addMenu: before 3.33 the
			// constructor takes the owner, after it the actor
			try {
				this._textMenuManager = new PopupMenu.PopupMenuManager(this);
			} catch (e) {
				this._textMenuManager = new PopupMenu.PopupMenuManager(this.actor);
			}
			this._textMenuManager.addMenu(this._textMenu.super_menu);
		}
		this._textMenu.popup(stageX, stageY);
	}

	/*
	 * Keyboard opening (Menu key / Shift+F10, via the popup-menu signal):
	 * anchored at the text cursor, falling back to the entry's corner when
	 * the cursor position can't be translated to coordinates (e.g. no cursor
	 * in the read-only mode).
	 */
	_onTextPopupMenu () {
		let clutterText = this.noteEntry.get_clutter_text();
		let [transformed, entryX, entryY] = clutterText.get_transformed_position();
		let [success, textX, textY, lineHeight] =
			clutterText.position_to_coords(clutterText.get_cursor_position());
		if (success) {
			this._openTextMenu(entryX + textX, entryY + textY + lineHeight);
		} else if (transformed) {
			this._openTextMenu(entryX, entryY);
		}
		return true;
	}

	_pasteFromClipboard () {
		St.Clipboard.get_default().get_text(
			St.ClipboardType.CLIPBOARD,
			(clipboard, text) => { this.appendClipboardText(text); }
		);
	}

	/*
	 * Appends `text` at the end of the note: straight into an empty (or new)
	 * note, on a new line otherwise — without doubling a newline the note
	 * already ends with. Public: the notes manager also calls it right after
	 * creating a 'New from Clipboard' note. The clipboard read is
	 * asynchronous, so the note may have been destroyed in the meantime.
	 */
	appendClipboardText (text) {
		if (this.actor == null || !text) { return; }
		// the headerbar's paste button is a discrete operation: any open
		// typing portion closes here, the paste becomes its own undo step
		this._history.boundary();
		let noteText = this.noteEntry.get_text();
		if (noteText && noteText.length > 0) {
			if (!noteText.endsWith('\n')) {
				noteText += '\n';
			}
			text = noteText + text;
		}
		this.noteEntry.set_text(text);
		this._saveText();
		if (this._editing) {
			this.noteEntry.get_clutter_text().set_cursor_position(text.length);
		}
	}

	/*
	 * The keyboard matrix of task 003 (02-architecture.md §2), running before
	 * the entry's own class handler. Every recognized key is executed here
	 * and stopped, so the native path never takes part: St.Entry pastes and
	 * cuts with no editable check, and the whole native path is unreviewable
	 * (01-analysis.md). Paste and cut are served only in the editing mode —
	 * in the read-only mode they are swallowed (pasting never switches the
	 * mode, decision 2026-10-21), just like the context menu items they
	 * mirror; copy, select-all and undo/redo work in both modes. A
	 * recognized key failing its precondition (no selection, empty text) is
	 * stopped all the same: the key is ours.
	 */
	_onKeyPress (actor, event) {
		let state = event.get_state();
		let key = event.get_key_symbol();
		let control = state & Clutter.ModifierType.CONTROL_MASK;
		let shift = state & Clutter.ModifierType.SHIFT_MASK;
		let clutterText = this.noteEntry.get_clutter_text();

		// undo / redo, both modes
		if (control && (this._isKey(event, [Clutter.KEY_z, Clutter.KEY_Z], EVDEV_Z)
				|| key == Clutter.KEY_Undo)) {
			if (shift) {
				this.redo();
			} else {
				this.undo();
			}
			return Clutter.EVENT_STOP;
		}
		if (control && key == Clutter.KEY_Redo) {
			this.redo();
			return Clutter.EVENT_STOP;
		}

		// paste in the editing mode, swallowed in the read-only mode:
		// Ctrl+V / Shift+Insert / KEY_Paste (KP_Insert, like in St.Entry, is
		// not served)
		if ((control && this._isKey(event, [Clutter.KEY_v, Clutter.KEY_V], EVDEV_V))
				|| key == Clutter.KEY_Paste
				|| (shift && !control
					&& this._isKey(event, [Clutter.KEY_Insert], EVDEV_INSERT))) {
			if (this._editing) {
				this.pasteClipboardAtCursor();
			}
			return Clutter.EVENT_STOP;
		}

		// cut, editing only, with a selection; swallowed when read-only
		if ((control && this._isKey(event, [Clutter.KEY_x, Clutter.KEY_X], EVDEV_X))
				|| key == Clutter.KEY_Cut) {
			if (this._editing && clutterText.get_selection()) {
				this.cutSelection();
			}
			return Clutter.EVENT_STOP;
		}

		// copy, both modes, only with a selection
		if (control && this._isKey(event, [Clutter.KEY_c, Clutter.KEY_C], EVDEV_C)) {
			if (clutterText.get_selection()) {
				this.copySelection();
			}
			return Clutter.EVENT_STOP;
		}

		// select all, both modes, only with some text
		if (control && this._isKey(event, [Clutter.KEY_a, Clutter.KEY_A], EVDEV_A)) {
			if (clutterText.get_text()) {
				this.selectAllText();
			}
			return Clutter.EVENT_STOP;
		}

		// not ours: typing, navigation, IM/preedit — the native path
		return Clutter.EVENT_PROPAGATE;
	}

	/*
	 * True when the event's keyval is one of `keyvals`, or when its hardware
	 * keycode is `evdevCode` — a keyval depends on the active XKB group
	 * (with Cyrillic active Ctrl+Z arrives as a Cyrillic keysym on the same
	 * physical key), a keycode doesn't. Clutter reports the evdev code
	 * unchanged on Wayland and offset by 8 (the X keycode) under X11, hence
	 * both are accepted. The service keysyms (Undo, Redo, Paste, Cut) have
	 * no physical key: pass 0 to skip the keycode check. Lower- and
	 * uppercase keyvals are both listed by the callers, so Caps Lock doesn't
	 * matter either.
	 */
	_isKey (event, keyvals, evdevCode) {
		if (keyvals.includes(event.get_key_symbol())) { return true; }
		if (evdevCode == 0) { return false; }
		let code = event.get_key_code();
		return code == evdevCode || code == evdevCode + 8;
	}

	_openDeleteDialog () {
		let noteText = this.noteEntry.get_text();
		// The text has to be truncated to avoid issues with long notes
		let lines = noteText.split("\n")
		if(lines.length > 10) {
			noteText = lines[0] + "\n" + lines[1] + "\n" + lines[2] + "\n[...]\n";
			noteText += lines[lines.length - 2] + "\n" + lines[lines.length - 1];
		}
		if(noteText === "") {
			noteText = "[" + _("Empty note") + "]";
		}

		let description_label = new St.Label({
			style_class: 'notesDialogDescription',
			x_align: Clutter.ActorAlign.CENTER,
			text: noteText,
		});

		let dialog = new Dialog.CustomModalDialog(
			_("Delete this note?"),
			description_label,
			_("Delete"),
			this._deleteNoteObject.bind(this)
		);
		dialog.open();
	}

	openEditTitleDialog () {
		let titleEntry = new St.Entry({
			can_focus: true,
			track_hover: true,
			x_expand: true,
			text: "todo load existing title"
		});

		let dialog = new Dialog.CustomModalDialog(
			_("Edit title"),
			titleEntry,
			_("Apply"),
			this._applyTitleChange.bind(this)
		);
		dialog.open();
	}

	_initStyle () {
		let initialRGB_r = this.customColor.split(',')[0];
		let initialRGB_g = this.customColor.split(',')[1];
		let initialRGB_b = this.customColor.split(',')[2];
		this._applyColor(initialRGB_r, initialRGB_g, initialRGB_b);
		this._applyActorStyle();
		this._applyNoteStyle();
	}

	//--------------------------------------------------------------------------
	// "Public" methods called by NotesManager ---------------------------------

	get manager () {
		return this._manager;
	}

	loadIntoCorrectLayer () {
		Main.layoutManager.addChrome(this.actor, {
			affectsInputRegion: true
		});
	}

	show () {
		// a visible note is already in the chrome; trackChrome would throw
		// ('trying to re-track existing chrome actor'), e.g. when the color
		// filter reset shows the hidden notes next to the already visible
		// ones, or when a note created through 'New note' while the notes
		// are globally hidden survives into the next global show
		if (this.actor.visible) { return; }
		// hidden notes never stay expanded: the next show starts from the
		// home size, instantly (decision 6, 02-architecture §1)
		if (this._expanded) {
			this._collapseNote(false);
		}
		this.actor.visible = true;
		Main.layoutManager.trackChrome(this.actor);
	}

	onlyHide () {
		this.actor.visible = false;
		Main.layoutManager.untrackChrome(this.actor);
	}

	/*
	 * Smooth variant of onlyHide(), used by the color filter: the note fades
	 * out and leaves the chrome only once the animation is over. The guard
	 * keeps hidden notes (for instance a filter change during a fade) from
	 * restarting the animation. The note leaves the edit mode right away, so
	 * it is never editable while dissolving.
	 */
	fadeOutAndHide () {
		if (!this.actor.visible) { return; }
		this.setEditMode(false);
		this.actor.ease({
			opacity: 0,
			duration: FILTER_FADE_MS,
			mode: Clutter.AnimationMode.EASE_OUT_QUAD,
			onComplete: () => {
				this.onlyHide();
				this.actor.opacity = 255;
			}
		});
	}

	/*
	 * Cancels a fade-out in progress, called by the manager before showing
	 * the notes back (resetting the filter mid-fade must not let the deferred
	 * onlyHide() run on a note that is shown again). The shell's ease() helper
	 * fires onComplete only for transitions that finished by themselves, so
	 * detaching the transitions is enough; remove_all_transitions() is part
	 * of the gnome-shell 42 Clutter API (verified on this build).
	 */
	cancelFadeOut () {
		this.actor.remove_all_transitions();
		this.actor.opacity = 255;
	}

	onlySave (withMetadata=true) {
		if(withMetadata) {
			// one disk write for the whole set of notes (positions +
			// attributes), see NotesManager.saveLayout
			this._manager.saveLayout();
		}
		this._saveText();
	}

	/*
	 * The geometry the manager persists (task 005, 02-architecture §1): while
	 * expanded — the home rect, since the disk always holds the home geometry
	 * and the expanded size is a view state; otherwise the live one. While a
	 * rect animation is in flight (collapse, reset), the bookkeeping is
	 * already the target — a save landing mid-flight (e.g. the toggling
	 * release's onlySave) must observe the final geometry, never an
	 * intermediate one.
	 */
	getPersistedRect () {
		if (this._expanded) {
			return {
				x: this._homeRect.x,
				y: this._homeRect.y,
				w: this._homeRect.w,
				h: this._homeRect.h
			};
		}
		if (this._rectAnimating) {
			return { x: this._x, y: this._y, w: this._targetW, h: this._targetH };
		}
		return this._liveRect();
	}

	//--------------------------------------------------------------------------

	_applyTitleChange () {
		// TODO
		// ...
		this.onlySave();
	}

	_applyActorStyle () {
		if (this.actor == null) { return; }
		let temp = 'background-color: rgb(' + this.customColor + ');'
			+ 'border: 1px solid ' + this._getBorderColor() + ';';
		if(this._fontColor != '') {
			temp += 'color: ' + this._fontColor + ';';
		}
		this.actor.style = temp;
	}

	_applyNoteStyle () {
		let temp = 'background-color: transparent;';
		if(this._fontColor != '') {
			temp += 'color: ' + this._fontColor + ';';
		}
		if(this._fontSize != 0) {
			temp += 'font-size: ' + this._fontSize + 'px;';
		}
		this.noteEntry.style = temp;
	}

	/*
	 * Border matching the note's background: the palette's own border when the
	 * color is one of the presets (COLOR.md §2), else the background darkened
	 * by ~10%, which is how the palette's borders relate to their backgrounds.
	 */
	_getBorderColor () {
		let presets = Common.PRESET_COLORS;
		for (let name in presets) {
			if (presets[name].rgb.join(',') === this.customColor) {
				return presets[name].border;
			}
		}
		let rgb = this.customColor.split(',').map(Number);
		return 'rgb(' + Math.round(rgb[0] * 0.9) + ','
			+ Math.round(rgb[1] * 0.9) + ','
			+ Math.round(rgb[2] * 0.9) + ')';
	}

	/*
	 * WCAG relative luminance (0 = black, 1 = white). The pivot 0.18 is
	 * mid-gray: lighter backgrounds get the light theme's dark text token,
	 * darker ones get the dark theme's light text token.
	 */
	_getLuminance (r, g, b) {
		let channel = function (c) {
			c = c / 255;
			if (c <= 0.03928) { return c / 12.92; }
			return Math.pow((c + 0.055) / 1.055, 2.4);
		};
		return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
	}

	_getKeyFocus () {
		if (this._editing) {
			this.noteEntry.grab_key_focus();
		}
		this._redraw();
	}

	_redraw () {
		this.actor.get_parent().set_child_above_sibling(this.actor, null);
		this.onlySave();
	}

	//--------------------------------------------------------------------------
	// Sticky note's size and position -----------------------------------------

	_setNotePosition () {
		// the note's coordinates are global scene coordinates (valid across
		// all the monitors), not relative to the primary monitor anymore
		this.actor.set_position(
			Math.floor(this._x),
			Math.floor(this._y)
		);
	}

	//--------------------------------------------------------------------------
	// Expand / collapse (the double-click toggle, task 005 / ADR-0004) --------

	/*
	 * Height the actor needs at width `width` for the text to be fully
	 * visible: the chrome (headerbar, borders, padding) plus the natural
	 * height pango wraps the text to at that width. Measured through
	 * get_preferred_height, which stays correct where the GNOME 42
	 * natural-size bookkeeping of a wrapping ClutterText does not (the
	 * reason the whole task 005 exists).
	 */
	_neededH (width) {
		let clutterText = this.noteEntry.get_clutter_text();
		let chromeW = this.actor.width - clutterText.width;
		let chromeH = this.actor.height - clutterText.height;
		return chromeH + clutterText.get_preferred_height(width - chromeW)[1];
	}

	_isTextFullyVisible () {
		return this._neededH(this.actor.width) <= this.actor.height + 2;
	}

	_liveRect () {
		return { x: this._x, y: this._y, w: this.actor.width, h: this.actor.height };
	}

	_toggleExpanded () {
		if (this._expanded) {
			this._collapseNote(true);
		} else {
			this._expandNote(true);
		}
	}

	/*
	 * Expands (or re-fits, when already expanded) the note so the whole text
	 * is visible: Layouts.fitExpandRect picks the smallest 3:4 rect around
	 * the current position; a no-op when nothing is hidden.
	 */
	_expandNote (animated) {
		if (this.actor == null || this._isTextFullyVisible()) { return; }
		if (!this._expanded) {
			this._homeRect = this._liveRect();
			this._expanded = true;
		}
		// the search floor is the home width: a manual widening done in the
		// expanded mode is not rolled back by a re-fit (02-architecture §5)
		let base = this._liveRect();
		base.w = Math.max(base.w, this._homeRect.w);
		let target = Layouts.fitExpandRect(
			base, this._manager._monitorRects(), (w) => this._neededH(w)
		);
		this._applyRectAnimated(target, animated);
	}

	_collapseNote (animated) {
		if (!this._expanded) { return; }
		let target = this._homeRect;
		this._expanded = false;
		this._homeRect = null;
		this._applyRectAnimated(target, animated);
	}

	/*
	 * Resets the note to its starting size (the default of a brand-new
	 * note) at the current position: the double click on the resize button,
	 * the quick way to shrink a grown note (02-architecture §8). A discrete
	 * manual resize: the expanded mode ends here — its geometry is
	 * deliberately abandoned — and the result persists through the regular
	 * save path. Animated, like the toggle.
	 */
	_resetSize () {
		if (this.actor == null) { return; }
		this._expanded = false;
		this._homeRect = null;
		this._applyRectAnimated({
			x: this._x,
			y: this._y,
			w: Layouts.DEFAULT_WIDTH,
			h: Layouts.DEFAULT_HEIGHT,
		}, true, () => { this.onlySave(); });
	}

	/*
	 * Applies a target rect: the bookkeeping (_x/_y and the target size)
	 * jumps right away — release handling and the manager's saves must never
	 * observe an intermediate geometry — while the actor's visuals either
	 * snap (animated = false) or ease towards the target. `onComplete` (a
	 * save that must observe the target geometry, not the in-flight one)
	 * runs once the target is actually reached; it is skipped when the
	 * transition is cancelled by a mid-flight press — the gesture taking
	 * over saves on its own release.
	 */
	_applyRectAnimated (rect, animated, onComplete) {
		this._x = Math.floor(rect.x);
		this._y = Math.floor(rect.y);
		this._targetW = Math.round(rect.w);
		this._targetH = Math.round(rect.h);
		if (!animated) {
			// an instant application must also detach an in-flight ease
			// (monitors-changed or the fold landing mid-animation), or the
			// stale transition would fight the snap and _rectAnimating would
			// never clear (same pattern as the mid-flight press)
			if (this._rectAnimating) {
				this.actor.remove_all_transitions();
				this._rectAnimating = false;
			}
			this._snapToRect();
			if (onComplete) { onComplete(); }
			return;
		}
		this._rectAnimating = true;
		this.actor.ease({
			x: this._x,
			y: this._y,
			width: this._targetW,
			height: this._targetH,
			duration: EXPAND_ANIM_MS,
			mode: Clutter.AnimationMode.EASE_OUT_QUAD,
			onComplete: () => {
				this._rectAnimating = false;
				this._snapToRect();
				if (onComplete) { onComplete(); }
			}
		});
	}

	_snapToRect () {
		if (this.actor == null) { return; }
		this.actor.set_position(this._x, this._y);
		this.actor.width = this._targetW;
		this.actor.height = this._targetH;
	}

	/*
	 * The double-click detector (02-architecture §2): button 1 pressed again
	 * within the system double-click time and DBL_CLICK_DIST_PX of the
	 * previous press. A completed pair is consumed: the next press always
	 * starts a fresh one, so however fast the user fires double clicks one
	 * after another, each completes exactly one toggle (without this, the
	 * first click of the second pair lands within the window of the click
	 * that toggled the first pair and re-toggles it back).
	 */
	_isDoubleClick (event) {
		if (event.get_button() != 1) { return false; }
		let [x, y] = event.get_coords();
		let now = event.get_time();
		let dblTime = DBL_CLICK_MS;
		try {
			dblTime = Clutter.Settings.get_default().double_click_time;
		} catch (e) { /* older shell: constant fallback */ }
		let isDouble = this._lastPressTime > 0
			&& (now - this._lastPressTime) <= dblTime
			&& Math.abs(x - this._lastPressX) <= DBL_CLICK_DIST_PX
			&& Math.abs(y - this._lastPressY) <= DBL_CLICK_DIST_PX;
		if (isDouble) {
			this._lastPressTime = 0;
			return true;
		}
		this._lastPressTime = now;
		this._lastPressX = x;
		this._lastPressY = y;
		return false;
	}

	_onMovePress (actor, event) {
		// a double click on the move area toggles the expanded mode instead
		// of starting a drag (task 005): stopped here, so neither the drag
		// state (the first press of the pair may have armed it) nor the
		// common press bookkeeping run
		if (this._isDoubleClick(event)) {
			this._isMoving = false;
			this._isResizing = false;
			this._gestureDistance = 0;
			this._toggleExpanded();
			return Clutter.EVENT_STOP;
		}
		this._onPressCommon(event);
		this._isMoving = true;
		this._isResizing = false;
		this._gestureDistance = 0;
	}

	_onResizePress (actor, event) {
		// a double click on the resize button resets the note to its
		// starting size — the quick way to shrink a grown note (task 005,
		// 02-architecture §8): stopped here, so no resize gesture arms
		if (this._isDoubleClick(event)) {
			this._isResizing = false;
			this._isMoving = false;
			this._gestureDistance = 0;
			this._resetSize();
			return Clutter.EVENT_STOP;
		}
		this._onPressCommon(event);
		this._isResizing = true;
		this._isMoving = false;
		this._gestureDistance = 0;
	}

	_onPressCommon (event) {
		// a press in the middle of an expand/collapse animation snaps the
		// actor to the bookkeeping (already the target): drag/resize always
		// start from the actual geometry (cancelFadeOut pattern)
		if (this._rectAnimating) {
			this.actor.remove_all_transitions();
			this._rectAnimating = false;
			this._snapToRect();
		}
		this._redraw();
		this.grabX = Math.floor(event.get_coords()[0]);
		this.grabY = Math.floor(event.get_coords()[1]);
	}

	_onResizeMotion (actor, event) {
		if (!this._isResizing) { return; }
		let x = Math.floor(event.get_coords()[0]);
		let y = Math.floor(event.get_coords()[1]);
		this._resizeTo(x, y);
	}

	_resizeTo (event_x, event_y) {
		let newWidth = Math.abs(this.actor.width + (event_x - this.grabX));
		let newHeight = Math.abs(this._y + this.actor.height - event_y + (this.grabY - this._y));
		let newY = event_y - (this.grabY - this._y);

		newWidth = Math.max(newWidth, MIN_WIDTH);
		newHeight = Math.max(newHeight, MIN_HEIGHT);

		this.actor.width = newWidth;
		this.actor.height = newHeight;
		this._y = newY;
		this._setNotePosition();
		this._gestureDistance += Math.abs(event_x - this.grabX)
			+ Math.abs(event_y - this.grabY);

		this.grabX = event_x;
		this.grabY = event_y;
	}

	_onMoveMotion (actor, event) {
		if (!this._isMoving) { return; }
		let x = Math.floor(event.get_coords()[0]);
		let y = Math.floor(event.get_coords()[1]);
		this._moveTo(x, y);
	}

	_moveTo (event_x, event_y) {
		let newX = event_x - (this.grabX - this._x);
		let newY = event_y - (this.grabY - this._y);

		this._y = Math.floor(newY);
		this._x = Math.floor(newX);
		this._setNotePosition();
		this._gestureDistance += Math.abs(event_x - this.grabX)
			+ Math.abs(event_y - this.grabY);

		this.grabX = event_x;
		this.grabY = event_y;
	}

	_onRelease (actor, event) {
		this._isResizing = false;
		this._isMoving = false;
		// only the end of an actual drag/resize rebases the home rect: the
		// release of the double click that toggled the mode, or of a plain
		// click, must not turn the expanded geometry into the home one, or
		// collapsing back would become a no-op (02-architecture §1). The
		// accumulated path separates a real gesture from the hand jitter
		// between the clicks of a double click (GESTURE_MIN_DIST_PX)
		if (this._expanded && this._gestureDistance >= GESTURE_MIN_DIST_PX) {
			this._homeRect = this._liveRect();
		}
		this.onlySave();
	}

	//--------------------------------------------------------------------------
	// "Public" methods called by the NoteOptionsMenu's code -------------------

	changeFontSize (delta) {
		if (this._fontSize + delta > 1) {
			this._fontSize += delta;
			this._applyNoteStyle();
			// the new metrics change how the text wraps: an expanded note
			// re-fits instantly (task 005; a measure lagging one frame
			// behind the restyle is a known accepted risk — 03-plan)
			if (this._expanded) {
				this._expandNote(false);
			}
		}
		this.onlySave();
	}

	/*
	 * This applies the color from the menu. Metadata is saved after applying
	 * the new CSS.
	 */
	applyColorAndSave (r, g, b) {
		this._applyColor(r, g, b)
		this.onlySave();
		// a visible note whose new color doesn't match the active filter has
		// to fade away (the manager ignores the notes hidden by the filter:
		// their menu is unreachable, so no reverse case)
		this._manager.refreshFilterForNote(this);
	}

	//--------------------------------------------------------------------------

	/*
	 * This applies the color, from the menu (`applyColorAndSave`) or the
	 * constructor (direct call). It requires some string manipulations since
	 * the color is saved in the text file using an 'r,g,b' string format. Then,
	 * the text coloration and the CSS is updated.
	 */
	_applyColor (r, g, b) {
		if (Number.isNaN(r)) r = 255;
		if (Number.isNaN(g)) g = 255;
		if (Number.isNaN(b)) b = 255;
		// rounding also normalizes float values coming from the settings
		// (stored as 0..1 doubles) or from legacy state files
		r = Math.round(Math.min(Math.max(0, r), 255));
		g = Math.round(Math.min(Math.max(0, g), 255));
		b = Math.round(Math.min(Math.max(0, b), 255));
		this.customColor = r.toString() + ',' + g.toString() + ',' + b.toString();
		if (this._getLuminance(r, g, b) > 0.18) {
			this._fontColor = Common.TEXT_COLORS.primary;
		} else {
			this._fontColor = Common.TEXT_COLORS.primaryDark;
		}
		this._applyNoteStyle();
		this._applyActorStyle();
	}

	_loadText () {
		let file2 = GLib.build_filenamev([PATH, this.id.toString() + '_text']);
		if (!GLib.file_test(file2, GLib.FileTest.EXISTS)) {
			GLib.file_set_contents(file2, '');
		}

		let file = Gio.file_new_for_path(PATH + '/' + this.id.toString() + '_text');
		let [result, contents] = file.load_contents(null);
		if (!result) {
			log('Could not read file: ' + PATH);
		}
		let content = stringFromArray(contents);

		// the loaded text is the baseline: the initial set_text fires
		// 'text-changed' (the connection predates this method), so it runs
		// under suspend and opens no undo step
		this._history = new TextHistory({ text: content, cursor: 0 });
		this._history.suspend(() => {
			this.noteEntry.set_text(content);
		});
		this._textLoaded = true;
	}

	_saveText () {
		let noteText = this.noteEntry.get_text();
		if (noteText == null) {
			noteText = '';
		}
		let file = GLib.build_filenamev([PATH, this.id.toString() + '_text']);
		GLib.file_set_contents(file, noteText);
	}

	//--------------------------------------------------------------------------

	_deleteNoteObject () {
		let noteId = this.id;
		this.destroy();
		this._manager.postDelete(noteId);
	}

	destroy () {
		// Clutter doesn't drop the stage's key focus when the focused actor
		// is destroyed: the shell-side focus trackers (SearchController,
		// modal dialogs) would then be handed a disposed Clutter.Text, log
		// errors, and can even crash the whole shell
		let focus = global.stage.get_key_focus();
		if (focus != null && this.actor.contains(focus)) {
			global.stage.set_key_focus(null);
		}
		this.actor.destroy_all_children();
		this.actor.destroy();
		this.actor = null;
	}
};

//------------------------------------------------------------------------------

