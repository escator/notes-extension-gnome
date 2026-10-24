// notes@escator/textHistory.js
// GPL v3
// Undo/redo history for the text of a single note (task 002, see
// docs/tasks/002-text-context-menu/02-architecture.md).
//
// Pure logic: no Clutter/St/shell dependencies, runs both inside gnome-shell
// and under plain `gjs` (unit tests: test/testTextHistory.js, run from the
// repository root). Snapshots are {text, cursor} string/number pairs; nothing
// is persisted — the history lives as long as the note does.
//
// Coalescing: consecutive onChange() calls within a time window form one
// "portion" — one undo step. The window is NOT a GLib timer: a portion is
// closed lazily, on the first API call that happens after the window has
// expired (onChange/boundary/undo/redo/canUndo/canRedo all flush it), so the
// observable behavior matches a timer while staying deterministic and free of
// event-loop dependencies (tests inject a clock instead).

const PORTION_WINDOW_MS = 800;
const DEFAULT_MAX_DEPTH = 50;

var TextHistory = class TextHistory {

	/*
	 * baseline: the state the note starts in, {text, cursor}. params (all
	 * optional): now — clock function returning ms (default Date.now, inject
	 * for tests); windowMs — coalescing window; maxDepth — undo stack cap.
	 */
	constructor(baseline, params) {
		params = params || {};
		this._now = params.now || Date.now;
		this._windowMs = (params.windowMs !== undefined) ? params.windowMs : PORTION_WINDOW_MS;
		this._maxDepth = (params.maxDepth !== undefined) ? params.maxDepth : DEFAULT_MAX_DEPTH;
		this._current = { text: baseline.text, cursor: baseline.cursor };
		this._undoStack = [];
		this._redoStack = [];
		// State before the currently open portion; null when no portion is open.
		this._pending = null;
		this._pendingAt = 0;
		this._suspended = false;
	}

	/*
	 * Records a change from the outside (ClutterText 'text-changed'). The
	 * first call of a portion remembers the pre-portion state as `pending`;
	 * closing the portion pushes it onto the undo stack. Ignored while
	 * suspended.
	 */
	onChange(text, cursor) {
		if (this._suspended) {
			return;
		}
		if (text === this._current.text && cursor === this._current.cursor) {
			return;
		}
		this._flushIfExpired();
		if (!this._pending) {
			this._pending = { text: this._current.text, cursor: this._current.cursor };
		}
		this._current = { text: text, cursor: cursor };
		this._pendingAt = this._now();
	}

	/*
	 * Force-closes the open portion (if any): it becomes an undo step and the
	 * redo stack is dropped. Call before known discrete operations (paste,
	 * menu actions, mode switch, undo itself).
	 */
	boundary() {
		this._closePending();
	}

	/*
	 * Runs fn with change recording turned off (initial text load, restoring
	 * from history). Returns fn's return value.
	 */
	suspend(fn) {
		this._suspended = true;
		try {
			return fn();
		} finally {
			this._suspended = false;
		}
	}

	/*
	 * Restores the previous state; returns the snapshot to apply, or null
	 * when there is nothing to undo. An open portion is committed first, so
	 * Ctrl+Z right after typing undoes the whole portion.
	 */
	undo() {
		this._closePending();
		if (this._undoStack.length === 0) {
			return null;
		}
		this._redoStack.push({ text: this._current.text, cursor: this._current.cursor });
		this._current = this._undoStack.pop();
		return { text: this._current.text, cursor: this._current.cursor };
	}

	/*
	 * Restores the next state (only meaningful right after an undo); returns
	 * the snapshot to apply, or null. Any unrecorded editing invalidates the
	 * redo stack via _closePending.
	 */
	redo() {
		this._closePending();
		if (this._redoStack.length === 0) {
			return null;
		}
		this._undoStack.push({ text: this._current.text, cursor: this._current.cursor });
		this._current = this._redoStack.pop();
		return { text: this._current.text, cursor: this._current.cursor };
	}

	canUndo() {
		return this._pending !== null || this._undoStack.length > 0;
	}

	canRedo() {
		return this._pending === null && this._redoStack.length > 0;
	}

	//------------------------------------------------------------------------------
	// internals -------------------------------------------------------------------

	_closePending() {
		if (!this._pending) {
			return;
		}
		this._undoStack.push(this._pending);
		if (this._undoStack.length > this._maxDepth) {
			this._undoStack.shift(); // evict the oldest step
		}
		this._pending = null;
		this._redoStack.length = 0; // new editing invalidates redo
	}

	_flushIfExpired() {
		if (this._pending && this._now() - this._pendingAt > this._windowMs) {
			this._closePending();
		}
	}

};
