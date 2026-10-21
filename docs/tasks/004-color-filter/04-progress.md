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
- 2026-10-21 — Ф2 выполнена (секция меню + бейдж). `extension.js`:
  ребёнок кнопки панели — `St.BoxLayout` [иконка, `this._filterDot`]; точка —
  `St.Bin` класса `notesFilterBadge`, скрыта по умолчанию, фон инлайном из
  ring-цвета пресета в `_updateFilterBadge` (заглушка Ф1 заменена);
  `_buildFilterSection` после пункта New from Clipboard: separator,
  неинтерактивный заголовок «Filter by color» (паттерн `size_item` из
  menus.js), две строки свотчей 2×4 в порядке палитры (паттерн
  `_addColorButton`, кнопки в `this._filterSwatches`), «Reset filter» через
  `_menu.addAction` (закрывает меню, паттерн `_onApply`), изначально
  insensitive; клик свотча — `setColorFilter(name)` + close. Стили свотчей
  строит один метод `_swatchStyle` (заливка пресетом + ring-кольцо активному,
  приём menus.js:138–140), используется и при построении, и при
  `_refreshFilterMenu` в обработчике `open-state-changed` (там же
  чувствительность «Reset filter»). `stylesheet.css`: класс
  `.notesFilterBadge` (8×8, радиус 4; фон — инлайн из JS). Smoke-стабы:
  generic `FakeWidget` (Bin/BoxLayout/Label/Button), `FakePopupItem`,
  `addMenuItem` у фейкового меню, `Clutter.ActorAlign`. Прогон 74/74.
  Живая проверка X11 (сценарии 1–5, 7, 8) — после установки, на пользователе.
- 2026-10-21 — баг живой проверки Ф1+Ф2 и его починка. Симптомы (цепочка
  пользователя): повторный клик по активному свотчу — состояние фильтра
  сбрасывалось (кольцо исчезало, reset неактивен, после hide/show видны все),
  но точка-бейдж не пропадала, меню в части случаев не закрывалось, скрытые
  заметки показывались не всегда. Диагноз по журналу shell (стек у каждого
  клика): `JS ERROR: Error: trying to re-track existing chrome actor` —
  `trackChrome` (layout.js:898) из `NoteBox.show()`. Корень: `show()` не
  идемпотентен, а `clearColorFilter` показывает ВСЕ заметки, включая уже
  видимые (уже отслеженные); исключение убивало остаток `clearColorFilter`
  (`_updateFilterBadge` — точка) и обработчика (`_menu.close()` — меню);
  какой объём заметок успевал показаться, зависело от позиции первой видимой
  в `_allNotes` — отсюда «фильтр не отменился» vs «отразились все» в разных
  прогонах. Тот же взрыв ждал и до задачи 004: заметка, созданная «New note»
  при глобально скрытых заметках (конструктор → addChrome → уже отслежена),
  рвала следующий `_showNotes`. Починка: `NoteBox.show()` стал идемпотентным
  (guard `if (this.actor.visible) return;` перед `visible=true` +
  `trackChrome`); `untrackChrome` нестрогий (журнал никогда не ругался на
  повторный onlyHide — `_onlyHideNotes` и `_loadAllNotes` в безопасности).
  В офлайн-тест не выносится: слой trackChrome/mutter стабом не моделируется
  (фейковый show и так идемпотентен), регрессионный сценарий — живой: клик по
  активному свотчу и по «Сбросить фильтр» при видимых заметках — все
  возвращаются, точка гаснет, меню закрывается, журнал чист. Прогон 74/74.
