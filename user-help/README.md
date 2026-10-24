# Basic help manual

## The panel icon

**Show/hide all notes:** left-click on the icon in the GNOME Shell top bar.
The action fires after the system double-click timeout (~0.4 s).

**Create a note:** double-click on the panel icon. The new note opens in the
editing mode; it gets the color of the active color filter, or the default
color when no filter is active (see *First note's color* in the settings).

**The panel menu:** right-click on the panel icon:

- *New note* — create a note (the same as the double click);
- *New from Clipboard* — create a note prefilled with the current clipboard
  text (grayed out while the clipboard holds no text);
- *Filter by color* — pick one of the 8 palette colors: all the notes of
  other colors fade out. The active filter is shown as a dot on the panel
  icon, new notes take the filter color, and it lives for the current
  session only. Picking the active filter's color again, or the
  *Reset filter* item, shows everything back;
- *Settings* — open the settings window.

## Notes

**Edit:** a note is read-only by default (its text can still be selected and
copied). The pencil button in the header enables the editing mode; the same
button (a checkmark then) finishes editing. Newly created notes open
directly in the editing mode.

**Move:** drag the blank space in the center of the note header.

**Resize:** drag the resize button at the right of the note header; a double
click on it resets the note to its starting size (300×180).

**Expand:** a double click on the blank space of the header unfolds the note
(with a short animation) so the whole text is visible; another double click
folds it back. The size saved on the disk doesn't change.

**Copy / paste:** the header has a *copy to clipboard* button (copies the
whole text of the note) and a *paste from clipboard* button (appends the
clipboard text at the end of the note). In the editing mode `Ctrl+V` pastes
at the text cursor; on a read-only note `Ctrl+V` switches it into the
editing mode.

**Change color and font size:** click on the menu button of the header:
8 preset colors (the current one is marked with a ring) and `−` / `+` font
size buttons.

**Delete:** click on the wastebasket icon and confirm.

**Text editing:** right-click on the text (or press the `Menu` key) to open
the context menu: cut / copy / paste, undo / redo, select all. The
extension keeps its own undo/redo history, also reachable with `Ctrl+Z` and
`Ctrl+Shift+Z`.

## The settings window

- *Use a keyboard shortcut* — show/hide all the notes with a keyboard
  shortcut (`<Super><Alt>n` by default: enter the value and press *Apply*).
  With the shortcut enabled, the panel icon can also be hidden
  (*Hide the icon*).
- *First note's color* — the color new notes get when no color filter is
  active, chosen among the 8 presets.
- **Backup** — a button opens the directory where the notes are stored: one
  text file per note, plus the `layouts.json` registry holding the layout
  of the notes for each monitor configuration.
- **Help** — a link to the online help manual, and a *Bring back to the
  primary monitor* button for the notes stuck on a disconnected monitor.
