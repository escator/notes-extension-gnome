// Unit tests for notes@escator/textHistory.js — plain gjs, no shell:
//     gjs -m test/testTextHistory.js     (from the repository root)

import System from 'system';

import * as TextHistory from '../notes@escator/textHistory.js';

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

/*
 * Deterministic clock: each TextHistory instance in a test block shares one
 * mutable time value, advanced explicitly.
 */
function makeClock() {
	const state = { t: 0 };
	return {
		now: function () { return state.t; },
		advance: function (ms) { state.t += ms; },
	};
}

//------------------------------------------------------------------------------

print('== baseline ==');

{
	const clock = makeClock();
	const h = new TextHistory.TextHistory({ text: 'hello', cursor: 5 }, { now: clock.now });

	check('fresh history: cannot undo', !h.canUndo());
	check('fresh history: cannot redo', !h.canRedo());
	check('undo without changes is null', h.undo() === null);
	check('redo without undo is null', h.redo() === null);
	check('still cannot undo after null results', !h.canUndo() && !h.canRedo());
}

//------------------------------------------------------------------------------

print('== one portion: changes inside the window coalesce ==');

{
	const clock = makeClock();
	const h = new TextHistory.TextHistory({ text: '', cursor: 0 }, { now: clock.now });

	// typing "abc" as three text-changed events within the window
	h.onChange('a', 1);
	clock.advance(100);
	h.onChange('ab', 2);
	clock.advance(100);
	check('open portion: can undo', h.canUndo());
	check('open portion: cannot redo', !h.canRedo());

	h.onChange('abc', 3);
	clock.advance(100); // still inside the 800 ms window
	const snap = h.undo();
	eq('whole portion undone in one step', snap, { text: '', cursor: 0 });
	check('cannot undo past the baseline', !h.canUndo());
	check('undo made redo available', h.canRedo());

	const redone = h.redo();
	eq('redo restores the portion result', redone, { text: 'abc', cursor: 3 });
	check('redo exhausted', !h.canRedo());
	check('undo available again', h.canUndo());
}

//------------------------------------------------------------------------------

print('== window expiry: a late change starts a new step ==');

{
	const clock = makeClock();
	const h = new TextHistory.TextHistory({ text: '', cursor: 0 }, { now: clock.now });

	h.onChange('a', 1);
	clock.advance(799); // just inside the window
	h.onChange('ab', 2);
	clock.advance(801); // window expires before the next change
	h.onChange('abc', 3);
	clock.advance(100);

	// step 1: "ab"; step 2 (pending): "abc"
	eq('first undo lands before the expired portion', h.undo(), { text: 'ab', cursor: 2 });
	eq('second undo lands before the first portion', h.undo(), { text: '', cursor: 0 });
	check('exactly two steps', !h.canUndo());
}

{
	const clock = makeClock();
	const h = new TextHistory.TextHistory({ text: '', cursor: 0 }, { now: clock.now });

	h.onChange('a', 1);
	clock.advance(801); // the whole portion expired before undo was called
	check('expired portion still yields one undo step', h.canUndo());
	eq('expired portion undone as a whole', h.undo(), { text: '', cursor: 0 });
	check('nothing else to undo', !h.canUndo());
}

//------------------------------------------------------------------------------

print('== boundary() closes the portion ==');

{
	const clock = makeClock();
	const h = new TextHistory.TextHistory({ text: '', cursor: 0 }, { now: clock.now });

	h.onChange('a', 1);
	clock.advance(10);
	h.onChange('ab', 2);
	h.boundary();
	clock.advance(10);
	h.onChange('abc', 3); // a new portion after the boundary
	clock.advance(10);

	eq('boundary split the typing into two steps', h.undo(), { text: 'ab', cursor: 2 });
	eq('second step reaches the baseline', h.undo(), { text: '', cursor: 0 });
}

{
	const clock = makeClock();
	const h = new TextHistory.TextHistory({ text: 'base', cursor: 4 }, { now: clock.now });

	// boundary with no open portion must not create a phantom undo step
	h.boundary();
	check('boundary without changes creates no step', !h.canUndo());
	check('boundary does not clear redo when nothing changed', h.redo() === null);
}

//------------------------------------------------------------------------------

print('== depth cap: oldest steps are evicted ==');

{
	const clock = makeClock();
	const h = new TextHistory.TextHistory({ text: '', cursor: 0 }, { now: clock.now, maxDepth: 3 });

	// six separate steps, each closed by a boundary
	for (let i = 1; i <= 6; i++) {
		h.onChange('x'.repeat(i), i);
		h.boundary();
		clock.advance(10);
	}

	check('depth cap holds', h.canUndo());
	eq('newest state kept', h.undo(), { text: 'xxxxx', cursor: 5 });
	eq('step 5 kept', h.undo(), { text: 'xxxx', cursor: 4 });
	eq('step 4 kept', h.undo(), { text: 'xxx', cursor: 3 });
	check('only maxDepth steps survived the cap', !h.canUndo());
}

//------------------------------------------------------------------------------

print('== suspend: changes are not recorded ==');

{
	const clock = makeClock();
	const h = new TextHistory.TextHistory({ text: '', cursor: 0 }, { now: clock.now });

	h.onChange('typed', 5);
	h.boundary();

	const ret = h.suspend(function () {
		h.onChange('restored', 8);
		return 'callback-result';
	});
	check('suspend returns fn result', ret === 'callback-result');

	// the suspended change must be invisible to undo: if it had been recorded,
	// this undo would land on 'typed' instead of the baseline
	eq('suspended change not recorded', h.undo(), { text: '', cursor: 0 });
	check('no earlier steps', !h.canUndo());

	// …and recording resumes after suspend
	h.onChange('typed!', 6);
	clock.advance(10);
	check('change after suspend recorded', h.canUndo());
	eq('undo returns to the pre-edit state', h.undo(), { text: '', cursor: 0 });
	// redo must hold the just-undone edit, not the stale pre-suspend 'typed'
	eq('stale redo dropped, redo restores the resumed edit', h.redo(), { text: 'typed!', cursor: 6 });
}

//------------------------------------------------------------------------------

print('== redo invalidation on new editing ==');

{
	const clock = makeClock();
	const h = new TextHistory.TextHistory({ text: '', cursor: 0 }, { now: clock.now });

	h.onChange('one', 3);
	h.boundary();
	h.onChange('one two', 7);
	h.boundary();

	h.undo(); // at "one"
	h.undo(); // at ""
	check('redo available after undos', h.canRedo());

	h.redo(); // back to "one"
	eq('redo restored', h.redo(), { text: 'one two', cursor: 7 });

	// fresh editing after undo/redo must drop the redo stack
	h.undo(); // at "one"
	check('redo available before new editing', h.canRedo());
	h.onChange('one three', 9);
	clock.advance(10);
	check('new editing cleared redo', !h.canRedo());
	eq('undo returns to the pre-edit state', h.undo(), { text: 'one', cursor: 3 });

	// an open (not yet closed) portion also blocks redo
	h.redo(); // invalid, redone state is gone
	const h2 = new TextHistory.TextHistory({ text: '', cursor: 0 }, { now: clock.now });
	h2.onChange('a', 1);
	h2.boundary();
	h2.onChange('ab', 2);
	h2.undo(); // portion committed by undo
	h2.redo(); // back to "ab" (now the current state)
	h2.onChange('abc', 3); // open portion, redo must be blocked already
	check('open portion blocks redo', !h2.canRedo());
}

//------------------------------------------------------------------------------

print('== canUndo/canRedo at every step ==');

{
	const clock = makeClock();
	const h = new TextHistory.TextHistory({ text: '', cursor: 0 }, { now: clock.now });

	check('step 0: no undo, no redo', !h.canUndo() && !h.canRedo());

	h.onChange('a', 1);
	h.boundary();
	check('after 1 portion: undo yes, redo no', h.canUndo() && !h.canRedo());

	h.onChange('ab', 2);
	h.boundary();
	check('after 2 portions: undo yes, redo no', h.canUndo() && !h.canRedo());

	eq('undo 1', h.undo(), { text: 'a', cursor: 1 });
	check('after undo 1: both available', h.canUndo() && h.canRedo());

	eq('undo 2', h.undo(), { text: '', cursor: 0 });
	check('after undo 2: redo only', !h.canUndo() && h.canRedo());

	eq('redo 1', h.redo(), { text: 'a', cursor: 1 });
	check('after redo 1: both available', h.canUndo() && h.canRedo());

	eq('redo 2', h.redo(), { text: 'ab', cursor: 2 });
	check('after redo 2: undo only', h.canUndo() && !h.canRedo());
}

//------------------------------------------------------------------------------

print('\n' + (checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
	print(failures + ' FAILURES');
	System.exit(1);
}
System.exit(0);
