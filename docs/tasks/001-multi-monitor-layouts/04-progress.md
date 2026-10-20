# Прогресс: 001-multi-monitor-layouts

| Фаза | Содержание | Статус |
|------|------------|--------|
| Ф0 | Ветка `feat/multi-monitor-layouts` | готова |
| Ф1 | `layouts.js` + юнит-тесты | готова (62/62) |
| Ф2 | Cutover: реестр, стабильные id, глобальные координаты, миграция | код + офлайн-дым готов; дым в реальной сессии — см. журнал |
| Ф3 | `monitors-changed`, fold, кнопка | не начата |
| Ф4 | Строка prefs, переводы | не начата |
| Ф5 | Приёмка (матрица 10 сценариев), деплой | не начата |

## Журнал

- 2026-10-20 — концепция согласована; созданы ADR-0001, анализ, архитектура, план.
- 2026-10-20 — Ф0: ветка `feat/multi-monitor-layouts` от dev.
- 2026-10-20 — Ф1: `notes@maestroschan.fr/layouts.js` (`signature`, `clampRect`, `foldInto`, `LayoutStore`, миграция) + `test/testLayouts.js`; `MAX_LAYOUTS = 8` в `common.js`. 62/62 проверок gjs. Найдено и исправлено при отладке: (1) поиск свободного слота в `foldInto` при заполненном мониторе крутился до guard'а и ставил заметку вне границ — переписан на конечный row-major скан + поточную фазу для «не поместившихся» (могут перекрываться, но всегда в границах); (2) `this` в колбэке `removeNote`; (3) `.bak` создаётся со второго сохранения (у первого нет предыдущей версии) — отражено в тесте.
- 2026-10-20 — Ф2: cutover. `extension.js`: `_ensureStore` (лениво, вместе с заметками; нет реестра → миграция из `N_state` с origin первичного монитора), `_loadAllNotes` из `store.noteIds()` + позиции схемы/фолд/кламп, `createNote` = `nextId()` + fold-слот, `postDelete` = `removeNote` + удаление только `N_text` (swap и `_deleteNoteFiles` удалены), `saveLayout()` (одна запись позиций+атрибутов), `destroy` — финальный `store.save()`. `noteBox.js`: spec-конструктор `{id, color, fontSize, x, y, w, h, startInEditMode}`, глобальные координаты в `_setNotePosition`, `onlySave(true)` → `manager.saveLayout()`; удалены `_loadState/_saveState/_createDefaultState/fixState/_computeRandomPosition`. `areCoordsUsable` удалён. Обработчик `ugly-hack` временно no-op, `monitors-changed` подключён как no-op (включается в Ф3). `layouts.js`: `DEFAULT_FONT_SIZE/WIDTH/HEIGHT` стали экспортируемыми `var`. Новый офлайн-харнесс `test/smokeExtension.js` (реальный `extension.js` на заглушках `imports` + NoteBox-двойник, синтетические `N_state` во временном `XDG_DATA_HOME`): 25/25 — миграция (относительные→глобальные, атрибуты, `_state` не удаляются), fold-слот новой заметки, удаление из реестра и схем, id без переиспользования, точное восстановление после перезагрузки менеджера. Юнит-тесты 62/62.
