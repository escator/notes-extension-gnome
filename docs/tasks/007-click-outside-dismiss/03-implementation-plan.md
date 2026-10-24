# 03 План реализации: клик вне заметок

Фаза одна — Ф2 «подложка + настройка» (коммит вместе со smoke-фазой 7;
переводы — отдельный коммит той же ветки).

## Изменения по файлам

### notes@maestroschan.fr/schemas/org.gnome.shell.extensions.notes-extension.gschema.xml

- Ключ `hide-on-click-outside` (b, default true) после `hide-icon`;
  `gschemas.compiled` перегенерировать (`glib-compile-schemas schemas/`).

### notes@maestroschan.fr/extension.js (`NotesManager`)

- `constructor`: `this._clickCatcher = null;`
- `_updateClickCatcher()` — создание/видимость по 02-architecture;
- `_dismissNotes()` — отмена пары 006 + `_hideNotes()`;
- вызовы `_updateClickCatcher()` из `_showNotes`, `_onlyHideNotes`,
  обработчика `changed::hide-on-click-outside` (`_connectAllSignals`,
  `destroy`);
- `destroy()`: `removeChrome` + destroy подложки.

### notes@maestroschan.fr/prefs.ui

- Label «Hide notes on click outside» + `GtkSwitch#hide_outside_switch`,
  ряды 20; разделитель с ряда 20 → 21 (цветовые свотчи остаются на 22).

### notes@maestroschan.fr/prefs.js

- `_buildSettingsPage`: связка `hide_outside_switch` ↔ `hide-on-click-outside`
  по образцу `hide_switch`.

### Переводы

- `locale/notes-extension.pot` + `locale/ru/LC_MESSAGES/notes-extension.po`:
  новая строка «Hide notes on click outside»; `msgfmt` → `.mo`
  (`update-and-compile-translations.sh`).

### test/smokeExtension.js

- стабы: `Clutter.Actor` (фиксирует props/visible), `Clutter.BindConstraint`,
  `Clutter.EVENT_STOP`; `Main.layoutManager.addChrome/removeChrome` — запись
  вызовов; `Main.uiGroup.add_child/get_children/set_child_below_sibling`;
  `fakeSettings.get_boolean` — по ключу (`hide-on-click-outside: true`).
- Фаза 7: `_showNotes` → подложка создана/видима, addChrome звался;
  обработчик press → заметки скрыты (hideCount), `_notesAreVisible = false`,
  подложка невидима; `_onlyHideNotes` (меню настроек) → подложка невидима;
  выключение настройки при видимых заметках → подложка снята сразу;
  включение → `_showNotes` возвращает подложку; dismissal отменяет
  отложенный toggle 006; `destroy()` → removeChrome.

## Definition of Done

- Приёмка 007-1…12 (README): smoke-часть зелёная, живая часть показана
  пользователем (X11).
- `gjs test/smokeExtension.js` — 0 FAIL.

## Риски

- Взаимодействие подложки с grab'ами PopupMenuManager/GrabHelper (007-8) —
  только живая приёмка, в smoke не моделируется.
- Сброс input region при модалках — поведение shell, не наше; проверить
  восстановление после диалога (007-8).
