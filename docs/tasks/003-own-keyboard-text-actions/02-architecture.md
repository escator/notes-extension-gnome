# 02. Концепция: общий слой текстовых действий + полный клавиатурный перехват

```
клавиатура (_onKeyPress) ──┐
                           ├──▶ NoteBox: copySelection / cutSelection /
NoteTextContextMenu ───────┘    pasteClipboardAtCursor / selectAllText /
                                undo / redo   (boundary() перед мутациями)
NoteBox.actions ──▶ St.Clipboard + ClutterText.delete_selection/insert_text
                   ──▶ TextHistory (text-changed → onChange, suspend при откате)
```

## 1. Общий слой действий (методы `NoteBox`)

Единственная реализация каждого действия; меню и клавиатура только вызывают:

- `copySelection()` — `St.Clipboard.set_text(CLIPBOARD, get_selection())`.
- `cutSelection()` — то же + `delete_selection()`; предусловие «есть
  выделение и режим редактирования» проверяют вызывающие (меню — через
  чувствительность, клавиатура — через матрицу клавиш).
- `pasteClipboardAtCursor()` — async `St.Clipboard.get_text` → guard
  уничтоженной заметки (флаг, как в меню) → `delete_selection()` +
  `insert_text(text, cursor)`; перед запуском чтения — `boundary()`.
- `selectAllText()` — фокус на entry + `set_selection(0, len)`.
- Уже есть: `undo()` / `redo()` / `boundary()` (Ф2 задачи 002).

Каждое мутирующее действие — ровно один шаг undo: `boundary()` до мутации,
дальше `text-changed` пишет порцию сам.

## 2. Матрица клавиш (полный перехват, оба режима)

| Клавиши | Чтение | Редактирование |
|---------|--------|----------------|
| Ctrl+V, Shift+Insert, KEY_Paste | глотается, ничего | pasteClipboardAtCursor |
| Ctrl+C | copySelection ⇔ есть выделение | copySelection ⇔ есть выделение |
| Ctrl+X | глотается, ничего | cutSelection ⇔ есть выделение |
| Ctrl+A | selectAllText ⇔ текст непуст | selectAllText ⇔ текст непуст |
| Ctrl+Z, KEY_Undo | undo | undo |
| Ctrl+Shift+Z, KEY_Redo | redo | redo |

Все распознанные клавиши возвращают `EVENT_STOP` — до St.Entry/ClutterText
ничего из набора не доходит ни в одном режиме (нативный путь не участвует).
Нераспознанные клавиши — `false` (обычный набор текста и пр.). Условие
«есть выделение/текст» проверяется по `get_selection()`/`get_text()`;
невыполнение — тоже `EVENT_STOP` (клавиша всё равно наша).

## 3. Matching клавиш независимо от раскладки

Клавиша распознаётся, если совпал **keyval** (латинские `KEY_v/c/x/z/a` +
служебные `KEY_Undo/KEY_Redo/KEY_Paste/KEY_Cut`) **или hardware keycode**
(физическая клавиша, не зависит от группы XKB):

- `V=55, C=54, X=53, Z=52, A=38` (X11 evdev-коды), Insert=118.
- Union закрывает практические случаи: латинская раскладка (в т.ч. Dvorak)
  матчится по keyval; активная кириллица (ЙЦУКЕН, фонетические) — по keycode.

Shift+Insert: keycode Insert + SHIFT; для KP_Insert — как у St.Entry, не
обслуживается.

## 4. Что остаётся нативным

Набор символов, Enter/стрелки/Home/End/Delete в редактировании, Ctrl+A
внутри editable ClutterText (наш перехват его перекрывает — исполняется
собственный `selectAllText`), IM/preedit.

## 5. Мышь в read-only: press глотается до нативного обработчика

Клик по тексту read-only заметки обрабатывается mutter'ом
(`clutter_text_press`): ClutterText остаётся selectable в чтении, а обработчик
press срабатывает на любую кнопку при `editable || selectable` и начинает с
безусловного `grab_key_focus()` + reset/panel-toggle над IM (у не-editable
текста IM-фокуса нет — отсюда пары предупреждений
`clutter_input_focus_*: assertion 'clutter_input_focus_is_focused' failed` в
журнале; вызовы скипаются, но grab уже случился). Последствия до фикса:

- клик по read-only заметке крал key focus у редактируемой заметки — Ctrl+V
  и набор уезжали в read-only запись и молча глотались матрицей (§2);
  отсюда нестабильное «вставка не работает в новой заметке»;
- каждый такой клик — два предупреждения в журнале shell.

Решение (2026-10-21, пользователь): в read-only press по тексту глотается в
обработчике `button-press-event` на ClutterText (как уже перехвачен правый
клик меню) — до class handler'а mutter'а; заметка при этом поднимается
(`_redraw()`, до куда press раньше доходил по bubbling). Цена: мышиное
drag-выделение в read-only отсутствует — выделение там только через
контекстное меню («Выделить всё») или действия с фокусом, который дают сами
пункты меню. В режиме редактирования мышь не тронута (курсор, drag-выделение,
двойной клик).

## Отклонённые альтернативы

- Затычка ed573d5 (глотать только в read-only, редактирование — натив):
  ядро проблемы — необозримость нативного пути; выбран полный перехват.
- Матчинг только по кириллическим keyval — ломается на фонетических
  раскладках; только keycode — ломается на Dvorak.
- binding pool / клонирование биндингов ClutterText — API не для расширений,
  дублирует то, что уже есть в `_onKeyPress`.
- Оставить клики read-only как есть (шум только в журнале): кража фокуса —
  реальный баг вставки, не только шум.
- Клик по read-only заметке = вход в режим редактирования: кража фокуса
  становится фичей, но противоречит решению «режим меняется только кнопкой»
  (noteBox.js, комментарий при `setEditMode(false)`).
