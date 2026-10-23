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
		// the color filter badge (task 004): a small dot shown next to the
		// icon while a filter is active, so the filter is never forgotten
		this._filterDot = new St.Bin({
			style_class: 'notesFilterBadge',
			x_align: Clutter.ActorAlign.END,
			y_align: Clutter.ActorAlign.END,
			visible: false
		});
		let buttonContent = new St.BoxLayout({ vertical: false });
		buttonContent.add_child(icon);
		buttonContent.add_child(this._filterDot);
		this.panel_button.add_child(buttonContent);
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

		// The color filter (task 004 / ADR-0003): name of the active preset,
		// or null. A session-only state, deliberately not persisted.
		this._colorFilter = null;

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
			return n.getPersistedRect();
		});
		let slot = Layouts.foldInto(
			Main.layoutManager.primaryMonitor,
			[{ id: id, w: Layouts.DEFAULT_WIDTH, h: Layouts.DEFAULT_HEIGHT }],
			occupied
		)[id];
		let note = this._createNoteBox(id, colorString, fontSize,
			slot.x, slot.y, slot.w, slot.h, startInEditMode);
		this.saveLayout();
		// null when the NoteBox constructor threw (the failure is already
		// notified); the caller may want the object (e.g. to fill it)
		return note;
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
			return note;
		} catch (e) {
			Main.notify(_("Notes extension error: failed to load a note"));
			log('failed to create note n°' + id.toString());
			log(e);
			return null;
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
			let r = n.getPersistedRect();
			positions[n.id] = {
				x: r.x,
				y: r.y,
				w: Math.floor(r.w),
				h: Math.floor(r.h)
			};
			this._store.setNoteAttrs(n.id, { color: n.customColor, fontSize: n._fontSize });
		});
		this._store.put(this._currentKey, positions);
	}

	// The note's geometry, in the shape the layouts.js helpers expect: the
	// single geometry source for the manager (home rect while expanded —
	// task 005, 02-architecture §1).
	_noteRect (note) {
		return note.getPersistedRect();
	}

	_applyRectToNote (note, rect) {
		// the applied layout is made of saved (home) rectangles: an expanded
		// note leaves the expanded mode first, instantly (monitors-changed
		// and 'bring back to the primary monitor' never lay out the
		// expanded view)
		if (note._expanded) {
			note._collapseNote(false);
		}
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
				let r = n.getPersistedRect();
				return { id: n.id, w: r.w, h: r.h };
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
				let r = n.getPersistedRect();
				return { id: n.id, w: r.w, h: r.h };
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
		this._allNotes.filter(this._passesFilter, this).forEach(function (n) {
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

	//--------------------------------------------------------------------------
	// Color filter (task 004 / ADR-0003) ---------------------------------------
	//
	// Visibility invariant: a note is visible if and only if the notes are
	// globally visible AND it passes the filter (always true when the filter
	// is null). Every change goes through NoteBox.show/onlyHide, so that the
	// input region follows.

	/* Strict comparison of the rgb string: the colors outside the presets
	 * don't exist anymore (the custom color is gone, the default is beige). */
	_passesFilter (note) {
		return this._colorFilter === null
			|| note.customColor === Common.PRESET_COLORS[this._colorFilter].rgb.join(',');
	}

/* Hides (with a fade-out) the visible notes that stop passing the newly set
 * filter; the edit mode is left by fadeOutAndHide itself. */
_applyFilterHiding () {
	this._allNotes.forEach((n) => {
		if (n.actor.visible && !this._passesFilter(n)) {
			n.fadeOutAndHide();
		}
	});
}

/* Called by NoteBox.applyColorAndSave: a visible note whose fresh color
 * doesn't match the active filter fades away. The reverse case (a hidden
 * note becoming the filter's color) can't happen: the menu of a hidden note
 * is unreachable (02-architecture.md §4). */
refreshFilterForNote (note) {
	if (this._colorFilter !== null
			&& note.actor.visible
			&& !this._passesFilter(note)) {
		note.fadeOutAndHide();
	}
}

	/* Toggle semantics: selecting the active preset again clears the filter. */
	setColorFilter (presetName) {
		if (presetName === this._colorFilter) {
			this.clearColorFilter();
			return;
		}
		this._colorFilter = presetName;
		this._applyFilterHiding();
		this._updateFilterBadge();
	}

	clearColorFilter () {
		this._colorFilter = null;
		// the globally hidden case is already covered by the next _showNotes;
		// cancelFadeOut first, so that a note caught mid-fade comes back
		// opaque instead of dissolving after being shown again
		if (this._notesAreVisible) {
			this._allNotes.forEach(function (n) {
				n.cancelFadeOut();
				n.show();
			});
		}
		this._updateFilterBadge();
	}

	/* The color new notes get while a filter is active (empty string keeps
	 * the default, i.e. the first note's color). */
	_filterColorString () {
		if (this._colorFilter === null) { return ''; }
		return Common.PRESET_COLORS[this._colorFilter].rgb.join(',');
	}

	// the dot's color is the active preset's ring: darker and more
	// contrasted than the fill on the dark panel
	_updateFilterBadge () {
		if (this._colorFilter === null) {
			this._filterDot.visible = false;
			return;
		}
		this._filterDot.style = 'background-color: '
			+ Common.PRESET_COLORS[this._colorFilter].ring + ';';
		this._filterDot.visible = true;
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
			this.createNote(this._filterColorString(), 16, true);
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
		// the clipboard content is only known asynchronously: the item starts
		// insensitive, and gets enabled on each menu opening if there is some
		// text to paste (see the 'open-state-changed' handler below)
		this._newFromClipboardItem = this._addIconAction(_("New from Clipboard"),
			Common.getCustomIcon(Me.dir, 'edit-paste'),
			this._onMenuNewFromClipboard.bind(this));
		this._newFromClipboardItem.setSensitive(false);
		this._buildFilterSection();
		this._addIconAction(_("Settings"), Common.getCustomIcon(Me.dir, 'setting'),
			this._onMenuSettings.bind(this));

		this._menuManager = new PopupMenu.PopupMenuManager(this.panel_button);
		this._menuManager.addMenu(this._menu);

		this._menu.connect('open-state-changed', (menu, open) => {
			if (open) {
				this.panel_button.add_style_pseudo_class('active');
				this._refreshFilterMenu();
				// 'New from Clipboard' makes sense only with some text in the
				// clipboard; the read is asynchronous, so the item visibly
				// grays out (or back in) a moment after the menu opens
				St.Clipboard.get_default().get_text(
					St.ClipboardType.CLIPBOARD,
					(clipboard, text) => {
						this._newFromClipboardItem.setSensitive(!!text);
					}
				);
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
		return menuItem;
	}

	/*
	 * The color filter section (task 004 / ADR-0003): a non-interactive
	 * title, two rows of swatches in the palette order and a "Reset filter"
	 * item. The row/swatch widgets reuse the NoteOptionsMenu patterns
	 * (non-reactive PopupBaseMenuItems hosting St.Buttons).
	 */
	_buildFilterSection () {
		this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

		let titleItem = new PopupMenu.PopupBaseMenuItem({
			reactive: false,
			activate: false,
			hover: false,
			style_class: null,
			can_focus: false
		});
		titleItem.actor.add_child(new St.Label({
			text: _("Filter by color"),
			x_expand: true,
			x_align: Clutter.ActorAlign.START,
			y_align: Clutter.ActorAlign.CENTER,
		}));
		this._menu.addMenuItem(titleItem);

		this._filterSwatches = {};
		let row1 = this._newSwatchRow();
		let row2 = this._newSwatchRow();
		['peach', 'cream', 'mint', 'sky'].forEach(
			(name) => this._addFilterSwatch(name, row1));
		['lavender', 'pink', 'sage', 'beige'].forEach(
			(name) => this._addFilterSwatch(name, row2));
		this._menu.addMenuItem(row1);
		this._menu.addMenuItem(row2);

		// like the swatches, the reset closes the menu (_onApply pattern):
		// the result is immediately visible on the desktop
		this._resetFilterItem = this._menu.addAction(_("Reset filter"), () => {
			this.clearColorFilter();
			this._menu.close();
		});
		this._resetFilterItem.setSensitive(false);
	}

	_newSwatchRow () {
		return new PopupMenu.PopupBaseMenuItem({
			reactive: false,
			activate: false,
			hover: false,
			style_class: null,
			can_focus: false
		});
	}

	_addFilterSwatch (presetName, rowItem) {
		let btn = new St.Button({
			style_class: 'notesCircleButton',
			style: this._swatchStyle(presetName),
			x_expand: true,
			x_align: Clutter.ActorAlign.CENTER,
		});
		btn.connect('clicked', () => {
			this.setColorFilter(presetName);
			this._menu.close();
		});
		rowItem.actor.add_child(btn);
		this._filterSwatches[presetName] = btn;
	}

	/* The swatch background is the preset fill; the active filter's swatch
	 * additionally gets the ring of its own color (COLOR.md §4.2, the same
	 * convention as the current color in the note options menu). */
	_swatchStyle (presetName) {
		let preset = Common.PRESET_COLORS[presetName];
		let rgb = preset.rgb;
		let style = 'background-color: rgb(' + rgb[0] + ','
			+ rgb[1] + ','
			+ rgb[2] + ');';
		if (presetName === this._colorFilter) {
			style += 'border-color: ' + preset.ring + '; border-width: 2px;';
		}
		return style;
	}

	/* Called on every menu opening: redraw the rings and the reset item. */
	_refreshFilterMenu () {
		Object.keys(this._filterSwatches).forEach((name) => {
			this._filterSwatches[name].set_style(this._swatchStyle(name));
		});
		this._resetFilterItem.setSensitive(this._colorFilter !== null);
	}

	_onMenuNewNote () {
		this._menu.close();
		if(!this._notesLoaded) {
			this._loadAllNotes();
		}
		this.createNote(this._filterColorString(), 16, true);
	}

	/*
	 * Creates a note prefilled with the clipboard's text, kept in the
	 * read-only mode (like every existing note; the user clicks 'Edit' to
	 * modify it). The clipboard read is asynchronous: nothing is created when
	 * the clipboard got emptied between the menu opening and this callback.
	 */
	_onMenuNewFromClipboard () {
		this._menu.close();
		if(!this._notesLoaded) {
			this._loadAllNotes();
		}
		St.Clipboard.get_default().get_text(
			St.ClipboardType.CLIPBOARD,
			(clipboard, text) => {
				if (!text) { return; }
				let note = this.createNote(this._filterColorString(), 16, false);
				if (note != null) {
					note.appendClipboardText(text);
				}
			}
		);
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

