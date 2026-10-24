# 008 — 01: Анализ (2026-10-24)

Аудит против официальных гайдов портирования GNOME Shell 45–50
(gjs.guide/extensions/upgrading/…). Пути от `notes@maestroschan.fr/`.

## 1. Формат: всё сломано на 45+

Все модули — legacy-скрипты на `imports.*`; на 45+ Shell грузит только ESM с
классом `Extension`/`ExtensionPreferences`.

- `extension.js`: `init`/`enable`/`disable` — :33/:45/:49; импорты `gi`,
  `ui.panelMenu`, `ui.panel`, `ui.main`, `ui.popupMenu`, `misc.util` —
  :5–10; `Mainloop` — :9; `Me = ExtensionUtils.getCurrentExtension()` — :14;
  `Me.imports.*` — :16–18.
- `prefs.js`: импорты :5–14; `init()` + `initTranslations()` :18–20;
  `SETTINGS = ExtensionUtils.getSettings()` на уровне модуля :22;
  GObject-класс `NotesSettingsWidget`, UI из `Gtk.Builder` +
  `Me.path+'/prefs.ui'` :25+.

## 2. Точки замены (механика порта)

| Что | Где | Замена |
|---|---|---|
| `Mainloop.timeout_add/source_remove` | extension.js: :431, :549–582 (`_pendingToggleId`), :864–866 (`_monitorsDebounceId`), :930, :936; prefs.js (импорт :6) | `GLib.timeout_add(GLib.PRIORITY_DEFAULT, …)` / `GLib.source_remove` (есть и в 42) |
| `Me.*` | extension.js:14, noteBox.js:11, menus.js:11+, prefs.js:12 | `this.uuid/this.dir/this.metadata` класса; `Me.path` → `this.dir.get_path()` |
| `Me.imports.*` | extension.js:16–18, noteBox.js:13–16, prefs.js:14 | относительные ESM-импорты `./common.js` и т.д. |
| `imports.ui.*` | extension.js, noteBox.js, menus.js (`boxpointer`, `signals`), dialog.js (`modalDialog`) | `resource:///org/gnome/shell/ui/*.js`, signals — `…/misc/signals.js` |
| `imports.gettext.domain` | extension.js:20, menus.js:16, prefs.js:8 | `import Gettext from 'gettext'`; домен уже в metadata (`gettext-domain`), `initTranslations` не нужен |
| `imports.byteArray` | layouts.js:12 | `TextDecoder` (byteArray deprecated) |
| Открытие prefs | extension.js:795–798 (`ExtensionUtils.openPrefs` → фолбэк `Util.spawn(['gnome-shell-extension-prefs',…])`) | обе ветки мертвы на 45+; `this.openPreferences()` из Extension, в меню — callback |
| prefs-формат | prefs.js целиком | `fillPreferencesWindow(window)`; текущий Gtk.Stack из `prefs.ui` целиком внутри `Adw.PreferencesPage`; `window.set_default_size(496, 405)` |
| `getSettings()` на уровне модуля | prefs.js:22 | `this.getSettings()` (схема из `settings-schema` metadata) |

## 3. Аудит 46–50: удаляемые API не используются

- **46**: `Clutter.Container` — нет; `St.Bin` (menus.js:281,
  extension.js:80) — только как контейнер, без FILL-expand — ок; markup в
  `St.Button` — нет; BlurEffect/cairo/Barrier/UnixInputStream — нет.
- **47**: `Clutter.Color` — нет; `fillPreferencesWindow` стал async —
  учтено в Ф2.
- **48**: St `.vertical` — нет; `Clutter.Image` — нет;
  `Stage.get_key_focus()` теперь возвращает null — noteBox.js:1322 уже с
  null-проверкой; переезды в `Meta.Compositor` — `window_actors` не
  используются.
- **49**: `Clutter.ClickAction`/`TapAction` — нет (006 сделан на своих
  таймерах); `Meta.Rectangle`, `get_maximized`, `AppMenuButton` — нет;
  X11 off by default — только среда запуска.
- **50**: X11 удалён — не задевает: chrome-акторы работают на Wayland,
  keycodes двупутные (noteBox.js:44–49, :692); restart-сигналы
  `global.display` и `releaseKeyboard`/`holdKeyboard` — не используются.

## 4. 40/41 — сломаны; 44 проверен контейнером

`metadata.json` заявляет 40–44 (наследие апстрима). Prefs форка рассчитан
на GTK4 (свотчи, GTK4-специфика), в 40/41 окно настроек — GTK3. Снять из
заявления.

Статус по версиям: 42.9 — подтверждён live-приёмкой; **44.9 — подтверждён
контейнерным прогоном gnome-shell-pod (2026-10-24, см. 04)**: смок 239
проверок, install/enable, меню, создание/ввод/персистентность заметок,
хоткей, prefs — всё зелёное, кроме бага prefs из §5 (фикс проверен там же);
43 не прогонялся (по гайдам чист).

## 5. Неучтённые моменты / открытые вопросы

- **Баг prefs на 44 (найден контейнерным тестом 2026-10-24)**:
  prefs.js:116 `provider.load_from_data(css)` на GTK 4.8 + gjs 1.76 падает
  — `TypeError: … At least 2 arguments required` (нужна пара
  данные/длина), окно настроек не открывается вовсе; на 42.9 (GTK 4.6 +
  gjs 1.72) одноаргументный вызов работает. Фикс
  `load_from_data(css, -1)` корректен на обеих версиях GTK — применён и
  проверен в контейнере, в рабочее дерево не вносился. Входит в Ф0.
  Побочный эффект: упавший buildPrefsWidget оставляет в 42+ пустое
  модальное окно — shell отвечает «Already showing a prefs dialog» до
  рестарта сессии.

- **Смок-харнесс**: `test/smokeExtension.js` грузит настоящий extension.js,
  оценивая его с рукописным фейковым деревом `imports`. В ESM статические
  импорты `resource:///…` так не стабятся. Варианты — в
  [02-architecture.md](02-architecture.md) §5, решение на Ф3.
- **Цикл extension.js ↔ noteBox.js**: упомянут в шапке common.js (:6–10) как
  источник ненадёжного порядка инициализации; в ESM цикл даёт TDZ-риски —
  разорвать при порте (инъекция, см. 02 §2).
- **Установленная копия = рабочее дерево** (текущий ритуал): после Ф1
  ESM-дерево на 42.9 не грузится — на время порта установленной остаётся
  legacy-версия из тега.
