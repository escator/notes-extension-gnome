// notes@escator/prefs.js
// GPL v3
// Copyright 2018-2021 Romain F. T.

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Gettext from 'gettext';

import * as Common from './common.js';

const _ = Gettext.domain('notes-extension').gettext;

//------------------------------------------------------------------------------

export default class NotesExtensionPreferences extends ExtensionPreferences {

	fillPreferencesWindow(window) {
		// EGO versions are integers; the About tab shows the marketing
		// form ("3" -> "3.0") — the translated "Version %s" is unchanged.
		let widget = new NotesSettingsWidget(
			this.getSettings(), this.path, this.metadata.version + '.0');

		let page = new Adw.PreferencesPage();
		let group = new Adw.PreferencesGroup();
		group.add(widget.prefs_stack);
		page.add(group);
		window.add(page);

		window.set_default_size(496, 405);
	}
}

//------------------------------------------------------------------------------

/*
 * Assembles the widgets of the four tabs from prefs.ui, and wires them to the
 * settings. Instead of the legacy global `Me`, it receives its dependencies
 * explicitly: the settings (from ExtensionPreferences.getSettings()), the
 * extension directory path (prefs.ui and the bundled icon live there) and the
 * extension version (the About tab shows it).
 */
class NotesSettingsWidget {
	constructor(settings, path, version) {
		this._settings = settings;
		this._path = path;
		this._version = version;

		let builder = new Gtk.Builder();
		builder.set_translation_domain('notes-extension');
		builder.add_from_file(this._path + '/prefs.ui');
		this.prefs_stack = builder.get_object('prefs_stack');

		this._buildSettingsPage(builder);
		this._buildHelpPage(builder);
		this._buildAboutPage(builder);
	}

	//--------------------------------------------------------------------------

	_buildSettingsPage (builder) {
		let RELOAD_TEXT = _("Modifications will be effective after reloading the extension.");

		//----------------------------------------------------------------------

		// The "Automatic focus" option is disabled for now (see prefs.ui)
		//let focus_switch = builder.get_object('focus_switch');
		//focus_switch.set_state(this._settings.get_boolean('auto-focus'));
		//focus_switch.connect('notify::active', (widget) => {
		//	this._settings.set_boolean('auto-focus', widget.active);
		//});

		//----------------------------------------------------------------------

		// The "hide icon" switch has to be build before the keybinding switch
		this._hide_switch = builder.get_object('hide_switch');
		this._hide_switch.set_state(this._settings.get_boolean('hide-icon'));
		this._hide_switch.connect('notify::active', (widget) => {
			this._settings.set_boolean('hide-icon', widget.active);
		});

		//----------------------------------------------------------------------

		// Context: %s will be replaced with the default keyboard shortcut
		let default_kbs_label = _("Default value is %s");
		default_kbs_label = default_kbs_label.replace('%s', "<Super><Alt>n");

		// Text entry
		let keybinding_entry = builder.get_object('keybinding_entry');
		keybinding_entry.set_sensitive(this._settings.get_boolean('use-shortcut'));
		keybinding_entry.set_tooltip_text(default_kbs_label);

		builder.get_object('default-kbs-help-1').set_label(default_kbs_label);
		builder.get_object('default-kbs-help-2').set_label(RELOAD_TEXT);

		if (this._settings.get_strv('notes-kb-shortcut') != '') {
			keybinding_entry.text = this._settings.get_strv('notes-kb-shortcut')[0];
		}

		// "Apply" button
		let keybinding_button = builder.get_object('keybinding_button');
		keybinding_button.set_sensitive(this._settings.get_boolean('use-shortcut'));

		keybinding_button.connect('clicked', (widget) => {
			this._settings.set_strv('notes-kb-shortcut', [keybinding_entry.text]);
		});

		// "Enable shortcut" switch
		let keybinding_switch = builder.get_object('keybinding_switch');
		keybinding_switch.set_state(this._settings.get_boolean('use-shortcut'));

		keybinding_switch.connect('notify::active', (widget) => {
			this._settings.set_boolean('use-shortcut', widget.active);
			keybinding_entry.sensitive = widget.active;
			keybinding_button.sensitive = widget.active;
			this._hide_switch.sensitive = widget.active;
		});

		//----------------------------------------------------------------------

		// The default color of the very first note, chosen among the preset
		// colors (Common.PRESET_COLORS); the chosen swatch gets the ring
		// matching it, like in the shell-side palette (COLOR.md §4.2)
		let presetsBox = builder.get_object('preset_colors_box');

		let css = '.notes-preset { border-radius: 12px; border-style: solid;'
			+ ' border-width: 2px; border-color: transparent; padding: 0;'
			+ ' box-shadow: none; min-width: 20px; min-height: 20px; }\n';
		for (let name in Common.PRESET_COLORS) {
			let preset = Common.PRESET_COLORS[name];
			css += '.notes-preset-' + name + ' { background-image: none;'
				+ ' background-color: rgb(' + preset.rgb.join(',') + '); }\n';
			css += '.notes-preset-' + name + '.notes-preset-selected'
				+ ' { border-color: ' + preset.ring + '; }\n';
		}
		let provider = new Gtk.CssProvider();
		provider.load_from_data(css, -1);
		Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),
			provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

		// first-note-rgb stores the color as 0..1 values, as set_strv()ed
		// here and read in noteBox.js
		let stored = this._settings.get_strv('first-note-rgb');
		let storedRgb = stored.map((c) => Math.round(parseFloat(c) * 255)).join(',');
		this._presetButtons = {};
		for (let name in Common.PRESET_COLORS) {
			let preset = Common.PRESET_COLORS[name];
			let btn = new Gtk.Button();
			btn.set_size_request(24, 24);
			btn.set_tooltip_text(name);
			btn.add_css_class('notes-preset');
			btn.add_css_class('notes-preset-' + name);
			btn.connect('clicked', () => {
				this._settings.set_strv('first-note-rgb', [
					(preset.rgb[0] / 255).toString(),
					(preset.rgb[1] / 255).toString(),
					(preset.rgb[2] / 255).toString()
				]);
				this._selectPresetColor(name);
			});
			presetsBox.append(btn);
			this._presetButtons[name] = btn;
			if (preset.rgb.join(',') === storedRgb) {
				this._selectedPreset = name;
			}
		}
		this._selectPresetColor(this._selectedPreset);
	}

	_selectPresetColor (selectedName) {
		for (let name in this._presetButtons) {
			let btn = this._presetButtons[name];
			if (name === selectedName) {
				btn.add_css_class('notes-preset-selected');
			} else {
				btn.remove_css_class('notes-preset-selected');
			}
		}
	}

	//--------------------------------------------------------------------------

	_buildHelpPage(builder) {
		let help_url = 'https://github.com/escator/notes-extension-gnome/blob/master/README.md';
		builder.get_object('help_btn').set_uri(help_url);

		let data_button = builder.get_object('backup_btn');
		data_button.connect('clicked', (widget) => {
			GLib.spawn_command_line_async('xdg-open ' + Common.DATA_PATH);
		});

		let reset_button = builder.get_object('reset_btn');
		reset_button.connect('clicked', (widget) => {
			this._settings.set_boolean('ugly-hack', !this._settings.get_boolean('ugly-hack'));
		});
	}

	//--------------------------------------------------------------------------

	_buildAboutPage(builder) {
		builder.get_object('about_icon').set_from_pixbuf(
			GdkPixbuf.Pixbuf.new_from_file_at_size(this._path +
			                             '/icons/notes.png', 96, 96)
		);

		let ext_version = _("Version %s").replace('%s', this._version);
		builder.get_object('label_version').set_label(ext_version)

		builder.get_object('report_link_button').set_uri('https://github.com/escator/notes-extension-gnome');
	}
}

//------------------------------------------------------------------------------
