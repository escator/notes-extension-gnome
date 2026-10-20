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
собственный `selectAllText`), IM/preedit. Поведение мыши не меняется.

## Отклонённые альтернативы

- Затычка ed573d5 (глотать только в read-only, редактирование — натив):
  ядро проблемы — необозримость нативного пути; выбран полный перехват.
- Матчинг только по кириллическим keyval — ломается на фонетических
  раскладках; только keycode — ломается на Dvorak.
- binding pool / клонирование биндингов ClutterText — API не для расширений,
  дублирует то, что уже есть в `_onKeyPress`.
