// notes@maestroschan.fr/noteBox.js
// GPL v3
// Copyright 2018-2021 Romain F. T.

const { Clutter, St, GLib, Gio } = imports.gi;
const Main = imports.ui.main;
const ShellEntry = imports.ui.shellEntry;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Common = Me.imports.common;
const Menus = Me.imports.menus;
const Dialog = Me.imports.dialog;

const Gettext = imports.gettext.domain('notes-extension');
const _ = Gettext.gettext;

// ~/.local/share/notes@maestroschan.fr
const PATH = Common.DATA_PATH;

const MIN_HEIGHT = 75;
const MIN_WIDTH = 200;

//------------------------------------------------------------------------------

function stringFromArray(data){
	if (data instanceof Uint8Array) {
		return imports.byteArray.toString(data);
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
		// on the entry itself), so a paste attempt on a read-only note can
		// still be redirected to the editing mode
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
		// ShellEntry.addContextMenu(this.noteEntry); // FIXME doesn't work
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
	 * - The 'delete' button asks the user to confirm if they really wants to
	 *   delete the note (see `dialog.js`), and if yes the object is destroyed,
	 *   and a method from the NotesManager is called to correctly delete the
	 *   corresponding files.
	 * - The 'move' button, which isn't styled as a button but looks like an
	 *   empty space. It simulates a kind of wacky window dragging.
	 * - The 'options' button, showing a menu defined in menus.js
	 * - The 'resize' button, which uses the same dragging mecanism as 'move',
	 *   to resize the note from its upper-right corner.
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
			Common.getCustomIcon(Me.dir, 'copy-to-buf'),
			_("Copy to clipboard")
		);
		this._btnCopy.actor.connect('clicked', this._copyToClipboard.bind(this));
		this._buttonsBox.add_child(this._btnCopy.actor);

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
	 * A paste attempt on a read-only note silently did nothing, which is easy
	 * to mistake for a broken clipboard: switch to the editing mode first and
	 * paste from there.
	 */
	_onKeyPress (actor, event) {
		if (this._editing) { return false; }
		if (!(event.get_state() & Clutter.ModifierType.CONTROL_MASK)) { return false; }
		let key = event.get_key_symbol();
		if (key != Clutter.KEY_v && key != Clutter.KEY_V && key != Clutter.KEY_Paste) {
			return false;
		}
		this.setEditMode(true);
		this.noteEntry.get_clutter_text().paste_clipboard();
		return true;
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
		this.actor.visible = true;
		Main.layoutManager.trackChrome(this.actor);
	}

	onlyHide () {
		this.actor.visible = false;
		Main.layoutManager.untrackChrome(this.actor);
	}

	onlySave (withMetadata=true) {
		if(withMetadata) {
			// one disk write for the whole set of notes (positions +
			// attributes), see NotesManager.saveLayout
			this._manager.saveLayout();
		}
		this._saveText();
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

	_onMovePress (actor, event) {
		this._onPressCommon(event);
		this._isMoving = true;
		this._isResizing = false;
	}

	_onResizePress (actor, event) {
		this._onPressCommon(event);
		this._isResizing = true;
		this._isMoving = false;
	}

	_onPressCommon (event) {
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

		this.grabX = event_x;
		this.grabY = event_y;
	}

	_onRelease (actor, event) {
		this._isResizing = false;
		this._isMoving = false;
		this.onlySave();
	}

	//--------------------------------------------------------------------------
	// "Public" methods called by the NoteOptionsMenu's code -------------------

	changeFontSize (delta) {
		if (this._fontSize + delta > 1) {
			this._fontSize += delta;
			this._applyNoteStyle();
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

		this.noteEntry.set_text(content);
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

