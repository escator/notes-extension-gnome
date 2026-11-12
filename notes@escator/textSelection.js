// notes@escator/textSelection.js
// GPL v3
// Copyright 2026 Chernyakov Pavel
// Pure helpers of the read-only mouse selection (task 009, see
// docs/tasks/009-readonly-mouse-selection/02-architecture.md §3, §6).
//
// No Clutter/St/shell dependencies, runs both inside gnome-shell and under
// plain `gjs` (unit tests: test/testTextSelection.js, run from the
// repository root).
//
// Units: pango's xy_to_index reports a byte offset into the UTF-8 encoding,
// while Clutter.Text's selection/cursor API counts unicode characters —
// byteOffsetToCharIndex converts between the two. All the functions here
// count characters as code points (for...of), which matches the
// character-based ClutterText API and the pango indices after conversion.

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function utf8Length (codePoint) {
	if (codePoint < 0x80) { return 1; }
	if (codePoint < 0x800) { return 2; }
	if (codePoint < 0x10000) { return 3; }
	return 4;
}

/*
 * The word the character at `index` (a code-point offset) belongs to, as a
 * [start, end] pair; null when the position holds no word character (a
 * space, punctuation, the end of the text) — a deliberate simplification
 * over the native double-click behavior (02-architecture §6). Word
 * characters: unicode letters (Cyrillic included), numbers, underscore.
 */
export function wordRange (text, index) {
	if (!text || index < 0) { return null; }
	let chars = [...text];
	if (index >= chars.length || !WORD_CHAR.test(chars[index])) { return null; }
	let start = index;
	while (start > 0 && WORD_CHAR.test(chars[start - 1])) { start--; }
	let end = index + 1;
	while (end < chars.length && WORD_CHAR.test(chars[end])) { end++; }
	return [start, end];
}

/*
 * Byte offset into the UTF-8 encoding of `text` → code-point index. Offsets
 * falling inside a multi-byte character (pango never produces them — it
 * reports cluster boundaries) round past that character. Empty text or an
 * offset of zero give 0; an offset past the end gives the text's length.
 */
export function byteOffsetToCharIndex (text, byteOffset) {
	if (!text || byteOffset <= 0) { return 0; }
	let bytes = 0;
	let chars = 0;
	for (const ch of text) {
		if (bytes >= byteOffset) { break; }
		bytes += utf8Length(ch.codePointAt(0));
		chars++;
	}
	return chars;
}
