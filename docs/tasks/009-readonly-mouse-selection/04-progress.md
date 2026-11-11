# 04: Журнал — 009

## 2026-11-12 — Ф1: доки и ветка

- Ветка `feat/readonly-selection` от dev (fd333a7), коммит 43df860:
  README (приёмка 1–12), 01-analysis, 02-architecture, 03-plan, ADR-0007.

## 2026-11-12 — Ф2: textSelection.js

- Коммит 5675a5a. `wordRange` (слово = буквы/цифры/`_`, не-слово → null) +
  `byteOffsetToCharIndex`.
- Вскрылось при проектировании: pango `xy_to_index` даёт **байтовый**
  offset в UTF-8, а `set_selection` ClutterText считает символы — нужна
  конверсия; добавлена в модуль (02 §6 дополнен). Существующий
  `selectAllText` (set_selection(0, text.length)) это подтверждает косвенно:
  работает с кириллицей, т.е. API — символьный.
- Тесты 32/32 офлайн.

## 2026-11-12 — Ф3: движок в noteBox.js

- `_isDoubleClick(event, tracker)`: состояние вынесено в трекер; шапка
  (move/resize) — общий `_dblTracker`, текст — свой `_textDblTracker`
  (перекрёстное срабатывание двойных кликов в разных местах исключено).
- Press в read-only: обычный клик — схлопывание в точке клика (сброс
  предыдущего выделения, паритет с нативом) + вооружение драга; двойной —
  wordRange (не-слово → нет выделения); Shift — расширение от дальнего от
  клика края (без выделения — от позиции курсора). Всегда EVENT_STOP —
  класс-хендлер и его grab_key_focus не выполняются (f051d89 не тронут).
- Motion/Release на ClutterText: только при вооружённом жесте; motion
  пересчитывает индекс и делает set_selection(anchor, idx) (направление
  любое); release снимает вооружение. Движение за пределы заметки
  накрывается implicit grab'ом после press.
- Маппинг `_indexAtStagePoint`: transform_stage_point → xy_to_index
  (Pango.SCALE) → clamp (вне layout = конец текста) → byteOffsetToCharIndex.
- setEditMode снимает жест (защита от переключения режима посреди драга).
- Редактирование не задето: хендлеры при `_editing` сразу
  EVENT_PROPAGATE / не вооружаются.
- Синтакс-проверка gjs (провал только на resource:// вне shell), все
  офлайн-тесты зелёные: smoke 106/106, textHistory 51/51, layouts 82/82,
  textSelection 32/32.
- Новых переводных строк нет — ru 53/53 не трогается; POTFILES.in без
  изменений (в textSelection.js нет строк).

## 2026-11-12 — приёмка (частичная, у пользователя)

- П.1–9, 11–12: работает (функционально: drag, двойной клик по слову,
  меню → Copy). П.10 провален: подсветки нет.
- Root cause (по исходнику mutter gnome-46, clutter-text.c):
  `selection_paint()` открывается `clutter_text_should_draw_cursor` =
  `(editable || selectable) && cursor_visible && has_focus`; в read-only
  курсор скрыт и фокус не берётся → нативная подсветка не рисуется вообще,
  CSS не помогает. Объясняет и отсутствие подсветки у Select All из меню в
  предыдущих задачах.
- Попутно проверено по исходнику: ClutterText в 46 — legacy `paint` vfunc,
  детей не рисует → оверлей-ребёнок ClutterText не годится.

## 2026-11-12 — Ф5: оверлей подсветки

- `St.DrawingArea` (reactive: false) — ребёнок `_entryBox` ПОСЛЕ entry
  (порядок отрисовки = поверх), скроллится вместе с entry.
- `_updateSelOverlay` — хаб: в edit-режиме скрыт; при пустом выделении
  скрыт; иначе — прямоугольники `_selectionRects` (position_to_coords
  концов диапазона: одна строка / хвост+блок+голова), позиция =
  transformed-разница clutterText − _entryBox (скролл сокращается), размер
  = размер текста, `queue_repaint`.
- Хуки перерисовки: press/motion/release, setEditMode, text-changed
  (undo/redo в read-only), notify::allocation ClutterText.
- Цвет `SELECTION_COLOR` = #3584e4 @ 40%, поверх глифов.
- Офлайн-тесты зелёные (106/51/82/32), синтакс-чек gjs чист.
- Доки: 02 §8 переписан, ADR-0007 дополнен.

## Далее

- Пере-приёмка п.10 (визуал) + просмотр журнала.
- Ф6: merge --no-ff по согласованию.
