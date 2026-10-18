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
