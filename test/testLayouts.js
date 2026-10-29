// Unit tests for notes@escator/layouts.js — plain gjs, no shell:
//     gjs -m test/testLayouts.js     (from the repository root)

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

import * as Layouts from '../notes@escator/layouts.js';

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

function eq(name, actual, expected) {
	check(name, JSON.stringify(actual) === JSON.stringify(expected));
}

// Flat temp dir per test; files are removed best-effort, the dir itself is
// disposable (/tmp) if removal fails.
function withTempDir(fn) {
	const dir = GLib.dir_make_tmp('notes-layouts-test-XXXXXX');
	try {
		return fn(dir);
	} finally {
		['_bak-test'].forEach(function () {}); // no-op, see cleanup below
		cleanupDir(dir);
	}
}

function cleanupDir(dir) {
	try {
		const iter = Gio.File.new_for_path(dir).enumerate_children(
			'standard::name',
			Gio.FileQueryInfoFlags.NONE,
			null
		);
		let info;
		while ((info = iter.next_file(null)) !== null) {
			try {
				Gio.File.new_for_path(GLib.build_filenamev([dir, info.get_name()]))
					.delete(null);
			} catch (e) { /* keep going */ }
		}
		iter.close(null);
		try {
			Gio.File.new_for_path(dir).delete(null); // works on empty dirs
		} catch (e) { /* leave it in /tmp */ }
	} catch (e) { /* leave it in /tmp */ }
}

function writeFile(path, contents) {
	GLib.file_set_contents(path, contents);
}

const MONITOR_A = { x: 0, y: 0, width: 1920, height: 1080 };
const MONITOR_B = { x: 1920, y: 0, width: 2560, height: 1440 };

//------------------------------------------------------------------------------

print('== signature ==');

eq('single monitor', Layouts.signature([MONITOR_A]), '1920x1080+0+0');
eq(
	'reorder invariant',
	Layouts.signature([MONITOR_A, MONITOR_B]),
	Layouts.signature([MONITOR_B, MONITOR_A])
);
check(
	'different geometry, different key',
	Layouts.signature([MONITOR_A, MONITOR_B]) !== Layouts.signature([MONITOR_A])
);
eq(
	'same size, different offset, different key',
	Layouts.signature([{ x: 0, y: 0, width: 1920, height: 1080 }]),
	'1920x1080+0+0'
);
check(
	'offset matters',
	Layouts.signature([{ x: 1920, y: 0, width: 1920, height: 1080 }])
		!== Layouts.signature([{ x: 0, y: 0, width: 1920, height: 1080 }])
);

//------------------------------------------------------------------------------

print('== clampRect ==');

eq(
	'inside a monitor unchanged',
	Layouts.clampRect({ x: 100, y: 50, w: 250, h: 180 }, [MONITOR_A]),
	{ x: 100, y: 50, w: 250, h: 180 }
);
eq(
	'hanging off the right edge pulled in',
	Layouts.clampRect({ x: 1900, y: 50, w: 250, h: 180 }, [MONITOR_A]),
	{ x: 1920 - 250, y: 50, w: 250, h: 180 }
);
eq(
	'negative x pulled in',
	Layouts.clampRect({ x: -100, y: 0, w: 250, h: 180 }, [MONITOR_A]),
	{ x: 0, y: 0, w: 250, h: 180 }
);
eq(
	'oversized resized to the monitor',
	Layouts.clampRect({ x: 500, y: 500, w: 4000, h: 3000 }, [MONITOR_A]),
	{ x: 0, y: 0, w: 1920, h: 1080 }
);
eq(
	'rect on the second monitor stays there',
	Layouts.clampRect({ x: 3000, y: 200, w: 250, h: 180 }, [MONITOR_A, MONITOR_B]),
	{ x: 3000, y: 200, w: 250, h: 180 }
);
eq(
	'rect spanning two monitors goes to the bigger overlap',
	Layouts.clampRect({ x: 1880, y: 0, w: 250, h: 180 }, [MONITOR_A, MONITOR_B]),
	{ x: 1920, y: 0, w: 250, h: 180 } // 210px on B vs 40px on A
);

//------------------------------------------------------------------------------

print('== bestMonitor ==');

eq(
	'biggest overlap wins',
	Layouts.bestMonitor({ x: 1880, y: 0, w: 250, h: 180 }, [MONITOR_A, MONITOR_B]),
	MONITOR_B
);
eq(
	'outside every monitor: the first one',
	Layouts.bestMonitor({ x: 5000, y: 5000, w: 250, h: 180 }, [MONITOR_A, MONITOR_B]),
	MONITOR_A
);
check('empty monitor list is null', Layouts.bestMonitor(
	{ x: 0, y: 0, w: 250, h: 180 }, []
) === null);
check(
	'clampRect survives an empty list through bestMonitor',
	JSON.stringify(Layouts.clampRect({ x: 7, y: 8, w: 250, h: 180 }, []))
		=== JSON.stringify({ x: 7, y: 8, w: 250, h: 180 })
);

//------------------------------------------------------------------------------

print('== fitExpandRect ==');

// the height the text needs, as noteBox measures it; the test variants are
// constant or hand-computed so the expectations below stay exact
const NEEDED_COMPACT = function () { return 200; };
const NEEDED_TALLISH = function () { return 600; };
const NEEDED_HUGE = function () { return 2000; };

// compact text: the search floor is the current width, found immediately,
// nothing shifts — the rect just gets the 3:4 proportion
eq(
	'compact text keeps the position, floor width',
	Layouts.fitExpandRect(
		{ x: 100, y: 100, w: 250, h: 180 }, [MONITOR_A], NEEDED_COMPACT
	),
	{ x: 100, y: 100, w: 250, h: 4 / 3 * 250 }
);

// at the bottom edge: the search widens until the text fits, then the rect
// slides up — its bottom stays inside the monitor
eq(
	'bottom edge: slides up',
	Layouts.fitExpandRect(
		{ x: 100, y: 1000, w: 250, h: 180 }, [MONITOR_A], NEEDED_TALLISH
	),
	{ x: 100, y: 1080 - 600, w: 450, h: 600 } // 4/3·450 = 600 fits
);

// at the right edge: slides left, its right edge stays inside the monitor;
// the rect lies across the A/B border, A still owns it (bigger overlap)
eq(
	'right edge: slides left',
	Layouts.fitExpandRect(
		{ x: 1700, y: 100, w: 250, h: 180 }, [MONITOR_A, MONITOR_B], NEEDED_TALLISH
	),
	{ x: 1920 - 450, y: 100, w: 450, h: 600 }
);

// a rect fully on the second monitor expands with its geometry
eq(
	'expansion follows the owning monitor',
	Layouts.fitExpandRect(
		{ x: 3000, y: 100, w: 250, h: 180 }, [MONITOR_A, MONITOR_B], NEEDED_TALLISH
	),
	{ x: 3000, y: 100, w: 450, h: 600 }
);

// safety net A: neededH is satisfied nowhere, the width is fixed at the
// monitor's — here the rect ends up being the whole monitor and the tail of
// the text stays hidden (the "note bigger than the screen" corner case)
eq(
	'safety net A: full monitor, tail hidden',
	Layouts.fitExpandRect(
		{ x: 500, y: 500, w: 250, h: 180 }, [MONITOR_A], NEEDED_HUGE
	),
	{ x: 0, y: 0, w: 1920, h: 1080 }
);

// the height cap is min(4/3·W, monitor height), not always the monitor: on a
// portrait monitor the pinned width keeps the proportion and still hides the
// tail
const PORTRAIT = { x: 0, y: 0, width: 1080, height: 1920 };
eq(
	'corner case: width pinned, height cut at 4/3, tail hidden',
	Layouts.fitExpandRect(
		{ x: 0, y: 0, w: 250, h: 180 }, [PORTRAIT], function () { return 1500; }
	),
	{ x: 0, y: 0, w: 1080, h: 1440 } // 4/3·1080 = 1440 < 1500
);

// safety net B: the monitor's height cuts the 3:4 proportion in favor of
// fitting the rect into the monitor
const SMALL = { x: 0, y: 0, width: 800, height: 300 };
eq(
	'safety net B: proportion cut by the monitor height',
	Layouts.fitExpandRect(
		{ x: 10, y: 10, w: 250, h: 100 }, [SMALL], NEEDED_COMPACT
	),
	{ x: 10, y: 0, w: 250, h: 300 } // 4/3·250 = 333 → 300
);

// a base wider than the monitor: the search floor is the monitor's width,
// the rect never grows past it
const TALL = { x: 0, y: 0, width: 800, height: 1200 };
eq(
	'base wider than the monitor: floor at monitor.width',
	Layouts.fitExpandRect(
		{ x: 0, y: 0, w: 1000, h: 400 }, [TALL], NEEDED_COMPACT
	),
	{ x: 0, y: 0, w: 800, h: 4 / 3 * 800 }
);

// no monitors at all: the base rect comes back untouched (same graceful
// fallback as clampRect)
eq(
	'empty monitor list returns the base rect',
	Layouts.fitExpandRect(
		{ x: 5, y: 6, w: 250, h: 180 }, [], NEEDED_TALLISH
	),
	{ x: 5, y: 6, w: 250, h: 180 }
);

//------------------------------------------------------------------------------

print('== intersectsAnyMonitor ==');

check('rect inside a monitor', Layouts.intersectsAnyMonitor(
	{ x: 100, y: 100, w: 250, h: 180 }, [MONITOR_A]
));
check('rect on the second monitor', Layouts.intersectsAnyMonitor(
	{ x: 3000, y: 200, w: 250, h: 180 }, [MONITOR_A, MONITOR_B]
));
check(
	'rect spanning the border between two monitors',
	Layouts.intersectsAnyMonitor({ x: 1880, y: 0, w: 250, h: 180 }, [MONITOR_A, MONITOR_B])
);
check('rect fully outside', !Layouts.intersectsAnyMonitor(
	{ x: 5000, y: 5000, w: 250, h: 180 }, [MONITOR_A, MONITOR_B]
));
check('rect left of everything', !Layouts.intersectsAnyMonitor(
	{ x: -500, y: 0, w: 250, h: 180 }, [MONITOR_A]
));
// [1920, 250) touches monitor A's right edge without entering it
check('edge touching does not count', !Layouts.intersectsAnyMonitor(
	{ x: 1920, y: 0, w: 250, h: 180 }, [MONITOR_A]
));
check('empty monitor list', !Layouts.intersectsAnyMonitor(
	{ x: 0, y: 0, w: 250, h: 180 }, []
));

//------------------------------------------------------------------------------

print('== foldInto ==');

const NOTES = [
	{ id: 2, w: 250, h: 180 },
	{ id: 0, w: 250, h: 180 },
	{ id: 1, w: 250, h: 180 },
];

function inMonitor(rect, m) {
	const inner = {
		x: m.x + 16, y: m.y + 16,
		w: m.width - 32, h: m.height - 32,
	};
	return rect.x >= inner.x && rect.y >= inner.y
		&& rect.x + rect.w <= inner.x + inner.w
		&& rect.y + rect.h <= inner.y + inner.h;
}

const fold1 = Layouts.foldInto(MONITOR_A, NOTES);
const fold2 = Layouts.foldInto(MONITOR_A, NOTES);
eq('deterministic', fold1, fold2);
eq('placed in id order regardless of input order', Object.keys(fold1), ['0', '1', '2']);
check(
	'all within monitor bounds',
	Object.keys(fold1).every(function (id) {
		return inMonitor(fold1[id], MONITOR_A);
	})
);
check(
	'no overlap among placed notes',
	!Layouts._overlaps(fold1['0'], fold1['1'])
	&& !Layouts._overlaps(fold1['0'], fold1['2'])
	&& !Layouts._overlaps(fold1['1'], fold1['2'])
);
eq(
	'first note at the top-left corner',
	{ x: fold1['0'].x, y: fold1['0'].y },
	{ x: MONITOR_A.x + 16, y: MONITOR_A.y + 16 }
);

const foldOcc = Layouts.foldInto(
	MONITOR_A,
	[{ id: 0, w: 250, h: 180 }],
	[{ x: 16, y: 16, w: 250, h: 180 }] // occupies the top-left slot
);
check(
	'avoids occupied rectangles',
	!Layouts._overlaps(foldOcc['0'], { x: 16, y: 16, w: 250, h: 180 })
);
eq('occupied input not mutated', foldOcc, Layouts.foldInto(
	MONITOR_A,
	[{ id: 0, w: 250, h: 180 }],
	[{ x: 16, y: 16, w: 250, h: 180 }]
));

const foldBig = Layouts.foldInto(MONITOR_A, [{ id: 0, w: 5000, h: 4000 }]);
check(
	'oversized note clamped to the monitor',
	foldBig['0'].w <= MONITOR_A.width - 32 && foldBig['0'].h <= MONITOR_A.height - 32
);

const many = [];
for (let i = 0; i < 60; i++) {
	many.push({ id: i, w: 250, h: 180 });
}
const foldMany = Layouts.foldInto(MONITOR_A, many);
check(
	'many notes still terminate and stay in bounds',
	Object.keys(foldMany).length === 60
	&& Object.keys(foldMany).every(function (id) {
		return inMonitor(foldMany[id], MONITOR_A);
	})
);

//------------------------------------------------------------------------------

print('== LayoutStore: ids, attrs, roundtrip ==');

withTempDir(function (dir) {
	const path = GLib.build_filenamev([dir, 'layouts.json']);
	const store = new Layouts.LayoutStore(path, 8);

	check('fresh store loads nothing', store.load() === false);
	eq('empty note ids', store.noteIds(), []);

	eq('nextId never reuses values', [store.nextId(), store.nextId(), store.nextId()], [0, 1, 2]);
	store.setNoteAttrs(0, { color: '232,213,184', fontSize: 14 });
	eq(
		'attrs roundtrip',
		store.getNoteAttrs(0),
		{ color: '232,213,184', fontSize: 14 }
	);
	eq('unknown attrs', store.getNoteAttrs(99), null);

	store.put('K1', { 0: { x: 10, y: 20, w: 250, h: 180 } });
	eq(
		'layout roundtrip through the disk',
		store.layoutFor('K1').positions,
		{ 0: { x: 10, y: 20, w: 250, h: 180 } }
	);
	check('layoutFor miss is null', store.layoutFor('NOPE') === null);

	// roundtrip through a second instance reading the file
	const store2 = new Layouts.LayoutStore(path, 8);
	check('second instance loads', store2.load() === true);
	eq('note ids survive reload', store2.noteIds(), [0]);
	eq('positions survive reload', store2.layoutFor('K1').positions, { 0: { x: 10, y: 20, w: 250, h: 180 } });

	// deep-copy guarantees
	const before = JSON.stringify(store.layoutFor('K1'));
	const leaked = store.layoutFor('K1');
	leaked.positions['0'].x = 9999;
	eq('layoutFor returns a copy', JSON.stringify(store.layoutFor('K1')), before);

	// removeNote drops the note everywhere
	store.put('K2', { 0: { x: 1, y: 2, w: 250, h: 180 } });
	store.removeNote(0);
	eq('removeNote: ids', store.noteIds(), []);
	eq('removeNote: layout K1', store.layoutFor('K1').positions, {});
	eq('removeNote: layout K2', store.layoutFor('K2').positions, {});
	const store3 = new Layouts.LayoutStore(path, 8);
	store3.load();
	eq('removeNote persisted', store3.noteIds(), []);
});

//------------------------------------------------------------------------------

print('== LayoutStore: LRU eviction ==');

withTempDir(function (dir) {
	const store = new Layouts.LayoutStore(GLib.build_filenamev([dir, 'layouts.json']), 8);
	for (let i = 0; i < 8; i++) {
		store.put('K' + i, {});
		// deterministic recency for the test (put uses Date.now())
		store._data.layouts['K' + i].savedAt = 1000 + i;
	}
	store.put('K8', {}); // 9th layout: K0 is the least recently used
	check('oldest evicted', store.layoutFor('K0') === null);
	check('others kept', store.layoutFor('K1') !== null && store.layoutFor('K8') !== null);

	// touch refreshes recency: K1 must now outlive K2
	store.touch('K1'); // sets savedAt to Date.now(), far above 1000+
	store.put('K9', {});
	check('touch protects a layout', store.layoutFor('K1') !== null);
	check('next oldest evicted instead', store.layoutFor('K2') === null);
});

//------------------------------------------------------------------------------

print('== LayoutStore: migration from N_state ==');

withTempDir(function (dir) {
	writeFile(GLib.build_filenamev([dir, '0_state']), '100;50;232,213,184;250;180;16;');
	// legacy 7-field file (entry_is_visible) and a file with garbage numbers
	writeFile(GLib.build_filenamev([dir, '1_state']), '0;0;1,2,3;200;100;12;1\n');
	writeFile(GLib.build_filenamev([dir, '2_state']), 'abc;def;sky;300;150;20;');

	const store = new Layouts.LayoutStore(GLib.build_filenamev([dir, 'layouts.json']), 8);
	const count = store.migrateFromStateFiles(dir, { x: 1920, y: 0 }, '1920x1080+0+0,2560x1440+1920+0');

	eq('migrated count', count, 3);
	eq('note ids from file numbers', store.noteIds(), [0, 1, 2]);
	eq('seq continues after migrated ids', [store.nextId(), store.nextId()], [3, 4]);
	eq('attrs: normal file', store.getNoteAttrs(0), { color: '232,213,184', fontSize: 16 });
	eq('attrs: legacy 7th field ignored', store.getNoteAttrs(1), { color: '1,2,3', fontSize: 12 });
	eq('attrs: garbage keeps finite fields', store.getNoteAttrs(2), { color: 'sky', fontSize: 20 });

	const positions = store.layoutFor('1920x1080+0+0,2560x1440+1920+0').positions;
	eq(
		'relative-to-primary converted to global',
		positions['0'],
		{ x: 1920 + 100, y: 0 + 50, w: 250, h: 180 }
	);
	eq('legacy file coordinates', positions['1'], { x: 1920, y: 0, w: 200, h: 100 });
	eq(
		'garbage coordinates degrade to defaults',
		positions['2'],
		{ x: 1920 + 10, y: 10, w: 300, h: 150 }
	);

	// persisted and re-readable; _state files left in place
	const store2 = new Layouts.LayoutStore(GLib.build_filenamev([dir, 'layouts.json']), 8);
	check('migration persisted', store2.load() === true && store2.noteIds().length === 3);
	check(
		'_state files untouched',
		GLib.file_test(GLib.build_filenamev([dir, '0_state']), GLib.FileTest.EXISTS)
			&& GLib.file_test(GLib.build_filenamev([dir, '2_state']), GLib.FileTest.EXISTS)
	);
});

//------------------------------------------------------------------------------

print('== LayoutStore: corruption and version guard ==');

withTempDir(function (dir) {
	const path = GLib.build_filenamev([dir, 'layouts.json']);

	// good save, then corrupt the main file: the .bak must take over
	// (.bak appears on the second save — the first has no previous version)
	let store = new Layouts.LayoutStore(path, 8);
	store.put('K1', { 0: { x: 5, y: 6, w: 250, h: 180 } });
	store.put('K2', {});
	writeFile(path, '{ this is not json');

	store = new Layouts.LayoutStore(path, 8);
	check('corrupt main file falls back to .bak', store.load() === true);
	eq('data from .bak', store.layoutFor('K1').positions, { 0: { x: 5, y: 6, w: 250, h: 180 } });

	// no usable file at all: empty registry, no crash
	writeFile(path, '###');
	GLib.file_set_contents(path + '.bak', 'also broken');
	store = new Layouts.LayoutStore(path, 8);
	check('everything corrupt: empty registry', store.load() === false);
	eq('empty: no notes', store.noteIds(), []);

	// wrong version is rejected rather than mis-read
	writeFile(path, JSON.stringify({ version: 99, seq: 5, notes: {}, layouts: {} }));
	store = new Layouts.LayoutStore(path, 8);
	check('wrong version rejected', store.load() === false);

	// per-note garbage degrades instead of rejecting the file
	store = new Layouts.LayoutStore(path, 8);
	store._data = {
		version: 1,
		seq: 3,
		notes: {
			0: { color: 'sky', fontSize: 12 },
			1: 'garbage',
			notAnId: { color: 'x', fontSize: 3 },
		},
		layouts: {
			K1: {
				savedAt: 123,
				positions: {
					0: { x: 1, y: 2, w: 3, h: 4 },
					1: { x: 'x', y: 2, w: 3, h: 4 }, // dropped
				},
			},
			K2: 'garbage', // dropped
		},
	};
	store.save();
	const store2 = new Layouts.LayoutStore(path, 8);
	check('sanitized file loads', store2.load() === true);
	eq('garbage attrs get defaults', store2.getNoteAttrs(1), { color: '', fontSize: 16 });
	eq('non-numeric id dropped', store2.noteIds(), [0, 1]);
	eq(
		'valid position kept, invalid dropped',
		store2.layoutFor('K1').positions,
		{ 0: { x: 1, y: 2, w: 3, h: 4 } }
	);
	check('garbage layout dropped', store2.layoutFor('K2') === null);
	eq('seq stays above known ids', store2.nextId(), 3);

	// .bak rotation: after a second save the .bak holds the previous version
	store2.put('K3', {});
	const bakContents = GLib.file_get_contents(path + '.bak')[1];
	check(
		'.bak holds the previous version',
		String(typeof bakContents === 'string' ? bakContents : String.fromCharCode.apply(null, bakContents))
			.indexOf('K3') === -1
	);
});

//------------------------------------------------------------------------------

print('\n' + (checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
	print(failures + ' FAILURES');
	System.exit(1);
}
System.exit(0);
