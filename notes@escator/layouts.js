// notes@escator/layouts.js
// GPL v3
// Layout registry for multi-monitor configurations (task 001 / ADR-0001, see
// docs/adr/0001-multi-monitor-layout-registry.md).
//
// Pure logic + local IO: no Clutter/St/shell dependencies, so the module runs
// both inside gnome-shell and under plain `gjs` (unit tests: test/testLayouts.js,
// run from the repository root).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const REGISTRY_VERSION = 1;
// Defaults mirror the legacy behavior: createNote('', 16) in extension.js and
// the former _createDefaultState in noteBox.js. Exported as constants: the
// manager uses them for the fold slot of a brand-new note.
export const DEFAULT_FONT_SIZE = 16;
export const DEFAULT_WIDTH = 300;
export const DEFAULT_HEIGHT = 180;

//------------------------------------------------------------------------------
// Monitor configuration signature --------------------------------------------

/*
 * Collapses a set of monitors (logical geometry {x, y, width, height}, as
 * reported by Main.layoutManager on both X11 and Wayland) into a canonical
 * string key. Sorting makes the key independent of the monitors enumeration
 * order; identical keys mean an identical usable canvas, so positions saved
 * for a key are valid wherever that key appears again (no hardware ids: the
 * same geometry at a different desk is the same layout, by design).
 */
export function signature(monitors) {
	return monitors.map(function (m) {
		return m.width + 'x' + m.height + '+' + m.x + '+' + m.y;
	}).sort().join(',');
}

//------------------------------------------------------------------------------
// Geometry helpers ------------------------------------------------------------

function _clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v));
}

function _intersectionArea(rect, monitor) {
	const w = Math.min(rect.x + rect.w, monitor.x + monitor.width)
	         - Math.max(rect.x, monitor.x);
	const h = Math.min(rect.y + rect.h, monitor.y + monitor.height)
	         - Math.max(rect.y, monitor.y);
	return (w > 0 && h > 0) ? w * h : 0;
}

/*
 * The monitor a rect belongs to: the one it overlaps the most. A rect outside
 * every monitor falls back to the first entry, an empty list yields null.
 * Shared by clampRect and the expand algorithm (task 005 / ADR-0004).
 */
export function bestMonitor(rect, monitors) {
	if (!monitors || monitors.length === 0) {
		return null;
	}

	let best = monitors[0];
	let bestArea = -1;
	monitors.forEach(function (m) {
		const area = _intersectionArea(rect, m);
		if (area > bestArea) {
			bestArea = area;
			best = m;
		}
	});
	return best;
}

/*
 * Fits a rect into the monitor it overlaps the most: a note hanging off an
 * edge is pulled back inside, a note larger than the monitor is resized.
 * Safety net for every position coming from the disk.
 */
export function clampRect(rect, monitors) {
	const best = bestMonitor(rect, monitors);
	if (best === null) {
		return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
	}

	const w = Math.min(rect.w, best.width);
	const h = Math.min(rect.h, best.height);
	return {
		x: _clamp(rect.x, best.x, best.x + best.width - w),
		y: _clamp(rect.y, best.y, best.y + best.height - h),
		w: w,
		h: h,
	};
}

//------------------------------------------------------------------------------
// Expand algorithm (task 005 / ADR-0004) --------------------------------------

// Width increment between the search steps: small enough to keep the expanded
// rect near-minimal, large enough to keep the number of neededH() calls low.
const EXPAND_STEP_PX = 40;

/*
 * Computes the expanded geometry of a note (the double-click toggle): the
 * smallest rect holding the 3:4 portrait proportion (height = 4/3 · width,
 * capped by the monitor) whose height fits `neededH(w)` — the caller's
 * measurement of the height the text needs at width w.
 *
 * `baseRect` is the note's rect {x, y, w, h} the expansion starts from; the
 * search floor is its width (a base wider than the monitor never grows past
 * it), each step widens by EXPAND_STEP_PX. Position keeps baseRect's x and y
 * unless the rect would cross the monitor's right/bottom edge: it then slides
 * left/up and never leaves the monitor. The maximum is a safety net, not a
 * regular mode: when no width makes the text fit (a note bigger than the
 * screen), the width is fixed at the monitor's and the text tail stays
 * hidden — same when the monitor's height has to cut the 3:4 proportion.
 * Returns {x, y, w, h}.
 */
export function fitExpandRect(baseRect, monitors, neededH) {
	const monitor = bestMonitor(baseRect, monitors);
	if (monitor === null) {
		return { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h };
	}

	let w = Math.min(baseRect.w, monitor.width);
	let found = false;
	for (; w <= monitor.width; w += EXPAND_STEP_PX) {
		if (neededH(w) <= Math.min(4 / 3 * w, monitor.height)) {
			found = true;
			break;
		}
	}
	if (!found) {
		// the text doesn't fit even at the monitor's width
		w = monitor.width;
	}
	// may violate the 3:4 proportion when the monitor's height cuts in
	const h = Math.min(4 / 3 * w, monitor.height);
	return {
		x: _clamp(baseRect.x, monitor.x, monitor.x + monitor.width - w),
		y: _clamp(baseRect.y, monitor.y, monitor.y + monitor.height - h),
		w: w,
		h: h,
	};
}

/*
 * True when the rect has a non-empty intersection with at least one monitor:
 * the union of the monitor geometries is the visible canvas. Used to decide
 * whether a note without a saved position may keep its current placement.
 */
export function intersectsAnyMonitor(rect, monitors) {
	return (monitors || []).some(function (m) {
		return rect.x < m.x + m.width && m.x < rect.x + rect.w
			&& rect.y < m.y + m.height && m.y < rect.y + rect.h;
	});
}

//------------------------------------------------------------------------------

const FOLD_PADDING = 16;
const FOLD_STEP = 24;

export function _overlaps(a, b) {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function _overlapsAny(rect, rects) {
	return rects.some(function (r) {
		return _overlaps(rect, r);
	});
}

/*
 * Deterministic cascade placement on a monitor, replacing the former random
 * repositioning: repeated folds put the same notes in the same slots, so
 * manual rearrangement after a monitor change stays predictable.
 *
 * `notes` is an array of {id, w, h}; notes are placed in id order. Phase 1
 * scans the monitor row-major for a slot avoiding the rectangles in
 * `occupied` (which is left untouched). The scan is finite by construction,
 * so a full monitor cannot spin. Notes that find no free slot go through a
 * pure flow pass: they may overlap, but always stay inside the monitor.
 * Returns { id: {x, y, w, h} }.
 */
export function foldInto(monitor, notes, occupied) {
	const occ = (occupied || []).slice();
	const sorted = notes.slice().sort(function (a, b) {
		return a.id - b.id;
	});
	const innerX = monitor.x + FOLD_PADDING;
	const innerY = monitor.y + FOLD_PADDING;
	const maxW = Math.max(1, monitor.width - 2 * FOLD_PADDING);
	const maxH = Math.max(1, monitor.height - 2 * FOLD_PADDING);

	const placed = {};
	const leftover = [];

	sorted.forEach(function (note) {
		const w = Math.max(1, Math.min(note.w, maxW));
		const h = Math.max(1, Math.min(note.h, maxH));
		let found = null;
		for (let y = innerY; found === null && y + h <= innerY + maxH; y += FOLD_STEP) {
			for (let x = innerX; x + w <= innerX + maxW; x += FOLD_STEP) {
				const rect = { x: x, y: y, w: w, h: h };
				if (!_overlapsAny(rect, occ)) {
					found = rect;
					break;
				}
			}
		}
		if (found) {
			placed[note.id] = found;
			occ.push(found);
		} else {
			leftover.push({ id: note.id, w: w, h: h });
		}
	});

	// monitor full: flow placement for the rest, ignoring overlaps
	let cx = innerX;
	let cy = innerY;
	let rowH = 0;
	leftover.forEach(function (note) {
		if (cx + note.w > innerX + maxW) {
			cx = innerX;
			cy += rowH + FOLD_STEP;
			rowH = 0;
		}
		if (cy + note.h > innerY + maxH) {
			// rows are exhausted too: restart from the top-left (overlap is
			// unavoidable at this point, bounds are not)
			cx = innerX;
			cy = innerY;
			rowH = 0;
		}
		placed[note.id] = { x: cx, y: cy, w: note.w, h: note.h };
		rowH = Math.max(rowH, note.h);
		cx += note.w + FOLD_STEP;
	});

	return placed;
}

//------------------------------------------------------------------------------
// Registry --------------------------------------------------------------------

function _emptyRegistry() {
	return {
		version: REGISTRY_VERSION,
		seq: 0,
		notes: {},   // id -> { color, fontSize } (monitor-independent)
		layouts: {}, // signature -> { savedAt, positions: id -> {x,y,w,h} }
	};
}

function _isId(key) {
	return /^\d+$/.test(key);
}

/*
 * Sanitizes a parsed registry: per-note garbage degrades to defaults, only a
 * structurally broken file is rejected (the caller then falls back to .bak).
 */
function _validate(parsed) {
	if (!parsed || typeof parsed !== 'object'
		|| parsed.version !== REGISTRY_VERSION
	) {
		return null;
	}

	const data = _emptyRegistry();
	data.seq = (Number.isFinite(parsed.seq) && parsed.seq >= 0)
		? Math.floor(parsed.seq)
		: 0;

	if (parsed.notes && typeof parsed.notes === 'object') {
		Object.keys(parsed.notes).forEach(function (id) {
			if (!_isId(id)) {
				return;
			}
			const n = parsed.notes[id];
			data.notes[id] = {
				color: (n && typeof n.color === 'string') ? n.color : '',
				fontSize: (n && Number.isFinite(n.fontSize) && n.fontSize > 0)
					? n.fontSize
					: DEFAULT_FONT_SIZE,
			};
		});
	}

	if (parsed.layouts && typeof parsed.layouts === 'object') {
		Object.keys(parsed.layouts).forEach(function (key) {
			const layout = parsed.layouts[key];
			if (!layout || typeof layout !== 'object'
				|| !layout.positions || typeof layout.positions !== 'object'
			) {
				return;
			}
			const positions = {};
			Object.keys(layout.positions).forEach(function (id) {
				const p = layout.positions[id];
				if (!_isId(id) || !p) {
					return;
				}
				const x = Number(p.x), y = Number(p.y);
				const w = Number(p.w), h = Number(p.h);
				if (!Number.isFinite(x) || !Number.isFinite(y)
					|| !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0
				) {
					return;
				}
				positions[id] = { x: x, y: y, w: w, h: h };
			});
			data.layouts[key] = {
				savedAt: Number.isFinite(layout.savedAt) ? layout.savedAt : Date.now(),
				positions: positions,
			};
		});
	}

	// ids are never reused, even if notes were deleted
	let maxId = -1;
	Object.keys(data.notes).forEach(function (id) {
		maxId = Math.max(maxId, Number(id));
	});
	data.seq = Math.max(data.seq, maxId + 1);

	return data;
}

/*
 * Asynchronous single-file read (EGO-X-004: no synchronous file IO in shell
 * code); callback receives the decoded string, or null when the file is
 * missing or unreadable.
 */
function _readString(path, callback) {
	Gio.File.new_for_path(path).load_contents_async(null, function (source, res) {
		try {
			const [ok, raw] = source.load_contents_finish(res);
			callback(ok
				? (typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
				: null);
		} catch (e) {
			callback(null);
		}
	});
}

/*
 * On-disk registry (layouts.json): see docs/tasks/001-multi-monitor-layouts/
 * 02-architecture.md for the format. Saves are atomic (GLib.file_set_contents
 * writes to a temp file and renames) and rotate one .bak generation.
 */
export class LayoutStore {

	constructor(filePath, maxLayouts) {
		this._path = filePath;
		this._bakPath = filePath + '.bak';
		this._maxLayouts = maxLayouts || 8;
		this._data = _emptyRegistry();
		// what the registry file currently holds on disk (the bytes read at
		// load time, then the bytes written at every save): the .bak rotation
		// replays it without re-reading the file
		this._rawOnDisk = null;
	}

	//--------------------------------------------------------------------------
	// IO

	/*
	 * Loads the registry (or, failing that, its backup) and reports the
	 * outcome to callback(true/false): the reads are asynchronous, nothing
	 * below the callback may assume the store is filled yet.
	 */
	load(callback) {
		this._readFile(this._path, (data) => {
			if (data !== null) {
				this._data = data;
				callback(true);
				return;
			}
			this._readFile(this._bakPath, (bakData) => {
				if (bakData !== null) {
					this._data = bakData;
				}
				callback(bakData !== null);
			});
		});
	}

	_readFile(path, callback) {
		if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
			callback(null);
			return;
		}
		_readString(path, (raw) => {
			this._rawOnDisk = raw;
			if (raw === null) {
				callback(null);
				return;
			}
			try {
				callback(_validate(JSON.parse(raw)));
			} catch (e) {
				log('LayoutStore: could not read ' + path + ': ' + e.message);
				callback(null);
			}
		});
	}

	save() {
		try {
			// rotate the previous good version into .bak: the snapshot taken
			// at load time (and kept fresh at every save) is exactly what the
			// file holds, so no re-read is needed
			if (this._rawOnDisk !== null) {
				try {
					GLib.file_set_contents(this._bakPath, this._rawOnDisk);
				} catch (e) { /* a failed rotation only loses one generation */ }
			}
			const json = JSON.stringify(this._data, null, 1);
			GLib.file_set_contents(this._path, json);
			this._rawOnDisk = json;
		} catch (e) {
			log('LayoutStore: could not save ' + this._path + ': ' + e.message);
		}
	}

	//--------------------------------------------------------------------------
	// Layouts (one per monitor configuration)

	/* Deep copy: callers must not mutate the store's internals. */
	layoutFor(key) {
		const layout = this._data.layouts[key];
		return layout ? JSON.parse(JSON.stringify(layout)) : null;
	}

	/* Saves the positions for a configuration, evicting the least recently
	 * used layouts over the limit. */
	put(key, positions) {
		this._data.layouts[key] = {
			savedAt: Date.now(),
			positions: JSON.parse(JSON.stringify(positions)),
		};
		this._evictIfNeeded();
		this.save();
	}

	/* Refreshes the recency of a layout (LRU tracks usage, not edits). */
	touch(key) {
		if (this._data.layouts[key]) {
			this._data.layouts[key].savedAt = Date.now();
			this.save();
		}
	}

	_evictIfNeeded() {
		const keys = Object.keys(this._data.layouts);
		if (keys.length <= this._maxLayouts) {
			return;
		}
		const store = this;
		keys.sort(function (a, b) {
			return store._data.layouts[a].savedAt - store._data.layouts[b].savedAt;
		});
		while (Object.keys(this._data.layouts).length > this._maxLayouts) {
			delete this._data.layouts[keys.shift()];
		}
	}

	//--------------------------------------------------------------------------
	// Notes (monitor-independent attributes + stable ids)

	/* Ids come from the `seq` counter and are never reused: saved layouts stay
	 * valid across note deletions. */
	nextId() {
		return this._data.seq++;
	}

	setNoteAttrs(id, attrs) {
		this._data.notes[id] = {
			color: attrs.color,
			fontSize: attrs.fontSize,
		};
	}

	getNoteAttrs(id) {
		const attrs = this._data.notes[id];
		return attrs ? JSON.parse(JSON.stringify(attrs)) : null;
	}

	noteIds() {
		return Object.keys(this._data.notes).map(Number).sort(function (a, b) {
			return a - b;
		});
	}

	/* Drops a note everywhere: attributes and every layout's position. */
	removeNote(id) {
		delete this._data.notes[id];
		const store = this;
		Object.keys(this._data.layouts).forEach(function (key) {
			delete store._data.layouts[key].positions[id];
		});
		this.save();
	}

	//--------------------------------------------------------------------------
	// One-time migration from the legacy per-note `N_state` files

	/*
	 * `dir` is the data directory, `origin` the {x, y} of the primary monitor
	 * (legacy coordinates were relative to it), `currentKey` the signature of
	 * the configuration active right now. Ids keep the file numbers, so the
	 * `N_text` file names stay valid. The `_state` files are left on disk as
	 * a natural backup. The number of migrated notes is reported to the
	 * callback (the reads are asynchronous).
	 */
	migrateFromStateFiles(dir, origin, currentKey, callback) {
		const positions = {};
		let count = 0;
		const next = () => {
			const path = GLib.build_filenamev([dir, count + '_state']);
			if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
				this._data.seq = count;
				this._data.layouts[currentKey] = {
					savedAt: Date.now(),
					positions: positions,
				};
				this.save();
				callback(count);
				return;
			}
			_readString(path, (raw) => {
				const fields = this._parseStateFields(raw);
				this._data.notes[count] = {
					color: fields.color,
					fontSize: fields.fontSize,
				};
				positions[count] = {
					x: origin.x + fields.x,
					y: origin.y + fields.y,
					w: fields.w,
					h: fields.h,
				};
				count++;
				next();
			});
		};
		next();
	}

	/*
	 * Pure parser of one legacy `N_state` line: NaN/missing fields degrade to
	 * the defaults instead of producing off-screen notes; the legacy 7th
	 * field ('entry_is_visible') is ignored.
	 */
	_parseStateFields(raw) {
		const fields = {
			x: 10,
			y: 10,
			color: '',
			fontSize: DEFAULT_FONT_SIZE,
			w: DEFAULT_WIDTH,
			h: DEFAULT_HEIGHT,
		};
		if (raw === null) {
			return fields;
		}
		try {
			const state = raw.split(';');
			const x = Number(state[0]);
			const y = Number(state[1]);
			const w = Number(state[3]);
			const h = Number(state[4]);
			const fontSize = Number(state[5]);
			if (Number.isFinite(x)) { fields.x = x; }
			if (Number.isFinite(y)) { fields.y = y; }
			if (Number.isFinite(w) && w > 0) { fields.w = w; }
			if (Number.isFinite(h) && h > 0) { fields.h = h; }
			if (Number.isFinite(fontSize) && fontSize > 0) { fields.fontSize = fontSize; }
			if (state[2] !== undefined) { fields.color = state[2]; }
		} catch (e) {
			log('LayoutStore: could not parse a state file: ' + e.message);
		}
		return fields;
	}
}
