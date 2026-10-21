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
const Layouts = Me.imports.layouts;
const NoteBox = Me.imports.noteBox;

const Gettext = imports.gettext.domain('notes-extension');
const _ = Gettext.gettext;

//------------------------------------------------------------------------------

const PATH = Common.DATA_PATH;

// A display reconfiguration storms 'monitors-changed'; the layout is applied
// once, after things settle, for the final configuration
const MONITORS_DEBOUNCE_MS = 1000;

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
		// The "Automatic focus" option is disabled for now (see noteBox.js)
		//this._autoFocus = settings.get_boolean('auto-focus');

		// Initialisation of the button in the top panel
		this.panel_button = new PanelMenu.Button(0.0, _("Show notes"), true);
		// Full-color bundled PNG (icons/notes.png): St downscales it to the
		// panel size, which also keeps it crisp at HiDPI scale factors
		let icon = new St.Icon({
			gicon: Common.getCustomIcon(Me.dir, 'notes'),
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

		// The layout registry (task 001 / ADR-0001) owns the stable note ids,
		// the monitor-independent note attributes (color, font size) and one
		// saved layout per monitor configuration. It is initialized lazily,
		// together with the notes: the legacy code deferred everything to the
		// first toggle too, and this keeps enable() free of any dependence on
		// the layout manager being ready.
		this._store = null;
		this._currentKey = null;
		this._monitorsDebounceId = null;

		// Initialisation of the signals connections
		this._bindKeyboardShortcut();
		this._connectAllSignals();
	}

	// Read-only accessors for the NoteBox objects
	get settings () {
		return this._settings;
	}

	/*
	 * Creates the layout registry and loads it; a missing (or unusable)
	 * registry triggers the one-time migration from the legacy per-note
	 * `N_state` files, whose coordinates were relative to the primary monitor.
	 */
	_ensureStore () {
		if (this._store) { return; }
		this._store = new Layouts.LayoutStore(
			GLib.build_filenamev([PATH, 'layouts.json']), Common.MAX_LAYOUTS
		);
		if (!this._store.load()) {
			let primary = Main.layoutManager.primaryMonitor;
			this._store.migrateFromStateFiles(PATH,
				{ x: primary.x, y: primary.y },
				Layouts.signature(this._monitorRects())
			);
		}
	}

	/* Logical monitor geometries, in the shape layouts.js expects. */
	_monitorRects () {
		return Main.layoutManager.monitors.map(function (m) {
			return { x: m.x, y: m.y, width: m.width, height: m.height };
		});
	}

	//get autoFocus () {
	//	return this._autoFocus;
	//}

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
		this._ensureStore();

		this._currentKey = Layouts.signature(this._monitorRects());
		let layout = this._store.layoutFor(this._currentKey);
		let positions = layout ? layout.positions : {};

		// Notes without a saved position in this configuration (first run
		// after the migration to another configuration, or a note created
		// while another configuration was active) get a deterministic fold
		// slot on the primary monitor; clamping is a safety net for positions
		// saved for a geometry that overlaps the current one
		let ids = this._store.noteIds();
		let missing = ids.filter(function (id) {
			return !positions[id];
		}).map(function (id) {
			return { id: id, w: Layouts.DEFAULT_WIDTH, h: Layouts.DEFAULT_HEIGHT };
		});
		if (missing.length > 0) {
			let occupied = ids.filter(function (id) {
				return !!positions[id];
			}).map(function (id) {
				return positions[id];
			});
			let folded = Layouts.foldInto(
				Main.layoutManager.primaryMonitor, missing, occupied
			);
			Object.keys(folded).forEach(function (id) {
				positions[id] = folded[id];
			});
		}

		ids.forEach((id) => {
			let attrs = this._store.getNoteAttrs(id)
				|| { color: '', fontSize: Layouts.DEFAULT_FONT_SIZE };
			let p = Layouts.clampRect(positions[id], this._monitorRects());
			this._createNoteBox(id, attrs.color, attrs.fontSize,
				p.x, p.y, p.w, p.h, false);
		});

		this._onlyHideNotes();
		this._notesLoaded = true;
		// the folded/clamped positions become the saved layout of this
		// configuration (this also refreshes its LRU recency)
		this.saveLayout();
	}

	//--------------------------------------------------------------------------
	// "Public" methods, accessed by the NoteBox objects -----------------------

	createNote (colorString, fontSize, startInEditMode = false) {
		this._ensureStore();
		let id = this._store.nextId();
		// brand-new notes go into a fold slot avoiding the existing notes'
		// rectangles (the deterministic replacement of the former random
		// placement); the 250x180 default size mirrors the legacy behavior
		let occupied = this._allNotes.map(function (n) {
			return { x: n._x, y: n._y, w: n.actor.width, h: n.actor.height };
		});
		let slot = Layouts.foldInto(
			Main.layoutManager.primaryMonitor,
			[{ id: id, w: Layouts.DEFAULT_WIDTH, h: Layouts.DEFAULT_HEIGHT }],
			occupied
		)[id];
		this._createNoteBox(id, colorString, fontSize,
			slot.x, slot.y, slot.w, slot.h, startInEditMode);
		this.saveLayout();
	}

	_createNoteBox (id, colorString, fontSize, x, y, w, h, startInEditMode) {
		try {
			let note = new NoteBox.NoteBox(this, {
				id: id,
				color: colorString,
				fontSize: fontSize,
				x: x, y: y, w: w, h: h,
				startInEditMode: startInEditMode
			});
			this._allNotes.push(note);
		} catch (e) {
			Main.notify(_("Notes extension error: failed to load a note"));
			log('failed to create note n°' + id.toString());
			log(e);
		}
	}

	/*
	 * When a NoteBox object deletes itself, it calls this method: the note is
	 * dropped from the registry (its attributes and its position in every
	 * saved layout), and only its text file is removed. Ids are never
	 * reused, so the other saved layouts stay valid.
	 */
	postDelete (deletedNoteId) {
		this._allNotes = this._allNotes.filter(function (n) {
			return n.id !== deletedNoteId;
		});
		this._store.removeNote(deletedNoteId);
		let textfile = Gio.file_new_for_path(
			PATH + '/' + deletedNoteId.toString() + '_text'
		);
		textfile.delete(null); // may not do anything
	}

	/*
	 * Single disk write for the whole set of notes: the positions of every
	 * note become the saved layout of the current monitor configuration, and
	 * the monitor-independent attributes (color, font size) are synced too.
	 * Called by the NoteBox objects (through onlySave) on drag/resize
	 * release, color or font size change, and by the manager itself.
	 */
	saveLayout () {
		this._currentKey = Layouts.signature(this._monitorRects());
		let positions = {};
		this._allNotes.forEach((n) => {
			positions[n.id] = {
				x: n._x,
				y: n._y,
				w: Math.floor(n.actor.width),
				h: Math.floor(n.actor.height)
			};
			this._store.setNoteAttrs(n.id, { color: n.customColor, fontSize: n._fontSize });
		});
		this._store.put(this._currentKey, positions);
	}

	// The note's geometry, in the shape the layouts.js helpers expect.
	_noteRect (note) {
		return {
			x: note._x,
			y: note._y,
			w: note.actor.width,
			h: note.actor.height
		};
	}

	_applyRectToNote (note, rect) {
		note._x = Math.floor(rect.x);
		note._y = Math.floor(rect.y);
		note.actor.width = Math.floor(rect.w);
		note.actor.height = Math.floor(rect.h);
		note._setNotePosition();
	}

	/*
	 * Re-position every note for the monitor configuration currently active,
	 * after a debounced monitors-changed whose signature actually changed:
	 * 1. notes with a position saved for this configuration get it back,
	 *    clamped to the current geometry (safety net for a configuration
	 *    overlapping the saved one only partially);
	 * 2. notes without one keep their current position when it is still
	 *    visible (intersecting the union of the monitors), otherwise they are
	 *    folded into a deterministic slot of the primary monitor;
	 * 3. the result becomes the saved layout of this configuration.
	 */
	applyLayoutForCurrentConfig () {
		let monitors = this._monitorRects();
		this._currentKey = Layouts.signature(monitors);

		let layout = this._store.layoutFor(this._currentKey);
		let positions = layout ? layout.positions : {};

		let occupied = [];
		let unplaced = [];
		this._allNotes.forEach((n) => {
			let saved = positions[n.id];
			if (saved) {
				this._applyRectToNote(n, Layouts.clampRect(saved, monitors));
				occupied.push(this._noteRect(n));
			} else {
				unplaced.push(n);
			}
		});

		let kept = unplaced.filter((n) => {
			return Layouts.intersectsAnyMonitor(this._noteRect(n), monitors);
		});
		// the notes keeping their spot also count as occupied by the fold
		let lost = unplaced.filter(function (n) {
			return kept.indexOf(n) === -1;
		});
		kept.forEach((n) => {
			occupied.push(this._noteRect(n));
		});

		let slots = Layouts.foldInto(
			Main.layoutManager.primaryMonitor,
			lost.map(function (n) {
				return { id: n.id, w: n.actor.width, h: n.actor.height };
			}),
			occupied
		);
		lost.forEach((n) => {
			this._applyRectToNote(n, slots[n.id]);
		});

		this.saveLayout();
	}

	/*
	 * Gathers every note into a deterministic cascade on the primary monitor,
	 * whatever the current configuration is. Bound to the "Bring back to the
	 * primary monitor" button of the preferences (through the ugly-hack
	 * gsettings key, see _connectAllSignals).
	 */
	foldAllIntoPrimary () {
		let slots = Layouts.foldInto(
			Main.layoutManager.primaryMonitor,
			this._allNotes.map(function (n) {
				return { id: n.id, w: n.actor.width, h: n.actor.height };
			}),
			[]
		);
		this._allNotes.forEach((n) => {
			this._applyRectToNote(n, slots[n.id]);
		});
		this.saveLayout();
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
			this.createNote('', 16, true);
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
		this.createNote('', 16, true);
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
		this._monitorsChangedId = Main.layoutManager.connect(
			'monitors-changed',
			this._onMonitorsChanged.bind(this)
		);
		//this._settingsSignals['auto-focus'] = this._settings.connect(
		//	'changed::auto-focus',
		//	this._updateFocusSetting.bind(this)
		//);
	}

	_updateShortcut () {
		if(this._useKeyboardShortcut) {
			Main.wm.removeKeybinding('notes-kb-shortcut');
		}
		this._bindKeyboardShortcut();
	}

	//_updateFocusSetting () {
	//	// XXX currently not very user-friendly
	//	Main.notify(
	//		_("Notes"),
	//		_("Restart the extension to apply the changes")
	//	);
	//}

	_onMonitorsChanged () {
		// before the first load there is nothing to reposition (and no
		// _currentKey to compare against): loading evaluates the layout of
		// the configuration active at that moment
		if (!this._notesLoaded) { return; }
		this._armMonitorDebounce();
	}

	/*
	 * Re-arming the timeout coalesces the signals storm of a display
	 * reconfiguration into a single layout application.
	 */
	_armMonitorDebounce () {
		if (this._monitorsDebounceId) {
			Mainloop.source_remove(this._monitorsDebounceId);
		}
		this._monitorsDebounceId = Mainloop.timeout_add(
			MONITORS_DEBOUNCE_MS,
			() => {
				this._monitorsDebounceId = null;
				// applying a layout while a note is being dragged would fight
				// with the pointer: retry after the same delay, the release
				// ends the loop
				if (this._allNotes.some(function (n) {
					return n._isMoving || n._isResizing;
				})) {
					this._armMonitorDebounce();
					return GLib.SOURCE_REMOVE;
				}
				this._applyLayoutIfConfigChanged();
				return GLib.SOURCE_REMOVE;
			}
		);
	}

	_applyLayoutIfConfigChanged () {
		let newKey = Layouts.signature(this._monitorRects());
		if (newKey === this._currentKey) { return; }
		this.applyLayoutForCurrentConfig();
	}

	_updateIconVisibility () {
		let now_visible = !this._settings.get_boolean('hide-icon');
		this.panel_button.visible = now_visible;
	}

	_bringToPrimaryMonitorOnly () {
		// nothing to gather before the notes are actually loaded
		if (!this._notesLoaded) { return; }
		this.foldAllIntoPrimary();
	}

	//--------------------------------------------------------------------------

	destroy() {
		this._settings.disconnect(this._settingsSignals['bring-back']);
		this._settings.disconnect(this._settingsSignals['hide-icon']);
		this._settings.disconnect(this._settingsSignals['kb-shortcut-1']);
		this._settings.disconnect(this._settingsSignals['kb-shortcut-2']);
		//this._settings.disconnect(this._settingsSignals['auto-focus']);
		Main.layoutManager.disconnect(this._monitorsChangedId);

		this._allNotes.forEach(function (n) {
			n.onlySave(false);
			n.destroy();
		});

		// the texts were saved just above; this flushes the registry itself
		if (this._store) {
			this._store.save();
		}

		if(this._useKeyboardShortcut) {
			Main.wm.removeKeybinding('notes-kb-shortcut');
		}

		this._menu.destroy();
		this.panel_button.destroy();

		if (this._timeout_id) {
			Mainloop.source_remove(this._timeout_id);
			this._timeout_id = null;
		}

		// a monitors-changed debounce may still be pending
		if (this._monitorsDebounceId) {
			Mainloop.source_remove(this._monitorsDebounceId);
			this._monitorsDebounceId = null;
		}
	}
};

//------------------------------------------------------------------------------

