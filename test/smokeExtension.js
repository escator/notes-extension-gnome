// Offline smoke test for extension.js (NotesManager) — plain gjs, no shell:
//     gjs test/smokeExtension.js     (from the repository root)
//
// The manager runs against a fake `imports` tree (stubs for St/Shell/Clutter/
// Main/PanelMenu/…) and a fake NoteBox, so the code under test is the real
// extension.js: the one-time migration from the legacy `N_state` files, the
// loading of layouts.json, the stable ids, saveLayout and postDelete.

const { GLib, Gio } = imports.gi;
const ByteArray = imports.byteArray;
const System = imports.system;

const EXT_DIR = GLib.get_current_dir() + '/notes@maestroschan.fr';

//------------------------------------------------------------------------------

let checks = 0;
let failures = 0;

function check(name, cond) {
	checks++;
	if (cond) {
		print('ok   ' + name);
	} else {
		failures++;
		print('FAIL ' + name);
	}
}

/* Order-insensitive stringify: JSON.stringify depends on the keys' insertion
 * order, which is an implementation detail of the tested code. */
function sortedStringify(v) {
	if (Array.isArray(v)) {
		return '[' + v.map(sortedStringify).join(',') + ']';
	}
	if (v && typeof v === 'object') {
		return '{' + Object.keys(v).sort().map(function (k) {
			return JSON.stringify(k) + ':' + sortedStringify(v[k]);
		}).join(',') + '}';
	}
	return JSON.stringify(v);
}

function eq(name, actual, expected) {
	check(name, sortedStringify(actual) === sortedStringify(expected));
}

function fileExists(path) {
	return GLib.file_test(path, GLib.FileTest.EXISTS);
}

//------------------------------------------------------------------------------

// XDG_DATA_HOME must be redirected before common.js is evaluated: DATA_PATH is
// computed from GLib.get_user_data_dir() at import time and caches
const tmpBase = GLib.dir_make_tmp('notes-ext-smoke-XXXXXX');
const DATA_PATH = GLib.build_filenamev([tmpBase, 'notes@maestroschan.fr']);
GLib.setenv('XDG_DATA_HOME', tmpBase, true);
GLib.mkdir_with_parents(DATA_PATH, 0o755);

function readFile(path) {
	const [ok, data] = GLib.file_get_contents(path);
	if (!ok) {
		throw new Error('cannot read ' + path);
	}
	return ByteArray.toString(data);
}

/* Evaluates a module the way the gjs importer would, with a hand-built
 * `imports` object, and returns the requested top-level exports. */
function loadModule(path, importsObj, exportNames) {
	const fn = new Function('imports', readFile(path) + '\n;return {' + exportNames + '};');
	return fn(importsObj);
}

//------------------------------------------------------------------------------

// two-monitor configuration; monitor 0 is the primary at the origin, monitor 1
// sits to its right, so migrated relative coords must land beyond x=1920
const MONITORS = [
	{ x: 0, y: 0, width: 1920, height: 1080 },
	{ x: 1920, y: 0, width: 1280, height: 1024 },
];

// timeout_add/source_remove drive a tiny manual scheduler: the tests fire the
// pending callbacks themselves (flush-free determinism)
let pendingTimeouts = [];
let nextTimeoutId = 1;
// the last 'monitors-changed' callback connected by the manager under test
let monitorsChangedCb = null;

// the chrome bookkeeping (task 007): what the catcher added/removed
let chromeAdded = [];
let chromeRemoved = [];

// the free `global` object extension.js sees in the shell; the module under
// test is evaluated with the Function constructor, so the binding must live
// on globalThis (this script's consts are not in its scope chain)
const global = {
	stage: { name: 'stage' },
	window_group: { name: 'window_group' },
};
globalThis.global = global;

// uiGroup double keeping its children, so the catcher pinning can be checked
const uiGroup = {
	children: [global.window_group, { name: 'top_window_group' }],
	pinnedBelow: null,
	add_actor: function (a) {
		if (this.children.indexOf(a) === -1) { this.children.push(a); }
	},
	add_child: function (a) { this.add_actor(a); },
	remove_actor: function (a) {
		this.children = this.children.filter(function (c) { return c !== a; });
	},
	get_children: function () { return this.children; },
	set_child_below_sibling: function (actor, sibling) {
		this.pinnedBelow = { actor: actor, sibling: sibling };
	},
};

const Main = {
	layoutManager: {
		monitors: MONITORS,
		primaryMonitor: MONITORS[0],
		connect: function (sig, cb) {
			if (sig === 'monitors-changed') {
				monitorsChangedCb = cb;
			}
			return 1;
		},
		disconnect: function () {},
		addChrome: function (a) { chromeAdded.push(a); },
		removeChrome: function (a) { chromeRemoved.push(a); },
		trackChrome: function () {},
		untrackChrome: function () {},
	},
	panel: { addToStatusArea: function () {} },
	uiGroup: uiGroup,
	wm: {
		addKeybinding: function () { return 1; },
		removeKeybinding: function () {},
	},
	notify: function () {},
};

class FakeIcon {
	constructor(props) { Object.assign(this, props || {}); }
}

/* Generic St widget double (Bin, BoxLayout, Label, Button…): records the
 * constructor properties, keeps a visible flag. */
class FakeWidget {
	constructor(props) {
		this.visible = true;
		Object.assign(this, props || {});
	}
	add_child() {}
	connect() { return 1; }
	set_style() {}
	destroy() {}
}

class FakeButton {
	constructor() { this.visible = true; }
	add_child() {}
	connect() { return 1; }
	destroy() {}
}

class FakeMenu {
	constructor() {
		this.toggleCount = 0;
		this.actor = {
			add_style_class_name: function () {},
			hide: function () {},
			connect: function () { return 1; },
		};
	}
	addAction() {
		return {
			actor: { insert_child_at_index: function () {} },
			setSensitive: function () {},
		};
	}
	addMenuItem() {}
	connect() { return 1; }
	close() {}
	toggle() { this.toggleCount++; }
	destroy() {}
}

/* PopupBaseMenuItem / PopupSeparatorMenuItem double: hosts an actor. */
class FakePopupItem {
	constructor() { this.actor = new FakeWidget(); }
	setSensitive() {}
}

class FakeMenuManager {
	constructor() {}
	addMenu() {}
}

// gsettings double: `changed::key` handlers are kept so the tests can emit
// the signals (the ugly-hack channel used by the prefs fold button); the
// boolean keys are stored per key (defaults from the gschema)
const settingsHandlers = {};
const boolSettings = {
	'use-shortcut': false,
	'hide-icon': false,
	'hide-on-click-outside': true,
};
const fakeSettings = {
	get_boolean: function (key) { return boolSettings[key]; },
	set_boolean: function (key, v) { boolSettings[key] = v; },
	get_strv: function () { return [0.5, 0.5, 0.5]; },
	connect: function (key, cb) { settingsHandlers[key] = cb; return 1; },
	disconnect: function () {},
};

/*
 * NoteBox double: records the spec handed over by the manager (id, color,
 * fontSize, geometry — that's the manager/note contract under test) and
 * exposes the fields saveLayout reads back.
 */
let createdSpecs = [];
class FakeNoteBox {
	constructor(manager, spec) {
		this._manager = manager;
		this.id = spec.id;
		this.spec = spec;
		this._x = Math.floor(spec.x);
		this._y = Math.floor(spec.y);
		this._expanded = false;
		this._homeRect = null;
		this.customColor = (spec.color === '') ? '184,217,242' : spec.color;
		this._fontSize = spec.fontSize;
		this.actor = {
			x: Math.floor(spec.x),
			y: Math.floor(spec.y),
			width: Math.floor(spec.w),
			height: Math.floor(spec.h),
			visible: true, // a real note enters the chrome visible
			set_position: function (x, y) { this.x = x; this.y = y; },
		};
		this.showCount = 0;
		this.hideCount = 0;
		this.fadeCount = 0;
		this.cancelCount = 0;
		this._editMode = false;
		createdSpecs.push(spec);
	}
	_setNotePosition () {
		this.actor.set_position(Math.floor(this._x), Math.floor(this._y));
	}
	// the manager-facing geometry contract (task 005): home rect while
	// expanded, live geometry otherwise
	getPersistedRect () {
		if (this._expanded) { return this._homeRect; }
		return { x: this._x, y: this._y, w: this.actor.width, h: this.actor.height };
	}
	// outcome-level mirror of an instant collapse: snap to the home rect
	_collapseNote () {
		this._expanded = false;
		if (this._homeRect) {
			this._x = this._homeRect.x;
			this._y = this._homeRect.y;
			this.actor.width = this._homeRect.w;
			this.actor.height = this._homeRect.h;
			this._homeRect = null;
		}
	}
	onlyHide() {
		this.actor.visible = false;
		this.hideCount++;
	}
	fadeOutAndHide() {
		// outcome-level mirror of the real method: the manager only cares
		// that the note is hidden and has left the edit mode (guard included);
		// the animation itself can only be checked live
		if (!this.actor.visible) { return; }
		this._editMode = false;
		this.fadeCount++;
		this.onlyHide();
	}
	cancelFadeOut() {
		this.cancelCount++;
	}
	show() {
		this.actor.visible = true;
		this.showCount++;
	}
	setEditMode(editing) {
		this._editMode = editing;
	}
	appendClipboardText(text) {
		this.appendedText = text;
	}
	destroy() {}
	onlySave(withMetadata) {
		if (withMetadata) {
			this._manager.saveLayout();
		}
	}
}

//------------------------------------------------------------------------------

const common = loadModule(EXT_DIR + '/common.js',
	{ gi: { GLib: GLib, Gio: Gio } },
	'DATA_PATH, MAX_LAYOUTS, PRESET_COLORS, TEXT_COLORS, CUSTOM_ICONS, getCustomIcon');

const layouts = loadModule(EXT_DIR + '/layouts.js',
	{ gi: { GLib: GLib }, byteArray: ByteArray },
	'signature, clampRect, intersectsAnyMonitor, foldInto, LayoutStore, DEFAULT_FONT_SIZE, DEFAULT_WIDTH, DEFAULT_HEIGHT');

const Me = {
	uuid: 'notes@maestroschan.fr',
	dir: Gio.File.new_for_path(EXT_DIR),
	imports: { common: common, layouts: layouts, noteBox: { NoteBox: FakeNoteBox } },
};

/* The plain Clutter.Actor double (the light-dismiss catcher of task 007):
 * constructor props recorded, signal handlers kept so the tests can emit
 * them. */
class FakeActor {
	constructor(props) {
		this.visible = true;
		this.handlers = {};
		Object.assign(this, props || {});
	}
	connect(sig, cb) {
		this.handlers[sig] = cb;
		return 1;
	}
	destroy() { this.destroyed = true; }
}

class FakeBindConstraint {
	constructor(props) { Object.assign(this, props || {}); }
}

const fakeImports = {
	gi: {
		St: {
			Icon: FakeIcon,
			Bin: FakeWidget,
			BoxLayout: FakeWidget,
			Label: FakeWidget,
			Button: FakeWidget,
			Side: { TOP: 1 },
			ClipboardType: { CLIPBOARD: 0 },
			Clipboard: {
				get_default: function () {
					return {
						// the test clipboard always has some text
						get_text: function (type, cb) { cb(null, 'clipboard text'); },
					};
				},
			},
		},
		Shell: { ActionMode: { ALL: 1 } },
		GLib: GLib,
		Gio: Gio,
		Meta: { KeyBindingFlags: { NONE: 0 } },
		Clutter: {
			BUTTON_SECONDARY: 3,
			ActorAlign: { START: 0, CENTER: 3, END: 2 },
			Actor: FakeActor,
			BindConstraint: FakeBindConstraint,
			BindCoordinate: { ALL: 0 },
			EVENT_STOP: 1,
			EVENT_PROPAGATE: 0,
			Settings: {
				get_default: function () { return { double_click_time: 400 }; },
			},
		},
	},
	// extension.js imports Mainloop from the top level, like in the shell
	mainloop: {
		timeout_add: function (delay, cb) {
			pendingTimeouts.push({ id: nextTimeoutId, delay: delay, cb: cb });
			return nextTimeoutId++;
		},
		source_remove: function (id) {
			pendingTimeouts = pendingTimeouts.filter(function (t) {
				return t.id !== id;
			});
		},
	},
	ui: {
		panelMenu: { Button: FakeButton },
		panel: {},
		main: Main,
		popupMenu: {
			PopupMenu: FakeMenu,
			PopupMenuManager: FakeMenuManager,
			PopupBaseMenuItem: FakePopupItem,
			PopupSeparatorMenuItem: FakePopupItem,
		},
	},
	misc: {
		extensionUtils: {
			initTranslations: function () {},
			getCurrentExtension: function () { return Me; },
			getSettings: function () { return fakeSettings; },
			openPrefs: undefined,
		},
		util: { spawn: function () {} },
	},
	gettext: {
		domain: function () { return { gettext: function (s) { return s; } }; },
	},
};

const extension = loadModule(EXT_DIR + '/extension.js', fakeImports,
	'enable, disable, getNotesManager: function () { return NOTES_MANAGER; }');

//------------------------------------------------------------------------------

// legacy data: coordinates relative to the primary monitor (which sits at
// the origin here), 6-field format x;y;color;w;h;fontSize;
GLib.file_set_contents(DATA_PATH + '/0_state', '100;50;184,217,242;250;180;16;');
GLib.file_set_contents(DATA_PATH + '/1_state', '2100;120;255,240,168;300;200;12;');
GLib.file_set_contents(DATA_PATH + '/0_text', 'hello');
GLib.file_set_contents(DATA_PATH + '/1_text', 'world');

const SIG = layouts.signature(MONITORS);

extension.enable();
const manager = extension.getNotesManager();
manager._loadAllNotes();

check('registry file created at ' + DATA_PATH, fileExists(DATA_PATH + '/layouts.json'));

let store = new layouts.LayoutStore(DATA_PATH + '/layouts.json', common.MAX_LAYOUTS);
check('registry loads back', store.load());
eq('migrated note ids', store.noteIds(), [0, 1]);
eq('note 0 attributes migrated', store.getNoteAttrs('0'),
	{ color: '184,217,242', fontSize: 16 });
eq('note 1 attributes migrated', store.getNoteAttrs('1'),
	{ color: '255,240,168', fontSize: 12 });

let lay = store.layoutFor(SIG);
eq('note 0 position is now global', lay.positions['0'],
	{ x: 100, y: 50, w: 250, h: 180 });
eq('note 1 position is now global', lay.positions['1'],
	{ x: 2100, y: 120, w: 300, h: 200 });

eq('note 0 spec handed to the note', createdSpecs[0],
	{ id: 0, color: '184,217,242', fontSize: 16, x: 100, y: 50, w: 250, h: 180,
		startInEditMode: false });

check('legacy 0_state kept as backup', fileExists(DATA_PATH + '/0_state'));

// a brand-new note lands in a fold slot of the primary monitor
createdSpecs = [];
manager.createNote('', 16);
let spec2 = createdSpecs[0];
eq('new note got the next stable id', spec2.id, 2);
check('new note inside the primary monitor',
	spec2.x >= 0 && spec2.y >= 0
	&& spec2.x + spec2.w <= MONITORS[0].width
	&& spec2.y + spec2.h <= MONITORS[0].height);
function overlaps(a, b) {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
check('new note avoids note 0', !overlaps(spec2,
	{ x: 100, y: 50, w: 250, h: 180 }));

// deletion: dropped everywhere, ids not reused
manager.postDelete(0);
check('0_text deleted', !fileExists(DATA_PATH + '/0_text'));
check('legacy 0_state still kept', fileExists(DATA_PATH + '/0_state'));

store = new layouts.LayoutStore(DATA_PATH + '/layouts.json', common.MAX_LAYOUTS);
store.load();
eq('deleted note left the registry', store.noteIds(), [1, 2]);
lay = store.layoutFor(SIG);
check('deleted note left the layout', !lay.positions['0']);
eq('other positions untouched', lay.positions['1'],
	{ x: 2100, y: 120, w: 300, h: 200 });

createdSpecs = [];
manager.createNote('', 16);
eq('ids are never reused', createdSpecs[0].id, 3);

// fresh manager: everything is restored exactly (and the second load does
// not drift, since the saved layout already covers every note)
manager.destroy();
createdSpecs = [];
extension.enable();
const manager2 = extension.getNotesManager();
manager2._loadAllNotes();

store = new layouts.LayoutStore(DATA_PATH + '/layouts.json', common.MAX_LAYOUTS);
store.load();
lay = store.layoutFor(SIG);
[1, 2, 3].forEach(function (id) {
	let spec = createdSpecs.find(function (s) { return s.id === id; });
	check('note ' + id + ' exists after reload', !!spec);
	let p = lay.positions[String(id)];
	eq('note ' + id + ' restored exactly',
		[spec.x, spec.y, spec.w, spec.h], [p.x, p.y, p.w, p.h]);
});
eq('attributes survived the reload', store.getNoteAttrs('1'),
	{ color: '255,240,168', fontSize: 12 });

manager2.destroy();

//------------------------------------------------------------------------------
// Phase 3: monitors-changed debounce, applyLayoutForCurrentConfig, fold button

print('== phase 3: monitors-changed and fold ==');

const MON_A = MONITORS[0];
const SIG_TWO = SIG;
const SIG_MONO = layouts.signature([MON_A]);

function noteById(id) {
	return manager3._allNotes.find(function (n) { return n.id === id; });
}
function rectOf(n) {
	return { x: n._x, y: n._y, w: n.actor.width, h: n.actor.height };
}
function inMonitorA(p) {
	return p.x >= MON_A.x + 16 && p.y >= MON_A.y + 16
		&& p.x + p.w <= MON_A.x + MON_A.width - 16
		&& p.y + p.h <= MON_A.y + MON_A.height - 16;
}
function savedPositions(key) {
	let s = new layouts.LayoutStore(DATA_PATH + '/layouts.json', common.MAX_LAYOUTS);
	s.load();
	let l = s.layoutFor(key);
	return l ? l.positions : null;
}
function fireDebounce() {
	let t = pendingTimeouts.shift();
	if (!t) {
		throw new Error('no pending timeout to fire');
	}
	t.cb();
}

// a fresh manager whose notes are never loaded: both the monitors-changed
// handler and the ugly-hack button must be no-ops before the first load
createdSpecs = [];
extension.enable();
const managerIdle = extension.getNotesManager();
monitorsChangedCb();
check('monitors-changed before load: nothing armed', pendingTimeouts.length === 0);
check('monitors-changed before load: no store', managerIdle._store === null);
settingsHandlers['changed::ugly-hack']();
check('ugly-hack before load: no store', managerIdle._store === null);
extension.disable();

// the manager under test, loaded for the two-monitor configuration
createdSpecs = [];
extension.enable();
const manager3 = extension.getNotesManager();
manager3._loadAllNotes();

let twoPos = savedPositions(SIG_TWO);
let n1 = noteById(1), n2 = noteById(2), n3 = noteById(3);

// unchanged configuration: the debounced application exits early
let beforeBytes = readFile(DATA_PATH + '/layouts.json');
monitorsChangedCb();
check('monitors-changed arms the debounce', pendingTimeouts.length === 1);
monitorsChangedCb();
check('repeated signals coalesce into one timeout', pendingTimeouts.length === 1);
fireDebounce();
check('unchanged signature: registry untouched',
	readFile(DATA_PATH + '/layouts.json') === beforeBytes);

// single-monitor configuration: note 1 (saved on the second monitor) becomes
// invisible and gets folded; the visible notes keep their positions
Main.layoutManager.monitors = [MON_A];
monitorsChangedCb();
fireDebounce();
check('folded note inside the primary', inMonitorA(rectOf(n1)));
check('visible note 2 kept its position',
	n2._x === twoPos['2'].x && n2._y === twoPos['2'].y);
check('visible note 3 kept its position',
	n3._x === twoPos['3'].x && n3._y === twoPos['3'].y);
check('folded note avoids the kept notes',
	!overlaps(rectOf(n1), rectOf(n2)) && !overlaps(rectOf(n1), rectOf(n3)));

let monoPos = savedPositions(SIG_MONO);
check('single-monitor scheme saved', monoPos !== null);
check('scheme covers every note',
	['1', '2', '3'].every(function (id) { return !!monoPos[id]; }));
eq('kept note 2 saved as-is', monoPos['2'], twoPos['2']);
eq('kept note 3 saved as-is', monoPos['3'], twoPos['3']);
check('folded note saved inside the primary', inMonitorA(monoPos['1']));
eq('two-monitor scheme untouched', savedPositions(SIG_TWO)['1'], twoPos['1']);

// back to two monitors while a note is being dragged: the application is
// deferred, then happens once the note is released
Main.layoutManager.monitors = MONITORS;
n1._isMoving = true;
monitorsChangedCb();
fireDebounce(); // detects the drag, re-arms itself
check('drag defers the layout application', pendingTimeouts.length === 1);
check('dragging note not repositioned yet', inMonitorA(rectOf(n1)));
n1._isMoving = false;
fireDebounce();
check('released note restored to its saved position',
	n1._x === twoPos['1'].x && n1._y === twoPos['1'].y);
check('restored note has its saved size',
	n1.actor.width === twoPos['1'].w && n1.actor.height === twoPos['1'].h);

// the prefs button ("Bring back to the primary monitor", ugly-hack channel)
settingsHandlers['changed::ugly-hack']();
eq('button fold starts the cascade at the origin',
	{ x: n1._x, y: n1._y }, { x: 16, y: 16 });
check('button fold keeps every note in the primary',
	inMonitorA(rectOf(n1)) && inMonitorA(rectOf(n2)) && inMonitorA(rectOf(n3)));
check('button fold has no overlap',
	!overlaps(rectOf(n1), rectOf(n2)) && !overlaps(rectOf(n1), rectOf(n3))
		&& !overlaps(rectOf(n2), rectOf(n3)));
eq('button fold saved in the current scheme',
	savedPositions(SIG_TWO)['1'], rectOf(n1));

// a pending debounce is cancelled by destroy
monitorsChangedCb();
check('debounce pending before destroy', pendingTimeouts.length === 1);
manager3.destroy();

//------------------------------------------------------------------------------
// Phase 4: color filter (task 004 / ADR-0003)

print('== phase 4: color filter ==');

extension.enable();
const manager4 = extension.getNotesManager();
manager4._loadAllNotes();

function m4note(id) {
	return manager4._allNotes.find(function (n) { return n.id === id; });
}

const MINT = common.PRESET_COLORS['mint'].rgb.join(',');
const SKY = common.PRESET_COLORS['sky'].rgb.join(',');
const CREAM = common.PRESET_COLORS['cream'].rgb.join(',');
m4note(1).customColor = MINT;
m4note(2).customColor = SKY;
m4note(3).customColor = CREAM;

// applying a filter to visible notes: only the matching color survives, and
// the hidden notes leave the editing mode
manager4._showNotes();
m4note(2)._editMode = true;
manager4.setColorFilter('mint');
eq('filter state is the preset name', manager4._colorFilter, 'mint');
check('filtered note stays visible', m4note(1).actor.visible);
check('other colors hidden', !m4note(2).actor.visible && !m4note(3).actor.visible);
check('hidden notes left the edit mode', !m4note(2)._editMode);
check('hidden notes went through onlyHide', m4note(2).hideCount > 0);

// _showNotes under an active filter shows only the passing notes
manager4._onlyHideNotes();
manager4._showNotes();
check('show under filter: only the passing note',
	m4note(1).actor.visible && !m4note(2).actor.visible && !m4note(3).actor.visible);

// clearing the filter brings every note back, instantly
manager4.clearColorFilter();
check('filter is null after clearing', manager4._colorFilter === null);
check('clearing shows every note again',
	m4note(1).actor.visible && m4note(2).actor.visible && m4note(3).actor.visible);

// the toggle: selecting the active preset again clears the filter
manager4.setColorFilter('mint');
eq('filter active before the toggle', manager4._colorFilter, 'mint');
manager4.setColorFilter('mint');
check('re-selecting the preset clears the filter', manager4._colorFilter === null);
check('toggle made every note visible again',
	m4note(1).actor.visible && m4note(2).actor.visible && m4note(3).actor.visible);

// new notes get the filter color while a filter is active: exercised through
// the real menu call sites, which is where the color string comes from
manager4.setColorFilter('mint');
eq('_filterColorString returns the preset rgb', manager4._filterColorString(), MINT);
createdSpecs = [];
manager4._onMenuNewNote();
eq('new note gets the filter color', createdSpecs[0].color, MINT);
check('new note starts in the edit mode', createdSpecs[0].startInEditMode === true);
createdSpecs = [];
manager4._onMenuNewFromClipboard();
eq('clipboard note gets the filter color', createdSpecs[0].color, MINT);
manager4.clearColorFilter();
eq('_filterColorString empty without filter', manager4._filterColorString(), '');
createdSpecs = [];
manager4._onMenuNewNote();
eq('new note without filter keeps the empty color string', createdSpecs[0].color, '');

// a legacy color outside the palette passes no filter (ADR-0003 risk, accepted)
let odd = m4note(3);
odd.customColor = '10,20,30';
manager4.setColorFilter('mint');
check('off-palette color hidden by the mint filter', !odd.actor.visible);
manager4.setColorFilter('beige');
check('off-palette color hidden by any filter', !odd.actor.visible);
manager4.clearColorFilter();
check('off-palette color back after clearing', odd.actor.visible);

// the global toggle keeps the filter and its effect
manager4.setColorFilter('mint');
manager4._hideNotes();
check('global hide hides everyone, filter kept', manager4._colorFilter === 'mint'
	&& !m4note(1).actor.visible && !m4note(2).actor.visible);
manager4._showNotes();
check('global show respects the filter',
	m4note(1).actor.visible && !m4note(2).actor.visible && !m4note(3).actor.visible);
	manager4.clearColorFilter();
	check('final clearing shows everyone',
		m4note(1).actor.visible && m4note(2).actor.visible && m4note(3).actor.visible);

	// phase 3: the color-change hook. refreshFilterForNote is what the note
	// menu hits through applyColorAndSave: a visible note that stopped
	// matching the active filter fades away instead of staying around
	let fader = m4note(2);
	let baseline = fader.fadeCount; // fades accumulated by the rounds above
	fader.customColor = CREAM; // the note passes the filter that comes next
	manager4.setColorFilter('cream');
	check('note matching the filter stays visible', fader.actor.visible);
	fader._editMode = true;
	fader.customColor = SKY; // the user picks another preset in the note menu
	manager4.refreshFilterForNote(fader);
	check('color change hook fades the non-matching note',
		fader.fadeCount === baseline + 1 && !fader.actor.visible);
	check('faded note left the edit mode', !fader._editMode);
	check('fade went through onlyHide', fader.hideCount > 0);
	manager4.refreshFilterForNote(fader);
	check('already hidden note does not fade twice', fader.fadeCount === baseline + 1);
	manager4.clearColorFilter();
	fader.customColor = CREAM;
	manager4.setColorFilter('cream');
	manager4.refreshFilterForNote(fader);
	check('matching note is not faded',
		fader.fadeCount === baseline + 1 && fader.actor.visible);

	// clearing the filter cancels the fades before showing everyone back
	// (the mid-fade race itself is a live-check matter: timing is not
	// modeled here)
	manager4.clearColorFilter();
	check('clearing cancels fade-outs on every note',
		m4note(1).cancelCount > 0 && fader.cancelCount > 0 && m4note(3).cancelCount > 0);
	check('everyone is visible again after cancel + show',
		m4note(1).actor.visible && fader.actor.visible && m4note(3).actor.visible);
	manager4.refreshFilterForNote(fader);
	check('no fade when the filter is off', fader.fadeCount === baseline + 1);

manager4.destroy();
check('destroy cancelled the debounce', pendingTimeouts.length === 0);

//------------------------------------------------------------------------------
// Phase 5: expanded view vs home geometry on disk (task 005, phase 3)

print('== phase 5: expanded notes keep the home geometry on disk ==');

extension.enable();
const manager5 = extension.getNotesManager();
manager5._loadAllNotes();

function m5note(id) {
	return manager5._allNotes.find(function (n) { return n.id === id; });
}

// an expanded note (the state a double click leaves the real NoteBox in):
// the actor shows the inflated view, _homeRect is the geometry that must
// reach the disk
let n5 = m5note(2);
let home5 = savedPositions(SIG_TWO)['2'];
n5._expanded = true;
n5._homeRect = { x: home5.x, y: home5.y, w: home5.w, h: home5.h };
n5.actor.width = 1200;
n5.actor.height = 1600;

// README scenario 4: any action that saves the layout writes the home size,
// never the inflated view
manager5.saveLayout();
eq('expanded note saved with its home rect', savedPositions(SIG_TWO)['2'], home5);

// the layout application paths (monitors-changed, the fold button) apply
// saved home rectangles: the note leaves the expanded mode first
settingsHandlers['changed::ugly-hack']();
check('layout application folded the expanded note back',
	!n5._expanded && n5._homeRect === null);
check('folded note got a real slot, not the inflated view',
	n5.actor.width === home5.w && n5.actor.height === home5.h);
eq('folded layout saved clean', savedPositions(SIG_TWO)['2'],
	{ x: n5._x, y: n5._y, w: n5.actor.width, h: n5.actor.height });

manager5.destroy();
check('destroy cancelled the debounce (manager5)', pendingTimeouts.length === 0);

//------------------------------------------------------------------------------
// Phase 6: the panel button clicks (task 006 / ADR-0005)

print('== phase 6: panel button single vs double click ==');

extension.enable();
const manager6 = extension.getNotesManager();
manager6._loadAllNotes();

function leftClick6() {
	manager6._onButtonPressed(null, { get_button: function () { return 1; } });
}
function rightClick6() {
	manager6._onButtonPressed(null, { get_button: function () { return 3; } });
}
function pendingToggleCount() {
	return pendingTimeouts.filter(function (t) {
		return t.id === manager6._pendingToggleId;
	}).length;
}
function firePendingToggle() {
	let i = pendingTimeouts.findIndex(function (t) {
		return t.id === manager6._pendingToggleId;
	});
	if (i === -1) { throw new Error('no pending toggle to fire'); }
	// a GLib timeout returning SOURCE_REMOVE is retired once it has fired
	pendingTimeouts.splice(i, 1)[0].cb();
}

// the keyboard shortcut: instant toggle, nothing armed
check('manager starts hidden', manager6._notesAreVisible === false);
manager6._onButtonPressed(null, null);
check('keyboard toggle is instant', pendingTimeouts.length === 0
	&& manager6._notesAreVisible === true);

// a single left click is delayed, then toggles
manager6._onlyHideNotes();
leftClick6();
check('single click arms exactly one delayed toggle', pendingToggleCount() === 1);
check('single click is silent until the timeout', manager6._notesAreVisible === false);
eq('delay is the double-click time', pendingTimeouts.find(function (t) {
	return t.id === manager6._pendingToggleId;
}).delay, 400);
firePendingToggle();
check('delayed toggle showed the notes', manager6._notesAreVisible === true
	&& manager6._pendingToggleId === null);

// a double click cancels the toggle and creates an edit-mode note
manager6._onlyHideNotes();
createdSpecs = [];
leftClick6();
leftClick6();
eq('double click created exactly one note', createdSpecs.length, 1);
check('double-click note is in the edit mode', createdSpecs[0].startInEditMode === true);
check('double click cancelled the pending toggle', manager6._pendingToggleId === null
	&& pendingTimeouts.length === 0);
check('double click shows the notes without a toggle',
	manager6._notesAreVisible === true);

// a double click on visible notes does not hide them
createdSpecs = [];
leftClick6();
leftClick6();
eq('visible pair also creates one note', createdSpecs.length, 1);
check('visible pair never hid the notes', manager6._notesAreVisible === true);

// a right click cancels the pending toggle and opens the menu
leftClick6();
rightClick6();
eq('right click opened the menu', manager6._menu.toggleCount, 1);
check('right click cancelled the pending toggle', manager6._pendingToggleId === null
	&& pendingTimeouts.length === 0);

// a third click after the double behaves like a fresh single click
leftClick6();
check('third click arms a new toggle', pendingToggleCount() === 1);
firePendingToggle();
check('third click toggles like a single one', manager6._notesAreVisible === false);

// destroy with a pending toggle
leftClick6();
check('toggle pending before destroy', pendingToggleCount() === 1);
manager6.destroy();
check('destroy cancelled the pending toggle', pendingTimeouts.length === 0);

//------------------------------------------------------------------------------

print((checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
	System.exit(1);
}
