// notes@maestroschan.fr/common.js
// GPL v3

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/*
 * Shared constants, imported by extension.js, noteBox.js and prefs.js. This
 * lives in its own module because prefs.js can't import extension.js (which
 * depends on modules that only exist inside the shell process).
 */

// Data directory of the extension, usually ~/.local/share/notes@maestroschan.fr
export const DATA_PATH = GLib.build_pathv('/', [GLib.get_user_data_dir(), 'notes@maestroschan.fr']);

// Maximum number of monitor-configuration layouts kept in layouts.json;
// over the limit the least recently used one is evicted (see layouts.js and
// docs/adr/0001-multi-monitor-layout-registry.md)
export const MAX_LAYOUTS = 8;

/*
 * Light-theme color palette, from .agent/COLOR.md. GNOME Shell's CSS engine
 * doesn't support var() custom properties, so the same values are inlined in
 * stylesheet.css; this object is the reference used by the JS side. Each note
 * color comes with the border matching it, and with the ring (the outline
 * highlighting the swatch of the currently applied color in the options
 * menu). The dark-theme counterparts exist in .agent/COLOR.md but aren't
 * wired yet.
 */
export const PRESET_COLORS = {
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
export const TEXT_COLORS = {
	primary: '#2E2E2E',
	secondary: '#5C5C5C',
	primaryDark: '#EDEDED',
	secondaryDark: '#A8A8A8'
};

/*
 * Icons bundled with the extension live in icons/, one file per icon: SVGs
 * are named "<name>-symbolic.svg", bitmaps "<name>.png". This returns a
 * Gio.FileIcon to be used as the `gicon` property of a St.Icon (icon_name
 * can't find them, as they aren't part of the system icon theme). Returns
 * null when the icon doesn't exist.
 */
export const CUSTOM_ICONS = ['edit', 'edit-copy', 'edit-paste', 'new-note', 'setting'];

export function getCustomIcon(extensionDir, name) {
	let filenames = [name + '-symbolic.svg', name + '.png'];
	for (let i = 0; i < filenames.length; i++) {
		let file = Gio.File.new_for_path(GLib.build_filenamev([
			extensionDir.get_path(), 'icons', filenames[i]
		]));
		if (file.query_exists(null)) {
			return Gio.FileIcon.new(file);
		}
	}
	return null;
}
