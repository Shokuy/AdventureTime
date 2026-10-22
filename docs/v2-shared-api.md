# v2 shared API (для внедряющих `docs/script-fangs-v2.md`)

Кросс-серийные помощники. Папки серий их только импортируют; править — в `arc/shared/`, `arc/vampires/shadowGirl.ts`,
`art/portraits.ts`, `arc/town/speech.ts`.

## `safeMark` — `src/three/game/arc/shared/safeMark.ts` (§0 «Правило меток»)

```ts
import { safeMark, safeMarks, markFrom, clearMarks } from '../shared/safeMark';
const p = safeMark(L, new THREE.Vector3(x, y, z), { label: '5.1 Мармеладка' }); // → Vector3 на земле
cast.place('tosha', p.x, p.y, p.z, yaw);
const m = safeMarks(L, { tosha: v1, bublik: v2 }, { wall: 1.5 });              // по порядку
const q = markFrom(L, TOWER.door, 3.5, 4.0, { yaw: towerYaw });                 // ориентир + смещение
```
- Опускает метку на `phys.groundAt` (не выше `maxRise` = 1,2 м над данной y — крыши не берёт).
- Плохая метка: крыша/потолок 0,3–3 м над ней, стена/проп ближе `wall` (1,2 м), другая метка (за последние ~3 с)
  ближе `spacing` (0,9 м). Тогда — спираль шагом 0,5 м до `maxR` (4 м) на той же высоте земли (±0,6 м).
- В dev пишет `console.warn('[safeMark] …')` при каждом сдвиге. Цель проверки: этих предупреждений нет.
- Опции: `wall`, `spacing`, `maxR`, `roof:false` (низкий потолок комнаты), `maxRise`, `keepY` (не опускать: стремянка,
  парапет), `ignore(c)` (коллайдер, у которого стоять нужно — стол), `others` (доп. метки), `noClaim`, `label`.
- `clearMarks(L)` — забыть метки предыдущей сцены (если сцены идут подряд без паузы).

## `castleTag` — `src/three/game/arc/shared/castleTag.ts` (§0, 5.9, 6.7)

```ts
import { castleTag } from '../shared/castleTag';
yield* castleTag(L, [
  ['polnoch', 'Нетопырь. Тебя победили дети. И такса.'],
  ['netopyr', 'Пи! Такса нечестная! Она тянется!', 'scared'],
  ['polnoch', 'Ноки снова не одна. Как интересно.'],
  ['polnoch', 'Тише. Ты моя. Сто лет — моя.'],
], { say: (w, s, e) => say(L, w as Spk, s, e), mouse: 'netopyr', shot2At: 2, tugAt: 3, clang: true });
```
- Свой силуэт замка на скале + луна (без тумана) в 150 м от камеры в сторону `L.refs.castleAt` (или `castleAt` в
  опциях), длиннофокусный кадр (узкий fov), мышонок `createMouse(mouse)` (fangs5/rigs) влетает в окно башни
  (`raven: true` — его несёт ворон, 6.7). К2 с `shot2At`: медленный наезд на окно с силуэтом Короля; на `tugAt`
  плащ дёргается и из него на миг выглядывает тень девочки.
- `say` — функция вашей серии (портреты в окне); все реплики «за кадром». Убирает за собой всё; `L.cutscene`
  оставляет как было; `camBack` не делает. Опции: `from` (позиция камеры), `moon` (цвет), `clang` (удар на последней).

## `ShadowGirl` — `src/three/game/arc/vampires/shadowGirl.ts` (§1.6 нить А, §14 Общее)

```ts
import { ShadowGirl } from '../vampires/shadowGirl';
const girl = new ShadowGirl(L);
girl.waveOnWall(pos, normal, 0.8);       // С2: машет на стене/парапете
yield girl.hopAhead([p0, p1, p2], 3);    // С3: тень прыгает по воде по кочкам (Waiter)
girl.inMirror(pos, normal, 'left');      // С4: в зеркале, показывает рукой в сторону
girl.sitBeside(pos, yaw); girl.reach(true); // С5: сидит у костра, тянется за печеньем
girl.holdHand(pos, normal);              // С6: держит руку Короля (тянется вверх)
girl.hide(); girl.dispose();
```
`fly` (вертикальная плоскость, центрированная, как в `fangs5/finale.ts`) и `ground` (лежащая тень) — тот же
API, что у старого `ShadowGirl` в финале: **fangs5 может заменить импорт на этот файл** без других правок.

## Говорящие v2 — `src/art/portraits.ts`, `src/three/game/arc/town/speech.ts`

Новые `PortraitId` (их можно сразу отдавать в `drawPortrait`/`say` своей серии):
- `karamel` — «Карамель (дневник)»: раскрытая тетрадь (лейка, засушенный цветок, рисунок-лицо с эмоцией).
- `voron` — «Кар-Карыч»: голова ворона (для баров он не нужен, но портрет есть, если понадобится).
- `shurshik` — «Шуршик»: тот же портрет, что `shepot` с вариантом `'seen'` (теперь в садовом фартуке Карамели);
  мышиный вариант (`'mouse'`) тоже есть.
- `polnoch` — уже был; в хабе теперь тоже говорит (голос карточки-приглашения).

`town/speech.ts`: `SpeakerId` += `polnoch | karamel | voron | shepot | shurshik`; `SHURSHIK_FLAG = 'f3:named'` и
`speakerName(id)` — `shepot` подписывается «Шуршик», когда флаг `f3:named` стоит (`setStoryFlag('f3:named')` в 7.5 —
это делает fangs3). Серии со своими speech.ts: возьмите `PORTRAIT_INFO.karamel` и т. п. так же, как `netopyr`.

Исправлено в портретах: камышинка Камыша держится в уголке рта и не пересекает открытый рот; фонарь Зефирыча
целиком внутри круга.

## `showCard` — `src/three/game/arc/shared/storyCard.ts` (`card:` сценария, §10)

```ts
import { showCard } from '../shared/storyCard';
showCard(L, 'Меню Алой полночи', 'Проступило в тепле фонаря: топи, оранжерея, перевал — и «главное блюдо».', { icon: 'menu' });
yield showCard(L, 'Страница из дневника', 'Пожелтевшая, сложенная вчетверо…', { icon: 'page', secs: 4 }); // ждать, пока висит
```
Иконки: `invite` / `menu` (тёмная карточка с полумесяцем), `map`, `page`, `letter`, `jar`. Локально, одна за раз.

## Хаб / интерлюдии (для сведения)
- Реплики интерлюдий 5.10, 6.9, 7.8, 8.10 теперь живут в `fangs1/interludes.ts` (константа `INTERLUDE` там же);
  `fangs1/lines.ts → INTERLUDE` больше не читается — fangs1 может её удалить.
- Новая сцена хаба `hub_lab_card` (4.4а): цепочка `hub_lab_meet → hub_lab_card → hub_lab_plan`.
- Стадия хаба 4 = «Серый город» (`GREY_CITY` в `town/hub.ts`): серые зоны на весь город, кроме лаборатории и двора.
- Подзаголовки эпизодов в `episodes.ts` теперь «Граф Нетопырь · Ночь 1 из 5» и т. д.; баннеры уровней (`TITLE`
  в `lines.ts` серий) — забота серий.
