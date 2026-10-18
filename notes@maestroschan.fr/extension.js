// notes@maestroschan.fr/extension.js
// GPL v3
// Copyright 2018-2021 Romain F. T.

const { St, Shell, GLib, Gio, Meta, Clutter } = imports.gi;
const PanelMenu = imports.ui.panelMenu;
const Panel = imports.ui.panel;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Util = imports.misc.util;
const Me = ExtensionUtils.getCurrentExtension();

const Common = Me.imports.common;
const NoteBox = Me.imports.noteBox;

const Gettext = imports.gettext.domain('notes-extension');
const _ = Gettext.gettext;

//------------------------------------------------------------------------------

const PATH = Common.DATA_PATH;

var NOTES_MANAGER;

function init() {
	ExtensionUtils.initTranslations();
	try {
		let a = Gio.file_new_for_path(PATH);
		if (!a.query_exists(null)) {
			a.make_directory(null);
		}
	} catch (e) {
		log(e.message);
	}
}

function enable() {
	NOTES_MANAGER = new NotesManager(ExtensionUtils.getSettings());
}

function disable() {
	NOTES_MANAGER.destroy();
	NOTES_MANAGER = null;
}

//------------------------------------------------------------------------------

/*
 * A singleton that manages the button in the top bar, and thus provides the
 * actions of loading, showing, hiding, creating (and in some way saving and
 * destroying) all the notes.
 * If no note exists, it will create the first one itself, otherwise it serves
 * as a middleman between the note whose "new" button has been pressed and the
 * new one.
 */
class NotesManager {
	constructor(settings) {
		this._settings = settings;
		this._autoFocus = settings.get_boolean('auto-focus');

		// Initialisation of the button in the top panel
		this.panel_button = new PanelMenu.Button(0.0, _("Show notes"), true);
		let icon = new St.Icon({
			icon_name: 'document-edit-symbolic',
			style_class: 'system-status-icon'
		});
		this.panel_button.add_child(icon);
		this._buildPanelMenu();
		this.panel_button.connect(
			'button-press-event',
			this._onButtonPressed.bind(this)
		);
		this._updateIconVisibility();
		// `0` is the position within the chosen box (here, the `right` one)
		Main.panel.addToStatusArea('NotesButton', this.panel_button, 0, 'right');

		// Initialisation of the notes themselves
		this._allNotes = new Array();
		this._notesAreVisible = false;

		this._notesLoaded = false; // this will tell the toggleState method that
		// notes need to be loaded first, thus doing the actual initialisation

		// Initialisation of the signals connections
		this._bindKeyboardShortcut();
		this._connectAllSignals();
	}

	// Read-only accessors for the NoteBox objects
	get settings () {
		return this._settings;
	}

	get autoFocus () {
		return this._autoFocus;
	}

	_bindKeyboardShortcut () {
		this._useKeyboardShortcut = this._settings.get_boolean('use-shortcut');
		if (this._useKeyboardShortcut) {
			Main.wm.addKeybinding(
				'notes-kb-shortcut',
				this._settings,
				Meta.KeyBindingFlags.NONE,
				Shell.ActionMode.ALL,
				this._onButtonPressed.bind(this)
			);
		}
	}

	_loadAllNotes () {
		let i = 0;
		let ended = false;
		while(!ended) {
			let file2 = GLib.build_filenamev([PATH, i.toString() + '_state']);
			if (GLib.file_test(file2, GLib.FileTest.EXISTS)) {
				this.createNote('', 16);
			} else {
				ended = true;
			}
			i++;
		}
		this._onlyHideNotes();
		this._notesLoaded = true;
	}

	//--------------------------------------------------------------------------
	// "Public" methods, accessed by the NoteBox objects -----------------------

	createNote (colorString, fontSize) {
		let nextId = this._allNotes.length;
		try {
			this._allNotes.push(new NoteBox.NoteBox(this, nextId, colorString, fontSize));
		} catch (e) {
			Main.notify(_("Notes extension error: failed to load a note"));
			log('failed to create note n°' + nextId.toString());
			log(e);
		}
	}

	/*
	 * When a NoteBox object deletes itself, it calls this method to ensure the
	 * files go from 0 to (this._allNotes.length - 1) without any "gap" in the
	 * numerotation.
	 */
	postDelete (deletedNoteId) {
		let lastNote = this._allNotes.pop();
		if (deletedNoteId < this._allNotes.length) {
			this._allNotes[deletedNoteId] = lastNote;
			lastNote.id = deletedNoteId;
			this._allNotes[deletedNoteId].onlySave();
		}
		this._deleteNoteFiles(this._allNotes.length);
	}

	/*
	 * Tells if [x, y] are suitable coords for a note (= not too close of the
	 * other existing notes). Called by NoteBox objects on various occasions,
	 * for example when brought back to the primary monitor, or when deciding
	 * the initial coords at the creation of the note.
	 */
	areCoordsUsable (x, y) {
		let areaIsFree = true;
		this._allNotes.forEach(function (n) {
			if( (Math.abs(n._x - x) < 230) && (Math.abs(n._y - y) < 100) ) {
				areaIsFree = false;
			}
		});
		return areaIsFree;
	}

	/*
	 * Called by the note options menu when the user opens the preferences
	 * window: the notes then have to disappear from the desktop.
	 */
	hideNotes () {
		this._hideNotes();
	}

	//--------------------------------------------------------------------------

	_showNotes () {
		this._notesAreVisible = true;
		this._allNotes.forEach(function (n) {
			n.show();
		});
	}

	_hideNotes () {
		// A note left in the editing mode gets back to the read-only mode, so
		// that every note is read-only the next time the notes are shown
		this._allNotes.forEach(function (n) {
			n.setEditMode(false);
		});
		this._onlyHideNotes();
		this._timeout_id = Mainloop.timeout_add(10, () => {
			this._timeout_id = null;
			// saving to the disk is slightly delayed to give the illusion that
			// the extension doesn't freeze the system
			this._allNotes.forEach(function (n) {
				n.onlySave(false);
			});
			return GLib.SOURCE_REMOVE;
		});
	}

	_onlyHideNotes () {
		this._allNotes.forEach(function (n) {
			n.onlyHide();
		});
		this._notesAreVisible = false;
	}

	_deleteNoteFiles (id) {
		let filePathBeginning = PATH + '/' + id.toString();
		let textfile = Gio.file_new_for_path(filePathBeginning + '_text');
		let statefile = Gio.file_new_for_path(filePathBeginning + '_state');
		textfile.delete(null); // may not do anything
		statefile.delete(null); // may not do anything
	}

	_onButtonPressed (actor, event) {
		// the keyboard shortcut arrives without any Clutter event
		if (event && typeof event.get_button === 'function') {
			if (event.get_button() === Clutter.BUTTON_SECONDARY) {
				this._menu.toggle();
				return;
			}
		}
		this._toggleNotes();
	}

	_toggleNotes () {
		if(!this._notesLoaded) {
			this._loadAllNotes();
		}

		if(this._allNotes.length == 0) {
			this.createNote('', 16);
			this._showNotes();
		} else if (this._notesAreVisible) {
			this._hideNotes();
		} else {
			this._showNotes();
		}
	}

	//--------------------------------------------------------------------------
	// Context menu of the panel button, opened on right-click -----------------

	/*
	 * The button is created with dontCreateMenu=true: the shell would else
	 * open its (empty) menu on every click. We thus build and manage our own
	 * PopupMenu (same pattern as NoteRoundButton in menus.js), so that the
	 * left-click keeps toggling the notes, and the right-click opens this
	 * menu. The 'active' pseudo-class highlighting is done here too, since
	 * it is normally handled by PanelMenu.Button.setMenu.
	 */
	_buildPanelMenu () {
		this._menu = new PopupMenu.PopupMenu(this.panel_button, 0.0, St.Side.TOP);
		this._menu.actor.add_style_class_name('panel-menu');
		Main.uiGroup.add_actor(this._menu.actor);
		this._menu.actor.hide();

		this._addIconAction(_("New note"), Common.getCustomIcon(Me.dir, 'new-note'),
			this._onMenuNewNote.bind(this));
		this._addIconAction(_("Settings"), Common.getCustomIcon(Me.dir, 'setting'),
			this._onMenuSettings.bind(this));
		this._menu.addAction(_("Quit"), this._onMenuQuit.bind(this));

		this._menuManager = new PopupMenu.PopupMenuManager(this.panel_button);
		this._menuManager.addMenu(this._menu);

		this._menu.connect('open-state-changed', (menu, open) => {
			if (open) {
				this.panel_button.add_style_pseudo_class('active');
			} else {
				this.panel_button.remove_style_pseudo_class('active');
			}
		});
	}

	/*
	 * Same as PopupMenu.addAction, but with a bundled SVG (as a Gio.Icon)
	 * displayed before the label. The icon is inserted at index 1, that is
	 * right after the ornament container, before the label.
	 */
	_addIconAction (label, icon, callback) {
		let menuItem = this._menu.addAction(label, callback);
		let iconActor = new St.Icon({
			gicon: icon,
			icon_size: 16,
			style_class: 'popup-menu-icon',
		});
		menuItem.actor.insert_child_at_index(iconActor, 1);
	}

	_onMenuNewNote () {
		this._menu.close();
		if(!this._notesLoaded) {
			this._loadAllNotes();
		}
		this.createNote('', 16);
	}

	_onMenuSettings () {
		this._menu.close();
		if (typeof ExtensionUtils.openPrefs === 'function') {
			ExtensionUtils.openPrefs();
		} else {
			Util.spawn(['gnome-shell-extension-prefs', Me.uuid]);
		}
		this.hideNotes();
	}

	_onMenuQuit () {
		this._menu.close();
		this.hideNotes();
	}

	//--------------------------------------------------------------------------
	// Watch the gsettings values and update the extension if they change ------

	_connectAllSignals () {
		this._settingsSignals = {};

		this._settingsSignals['bring-back'] = this._settings.connect(
			'changed::ugly-hack',
			this._bringToPrimaryMonitorOnly.bind(this)
		);
		this._settingsSignals['hide-icon'] = this._settings.connect(
			'changed::hide-icon',
			this._updateIconVisibility.bind(this)
		);
		this._settingsSignals['kb-shortcut-1'] = this._settings.connect(
			'changed::use-shortcut',
			this._updateShortcut.bind(this)
		);
		this._settingsSignals['kb-shortcut-2'] = this._settings.connect(
			'changed::notes-kb-shortcut',
			this._updateShortcut.bind(this)
		);
		this._settingsSignals['auto-focus'] = this._settings.connect(
			'changed::auto-focus',
			this._updateFocusSetting.bind(this)
		);
	}

	_updateShortcut () {
		if(this._useKeyboardShortcut) {
			Main.wm.removeKeybinding('notes-kb-shortcut');
		}
		this._bindKeyboardShortcut();
	}

	_updateFocusSetting () {
		// XXX currently not very user-friendly
		Main.notify(
			_("Notes"),
			_("Restart the extension to apply the changes")
		);
	}

	_updateIconVisibility () {
		let now_visible = !this._settings.get_boolean('hide-icon');
		this.panel_button.visible = now_visible;
	}

	_bringToPrimaryMonitorOnly () {
		this._allNotes.forEach(function (n) {
			n.fixState();
		});
	}

	//--------------------------------------------------------------------------

	destroy() {
		this._settings.disconnect(this._settingsSignals['bring-back']);
		this._settings.disconnect(this._settingsSignals['hide-icon']);
		this._settings.disconnect(this._settingsSignals['kb-shortcut-1']);
		this._settings.disconnect(this._settingsSignals['kb-shortcut-2']);
		this._settings.disconnect(this._settingsSignals['auto-focus']);

		this._allNotes.forEach(function (n) {
			n.onlySave(false);
			n.destroy();
		});

		if(this._useKeyboardShortcut) {
			Main.wm.removeKeybinding('notes-kb-shortcut');
		}

		this._menu.destroy();
		this.panel_button.destroy();

		if (this._timeout_id) {
			Mainloop.source_remove(this._timeout_id);
			this._timeout_id = null;
		}
	}
};

//------------------------------------------------------------------------------

