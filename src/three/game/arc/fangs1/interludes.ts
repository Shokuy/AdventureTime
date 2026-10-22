import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { wait, all, type Script, type Waiter } from '../../../../game/coroutine';
import { LEVEL_PLUGINS, type Level3D, type Npc3 } from '../../level';
import { glow } from '../town/kit';
import { TOWN_HOOKS } from '../town';
import { TownHub, arcStage, type Figure } from '../town/hub';
import { say, type SpeakerId } from '../town/speech';
import { safeMark } from '../shared/safeMark';
import { setGrey } from '../vampires';

/** a line of the hub's interludes */
type Line = [who: SpeakerId, text: string, expr?: string];
/*
 * The interludes' lines — docs/script-fangs-v2.md 5.10, 6.9, 7.8, 8.10 (v2 replaces fangs1/lines.ts INTERLUDE, which is
 * no longer read here).
 */
const INTERLUDE: Record<number, Line[]> = {
  // 5.10 hub_after_fangs1 — «тень с косичками»
  1: [
    ['pastila', 'Три пустые колбы. Буду смотреть на них и нервничать.'],
    ['bublik', 'Пастила, а бывают тени без хозяина? Я видел. С гитарой.'],
    ['pastila', 'Научно — невозможно. Ты, наверное, устал.'],
    ['noki', '…С гитарой?'],
    ['bublik', 'Маленькая. С косичками.'],
    ['noki', 'Тебе показалось. А Морок хитрая. Не верьте никому, кто выглядит как друг. Даже мне.'],
    ['tosha', 'А как понять, где настоящая ты?'],
    ['noki', 'Я буду та, что ворчит.', 'sly'],
    ['pastila', 'Ноки… Граф сказал про посад.'],
    ['noki', 'Лунный посад. Он был тут, где теперь твоё королевство. Я тут выросла. Всё.'],
    ['pastila', 'Туманные топи проявились на макете. Идите, когда будете готовы.'],
  ],
  // 6.9 hub_after_fangs2 — «Карамель»
  2: [
    ['pastila', 'Одна колба полна! Я назову её Светик.', 'happy'],
    ['bublik', 'Ты назвала колбу?'],
    ['pastila', 'Я всем колбам даю имена. Это научно.'],
    ['pastila', 'Ноки. Ты видела, как строили оранжерею. Сто лет назад?'],
    ['noki', 'Карамель была моей подругой. Лейка больше её самой. Говорила с цветами.'],
    ['noki', 'Потом пришла Алая луна. Я ушла. И не вернулась. До этого месяца.'],
    ['tosha', 'Почему?'],
    ['noki', 'Стыдно было. Я проиграла. Всё. Хватит.'],
    ['bublik', '…Хочешь пирожок? Он не стыдный. Он с вишней.'],
    ['noki', '…Давай.', 'sly'],
    ['pastila', 'Возьму прабабушкин дневник. И маяк-солнышко: в его свете видно невидимок.'],
  ],
  // 7.8 hub_after_fangs3 — «опыт 212»
  3: [
    ['pastila', 'Две колбы: Светик и Полдник. Да, корень я назвала Полдником.'],
    ['pastila', 'И я строю Солнечную пушку. Сироп мало сварить — его надо доставить Королю.'],
    ['bublik', 'Можно я буду ядром?'],
    ['pastila', 'Нет.'],
    ['bublik', 'А фитилём?'],
    ['pastila', 'Бублик.'],
    ['pastila', 'У прабабушки тоже всё взрывалось. Опыт двести двенадцать. Значит, у меня получится.'],
    ['tosha', 'Ноки, а страница?'],
    ['noki', 'Лежит. Закрытая. Пусть полежит до перевала.'],
    ['noki', 'Перевал — последний шаг перед замком. Дальше пути назад нет. Подумайте.'],
    ['tosha', 'Мы уже подумали. Идём!'],
  ],
  // 8.10 hub_after_fangs4 — «Серый город»
  4: [
    ['bublik', 'Всё серое. Даже фонтан. Даже компот.', 'sad'],
    ['bear', 'Хо… хо… Заходите… Мёд… какой-то… никакой…', 'sleepy'],
    ['tosha', 'Дедушка Вторник…', 'sad'],
    ['bear', 'Пирог был… с малиной. Тень пришла… и унесла. Всё равно…', 'sleepy'],
    ['bublik', 'Он украл ПИРОГ?! Всё. Теперь это личное.', 'angry'],
    ['iriska', 'Лаборатория цела! Ночник принцессы горел всю ночь — тени не сунулись!', 'happy'],
    ['pastila', 'Мой ночник… спас лабораторию?', 'surprised'],
    ['noki', 'А ты стеснялась.', 'sly'],
    ['pastila', 'Пушка готова. Сироп залит. Колёса… почти на месте.'],
    ['iriska', 'Я подкрутила! Почти не отваливаются!'],
    ['noki', 'Сегодня Алая полночь. Он ждёт меня. Пусть ждёт всех.'],
    ['tosha', 'Вместе — успеем. Дедушка, мы вернём вам пирог.'],
  ],
};

/*
 * The hub's lab interludes between the series of «Ночь клыков» (docs/script-fangs.md §5.9, §6.7, §7.7, §8.8): back in
 * Пастильное королевство by day, the first time anyone walks into the lab after series N of the arc, its scene plays
 * once (TOWN_HOOKS.labScene: the hub's host / solo decides, by the room's progress; a world scene for everyone).
 * The lab shows the arc's progress too: three flasks on a shelf fill one by one (Светик, Полдник, the sun dust), and
 * the Солнечная пушка on wheels waits in the yard before the last night.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const NAMES = ['hub_after_fangs1', 'hub_after_fangs2', 'hub_after_fangs3', 'hub_after_fangs4'];
/** the flask shelf in the lab (by Ноки's window) and the cannon in the yard */
const SHELF = V(4.5, 0, -34.3);
const CANNON = V(6.4, 0, -25.6);

const hubOf = (L: Level3D) => L.refs.town as TownHub | undefined;

/** a figure walks to (x, z) (a Waiter, capped) */
function walk(f: Figure, x: number, z: number, speed = 2.2, max = 4): Waiter {
  f.walk = { to: V(x, f.g.position.y, z), speed };
  let t = 0;
  return { update: (dt) => { t += dt; if (t > max && f.walk) { f.walk = null; f.g.position.set(x, f.g.position.y, z); } return !f.walk; } };
}
function face(f: Figure, at: THREE.Vector3) { f.face = Math.atan2(at.x - f.g.position.x, at.z - f.g.position.z); }

function* speak(L: Level3D, figs: Partial<Record<string, Figure>>, ls: Line[]): Script {
  for (const [who, text, expr] of ls) {
    const f = figs[who];
    if (f) f.anim.expr = (expr as never) ?? 'normal';
    yield say(L, who as SpeakerId, text, expr);
    if (f) f.anim.expr = 'normal';
  }
}

/** the four (scene figures), the hub's own Пастила / Ноки set aside for the scene */
function stage4(hub: TownHub, at: Record<'tosha' | 'bublik' | 'pastila' | 'noki', [THREE.Vector3, number]>) {
  const hidden: Figure[] = [];
  for (const k of ['pastila', 'noki']) { const f = hub.figures.get(k); if (f && f.g.visible) { f.g.visible = false; hidden.push(f); } }
  const figs: Record<string, Figure> = {};
  for (const k of ['tosha', 'bublik', 'pastila', 'noki'] as const) figs[k] = hub.figure('i_' + k, k, at[k][0], at[k][1]);
  return {
    figs,
    done() { for (const k of ['tosha', 'bublik', 'pastila', 'noki']) hub.dropFigure('i_' + k); for (const f of hidden) f.g.visible = true; },
  };
}

/** the lab scenes 5.9 / 6.7 / 7.7 — the four at the flask shelf */
function* labInterlude(L: Level3D, n: number): Script {
  const hub = hubOf(L);
  if (!hub) return;
  L.cutscene(true);
  L.hud.chapter = null;
  const s = SHELF;
  // the shelf faces the lab's middle; the four stand in a little arc in front of it
  const fwd = V(0 - s.x, 0, -36 - s.z).normalize(), side = V(-fwd.z, 0, fwd.x);
  const G = s.clone().addScaledVector(fwd, 2.3);
  const at = (a: number, b: number) => G.clone().addScaledVector(side, a).addScaledVector(fwd, b);
  const shelfLook = s.clone().setY(1.5);
  const yawTo = (p: THREE.Vector3) => Math.atan2(s.x - p.x, s.z - p.z);
  const sm = (v: THREE.Vector3, k: string) => safeMark(L, v, { wall: 0.45, spacing: 0.7, label: `interlude ${n} ${k}` });
  const marks = { pastila: sm(at(-1.25, -0.35), 'pastila'), tosha: sm(at(-0.4, 0.3), 'tosha'), bublik: sm(at(0.45, 0.35), 'bublik'), noki: sm(at(1.3, 0), 'noki') };
  const st = stage4(hub, {
    pastila: [marks.pastila, yawTo(marks.pastila)], tosha: [marks.tosha, yawTo(marks.tosha)], bublik: [marks.bublik, yawTo(marks.bublik)], noki: [marks.noki, yawTo(marks.noki)],
  });
  const f = st.figs;
  // a shot from beside the shelf: the four's faces, the flasks at the edge of the frame
  const group = () => L.shot(s.clone().addScaledVector(fwd, 0.7).addScaledVector(side, -1.9).setY(1.75), G.clone().addScaledVector(side, 0.2).setY(1.05), 0.5);
  try {
    for (const k of Object.values(f)) face(k, shelfLook);
    // over their shoulders at the shelf (the flasks), then the faces
    yield L.shot(s.clone().addScaledVector(fwd, 4.4).addScaledVector(side, -0.8).setY(2.1), shelfLook, 0);
    yield all(L.shot(s.clone().addScaledVector(fwd, 3.8).addScaledVector(side, -0.6).setY(1.95), shelfLook, 1.2), wait(0.4));
    const ls = INTERLUDE[n];
    for (let i = 0; i < ls.length; i++) {
      if (i === 1) yield group();
      const who = ls[i][0];
      const fig = f[who];
      if (fig && i > 1 && ls[i - 1][0] !== who) {
        // a look at the speaker: they turn to the others, the camera in front of their face (the others at the edge)
        const p = fig.g.position;
        const others = Object.values(f).filter((k) => k !== fig);
        const mid = others.reduce((acc, k) => acc.add(k.g.position), V(0, 0, 0)).multiplyScalar(1 / Math.max(1, others.length));
        face(fig, mid);
        for (const k of others) face(k, p);
        const dir = mid.clone().sub(p).setY(0).normalize();
        const sd = V(-dir.z, 0, dir.x);
        const dog = fig.kind === 'bublik';
        yield L.shot(p.clone().addScaledVector(dir, dog ? 1.15 : 1.3).addScaledVector(sd, 0.7).setY(dog ? 1.0 : 1.55), p.clone().setY(dog ? 0.5 : 1.1), 0.45);
      } else if (i > 1 && !fig) yield group();
      yield* speak(L, f, [ls[i]]);
    }
    yield wait(0.3);
  } finally {
    st.done();
  }
  L.cutscene(false);
  yield L.camBack(0.6);
}

/** 8.10 hub_after_fangs4 — «Серый город»: dawn before the last night, the whole town grey but the lab's window */
function* yardInterlude(L: Level3D): Script {
  const hub = hubOf(L);
  if (!hub) return;
  L.cutscene(true);
  L.hud.chapter = null;
  audio.stopMusic(0.8);
  const lay = hub.lay, c = CANNON;
  const ls = INTERLUDE[4];
  // the marks (v2 8.10): Тоша and Бублик by the fountain (2 m off its rim), Вторник on the shop's porch (counter + 1.5 m
  // outward), Ириска at the lab's door (+2 m out), the four round the cannon (2 m, a half-circle)
  const fr = lay.fountain.r + 2;
  const tF = safeMark(L, V(-0.7, 0, fr), { label: '8.10 tosha' }), bF = safeMark(L, V(0.8, 0, fr + 0.1), { label: '8.10 bublik' });
  const k = lay.shop.keeper, ct = lay.shop.counter;
  const out = V(ct.x - k.x, 0, ct.z - k.z).normalize();
  const porch = safeMark(L, V(ct.x, 0, ct.z).addScaledVector(out, 1.5), { wall: 0.6, label: '8.10 bear' });
  const door = V(lay.lab.door.x, 0, lay.lab.door.z);
  // (2 m out of the door, a step to the side: Пастила and Ноки stay in the clear for К7)
  const iriM = safeMark(L, door.clone().add(V(2.7, 0, 2.0)), { wall: 0.8, label: '8.10 iriska' });
  const ring = (a: number) => safeMark(L, V(c.x + Math.sin(a) * 2.2, 0, c.z + Math.cos(a) * 2.2), { wall: 0.5, spacing: 0.8, label: '8.10 cannon' });
  const st = stage4(hub, {
    tosha: [tF, Math.PI], bublik: [bF, Math.PI],
    pastila: [safeMark(L, door.clone().add(V(-1.3, 0, 1.0)), { wall: 0.6, label: '8.10 pastila' }), 0.4], noki: [safeMark(L, door.clone().add(V(1.4, 0, 1.2)), { wall: 0.6, label: '8.10 noki' }), -0.4],
  });
  const f = st.figs;
  // the empty dish on the porch: crumbs and a grey smear of a shadow
  const dish = emptyDish();
  dish.position.copy(porch).addScaledVector(V(-out.z, 0, out.x), 0.9).setY(porch.y + 0.02);
  L.scene.add(dish);
  // Вторник (the hub's, grey) out on the porch; Ириска (in colour) at the lab's door
  const bear = hub.bear;
  const bearHome = bear ? { p: bear.root.position.clone(), y: bear.root.rotation.y } : null;
  if (bear) { bear.root.position.copy(porch); bear.root.rotation.y = Math.atan2(out.x, out.z); setGrey(bear.root, 1); }
  const iri = hub.folk.find((x) => x.id === 'iriska');
  const iriHome = iri ? { p: iri.g.position.clone(), y: iri.g.rotation.y, mode: iri.mode } : null;
  if (iri) { iri.g.visible = false; iri.mode = 'stand'; }
  const sayL = (i: number) => speak(L, f, [ls[i]]);
  try {
    // К1: from the gate, the grey square
    yield L.shot(V(0, 4.2, 40), V(0, 1.6, 0), 0);
    yield all(L.shot(V(0, 3.4, 30), V(0, 1.4, 0), 2.2), wait(1.6));
    // К2: Тоша and Бублик by the fountain
    // (they turn from the grey fountain to us: the fountain behind them in the frame)
    const k2 = V(0.9, 1.35, fr + 3.2);
    for (const x of [f.tosha, f.bublik]) face(x, k2);
    yield L.shot(k2, V(0.05, 1.0, fr - 0.6), 0.6);
    yield* sayL(0);
    // К3: Вторник on the porch
    const bp = porch.clone();
    yield L.shot(bp.clone().addScaledVector(out, 3.6).add(V(0, 1.7, 0)).addScaledVector(V(-out.z, 0, out.x), -1.0), bp.clone().setY(1.5), 0.6);
    if (bear) bear.talk = 0.3;
    yield* sayL(1);
    yield* sayL(2);
    // К4: the empty dish
    yield L.shot(dish.position.clone().addScaledVector(out, 1.1).add(V(0, 0.9, 0)), dish.position.clone(), 0.5);
    yield* sayL(3);
    // К5: Бублик, close
    f.bublik.anim.expr = 'angry';
    yield L.shot(bF.clone().add(V(0.3, 0.75, -1.3)), bF.clone().setY(0.55), 0.4);
    yield* sayL(4);
    f.bublik.anim.expr = 'normal';
    // К6: Ириска runs out of the lab — in colour, soot and all; the pink window glows behind her
    if (iri) { iri.g.visible = true; iri.g.position.copy(door); iri.g.rotation.y = 0; iri.homeYaw = 0; }
    const run = iri ? walkFolk(iri, iriM, 3.2) : wait(0);
    yield all(L.shot(V(iriM.x + 2.4, 1.8, iriM.z + 6.5), V(door.x, 2.0, door.z - 1), 0.5), run);
    if (iri) iri.waveT = 1.4;
    yield* sayL(5);
    // К7: Пастила and Ноки
    face(f.pastila, f.noki.g.position); face(f.noki, f.pastila.g.position);
    const mid = f.pastila.g.position.clone().add(f.noki.g.position).multiplyScalar(0.5);
    yield L.shot(mid.clone().add(V(0.4, 1.6, 3.4)), mid.clone().setY(1.15), 0.5);
    yield* sayL(6);
    yield* sayL(7);
    // К8: the yard, the cannon on its wheels, the four round it
    const arc = [-0.9, -0.3, 0.3, 0.9].map((a) => ring(Math.PI * 0.25 + a));
    const four = [f.pastila, f.tosha, f.bublik, f.noki];
    // (round the cannon, but turned to the camera: the cannon beside them, faces in the frame)
    const k8 = V(c.x + 4.6, 2.6, c.z + 6.8);
    four.forEach((x, i) => { x.g.position.copy(arc[i]); face(x, k8); });
    if (iri) { iri.g.position.copy(safeMark(L, V(c.x + 1.6, 0, c.z - 1.4), { wall: 0.4, label: '8.10 iriska yard' })); iri.g.rotation.y = -1.2; iri.homeYaw = -1.2; }
    audio.playMusic('hub_day');
    yield L.shot(k8, c.clone().add(V(1.2, 1.1, 1.2)), 0.6);
    yield* sayL(8);
    if (iri) iri.waveT = 1.0;
    audio.sfx('clang', { pitch: 1.6, volume: 0.5 });
    yield* sayL(9);
    yield L.shot(f.noki.g.position.clone().add(V(1.2, 1.5, 2.2)), f.noki.g.position.clone().setY(1.2), 0.5);
    yield* sayL(10);
    for (const x of four) face(x, f.tosha.g.position);
    yield L.shot(f.tosha.g.position.clone().add(V(-0.9, 1.4, 2.4)), f.tosha.g.position.clone().setY(1.0), 0.5);
    yield* sayL(11);
    yield wait(0.3);
  } finally {
    st.done();
    dish.removeFromParent();
    if (bear && bearHome) { bear.root.position.copy(bearHome.p); bear.root.rotation.y = bearHome.y; }
    if (iri && iriHome) { iri.g.visible = true; iri.g.position.copy(iriHome.p); iri.g.rotation.y = iriHome.y; iri.homeYaw = iriHome.y; iri.mode = iriHome.mode; }
  }
  L.cutscene(false);
  yield L.camBack(0.6);
}

/** a townsperson walks to (x, z) (a Waiter, capped) */
function walkFolk(f: { g: THREE.Group; anim: { state: string; speed: number } }, to: THREE.Vector3, speed: number): Waiter {
  const from = f.g.position.clone();
  const d = from.distanceTo(to), T = Math.max(0.3, d / speed);
  let t = 0;
  return { update: (dt) => {
    t += dt;
    const k = Math.min(1, t / T);
    f.g.position.lerpVectors(from, to, k);
    f.g.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    return k >= 1;
  } };
}

/** the empty pie dish on the porch: crumbs, a raspberry smear gone grey, the print of a shadow's hand */
function emptyDish(): THREE.Group {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.06, 24), new THREE.MeshToonMaterial({ color: '#fff4f0' })); plate.position.y = 0.03; g.add(plate);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.035, 6, 24), new THREE.MeshToonMaterial({ color: '#ff9ec0' })); rim.rotation.x = Math.PI / 2; rim.position.y = 0.065; g.add(rim);
  const crumbM = new THREE.MeshToonMaterial({ color: '#d8a868' });
  for (let i = 0; i < 9; i++) { const a = i * 2.3, r = 0.12 + (i % 4) * 0.08; const cr = new THREE.Mesh(new THREE.SphereGeometry(0.03 + (i % 3) * 0.012, 6, 4), crumbM); cr.position.set(Math.cos(a) * r, 0.075, Math.sin(a) * r); g.add(cr); }
  const smear = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), new THREE.MeshBasicMaterial({ color: '#7a7a82', transparent: true, opacity: 0.8 }));
  smear.rotation.x = -Math.PI / 2; smear.scale.set(1.3, 0.6, 1); smear.position.set(0.08, 0.068, -0.05); g.add(smear);
  // the grey trail of a shadow, off the plate and away
  const trail = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1.4), new THREE.MeshBasicMaterial({ color: '#2a2630', transparent: true, opacity: 0.45, depthWrite: false }));
  trail.rotation.x = -Math.PI / 2; trail.position.set(0.5, 0.015, 0.75); trail.rotation.z = 0.6; g.add(trail);
  return g;
}

export const INTERLUDE_SCRIPTS: Record<string, (L: Level3D) => Script> = {
  hub_after_fangs1: (L) => labInterlude(L, 1),
  hub_after_fangs2: (L) => labInterlude(L, 2),
  hub_after_fangs3: (L) => labInterlude(L, 3),
  hub_after_fangs4: (L) => yardInterlude(L),
};

/** TOWN_HOOKS.labScene: the interlude of this arc stage (1–4); keeps whatever hook was there for other stages */
export function installLabHook() {
  const prev = TOWN_HOOKS.labScene;
  TOWN_HOOKS.labScene = (stage: number) => (stage >= 1 && stage <= 4 ? NAMES[stage - 1] : prev ? prev(stage) : null);
}

// ───────────────────────── the lab's look by stage (the hub level) ─────────────────────────

/** three flasks with tags on a little shelf; filled ones glow (stage 2: Светик, 3: Полдник, 4: the sun dust) */
function flaskShelf(L: Level3D, stage: number) {
  const g = new THREE.Group();
  const wood = new THREE.MeshToonMaterial({ color: '#8a5a32' });
  const board = (y: number) => { const b = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), wood); b.position.y = y; b.castShadow = true; g.add(b); };
  board(0.9); board(1.6);
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.75, 0.45), wood); p.position.set(sx * 0.92, 0.87, 0); g.add(p); }
  const fills = [
    { c: '#d8ff7a', e: '#a8e040' }, // Слеза светлячка («Светик»)
    { c: '#ffb04a', e: '#ff7a10' }, // Корень полуденника («Полдник»)
    { c: '#ffe14a', e: '#ffc010' }, // Пыль солнечного камня
  ];
  fills.forEach((f, i) => {
    const x = -0.6 + i * 0.6;
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshToonMaterial({ color: '#e8f8ff', transparent: true, opacity: 0.5 }));
    glass.position.set(x, 1.85, 0); g.add(glass);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.22, 10), new THREE.MeshToonMaterial({ color: '#e8f8ff', transparent: true, opacity: 0.55 }));
    neck.position.set(x, 2.13, 0); g.add(neck);
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.08, 8), new THREE.MeshToonMaterial({ color: '#c8803e' }));
    cork.position.set(x, 2.27, 0); g.add(cork);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12), new THREE.MeshToonMaterial({ color: '#fff4e0', side: THREE.DoubleSide }));
    tag.position.set(x, 1.78, 0.21); g.add(tag);
    if (stage >= i + 2) {
      const liquid = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshToonMaterial({ color: f.c, emissive: f.e, emissiveIntensity: 0.8 }));
      liquid.position.set(x, 1.82, 0); g.add(liquid);
      const gl = glow(f.c, 0.9, 0.55); gl.position.set(x, 1.85, 0.05); g.add(gl);
    }
  });
  g.position.copy(SHELF);
  g.rotation.y = Math.atan2(-SHELF.x, -36 - SHELF.z);
  L.deco(g);
  L.col({ kind: 'box', min: V(SHELF.x - 0.5, 0, SHELF.z - 0.5), max: V(SHELF.x + 0.5, 1.8, SHELF.z + 0.5) });
}

/** the Солнечная пушка on wheels (one wheel tied on with string) */
function sunCannon(L: Level3D) {
  const g = new THREE.Group();
  const brass = new THREE.MeshToonMaterial({ color: '#e8b040', emissive: '#7a4a10', emissiveIntensity: 0.15 });
  const wood = new THREE.MeshToonMaterial({ color: '#c87a4a' });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 2.6, 18), brass);
  barrel.rotation.x = Math.PI / 2 - 0.45; barrel.position.set(0, 1.35, 0.2); g.add(barrel);
  for (const z of [-0.6, 0.4, 1.2]) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.56 - z * 0.08, 0.06, 6, 20), new THREE.MeshToonMaterial({ color: '#ff7aa8' })); band.position.set(0, 1.35 + z * Math.sin(0.45) * 0.9, 0.2 + z * Math.cos(0.45)); band.rotation.x = -0.45; g.add(band); }
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), new THREE.MeshToonMaterial({ color: '#ffd34a', emissive: '#ffb020', emissiveIntensity: 0.7 }));
  sun.position.set(0, 2.05, 1.65); g.add(sun);
  const gl = glow('#ffd34a', 1.6, 0.5); gl.position.copy(sun.position); g.add(gl);
  const cart = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 2.0), wood); cart.position.set(0, 0.75, 0); g.add(cart);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 8, 18), wood);
    w.rotation.y = Math.PI / 2; w.position.set(sx * 0.72, 0.5, sz * 0.75);
    if (sx === 1 && sz === 1) { w.rotation.z = 0.25; w.position.y = 0.46; const rope = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 12), new THREE.MeshToonMaterial({ color: '#fff4d8' })); rope.position.copy(w.position); rope.rotation.y = Math.PI / 2; g.add(rope); }
    g.add(w);
  }
  g.position.copy(CANNON);
  g.rotation.y = -0.6;
  L.deco(g);
  L.col({ kind: 'cyl', x: CANNON.x, z: CANNON.z, r: 1.2, y0: 0, y1: 1.6 });
}

let plugged = false;
export function installHubLook() {
  if (plugged) return;
  plugged = true;
  LEVEL_PLUGINS.push((L) => {
    if (L.def.id !== 'hub' || !(L.refs.town instanceof TownHub)) return null;
    const st = arcStage();
    if (st >= 1) flaskShelf(L, st);
    if (st >= 4) sunCannon(L);
    return null;
  });
}
