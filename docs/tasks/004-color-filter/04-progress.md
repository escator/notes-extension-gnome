# 04. Прогресс: фильтр заметок по цвету

| Фаза | Содержание | Статус |
|------|-----------|--------|
| Ф1 | Ядро менеджера без UI (мгновенное скрытие) + smoke-сценарии | done |
| Ф2 | Секция меню (свотчи 2×4, «Сбросить фильтр») + бейдж на панели | done |
| Ф3 | Плавный fade-out + хук applyColorAndSave | pending |
| Ф4 | Переводы, живая приёмка 1–9, слияние | pending |

## Журнал

- 2026-10-21 — старт реализации на ветке `feat/color-filter` от `dev`. До Ф1
  два служебных коммита: (1) починен стаб smoke-теста — `FakeMenu.addAction`
  не имел `setSensitive`, тест был красный с момента слияния New from
  Clipboard (e8a3443); (2) закоммичена документация задачи (ADR-0003, 01–03,
  индексы), до этого лежала в рабочем дереве.
- 2026-10-21 — Ф1 выполнена (ядро менеджера, мгновенное скрытие). `extension.js`:
  поле `_colorFilter` (null | имя пресета, только в памяти); `_passesFilter`
  (строгое сравнение `rgb.join(',')`); `_showNotes` показывает только
  прошедших фильтр (`_onlyHideNotes` не тронут — прячет всех); `_applyFilterHiding`
  (видимые не-проходящие: `setEditMode(false)` + `onlyHide()`; в Ф3 здесь
  появится fade-out); `setColorFilter` с toggle-семантикой (повторный клик по
  активному пресету = `clearColorFilter`); `clearColorFilter` (показ всех при
  `_notesAreVisible`); `_filterColorString()` передаётся в `createNote` из
  `_onMenuNewNote`, `_onMenuNewFromClipboard` и ветки «нет ни одной заметки»
  в `_toggleNotes`; `_updateFilterBadge` — пустая заглушка до Ф2.
  `test/smokeExtension.js`: стаб заметки получил `actor.visible` (стартует
  true, как addChrome у реальной заметки), `show`/`onlyHide` считают и
  переключают видимость, `setEditMode` запоминает режим, добавлен недостающий
  `appendClipboardText` (метод New from Clipboard) и стаб `St.Clipboard`
  (синхронный колбэк с текстом); фаза 4 — 20 новых проверок: применение
  фильтра к видимым, `_showNotes` под фильтром, сброс, toggle, цвет новых
  заметок через реальные колл-сайты меню (`_onMenuNewNote`,
  `_onMenuNewFromClipboard`), off-palette-цвет не проходит ни один фильтр,
  глобальный toggle сохраняет фильтр. Прогон 74/74 зелёный. Цвет фильтра
  подставляется в местах вызова меню, а не внутри `createNote` — сценарий
  теста изначально звал `createNote` напрямую и честно упал, переписан на
  колл-сайты.
