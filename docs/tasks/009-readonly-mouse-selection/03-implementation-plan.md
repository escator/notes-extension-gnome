# 03: План реализации — 009

- Ф1. Доки + ветка `feat/readonly-selection` от dev, доки — первый коммит.
- Ф2. `textSelection.js`: `wordRange` + `test/testTextSelection.js`
  (офлайн, как testTextHistory.js). Пустой коммит-разделение: модуль
  без врезки в UI.
- Ф3. `noteBox.js`:
  - `_isDoubleClick(event, tracker)` — вынос состояния в трекер (§5 02),
    moveBox/resize без поведенческих изменений;
  - press/motion/release хендлеры выделения (§2 02), маппинг §3;
  - Pango уже импортирован в noteBox.js.
- Ф4. Прогон всех офлайн-тестов (smoke + textHistory + layouts +
  textSelection).
- Ф5. Приёмка VM 46 (README 1–12, живая), по её итогам:
  - при нечитаемой подсветке на тёмном фоне — CSS-правило в
    `.notesTextField` (02 §8);
  - при систематическом сдвиге маппинга — калибровка (02 §3, фолбэк).
- Ф6. Merge в dev `--no-ff` (по явному согласию пользователя), пуш —
  отдельно после merge.
