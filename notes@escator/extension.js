// notes@escator/extension.js
// GPL v3
// Copyright 2018-2021 Romain F. T.

import St from 'gi://St';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { DATA_PATH } from './common.js';
import { NoteBox } from './noteBox.js';
import { NotesManager } from './manager.js';

//------------------------------------------------------------------------------

/*
 * The shell adapter: the only module that knows the shell namespaces. The
 * NotesManager (manager.js) is a pure module and receives them, together
 * with its other dependencies, as constructor arguments — exactly the form
 * the offline smoke test reuses with fakes (test/smokeExtension.js).
 */
export default class NotesExtension extends Extension {

	constructor(...args) {
		super(...args);
		try {
			let a = Gio.file_new_for_path(DATA_PATH);
			if (!a.query_exists(null)) {
				a.make_directory(null);
			}
		} catch (e) {
			log(e.message);
		}
	}

	enable() {
		this._manager = new NotesManager({
			settings: this.getSettings(),
			extensionDir: this.dir,
			openPrefs: () => this.openPreferences(),
			noteBoxClass: NoteBox,
			timers: GLib,
			shell: { Main, PanelMenu, PopupMenu, St, Clutter, Shell, Meta }
		});
	}

	disable() {
		this._manager.destroy();
		this._manager = null;
	}
}

//------------------------------------------------------------------------------
