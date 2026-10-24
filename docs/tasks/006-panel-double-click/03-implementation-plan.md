# 03 План реализации: двойной клик по значку панели

Один файл кода: `notes@maestroschan.fr/extension.js`. Фаза одна —
Ф1 «отложенный одиночный + пара кликов» (коммит вместе с smoke-фазой 6).

## Изменения по файлам

### extension.js (`NotesManager`)

- `constructor`: `this._pendingToggleId = null;`
- новый метод `_cancelPendingToggle()`;
- `_onButtonPressed` → новая маршрутизация (02-architecture);
- новый метод `_onButtonDoublePressed()`;
- `_toggleNotes()`: первая строка `_cancelPendingToggle()`;
- `destroy()`: снять `_pendingToggleId`.

### test/smokeExtension.js

- стаб `Clutter.Settings.get_default().double_click_time = 400`,
  `Clutter.EVENT_STOP`;
- `FakeMenu.toggle()` считает вызовы;
- фаза 6: одиночный клик → таймер в `pendingTimeouts`, после срабатывания
  заметки показаны; пара кликов → заметка создана, таймер снят,
  `toggle()` не звался; правый клик → `toggle()` меню, таймер снят;
  клавиатурный вызов `_onButtonPressed(null)` → мгновенный toggle;
  `destroy()` с висящим таймером не падает.

## Definition of Done

- Приёмка 006-1…9 (README) — smoke-часть зелёная, живая часть показана
  пользователем.
- `gjs test/smokeExtension.js` — 0 FAIL.

## Риски

- Задержка toggle субъективно заметна при медленном системном таймауте —
  принято пользователем осознанно (ADR-0005).
