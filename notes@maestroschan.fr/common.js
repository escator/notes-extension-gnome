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
	'peach':    { rgb: [255, 241, 230], border: '#E6D9CF', ring: '#E8A87C' },
	'cream':    { rgb: [255, 249, 219], border: '#E6E0C5', ring: '#D9C86A' },
	'mint':     { rgb: [230, 244, 234], border: '#CFDBD3', ring: '#6FBF8B' },
	'sky':      { rgb: [231, 241, 250], border: '#D0D9E1', ring: '#6FA8DC' },
	'lavender': { rgb: [240, 234, 251], border: '#D8D3E2', ring: '#A48FD8' },
	'pink':     { rgb: [251, 233, 240], border: '#E2D2D8', ring: '#E08FB0' },
	'sage':     { rgb: [234, 242, 230], border: '#D3DACF', ring: '#8FB08A' },
	'beige':    { rgb: [245, 239, 230], border: '#DDD7CF', ring: '#C9B79A' }
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
