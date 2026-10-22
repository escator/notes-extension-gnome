# 03: План реализации — фильтр по цвету

Концепт и решения: [02-architecture.md](02-architecture.md), ADR
[0003](../../adr/0003-color-filter.md) (accepted). Ветка: `feat/color-filter`
от `dev`. Каждая фаза — рабочее состояние и один логический коммит; после
каждой — запись в [04-progress.md](04-progress.md) (заводится при старте Ф1).

Кураторские правила: коммиты в ветке без согласия не сливаются; слив в `dev`
`--no-ff` после приёмки (AGENT.md).

## Ф1 — ядро менеджера (без UI)

Скрытие мгновенное; анимация — Ф3. Проверяется офлайн-тестом.

### extension.js

- `NotesManager.constructor`: добавить `this._colorFilter = null` (имя
  пресета | null). Сбрасывать нечего: поле живёт в памяти.
- Новый `_passesFilter(note)`: `this._colorFilter === null` или
  `note.customColor === Common.PRESET_COLORS[this._colorFilter].rgb.join(',')`.
- `_showNotes()` (extension.js:391): показывать только
  `this._allNotes.filter(this._passesFilter, this)`. `_onlyHideNotes` — без
  изменений (прячет всех).
- Новый `_applyFilterHiding()`: для каждой видимой не-проходящей заметки —
  `setEditMode(false)` + `onlyHide()` (в Ф3 меняется на `fadeOutAndHide()`).
- Новый `setColorFilter(presetName)`: если `presetName ===
  this._colorFilter` — делегировать `clearColorFilter()` (toggle); иначе
  установить поле, `_applyFilterHiding()`, `_updateFilterBadge()` (сама
  появится в Ф2; до того — пустой метод-заглушка, чтобы Ф1 компилировалась
  без ссылок вперёд).
- Новый `clearColorFilter()`: поле в null; если `_notesAreVisible` —
  показать все (`_allNotes.forEach(n => n.show())`; в Ф3 — с отменой
  анимаций); `_updateFilterBadge()`.
- Новый `_filterColorString()`: `rgb.join(',')` активного пресета или `''`.
  Передать его вместо `''` в трёх вызовах `createNote`:
  `_onMenuNewNote` (extension.js:520), `_onMenuNewFromClipboard`
  (extension.js:538), `_toggleNotes` (extension.js:440).

### test/smokeExtension.js

Расширить фейковый NoteBox полями `customColor`/`visible` и счётчиками
show/hide (по образцу существующих стабов), добавить сценарии:

- `setColorFilter('mint')` при видимых заметках: mint видима, остальные
  скрыты (visible == false), edit mode погашен у скрытых;
- `_showNotes()` после фильтра: показаны только mint;
- `clearColorFilter()`: все видимы;
- повторный `setColorFilter('mint')` — сброс (toggle);
- `createNote` при активном фильтре — новой заметке передан rgb фильтра;
- заметка с цветом вне палитры не проходит ни один фильтр (фиксация риска
  02).

Прогон: `gjs test/smokeExtension.js` (из корня репо) — все старые проверки
зелёные + новые.

## Ф2 — секция меню и бейдж

### extension.js

- `_buildPanelMenu()` (extension.js:460):
  - ребёнок `panel_button`: вместо одиночной иконки — `St.BoxLayout`
    [иконка, `this._filterDot`]; точка — `St.Bin({ style_class:
    'notesFilterBadge', x_align: END, y_align: END })`, изначально скрыта;
  - после пункта New from Clipboard — `this._buildFilterSection()`:
    separator; строка-заголовок (неинтерактивный `PopupBaseMenuItem` с
    меткой `_("Filter by color")` — паттерн `size_item`, menus.js:48–56);
    две строки свотчей 2×4 (порядок палитры; неинтерактивные пункты +
    `St.Button` `notesCircleButton` — паттерн menus.js:60–84). Кнопки
    запомнить в `this._filterSwatches = { name: btn }`;
    `this._resetFilterItem = this._menu.addAction(_("Reset filter"),
    this.clearColorFilter.bind(this))`, `setSensitive(false)`.
- Свотч `clicked` → `setColorFilter(name)` + `this._menu.close()`
  (паттерн `_onApply`, menus.js:163–167).
- Обновление состояния при открытии — в существующем обработчике
  `open-state-changed` (extension.js:481): при `open` — перекрасить кольца
  свотчей (активному `border-color: <ring>; border-width: 2px`, остальным —
  базовый стиль, приём menus.js:138–140) и
  `this._resetFilterItem.setSensitive(this._colorFilter !== null)`.
- Новый `_updateFilterBadge()`: точка видима ⇔ фильтр активен; инлайновый
  `background-color: <ring-цвет>`. Реализацию из Ф1-заглушки заменить этой.

### stylesheet.css

- Класс `.notesFilterBadge`: `width: 8px; height: 8px; border-radius: 4px;`
  (фон инлайном из JS; форма — в CSS, как у `notesCircleButton`).

### Живая проверка (X11, DISPLAY=:1)

Сценарии 1–5, 7, 8 из [README](README.md) (сценарий 6 — после Ф3; 9 — после
Ф4): секция на месте, фильтр прячет/возвращает, бейдж, кольцо, глобальный
toggle поверх фильтра, перезапуск сбрасывает.

## Ф3 — плавное исключение и хук смены цвета

### noteBox.js

- Константа `FILTER_FADE_MS = 300` рядом с остальными локальными константами.
- Новый `fadeOutAndHide()`: guard `this.actor.visible`; `setEditMode(false)`;
  `this.actor.ease({ opacity: 0, duration: FILTER_FADE_MS, mode:
  Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: () => {
  this.onlyHide(); this.actor.opacity = 255; } })`.
- Новый `cancelFadeOut()`: снять переходы по opacity
  (`this.actor.remove_all_transitions()` — проверить наличие API в GS 40;
  фолбэк — сохранённая ссылка на transition) и вернуть `opacity = 255`.
  Вызывается перед `show()` из `clearColorFilter` (гонка «сброс во время
  fade»).
- `applyColorAndSave` (noteBox.js:921): после `onlySave()` —
  `this._manager.refreshFilterForNote(this)`.

### extension.js

- `_applyFilterHiding()`: `onlyHide()` → `fadeOutAndHide()`.
- Новый `refreshFilterForNote(note)`: если фильтр активен, заметка видима и
  `_passesFilter(note) == false` → `fadeOutAndHide()`. (Заметка, скрытая
  фильтром, недостижима для смены цвета — ветки «появления» нет, 01 п. 4.)
- `clearColorFilter()`: перед показом — `n.cancelFadeOut()` для всех.

### Живая проверка

Сценарий 6 из README: смена цвета видимой заметки при фильтре — плавный уход,
текст цел; сброс фильтра во время fade-out (спринт-клик) — заметка
возвращается непрозрачной; журнал shell без новых assertion-пар.

## Ф4 — переводы и приёмка

- `./update-and-compile-translations.sh --pot` (xgettext по POTFILES.in;
  extension.js уже в списке), затем `--all` (msgmerge всех + компиляция).
- В `locale/ru/LC_MESSAGES/notes-extension.po` заполнить 2 новые строки
  («Фильтр по цвету», «Сбросить фильтр»); пересобрать `ru`.
- Полная живая приёмка сценариев 1–9 README на X11; журнал чистый.
- Обновить: 04-progress (фазы закрыты), статус задачи в
  [tasks/README.md](../README.md) → `implemented` (после слияния — `merged`),
  индекс [adr/README.md](../../adr/README.md) — уже на этапе ADR.

## Матрица «фаза → сценарий приёмки»

| Сценарий README | Ф1 | Ф2 | Ф3 | Ф4 |
|---|---|---|---|---|
| 1 секция в меню | — | + | | |
| 2 фильтр прячет | smoke | + | | |
| 3 кольцо, активный сброс-пункт | — | + | | |
| 4 сброс возвращает | smoke | + | | |
| 5 новые заметки цветом фильтра | smoke | + | | |
| 6 плавное исчезновение при смене цвета | — | — | + | |
| 7 глобальный toggle поверх фильтра | smoke | + | | |
| 8 сброс перезапуском | — | + | | |
| 9 переводы | — | — | — | + |

## Definition of Done

- Все 9 сценариев README прожиты живьём на X11 пользователем.
- `gjs test/smokeExtension.js` зелёный (старые + новые проверки).
- Журнал shell без новых ошибок/assertion-пар за сессию приёмки.
- `.pot`/`.po`/`.mo` обновлены; ru-строки заполнены.
- Документация: ADR-0003 accepted и связан с задачей; 04-progress заполнен;
  индексы задач/ADR актуальны.
- Слив в `dev` `--no-ff` с согласия пользователя; установленная копия
  обновлена (install.sh) и перезапущена.

## Риски и открытые вопросы

- **`ease`/`remove_all_transitions` на chrome-акторе в GS 40** — до этого
  анимаций в проекте не было; если API отличается — фолбэк через
  `Clutter.PropertyTransition` с сохранённой ссылкой. Проверить в начале Ф3
  мини-экспериментом на живом shell.
- **Гонки fade-out ↔ глобальный hide**: `_hideNotes` прячет всех
  `onlyHide()` без отмены анимации — onComplete потом выполнится на скрытом
  акторе (безвредно: onlyHide идемпотентен, opacity вернётся). Оставить как
  есть, отметить наблюдение в 04.
- **Существующая асимметрия** (вне рамок): «New note» при глобально скрытых
  заметках создаёт видимую заметку — поведение до задачи 004, не менять.
- **Легаси-цвета вне палитры** скрыты любым фильтром — принято (ADR-0003),
  smoke-тест фиксирует.

Открытых вопросов нет: все решения закрыты (ADR-0003).
