// Unit tests for notes@escator/textSelection.js — plain gjs, no shell:
//     gjs -m test/testTextSelection.js     (from the repository root)

import System from 'system';

import { wordRange, byteOffsetToCharIndex } from '../notes@escator/textSelection.js';

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

//------------------------------------------------------------------------------

// ---- wordRange: the basics

eq('word: first char', wordRange('привет мир', 0), [0, 6]);
eq('word: middle', wordRange('привет мир', 3), [0, 6]);
eq('word: last char', wordRange('привет мир', 5), [0, 6]);
eq('word: second word', wordRange('привет мир', 8), [7, 10]);

// ---- wordRange: non-word positions select nothing (02-architecture §6)

eq('space', wordRange('привет мир', 6), null);
eq('punctuation', wordRange('foo,bar', 3), null);
eq('hyphen is a boundary', wordRange('a-b', 1), null);
eq('past the end', wordRange('word', 4), null);
eq('negative index', wordRange('word', -1), null);

// ---- wordRange: word characters are letters, numbers, underscore

eq('underscore and digits', wordRange('_tmp x2', 2), [0, 4]);
eq('digits', wordRange('_tmp x2', 6), [5, 7]);
eq('single char', wordRange('x', 0), [0, 1]);

// ---- wordRange: degenerate inputs

eq('empty text', wordRange('', 0), null);
eq('null text', wordRange(null, 0), null);

// ---- wordRange: code points, not UTF-16 units (emoji is a single index)

eq('emoji: letter after emoji', wordRange('🙂ab', 2), [1, 3]);
eq('emoji: click on emoji', wordRange('🙂ab', 0), null);

// ---- byteOffsetToCharIndex: conversions between pango and ClutterText units

eq('ascii passthrough', byteOffsetToCharIndex('abc', 2), 2);
eq('ascii end', byteOffsetToCharIndex('abc', 3), 3);
eq('ascii past end', byteOffsetToCharIndex('abc', 10), 3);
eq('zero offset', byteOffsetToCharIndex('abc', 0), 0);
eq('negative offset', byteOffsetToCharIndex('abc', -1), 0);
eq('empty text', byteOffsetToCharIndex('', 0), 0);
eq('null text', byteOffsetToCharIndex(null, 1), 0);

// Cyrillic: two bytes per character in UTF-8
eq('cyrillic: boundary 0', byteOffsetToCharIndex('абв', 0), 0);
eq('cyrillic: boundary 1', byteOffsetToCharIndex('абв', 2), 1);
eq('cyrillic: boundary 2', byteOffsetToCharIndex('абв', 4), 2);
eq('cyrillic: end', byteOffsetToCharIndex('абв', 6), 3);

// Mixed ASCII/Cyrillic ("aбв": a=1 byte, б/в=2 bytes each)
eq('mixed: after ascii', byteOffsetToCharIndex('aбв', 1), 1);
eq('mixed: end', byteOffsetToCharIndex('aбв', 5), 3);

// Emoji: four bytes per character, one code point
eq('emoji: one char', byteOffsetToCharIndex('🙂x', 4), 1);
eq('emoji: end', byteOffsetToCharIndex('🙂x', 5), 2);

// An offset landing inside a multi-byte char (pango never produces it)
// rounds past that character
eq('mid-character rounds up', byteOffsetToCharIndex('абв', 1), 1);

//------------------------------------------------------------------------------

print('\n' + checks + ' checks, ' + failures + ' failures');
if (failures > 0) {
	System.exit(1);
}
