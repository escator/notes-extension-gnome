// notes@maestroschan.fr/menus.js
// GPL v3
// Copyright 2018-2021 Romain F. T.

const { Clutter, St } = imports.gi;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
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

		let colorSubmenuItem = new PopupMenu.PopupSubMenuMenuItem(_("Custom color"));
		this.super_menu.addMenuItem(colorSubmenuItem);
		this._buildCustomColorMenu(colorSubmenuItem.menu);

		this._appendSeparator(); //---------------------------------------------
	}

	_buildCustomColorMenu (colorSubmenu) {
		this._customColorEntries = [];
		let rgb = this._source._note.customColor.split(',');
		this._addCustomColorEntry('notesCustomColorEntryR', rgb[0], colorSubmenu);
		this._addCustomColorEntry('notesCustomColorEntryG', rgb[1], colorSubmenu);
		this._addCustomColorEntry('notesCustomColorEntryB', rgb[2], colorSubmenu);

		let applyMenuItem = new PopupMenu.PopupMenuItem(_("Apply"));
		applyMenuItem.connect('activate', this._onApplyCustom.bind(this));
		colorSubmenu.addMenuItem(applyMenuItem);
	}

	_addCustomColorEntry (cssClass, textContent, colorSubmenu) {
		let colorMenuItem = new PopupMenu.PopupBaseMenuItem({
			reactive: false,
			activate: false,
			hover: false,
			style_class: null,
			can_focus: false
		});

		let colorEntry = new St.Entry({
			can_focus: true,
			track_hover: true,
			x_expand: true,
			style_class: cssClass
		});
		colorEntry.set_text(textContent);

		colorMenuItem.actor.add_child(colorEntry);
		this._customColorEntries.push(colorEntry);
		colorSubmenu.addMenuItem(colorMenuItem);
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

	_onApplyCustom () {
		let r = Number(this._customColorEntries[0].get_text());
		let g = Number(this._customColorEntries[1].get_text());
		let b = Number(this._customColorEntries[2].get_text());
		this._source._note.applyColorAndSave(r, g, b);
	}

	_onEditTitle () {
		this._source._note.openEditTitleDialog();
	}

	_onApply (color, button) {
		let rgb = Common.PRESET_COLORS[color].rgb;
		this._source._note.applyColorAndSave(rgb[0], rgb[1], rgb[2]);
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

