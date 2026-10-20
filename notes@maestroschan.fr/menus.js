// notes@maestroschan.fr/menus.js
// GPL v3
// Copyright 2018-2021 Romain F. T.

const { Clutter, St } = imports.gi;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const BoxPointer = imports.ui.boxpointer;
const Signals = imports.signals;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Common = Me.imports.common;

const Gettext = imports.gettext.domain('notes-extension');
const _ = Gettext.gettext;

//------------------------------------------------------------------------------

class NoteOptionsMenu {
	constructor (source) {
		this.super_menu = new PopupMenu.PopupMenu(source.actor, 0.2, St.Side.LEFT);

		// We want to keep the item hovered while the menu is up
		this.super_menu.blockSourceEvents = true;
		this._source = source;
		this.super_menu.actor.add_style_class_name('app-well-menu');

		// Chain our visibility and lifecycle to that of the source
		source.actor.connect('notify::mapped', () => {
			if (!source.actor.mapped) {
				this.super_menu.close();
			}
		});
		source.actor.connect('destroy', this.super_menu.destroy.bind(this.super_menu));

		Main.uiGroup.add_child(this.super_menu.actor);
	}

	_redisplay () {
		this.super_menu.removeAll(); //-----------------------------------------

	//	this.super_menu.addAction(_("Edit title"), this._onEditTitle.bind(this));

	//	this._appendSeparator(); //---------------------------------------------

		this.size_item = new PopupMenu.PopupBaseMenuItem({
			reactive: false,
			activate: false,
			hover: false,
			style_class: null,
			can_focus: false
		});
		this.super_menu.addMenuItem(this.size_item);
		this._buildSizeItem();

		this._appendSeparator(); //---------------------------------------------

		this.color1_item = new PopupMenu.PopupBaseMenuItem({
			reactive: false,
			activate: false,
			hover: false,
			style_class: null,
			can_focus: false
		});
		this._addColorButton('peach', 1);
		this._addColorButton('cream', 1);
		this._addColorButton('mint', 1);
		this._addColorButton('sky', 1);
		this.super_menu.addMenuItem(this.color1_item);

		this.color2_item = new PopupMenu.PopupBaseMenuItem({
			reactive: false,
			activate: false,
			hover: false,
			style_class: null,
			can_focus: false
		});
		this._addColorButton('lavender', 2);
		this._addColorButton('pink', 2);
		this._addColorButton('sage', 2);
		this._addColorButton('beige', 2);
		this.super_menu.addMenuItem(this.color2_item);

		this._appendSeparator(); //---------------------------------------------
	}

	_buildSizeItem () {
		let sizeLabel = new St.Label({
			text: _("Font size"),
			x_expand: true,
			x_align: Clutter.ActorAlign.START,
			y_align: Clutter.ActorAlign.CENTER,
		});

		let bigger = new St.Button({
			style_class: 'button notesMenuSizeButton',
			child: new St.Icon({
				icon_name: 'zoom-in-symbolic',
				icon_size: 16,
				style_class: 'system-status-icon',
				x_expand: true,
				y_expand: true,
				x_align: Clutter.ActorAlign.CENTER,
				y_align: Clutter.ActorAlign.CENTER,
			}),
		});
		let smaller = new St.Button({
			style_class: 'button notesMenuSizeButton',
			child: new St.Icon({
				icon_name: 'zoom-out-symbolic',
				icon_size: 16,
				style_class: 'system-status-icon',
				x_expand: true,
				y_expand: true,
				x_align: Clutter.ActorAlign.CENTER,
				y_align: Clutter.ActorAlign.CENTER,
			}),
		});

		smaller.connect('clicked', this._onSmaller.bind(this));
		bigger.connect('clicked', this._onBigger.bind(this));

		this.size_item.actor.add_child(sizeLabel);
		this.size_item.actor.add_child(smaller);
		this.size_item.actor.add_child(bigger);
	}

	_addColorButton (color, line) {
		let preset = Common.PRESET_COLORS[color];
		let rgb = preset.rgb;
		let style = 'background-color: rgb(' + rgb[0] + ','
		                                + rgb[1] + ','
		                                + rgb[2] + ');';
		// The swatch of the color currently applied to the note gets the
		// ring that matches it (COLOR.md §4.2)
		if (this._source._note.customColor === rgb.join(',')) {
			style += 'border-color: ' + preset.ring + '; border-width: 2px;';
		}
		let btn = new St.Button({
			style_class: 'notesCircleButton',
			style: style,
			x_expand: true,
			x_align: Clutter.ActorAlign.CENTER,
		});
		if (line == 1) {
			this.color1_item.actor.add_child(btn);
		} else {
			this.color2_item.actor.add_child(btn);
		}
		btn.connect('clicked', this._onApply.bind(this, color));
	}

	_appendSeparator () {
		this.super_menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
	}

	_onEditTitle () {
		this._source._note.openEditTitleDialog();
	}

	_onApply (color, button) {
		let rgb = Common.PRESET_COLORS[color].rgb;
		this._source._note.applyColorAndSave(rgb[0], rgb[1], rgb[2]);
		this.super_menu.close();
	}

	popup (activatingButton) {
		this._redisplay();
		this.super_menu.toggle();//.open();
	}

	_onBigger () {
		this._source._note.changeFontSize(1);
	}

	_onSmaller () {
		this._source._note.changeFontSize(-1);
	}
};
Signals.addSignalMethods(NoteOptionsMenu.prototype);

//------------------------------------------------------------------------------

var NoteRoundButton = class NoteRoundButton {
	/*
	 * The icon argument is either an icon theme name, or a Gio.Icon (as
	 * returned by Common.getCustomIcon) for the SVGs bundled with the
	 * extension, which icon_name can't reach.
	 */
	constructor (note, icon, accessibleName) {
		this._note = note;
		this._iconActor = new St.Icon({
			icon_size: 16,
			style_class: 'system-status-icon',
			x_expand: true,
			y_expand: true,
			y_align: Clutter.ActorAlign.CENTER,
		});
		this._setIcon(icon);
		this.actor = new St.Button({
			child: this._iconActor,
			accessible_name: accessibleName,
			y_align: Clutter.ActorAlign.CENTER,
			style_class: 'notesCircleButton notesHeaderboxButton',
			reactive: true,
			can_focus: true,
			track_hover: true,
			y_expand: false,
		});
	}

	_setIcon (icon) {
		if (typeof icon === 'string') {
			this._iconActor.icon_name = icon;
		} else {
			this._iconActor.gicon = icon;
		}
	}

	//----------------------- If the button has a menu -------------------------

	addMenu () {
		this._menu = null;
		try {
			// before 3.33, the constructor uses this.actor
			this._menuManager = new PopupMenu.PopupMenuManager(this);
		} catch (e) {
			// after 3.33, the constructor uses directly the parameter
			this._menuManager = new PopupMenu.PopupMenuManager(this.actor);
		}
		this.actor.connect('button-press-event', this.popupMenu.bind(this));
	}

	popupMenu () {
		this.actor.fake_release();
		if (!this._menu) {
			this._menu = new NoteOptionsMenu(this);
			this._menu.super_menu.connect('open-state-changed', (menu, isPoppedUp) => {
				if (!isPoppedUp) {
					this.actor.sync_hover();
				}
			});
			this._menuManager.addMenu(this._menu.super_menu);
		}
		this.emit('menu-state-changed', true);
		this.actor.set_hover(true);
		this._menu.popup();
		return false;
	}
};
Signals.addSignalMethods(NoteRoundButton.prototype);

//------------------------------------------------------------------------------

/*
 * Text context menu of a single note (task 002, see
 * docs/tasks/002-text-context-menu/02-architecture.md): Cut / Copy / Paste —
 * Undo / Redo — Select all, opened by a right click on the note's text or by
 * the keyboard Menu key (popup-menu signal). Created lazily by the NoteBox;
 * destroys itself with the note.
 *
 * Positioning: BoxPointer can only anchor itself to a source actor, so the
 * menu is anchored to a 1×1 invisible "anchor" actor living in the uiGroup,
 * moved to the click point (or to the text cursor for the popup-menu signal)
 * before opening. Anchoring to the note entry itself would stick the arrow
 * to the entry's top edge instead of the click point.
 *
 * Item sensitivity follows the matrix from 02-architecture.md: Cut and Paste
 * are editing-only (Paste also depends on the clipboard content, checked
 * asynchronously like the upstream EntryMenu does), Copy depends on the
 * selection, Undo/Redo on the note's history, Select all on the text being
 * non-empty.
 */
var NoteTextContextMenu = class NoteTextContextMenu {
	constructor (note) {
		this._note = note;
		this._isDestroyed = false;

		this._anchor = new St.Bin({
			reactive: false,
			width: 1,
			height: 1,
		});
		Main.uiGroup.add_child(this._anchor);

		this.super_menu = new PopupMenu.PopupMenu(this._anchor, 0.0, St.Side.TOP);

		this._cutItem = this.super_menu.addAction(_("Cut"), this._onCutActivated.bind(this));
		this._copyItem = this.super_menu.addAction(_("Copy"), this._onCopyActivated.bind(this));
		this._pasteItem = this.super_menu.addAction(_("Paste"), this._onPasteActivated.bind(this));

		this._appendSeparator();

		this._undoItem = this.super_menu.addAction(_("Undo"), () => { this._note.undo(); });
		this._redoItem = this.super_menu.addAction(_("Redo"), () => { this._note.redo(); });

		this._appendSeparator();

		this._selectAllItem = this.super_menu.addAction(_("Select All"), this._onSelectAllActivated.bind(this));

		Main.uiGroup.add_child(this.super_menu.actor);
		this.super_menu.actor.hide();

		// Chain the menu's lifecycle to that of the note (pattern of
		// NoteOptionsMenu): hiding the note closes the menu, destroying it
		// destroys the menu (and the anchor with it)
		note.actor.connect('notify::mapped', () => {
			if (!note.actor.mapped) {
				this.super_menu.close();
			}
		});
		note.actor.connect('destroy', this.destroy.bind(this));
	}

	/*
	 * stageX/stageY: stage coordinates to anchor the menu at; when undefined
	 * (shouldn't normally happen), the menu opens at the anchor's last
	 * position.
	 */
	popup (stageX, stageY) {
		if (stageX !== undefined) {
			this._anchor.set_position(Math.floor(stageX), Math.floor(stageY));
		}
		this._redisplay();
		this.super_menu.open(BoxPointer.PopupAnimation.FULL);
	}

	destroy () {
		if (this._isDestroyed) { return; }
		this._isDestroyed = true;
		this._anchor.destroy();
		this.super_menu.destroy();
	}

	//-------------------------- internals --------------------------------------

	_redisplay () {
		let clutterText = this._note.noteEntry.get_clutter_text();
		let selection = clutterText.get_selection();
		let hasSelection = (selection != null && selection != '');
		let hasText = this._note.noteEntry.get_text().length > 0;

		this._cutItem.setSensitive(this._note._editing && hasSelection);
		this._copyItem.setSensitive(hasSelection);
		this._selectAllItem.setSensitive(hasText);
		this._undoItem.setSensitive(this._note.canUndo());
		this._redoItem.setSensitive(this._note.canRedo());

		// the clipboard read is asynchronous, the callback can happen after
		// the note (and the menu) got destroyed
		this._pasteItem.setSensitive(false);
		if (this._note._editing) {
			St.Clipboard.get_default().get_text(
				St.ClipboardType.CLIPBOARD,
				(clipboard, text) => {
					if (this._isDestroyed) { return; }
					this._pasteItem.setSensitive(text && text != '');
				}
			);
		}
	}

	_appendSeparator () {
		this.super_menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
	}

	/*
	 * Clutter.Text (GS 42) has no copy_clipboard/paste_clipboard/select_all:
	 * the clipboard is driven directly through St.Clipboard, and selection
	 * through set_selection — same approach as the upstream EntryMenu.
	 */
	_onCutActivated () {
		let clutterText = this._note.noteEntry.get_clutter_text();
		this._note.boundary();
		St.Clipboard.get_default().set_text(
			St.ClipboardType.CLIPBOARD,
			clutterText.get_selection()
		);
		clutterText.delete_selection();
	}

	_onCopyActivated () {
		let clutterText = this._note.noteEntry.get_clutter_text();
		this._note.boundary();
		St.Clipboard.get_default().set_text(
			St.ClipboardType.CLIPBOARD,
			clutterText.get_selection()
		);
	}

	_onPasteActivated () {
		let clutterText = this._note.noteEntry.get_clutter_text();
		this._note.boundary();
		// the menu's modal grab took the key focus away from the text;
		// give it back so the cursor sits where the user left it
		this._note.noteEntry.grab_key_focus();
		St.Clipboard.get_default().get_text(
			St.ClipboardType.CLIPBOARD,
			(clipboard, text) => {
				// the read is asynchronous: the note may be gone by then
				if (this._isDestroyed || !text) { return; }
				clutterText.delete_selection();
				clutterText.insert_text(text, clutterText.get_cursor_position());
			}
		);
	}

	_onSelectAllActivated () {
		let clutterText = this._note.noteEntry.get_clutter_text();
		this._note.noteEntry.grab_key_focus();
		clutterText.set_selection(0, clutterText.get_text().length);
	}
};

//------------------------------------------------------------------------------

