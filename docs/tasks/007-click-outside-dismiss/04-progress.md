# 04 Прогресс: клик вне заметок

| Фаза | Статус |
|------|--------|
| Ф2: подложка light-dismiss + настройка (+ smoke-фаза 7) | **code done** (81b12e7), переводы сделаны; живая приёмка не проводилась |

## Журнал

- 2026-10-23 — анализ (input region X11 по исходникам shell 42.9),
  концепция, ADR-0005, план; решение пользователя: подложка light-dismiss.
- 2026-10-23 — Ф2 реализована: gschema-ключ `hide-on-click-outside`
  (default true), `_updateClickCatcher` с прижиманием над `window_group`,
  `_dismissNotes` (отмена пары 006 + полный `_hideNotes`), сигнал
  `changed::` + строка в prefs.ui/js; smoke-фаза 7. Уроки: (а) два подряд
  `_hideNotes` затирают `_timeout_id` — в реальном shell первый таймаут
  просто срабатывает сам (утечки нет), но ручному планировщику smoke нужен
  явный дожиг save-таймаутов (`fireDeferredSave`); (б) `global` из
  extension.js в харнессе живёт на `globalThis`.
