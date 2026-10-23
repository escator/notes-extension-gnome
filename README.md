# Notes — sticky notes for GNOME Shell

A GNOME Shell extension providing customizable sticky notes on your desktop.

This repository is a **fork** of
[notes-extension-gnome](https://github.com/maoschanz/notes-extension-gnome)
by Romain F. T. ([maoschanz](https://github.com/maoschanz)) with a number of
new features added on top of it.

**English** · [Русский](#russian)

---

<a id="english"></a>
## About this fork

The original **Notes** extension (uuid `notes@maestroschan.fr`, also known as
[Sticky Notes on extensions.gnome.org](https://extensions.gnome.org/extension/1357/notes/))
is written and maintained by Romain F. T. (maoschanz), Copyright 2018–2021.

This fork starts from the upstream `master` as of July 2023 (commit `b5a5080`,
the last upstream commit so far) and extends it with a redesigned note, text
editing improvements, clipboard features, multi-monitor layouts and a color
filter. The fork is developed and maintained by
**Pavel Chernyakov (escator)** (2026);
the whole work remains free software under the **GNU GPL v3**, same as the
original.

## What's changed in this fork

Compared to the original extension:

- **Redesigned note.** A note is read-only by default, with an explicit edit
  toggle in its header. The text of a read-only note can be selected and
  copied; pressing `Ctrl+V` on it switches the note into the editing mode.
  Newly created notes open directly in the editing mode. All header buttons
  work in both modes.
- **Text editing.** A context menu on the note text: cut / copy / paste /
  undo / redo / select all. The extension keeps its own undo/redo history
  (`Ctrl+Z` / `Ctrl+Shift+Z`) and handles the text-related keys itself, which
  also fixes several focus and clipboard bugs of the native text entry.
- **Clipboard features.** A *paste from clipboard* button in the note header,
  and a *New from Clipboard* item in the panel menu that creates a read-only
  note prefilled with the current clipboard text.
- **Note expanding.** A double click on the note header unfolds the note
  (with a short animation) so the whole text is visible; another double
  click folds it back. The layouts on the disk always keep the normal size.
- **Quick clicks.** A double click on the panel icon creates a new note in
  the editing mode.
- **Multi-monitor layouts.** The position of the notes is saved per monitor
  configuration (signature `WxH+X+Y` in a `layouts.json` registry, last 8
  configurations kept). When monitors are added, removed or re-arranged, the
  notes automatically come back to where they were for that configuration.
- **Color filter.** The panel menu has a *Filter by color* section: pick one
  of the 8 palette colors and all notes of other colors are hidden (with a
  short fade-out); new notes take the filter color. An active filter is shown
  as a dot on the panel icon. The filter lives for the current session only.
- **Colors.** The free-form color picker is replaced by 8 preset colors
  (shared by the note menu, the settings window and the filter); a new note
  takes the active filter color, or the *First note's color* from the
  settings when no filter is active.
- **Panel icon.** The panel shows the bundled full-color application icon
  instead of a generic symbolic one.
- **Localization.** Full Russian translation; other languages are partially
  updated (untranslated strings fall back to English).
- **Removed.** The custom color submenu, the *Quit* item of the panel menu,
  the *Position of notes* option (notes are always shown above the windows),
  and the *Automatic focus* option (currently disabled).

## Compatibility

The upstream extension declares GNOME Shell 40–44. This fork is developed and
verified on **GNOME Shell 42 under X11**; other versions and Wayland are not
tested by the fork.

## Installation

```bash
git clone https://github.com/<fork-owner>/notes-extension-gnome.git
cd notes-extension-gnome
./install.sh
```

Then restart the GNOME Shell session (on X11: `Alt+F2`, `r`, `Enter`; on
Wayland: log out and back in) and enable the extension with the *Extensions*
application or:

```bash
gnome-extensions enable notes@maestroschan.fr
```

The extension installs into `~/.local/share/gnome-shell/extensions/`. Notes
created by the original extension remain readable: on the first start their
positions are migrated to the new layout registry automatically.

## Usage guide

### Panel button

- **Left-click** the icon in the top bar to show/hide all notes. The action
  fires after the system double-click timeout (~0.4 s), which is what lets a
  **double-click** create a new note in the editing mode instead.
- **Right-click** opens the panel menu:
  - *New note* — create a note;
  - *New from Clipboard* — create a read-only note with the clipboard text
    (grayed out while the clipboard holds no text);
  - *Filter by color* — 8 color swatches and a *Reset filter* item;
  - *Settings* — open the settings window.

### Notes

- **Create:** a double click on the panel icon, or the *New note* item of
  the panel menu. The new note opens in the editing mode, at a free spot;
  it takes the filter color when a filter is active, the *First note's
  color* otherwise.
- **Move:** drag the blank space in the center of the note header.
- **Resize:** drag the resize grip on the right of the note header; a double
  click on the grip resets the note to its starting size (300×180).
- **Expand:** a double click on the blank space of the header unfolds the
  note so the whole text is visible; another double click folds it back.
- **Edit:** the edit (pencil) button toggles between the read-only and the
  editing mode; the same button finishes editing.
- **Copy / paste:** the header has dedicated copy-to-clipboard and
  paste-from-clipboard buttons.
- **Delete:** the wastebasket button (asks for confirmation).
- **Color and font size:** the menu (hamburger) button of the note header —
  8 color swatches (the current one is marked with a ring) and `−` / `+`
  font size buttons.

### Keyboard shortcuts (in the note text)

| Keys | Action |
|------|--------|
| `Ctrl+Z` | undo |
| `Ctrl+Shift+Z` | redo |
| `Ctrl+C` | copy the selection (both modes) |
| `Ctrl+X` | cut the selection (editing mode) |
| `Ctrl+V` / `Shift+Insert` | paste (editing mode; in read-only mode `Ctrl+V` switches to editing) |
| `Ctrl+A` | select all |

All of these are also available in the text context menu (right-click).

### Multi-monitor behavior

Every monitor configuration gets its own saved layout of the notes. When you
dock a laptop, plug in an external monitor or change the screen arrangement,
the notes reappear at the positions saved for that exact configuration. The
last 8 configurations are remembered.

### Settings window

- *Keyboard shortcut* — show/hide all notes with a shortcut
  (`<Super><Alt>n` by default); with it enabled the top-bar icon can be
  hidden;
- *First note's color* — the color new notes get when no filter is active;
- *Backup* — opens the storage directory (see *Storage* below);
- *Help* — the online help manual and a *Bring back to the primary monitor*
  button.

## Storage

Notes are stored in `~/.local/share/notes@maestroschan.fr`: one text file per
note plus the `layouts.json` registry of monitor layouts. Uninstalling the
extension does not delete the data.

## Development and testing

Plain-gjs test suites run from the repository root without a GNOME Shell
session:

```bash
gjs test/testLayouts.js       # layout registry
gjs test/testTextHistory.js   # undo/redo history
gjs test/smokeExtension.js    # extension.js against stubbed shell imports
```

Design documents (ADRs and task journals) live in `docs/`.

## Credits and license

This program is free software: you can redistribute it and/or modify it under
the terms of the **GNU General Public License version 3** as published by the
Free Software Foundation, see [LICENSE](./LICENSE).

- The original extension — Copyright 2018–2021 Romain F. T. (maoschanz).
- Fork modifications — Copyright 2026 Pavel Chernyakov (escator), including
  the Russian translation.
- Some bundled symbolic icons are based on the GNOME Adwaita icon theme,
  dual-licensed LGPL-3.0-or-later / CC-BY-SA-3.0 and used here under the
  LGPL-3.0 terms; `notes.png` was drawn for this fork.

---

<a id="russian"></a>
## Об этом форке

Оригинальное расширение **Notes** (uuid `notes@maestroschan.fr`, известно как
[Sticky Notes на extensions.gnome.org](https://extensions.gnome.org/extension/1357/notes/))
написано и поддерживается Роменом Ф. (maoschanz), Copyright 2018–2021.

Этот форк начинается с апстримного `master` по состоянию на июль 2023 года
(коммит `b5a5080` — последний коммит апстрима на сегодня) и расширяет его
переработанной заметкой, улучшениями редактирования текста, работой с буфером
обмена, мультимониторными раскладками и цветовым фильтром. Форк развивает
**Павел Черняков (escator)** (2026); вся работа остаётся свободным ПО под
лицензией **GNU GPL v3**, как и оригинал.

## Что изменено в этом форке

По сравнению с оригинальным расширением:

- **Переработанная заметка.** По умолчанию заметка доступна только для чтения,
  с явным переключателем редактирования в заголовке. Текст заметки «только для
  чтения» можно выделять и копировать; `Ctrl+V` на нём переводит заметку в
  режим редактирования. Новые заметки открываются сразу в режиме ввода. Все
  кнопки заголовка работают в обоих режимах.
- **Редактирование текста.** Контекстное меню текста заметки: вырезать /
  копировать / вставить / отменить / повторить / выделить всё. Расширение
  ведёт собственную историю правок (`Ctrl+Z` / `Ctrl+Shift+Z`) и само
  обрабатывает текстовые клавиши — заодно исправлены несколько ошибок фокуса
  и буфера обмена штатного текстового поля.
- **Буфер обмена.** Кнопка *вставить из буфера* в заголовке заметки и пункт
  *Новая из буфера обмена* в меню панели, создающий заметку «только для
  чтения»
  с текстом из буфера.
- **Разворачивание заметки.** Двойной клик по заголовку заметки плавно
  разворачивает её так, чтобы был виден весь текст; повторный двойной клик
  сворачивает обратно. На диск всегда сохраняется обычный (домашний) размер.
- **Быстрые клики.** Двойной клик по значку панели создаёт новую заметку в
  режиме редактирования.
- **Мультимониторные раскладки.** Положение заметок сохраняется для каждой
  конфигурации мониторов (подпись `WxH+X+Y` в реестре `layouts.json`,
  хранятся последние 8 конфигураций). При добавлении, отключении или смене
  порядка мониторов заметки автоматически возвращаются на сохранённые для
  этой конфигурации места.
- **Цветовой фильтр.** В меню панели есть секция *Фильтр по цвету*: выберите
  один из 8 цветов палитры — и все заметки других цветов скроются (с коротким
  затуханием); новые заметки наследуют цвет фильтра. Активный фильтр показан
  точкой на иконке панели. Фильтр действует только в текущей сессии.
- **Цвета.** Произвольный подбор цвета заменён 8 предустановленными цветами
  (общими для меню заметки, окна настроек и фильтра); новая заметка получает
  цвет активного фильтра, а без фильтра — цвет *Цвет первой заметки* из
  настроек.
- **Иконка панели.** На панели отображается вложенная полноцветная иконка
  приложения вместо безликой символической.
- **Локализация.** Полный перевод на русский язык; остальные языки обновлены
  частично (непереведённые строки откатываются к английским).
- **Убрано.** Подменю произвольного цвета, пункт *Quit* в меню панели, опция
  *Положение заметок* (заметки всегда отображаются поверх окон) и опция
  *Автоматический фокус* (сейчас отключена).

## Совместимость

Апстрим заявляет GNOME Shell 40–44. Форк разрабатывался и проверялся на
**GNOME Shell 42 под X11**; остальные версии и Wayland форком не проверялись.

## Установка

```bash
git clone https://github.com/<fork-owner>/notes-extension-gnome.git
cd notes-extension-gnome
./install.sh
```

Затем перезапустите сессию GNOME Shell (на X11: `Alt+F2`, `r`, `Enter`; на
Wayland: выйти и войти заново) и включите расширение в приложении
*Расширения* или командой:

```bash
gnome-extensions enable notes@maestroschan.fr
```

Расширение устанавливается в `~/.local/share/gnome-shell/extensions/`.
Заметки, созданные оригинальным расширением, остаются читаемыми: при первом
запуске их позиции автоматически переносятся в новый реестр раскладок.

## Справка по работе

### Кнопка панели

- **Левый клик** по иконке в верхней панели — показать/скрыть все заметки.
  Действие срабатывает через таймаут двойного клика системы (~0,4 с) —
  именно поэтому **двойной клик** успевает создать новую заметку в режиме
  редактирования.
- **Правый клик** открывает меню панели:
  - *Новая заметка* — создать заметку;
  - *Новая из буфера обмена* — заметка «только для чтения» с текстом из буфера
    (пункт потушен, пока в буфере нет текста);
  - *Фильтр по цвету* — 8 цветных свотчей и пункт *Сбросить фильтр*;
  - *Настройки* — окно настроек.

### Заметки

- **Создать:** двойной клик по значку панели или пункт *Новая заметка* в
  меню панели. Новая заметка открывается в режиме редактирования, на
  свободном месте; она получает цвет активного фильтра, а без фильтра —
  цвет *Цвет первой заметки*.
- **Переместить:** перетащите пустое место в центре заголовка заметки.
- **Изменить размер:** потяните за рычаг изменения размера справа в
  заголовке; двойной клик по рычагу возвращает стартовый размер (300×180).
- **Развернуть:** двойной клик по пустому месту заголовка разворачивает
  заметку так, чтобы был виден весь текст; повторный двойной клик
  сворачивает обратно.
- **Редактировать:** кнопка-карандаш переключает режимы «только для чтения»
  и редактирования; той же кнопкой редактирование завершается.
- **Скопировать / вставить:** в заголовке есть отдельные кнопки копирования
  в буфер и вставки из буфера.
- **Удалить:** кнопка-корзина (с подтверждением).
- **Цвет и размер шрифта:** кнопка-меню в заголовке заметки — 8 цветных
  свотчей (текущий отмечен кольцом) и кнопки `−` / `+` размера шрифта.

### Клавиатурные сочетания (в тексте заметки)

| Сочетание | Действие |
|-----------|----------|
| `Ctrl+Z` | отменить |
| `Ctrl+Shift+Z` | повторить |
| `Ctrl+C` | копировать выделение (в обоих режимах) |
| `Ctrl+X` | вырезать выделение (режим редактирования) |
| `Ctrl+V` / `Shift+Insert` | вставить (режим редактирования; в режиме «только для чтения» `Ctrl+V` переводит заметку в редактирование) |
| `Ctrl+A` | выделить всё |

Все они есть и в контекстном меню текста (правый клик).

### Поведение при смене мониторов

Для каждой конфигурации мониторов сохраняется своя раскладка заметок. При
подключении док-станции, внешнего монитора или изменении расположения экранов
заметки возвращаются на позиции, сохранённые именно для этой конфигурации.
Последние 8 конфигураций запоминаются.

### Окно настроек

- *Использовать комбинацию клавиш* — показывать/скрывать все заметки
  сочетанием клавиш (по умолчанию `<Super><Alt>n`); при включённой опции
  значок в верхней панели можно скрыть;
- *Цвет первой заметки* — цвет новых заметок, когда фильтр не активен;
- *Резервное копирование* — открывает каталог хранения данных (см.
  «Хранение данных» ниже);
- *Справка* — онлайн-руководство и кнопка «Вернуть на основной монитор».

## Хранение данных

Заметки хранятся в `~/.local/share/notes@maestroschan.fr`: по одному
текстовому файлу на заметку плюс реестр раскладок `layouts.json`. Удаление
расширения данные не затрагивает.

## Разработка и тестирование

Тесты на чистом gjs запускаются из корня репозитория без сессии GNOME Shell:

```bash
gjs test/testLayouts.js       # реестр раскладок
gjs test/testTextHistory.js   # история отмен/повторов
gjs test/smokeExtension.js    # extension.js на стабах импортов shell
```

Проектные документы (ADR и журналы задач) лежат в `docs/`.

## Авторы и лицензия

Эта программа — свободное ПО: вы можете распространять её и/или изменять на
условиях **GNU General Public License версии 3**, опубликованной Free
Software Foundation; см. [LICENSE](./LICENSE).

- Оригинальное расширение — Copyright 2018–2021 Romain F. T. (maoschanz).
- Доработки форка — Copyright 2026 Павел Черняков (escator), включая перевод
  на русский язык.
- Часть вложенных символических иконок основана на теме иконок GNOME Adwaita
  (двойная лицензия LGPL-3.0-or-later / CC-BY-SA-3.0, здесь используются на
  условиях LGPL-3.0); `notes.png` нарисована для этого форка.
