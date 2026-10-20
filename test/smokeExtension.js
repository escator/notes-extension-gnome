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
		addChrome: function () {},
		trackChrome: function () {},
		untrackChrome: function () {},
	},
	panel: { addToStatusArea: function () {} },
	uiGroup: { add_actor: function () {} },
	wm: {
		addKeybinding: function () { return 1; },
		removeKeybinding: function () {},
	},
	notify: function () {},
};

class FakeIcon {
	constructor(props) { Object.assign(this, props || {}); }
}

class FakeButton {
	constructor() { this.visible = true; }
	add_child() {}
	connect() { return 1; }
	destroy() {}
}

class FakeMenu {
	constructor() {
		this.actor = {
			add_style_class_name: function () {},
			hide: function () {},
			connect: function () { return 1; },
		};
	}
	addAction() { return { actor: { insert_child_at_index: function () {} } }; }
	connect() { return 1; }
	close() {}
	toggle() {}
	destroy() {}
}

class FakeMenuManager {
	constructor() {}
	addMenu() {}
}

// gsettings double: `changed::key` handlers are kept so the tests can emit
// the signals (the ugly-hack channel used by the prefs fold button)
const settingsHandlers = {};
const fakeSettings = {
	get_boolean: function () { return false; },
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
		this.customColor = (spec.color === '') ? '184,217,242' : spec.color;
		this._fontSize = spec.fontSize;
		this.actor = {
			x: Math.floor(spec.x),
			y: Math.floor(spec.y),
			width: Math.floor(spec.w),
			height: Math.floor(spec.h),
			set_position: function (x, y) { this.x = x; this.y = y; },
		};
		createdSpecs.push(spec);
	}
	_setNotePosition () {
		this.actor.set_position(Math.floor(this._x), Math.floor(this._y));
	}
	onlyHide() {}
	show() {}
	setEditMode() {}
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

const fakeImports = {
	gi: {
		St: { Icon: FakeIcon, Side: { TOP: 1 } },
		Shell: { ActionMode: { ALL: 1 } },
		GLib: GLib,
		Gio: Gio,
		Meta: { KeyBindingFlags: { NONE: 0 } },
		Clutter: { BUTTON_SECONDARY: 3 },
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
		popupMenu: { PopupMenu: FakeMenu, PopupMenuManager: FakeMenuManager },
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
check('destroy cancelled the debounce', pendingTimeouts.length === 0);

//------------------------------------------------------------------------------

print((checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
	System.exit(1);
}
