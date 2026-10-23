# 03: План реализации — разворачивание заметки двойным кликом

Концепт и решения: [02-architecture.md](02-architecture.md), ADR
[0004](../../adr/0004-note-expand-toggle.md) (accepted). Ветка:
`feat/note-expand` от `dev` (документация — уже первый коммит ветки). Каждая
фаза — рабочее состояние и один логический коммит; после каждой — запись в
[04-progress.md](04-progress.md).

Кураторские правила: коммиты в ветке без согласия не сливаются; слив в `dev`
`--no-ff` после приёмки (AGENT.md).

## Ф1 — чистая геометрия в layouts.js (+ юнит-тесты)

Без изменения поведения расширения.

### layouts.js

- Экспорт `bestMonitor(rect, monitors)`: монитор с максимальной площадью
  пересечения с `rect`, fallback `monitors[0]` — извлечь логику из тела
  `clampRect` (layouts.js:59), `clampRect` переписать на вызов
  `bestMonitor` (поведение неизменно).
- Экспорт `fitExpandRect(baseRect, monitors, neededH)` — алгоритм
  [02 §3–§4](02-architecture.md) целиком: пол `w₀ = min(baseRect.w,
  monitor.width)`, поиск шагом 40px при условии `neededH(W) ≤ min(4/3·W,
  monitor.height)`, потолок `W ≤ monitor.width`, позиция со сдвигами
  влево/вверх внутри монитора. Возвращает `{x, y, w, h}`.

### test/testLayouts.js

Новые сценарии (по образцу существующих):

- `bestMonitor`: максимальное пересечение; вне всех мониторов → первый;
  пустой список → не падает (fallback `clampRect`).
- `fitExpandRect`:
  - компактный текст → минимальный прямоугольник 3:4, поиск стартует с
    текущей ширины, сдвигов нет;
  - текст у нижнего края → сдвиг вверх, низ не выходит за монитор;
  - у правого края → сдвиг влево, правый край не выходит за монитор;
  - защита A: `neededH` не удовлетворяется нигде → `W = monitor.width`;
  - защита B: `4/3·W > monitor.height` → `H = monitor.height`;
  - крайний случай: полный монитор, хвост скрыт;
  - база шире монитора → `w₀ = monitor.width` (не расширяем сверх).

Прогон: `gjs test/testLayouts.js` — старые + новые зелёные.

## Ф2 — ядро NoteBox: двойной клик и разворот

Персистенс-чок-пойнты менеджера ещё не переключены — Ф2 проверяется
вручную/дымом, полная защита правил диска приходит в Ф3.

### noteBox.js

- Константы рядом с существующими: `EXPAND_ANIM_MS = 250`,
  `DBL_CLICK_DIST_PX = 8`; поля: `_expanded = false`, `_homeRect = null`,
  `_lastPressTime/_lastPressX/_lastPressY`.
- `_onMovePress` (noteBox.js:883): перед общей логикой — детектор двойного
  клика ([02 §2](02-architecture.md)); при срабатывании —
  `_toggleExpanded()`, `return Clutter.EVENT_STOP`. Запоминать
  время/координаты каждого нажатия кнопки 1.
- Новые методы:
  - `_isTextFullyVisible()`: `chromeH + get_preferred_height(...)[1] ≤
    actor.height + 2` ([02 §3](02-architecture.md));
  - `_expandNote(animated)`: no-op при полном влезании; иначе `_homeRect` =
    живой прямоугольник; цель = `Layouts.fitExpandRect(живой прямоугольник,
    manager._monitorRects(), W => this._neededH(W))`; `_expanded = true`;
    `_applyRectAnimated(цель, animated)`;
  - `_collapseNote(animated)`: цель = `_homeRect`, сброс состояния,
    применение;
  - `_applyRectAnimated(rect, animated)`: [02 §6](02-architecture.md) —
    бухгалтерия сразу, `actor.ease` или прямой снап; `onComplete` — снап к
    целым.
- `_onPressCommon` (noteBox.js:895): если есть активные переходы —
  `remove_all_transitions()` + снап актора к `_x/_y` и размерам из
  бухгалтерии (бухгалтерия уже целевая).
- `show()` (noteBox.js:739): при `_expanded` — `_collapseNote(false)` до
  видимости.
- `_onRelease` (noteBox.js:944): при `_expanded` — `_homeRect` = живой
  прямоугольник.
- Re-fit ([02 §5](02-architecture.md)): `_onTextChanged` и
  `changeFontSize` — при `_expanded` вызвать `_expandNote(false)` (пол
  поиска от `_homeRect.w`); замер без анимации.

Живая проверка (X11, DISPLAY=:1): сценарии 1–3, 8–11 из
[README](README.md) в черновом виде (проверки `layouts.json` — после Ф3).

## Ф3 — персистенс менеджера

### extension.js

- Все 5 точек чтения геометрии (01 §3) → `n.getPersistedRect()`:
  `saveLayout` (:295), `createNote` (:230), `_noteRect` (:304),
  fold-размеры в `applyLayoutForCurrentConfig` (:365) и
  `foldAllIntoPrimary` (:386).
- `_applyRectToNote` (:313): первой строкой — если `note._expanded` →
  `note._collapseNote(false)`.

### Проверка

Чтение `~/.local/share/notes@maestroschan.fr/layouts.json` руками: сценарии
4–7 из README (клик по другой заметке при развёрнутой; ручной resize;
ручной drag; скрыть/показать).

## Ф4 — развертывание и приёмка

- Установка: `./install.sh` (rm-before-cp), перезапуск shell.
- Полная живая приёмка сценариев 1–11 README на X11; журнал shell чистый
  (без новых assertion-пар).
- Обновить [04-progress.md](04-progress.md) (фазы закрыты), статус задачи в
  [tasks/README.md](../README.md) → `implemented` (после слияния —
  `merged`).
- Переводы: новых строк нет, каталог не трогаем.

## Матрица «фаза → сценарий приёмки»

| Сценарий README | Ф1 | Ф2 | Ф3 | Ф4 |
|---|---|---|---|---|
| 1 разворот 3:4 + анимация | unit | + | | финал |
| 2 сворачивание к исходному | unit | + | | финал |
| 3 no-op при влезании | unit | + | | финал |
| 4 развёрнутый размер не на диске | — | — | + | финал |
| 5 ручной resize в развёрнутом | — | частично | + | финал |
| 6 ручной drag в развёрнутом | — | частично | + | финал |
| 7 скрыть/показать → домашний | — | + | + | финал |
| 8 re-fit при правке | — | + | | финал |
| 9 сдвиги у краёв | unit | + | | финал |
| 10 защита максимума | unit | + | | финал |
| 11 оба режима, monitors-changed | — | + | + | финал |

## Definition of Done

- Все 11 сценариев README прожиты живьём на X11 пользователем.
- `gjs test/testLayouts.js` зелёный (старые + новые проверки); дым
  расширения (`gjs test/smokeExtension.js`) — без регрессий (затрагивается
  только при необходимости стабов под `getPersistedRect`).
- Журнал shell без новых ошибок/assertion-пар за сессию приёмки.
- `layouts.json` после всех сценариев содержит только домашние
  прямоугольники.
- Документация: ADR-0004 связан с задачей; 04-progress заполнен; индексы
  задач/ADR актуальны.
- Слив в `dev` `--no-ff` с согласия пользователя; установленная копия
  обновлена и перезапущена.

## Риски и открытые вопросы

- **Замер сразу после смены размера шрифта**: рестайл может опережать
  пересчёт preferred height. Если живая проверка (сценарий 8) покажет —
  пере-замер через `Meta.later_add(Meta.LaterType.BEFORE_REDRAW, ...)`
  (паттерн уже есть в `selectAllText`, noteBox.js:499).
- **`actor.ease` по width/height/x/y на chrome-акторе**: в проекте до сих
  пор анимировалась только opacity (fade фильтра). Каждый кадр
  перепаковывает текст (pango relayout) — для типичных заметок дёшево; при
  рывках на приёмке — мгновенное применение без ease (решение в момент
  приёмки, деградация не ломает сценарии).
- **Пороги двойного клика**: 8px/400мс (fallback) могут конфликтовать с
  привычками; Tuning — на живой приёмке.
- **Drag посреди анимации**: покрыто снапом в `_onPressCommon`; сценарий 11
  фиксирует.
- **`smokeExtension.js`**: фейковый NoteBox не знает `getPersistedRect` —
  добавить в стаб при проработке Ф3, чтобы дым не падал.

Открытых вопросов нет: все решения закрыты (ADR-0004).
