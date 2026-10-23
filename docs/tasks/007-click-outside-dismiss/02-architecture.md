# 02 Архитектура: клик вне заметок

## Решение пользователя (2026-10-23)

Подложка light-dismiss. Отклонён пассивный перехват: на X11 клики вне
chrome до shell не доходят (01-analysis).

## Подложка

- Один `Clutter.Actor` (`reactive: true`, невидимый), размер = весь stage
  через `Clutter.BindConstraint(source: global.stage, coordinate: ALL)` —
  накрывает все мониторы и переживает `monitors-changed` без пересчётов.
- Жизнь в chrome: `Main.layoutManager.addChrome(catcher)` (влияет на input
  region), при создании прижимается непосредственно над `window_group`:
  `Main.uiGroup.set_child_below_sibling(catcher, uiGroup.children[idx+1])`,
  где `idx` — индекс `global.window_group`. Так подложка ниже заметок,
  значка, панели, меню и модалок — их клики до неё не доходят, а до неё
  доходят только клики, которые никто выше не забрал (пустой стол, окна).
- Событие: `button-press-event` → `_dismissNotes()` →
  `_cancelPendingToggle()` (006-6) + `_hideNotes()` (полный путь toggle:
  выход из правки, отложенное сохранение) → `Clutter.EVENT_STOP`
  (клик съедается — световое отклонение).
- Видимость: `_updateClickCatcher()`, вызывается из `_showNotes`,
  `_onlyHideNotes` и по `changed::hide-on-click-outside`. Актёр создаётся
  лениво при первом показе; «хочу» = `_notesAreVisible` И настройка.
  `destroy()`: `removeChrome` + `destroy`.

## Настройка

- `gsettings`: `<key type="b" name="hide-on-click-outside">`, default
  `true`, рядом с `hide-icon` (все булевы видимости в одном месте схемы).
- `prefs.ui`: строка «Скрывать по клику вне заметок» (label + GtkSwitch
  `hide_outside_switch`, ряды 20/21; разделитель сдвигается с 20 на 21).
- `prefs.js`: связывание по образцу `hide_switch`.
- Переводы: ru `.po` + `.pot`.

## Почему клик по панели не скрывает заметки

Подложка ниже всего chrome: у панели и значка свои клики (004/002 меню,
toggle) — предсказуемое поведение без спец-исключений. Модальные диалоги и
открытые PopupMenu держат grab — их вне-клики подложка не видит (007-8).

## Альтернативы (отклонены)

- Пассивный capture на `global.stage`: на X11 не видит клики по столу/окнам.
- Подложка на уровень панели/над заметками: съедала бы клики панели.
- Полноэкранный актор без chrome (без input region): на X11 не получает
  ничего, мёртвый код.
