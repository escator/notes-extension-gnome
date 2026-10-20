// notes@maestroschan.fr/layouts.js
// GPL v3
// Layout registry for multi-monitor configurations (task 001 / ADR-0001, see
// docs/adr/0001-multi-monitor-layout-registry.md).
//
// Pure logic + local IO: no Clutter/St/shell dependencies, so the module runs
// both inside gnome-shell and under plain `gjs` (unit tests: test/testLayouts.js,
// run from the repository root).

const { GLib } = imports.gi;

const ByteArray = imports.byteArray;

const REGISTRY_VERSION = 1;
// Defaults mirror the legacy behavior: createNote('', 16) in extension.js and
// the former _createDefaultState in noteBox.js. Exported as vars: the manager
// uses them for the fold slot of a brand-new note.
var DEFAULT_FONT_SIZE = 16;
var DEFAULT_WIDTH = 250;
var DEFAULT_HEIGHT = 180;

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
function signature(monitors) {
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
 * Fits a rect into the monitor it overlaps the most: a note hanging off an
 * edge is pulled back inside, a note larger than the monitor is resized.
 * Safety net for every position coming from the disk.
 */
function clampRect(rect, monitors) {
	if (!monitors || monitors.length === 0) {
		return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
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

	const w = Math.min(rect.w, best.width);
	const h = Math.min(rect.h, best.height);
	return {
		x: _clamp(rect.x, best.x, best.x + best.width - w),
		y: _clamp(rect.y, best.y, best.y + best.height - h),
		w: w,
		h: h,
	};
}

/*
 * True when the rect has a non-empty intersection with at least one monitor:
 * the union of the monitor geometries is the visible canvas. Used to decide
 * whether a note without a saved position may keep its current placement.
 */
function intersectsAnyMonitor(rect, monitors) {
	return (monitors || []).some(function (m) {
		return rect.x < m.x + m.width && m.x < rect.x + rect.w
			&& rect.y < m.y + m.height && m.y < rect.y + rect.h;
	});
}

//------------------------------------------------------------------------------

const FOLD_PADDING = 16;
const FOLD_STEP = 24;

function _overlaps(a, b) {
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
function foldInto(monitor, notes, occupied) {
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

function _readString(path) {
	const [ok, raw] = GLib.file_get_contents(path);
	if (!ok) {
		return null;
	}
	return typeof raw === 'string' ? raw : ByteArray.toString(raw);
}

/*
 * On-disk registry (layouts.json): see docs/tasks/001-multi-monitor-layouts/
 * 02-architecture.md for the format. Saves are atomic (GLib.file_set_contents
 * writes to a temp file and renames) and rotate one .bak generation.
 */
var LayoutStore = class LayoutStore {

	constructor(filePath, maxLayouts) {
		this._path = filePath;
		this._bakPath = filePath + '.bak';
		this._maxLayouts = maxLayouts || 8;
		this._data = _emptyRegistry();
	}

	//--------------------------------------------------------------------------
	// IO

	/* Returns true if a registry (or its backup) was found and loaded. */
	load() {
		let data = this._readFile(this._path);
		if (data === null) {
			data = this._readFile(this._bakPath);
		}
		if (data !== null) {
			this._data = data;
			return true;
		}
		return false;
	}

	_readFile(path) {
		try {
			if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
				return null;
			}
			return _validate(JSON.parse(_readString(path)));
		} catch (e) {
			log('LayoutStore: could not read ' + path + ': ' + e.message);
			return null;
		}
	}

	save() {
		try {
			if (GLib.file_test(this._path, GLib.FileTest.EXISTS)) {
				try {
					// rotate the previous good version into .bak; if reading
					// fails, keep the old .bak rather than aborting the save
					GLib.file_set_contents(this._bakPath, _readString(this._path));
				} catch (e) { /* see above */ }
			}
			GLib.file_set_contents(this._path, JSON.stringify(this._data, null, 1));
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
	 * a natural backup. Returns the number of migrated notes.
	 */
	migrateFromStateFiles(dir, origin, currentKey) {
		const positions = {};
		let count = 0;
		while (GLib.file_test(
			GLib.build_filenamev([dir, count + '_state']),
			GLib.FileTest.EXISTS
		)) {
			const fields = this._readStateFile(
				GLib.build_filenamev([dir, count + '_state'])
			);
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
		}
		this._data.seq = count;
		this._data.layouts[currentKey] = {
			savedAt: Date.now(),
			positions: positions,
		};
		this.save();
		return count;
	}

	_readStateFile(path) {
		// NaN/missing fields degrade to the defaults instead of producing
		// off-screen notes; the legacy 7th field ('entry_is_visible') is
		// ignored
		const fields = {
			x: 10,
			y: 10,
			color: '',
			fontSize: DEFAULT_FONT_SIZE,
			w: DEFAULT_WIDTH,
			h: DEFAULT_HEIGHT,
		};
		try {
			if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
				return fields;
			}
			const state = _readString(path).split(';');
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
			log('LayoutStore: could not read ' + path + ': ' + e.message);
		}
		return fields;
	}
};
