# 008 — 02: Архитектура порта

Формат GNOME 45+ (ESM), поведение и данные — без изменений (ADR-0006 п. 4).

## 1. Модульный граф

- **Чистые модули** (без shell-импортов, тестируются `gjs -m` напрямую):
  `common.js`, `layouts.js`, `textHistory.js`.
- **UI-модули** (импортируют `resource:///org/gnome/shell/ui/*.js`):
  `noteBox.js`, `menus.js`, `dialog.js`, точка входа `extension.js`.
- Импорты только относительные (`./common.js`); `imports.gi` → `gi://…`;
  `resource:///org/gnome/shell/ui/main.js` и т.п.

## 2. Зависимости вместо глобалов

`Me` и `ExtensionUtils` исчезают; контекст передаётся явно:

- `extension.js`: `export default class NotesExtension extends Extension`
  (из `resource:///org/gnome/shell/extensions/extension.js`); в `enable()`
  — `this.getSettings()` (схема из metadata `settings-schema`), менеджеру —
  `this.uuid`, `this.dir`, `this.metadata` параметрами.
- `noteBox.js`/`menus.js`: настройки, `DATA_PATH`, колбэки (включая
  открытие prefs) — параметрами конструкторов/фабрик. Цикл
  extension.js ↔ noteBox.js разрывается здесь: noteBox не знает про
  extension.js.
- Открытие prefs: `this.openPreferences()` (замена обеих мёртвых веток
  extension.js:795–798); меню получает callback.

## 3. Gettext

`import Gettext from 'gettext'; const _ =
Gettext.domain('notes-extension').gettext;` во всех модулях с UI-строками.
Домен уже в metadata (`gettext-domain`), `initTranslations` не нужен.

## 4. prefs.js

`export default class NotesExtensionPreferences extends
ExtensionPreferences` (из
`resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`).
`fillPreferencesWindow(window)` (async — 47 ждёт его): собрать текущий
Gtk.Stack из `prefs.ui` (`this.dir.get_path()+'/prefs.ui'`), обернуть в
`Adw.PreferencesPage` (+`Adw.PreferencesGroup`), добавить в окно;
`window.set_default_size(496, 405)`. Содержимое вкладок не переписывается —
GTK4-код остаётся; правки допустимы только если Adw-окно ломает вёрстку
(риск About, ADR-0006). Настройки — `this.getSettings()`.

## 5. Смок-харнесс (решено на Ф3: вариант (б))

`test/smokeExtension.js` legacy-линии подменял дерево `imports` вокруг
настоящего extension.js; в ESM так нельзя. Решение (2026-10-24, Ф3) —
**вариант (б)**, по изначальному наклону документа:

- `NotesManager` вынесен в чистый модуль `manager.js` (только `gi://GLib`,
  `gi://Gio`, `gettext`, `./common.js`, `./layouts.js`); shell-пространства
  (`{Main, PanelMenu, PopupMenu, St, Clutter, Shell, Meta}`), GLib-совместимый
  планировщик (`timers`: `timeout_add`/`source_remove`) и класс NoteBox
  приходят аргументами конструктора (продолжение принципа 02 §2);
- `extension.js` — тонкий адаптер (~60 строк): единственный модуль, знающий
  shell-пространства; собирает зависимости и создаёт менеджера;
- `test/smokeExtension.js` — настоящий ESM-тест (`gjs -m`) без всякого
  лоадера: динамический `import()` manager/common/layouts ПОСЛЕ редиректа
  `XDG_DATA_HOME` (статические импорты поднялись бы выше setenv; защитный
  `DATA_PATH`-гейт роняет тест при нарушении порядка), фейки ровно под
  инъекционную поверхность, ручной планировщик таймеров вместо `GLib.main`;
  все 6 фаз проверок сохранены 1:1;
- glue класса `Extension` (enable/disable/openPreferences) остался вне смока
  — он покрыт контейнерной приёмкой (сценарии 2–3).

Вариант (а) (рукописный лоадер v2 с текстовой подменой импортов) отклонён:
хрупкость навсегда, а после (б) тесты и CI гоняют один и тот же чистый
модуль под любым gjs. `testLayouts.js`/`testTextHistory.js` — без изменений
логики (заголовки ESM с Ф1).

## 6. Не меняется

Формат `N_state` (6 полей), `layouts.json` (ADR-0001), стили, иконки,
локали (ru 53/53), сценарии 004/005/006. Legacy-релиз (42–44) —
замороженный тег, не развивается.
