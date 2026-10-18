// notes@maestroschan.fr/common.js
// GPL v3

const { GLib } = imports.gi;

/*
 * Shared constants, imported by extension.js, noteBox.js and prefs.js. This
 * lives in its own module because prefs.js can't import extension.js (which
 * depends on modules that only exist inside the shell process), and because
 * the circular import between extension.js and noteBox.js makes their module
 * initialization order unreliable.
 */

// Data directory of the extension, usually ~/.local/share/notes@maestroschan.fr
var DATA_PATH = GLib.build_pathv('/', [GLib.get_user_data_dir(), 'notes@maestroschan.fr']);

/*
 * Light-theme color palette, from .agent/COLOR.md. GNOME Shell's CSS engine
 * doesn't support var() custom properties, so the same values are inlined in
 * stylesheet.css; this object is the reference used by the JS side. Each note
 * color comes with the border matching it, and with the ring (the outline
 * highlighting the swatch of the currently applied color in the options
 * menu). The dark-theme counterparts exist in .agent/COLOR.md but aren't
 * wired yet.
 */
var PRESET_COLORS = {
	'peach':    { rgb: [255, 217, 191], border: '#E6C3AC', ring: '#E89A66' },
	'cream':    { rgb: [255, 240, 168], border: '#E6D897', ring: '#D9B84D' },
	'mint':     { rgb: [184, 230, 201], border: '#A6CFB5', ring: '#5FB87C' },
	'sky':      { rgb: [184, 217, 242], border: '#A6C3DA', ring: '#5F9AD6' },
	'lavender': { rgb: [212, 198, 242], border: '#BFB2DA', ring: '#9A80D6' },
	'pink':     { rgb: [247, 198, 217], border: '#DEB2C3', ring: '#E07AA6' },
	'sage':     { rgb: [198, 221, 184], border: '#B2C7A6', ring: '#82A87C' },
	'beige':    { rgb: [232, 213, 184], border: '#D1C0A6', ring: '#C4A87F' }
};

/*
 * Text colors: the light ones on light backgrounds, the '-dark' ones on dark
 * backgrounds (dark backgrounds are only reachable via custom colors until a
 * dark palette gets wired).
 */
var TEXT_COLORS = {
	primary: '#2E2E2E',
	secondary: '#5C5C5C',
	primaryDark: '#EDEDED',
	secondaryDark: '#A8A8A8'
};
