import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { ease, lerp } from '../../../../engine/util';
import { net } from '../../../../net/session';
import { Script, Waiter, wait, tween, all } from '../../../../game/coroutine';
import { createHeroModel } from '../../../models/heroes';
import type { HeroAnim, HeroExpr } from '../../../models/hero';
import { makeBlob } from '../../../fx';
import { basic, noOutline } from '../../../gfx';
import { glowTex } from '../../../world/textures';
import type { Level3D, Npc3 } from '../../level';
import { vamp } from '../vampires';
import { safeMark, clearMarks } from '../shared/safeMark';
import { castleTag } from '../shared/castleTag';
import { createMouse, type MouseAnim } from '../fangs5/rigs';
import { say, talkingNow, type Spk } from './speech';
import { ingredientCard } from './card';
import { createKamysh, createLilyBoat, createCrow, createVoron, type KamyshRig, type VoronAnim } from './models';
import { swampOf, showCastSolo, afterVictory, openExit, burstJars, MARK } from './level';
import { ARENA } from './boss';
import {
  TOASTS, MOROK, CARD, DEATH, TITLE, COLD, INTRO, FAKE, BOSS_INTRO, BOSS_VORON, DEFEAT, DEFEAT_VORON, ENDING, TAG, SHOUT,
  type Line,
} from './lines';

/*
 * Story scenes of «Туманные топи» (docs/script-fangs-v2.md §6: 6.0 cold open → banner → 6.1 → … → 6.6 → 6.7 tag → exit).
 * Co-op: the host runs them (L.run) and every machine plays them with its own camera; lines advance by themselves. World
 * actions (the fight's start, the end of the level) only where L.authority. While the bars are down the story four (L.npc
 * cast) act and the players' figures are hidden (`castScenes`). Every mark goes through safeMark (§0). Chained scenes
 * (cold → intro, defeat → ending → tag) are separate scenes, so each one fits the co-op watchdog.
 */

type Kind = 'tosha' | 'bublik' | 'noki' | 'pastila';
const KINDS: Kind[] = ['tosha', 'bublik', 'noki', 'pastila'];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function cast(L: Level3D) { return swampOf(L)!.cast; }
const an = (n: Npc3) => n.anim as HeroAnim;
/** put the four on their marks (others hidden), facing a point; every mark through safeMark */
function stage(L: Level3D, label: string, spots: Partial<Record<Kind, [number, number, number]>>, look?: THREE.Vector3) {
  const c = cast(L);
  clearMarks(L);
  for (const k of KINDS) {
    const n = c[k], s = spots[k];
    n.root.visible = !!s;
    if (!s) continue;
    const p = safeMark(L, V(s[0], s[1], s[2]), { label: `${label} ${k}`, wall: 0.6 });
    n.root.position.copy(p);
    if (look) n.root.rotation.y = Math.atan2(look.x - p.x, look.z - p.z);
    an(n).state = 'idle'; an(n).expr = 'normal'; an(n).attack = null;
  }
}
function hideCast(L: Level3D) { for (const n of Object.values(cast(L))) n.root.visible = false; }
function faceTo(n: Npc3, p: THREE.Vector3) { n.root.rotation.y = Math.atan2(p.x - n.root.position.x, p.z - n.root.position.z); }
const at = (n: Npc3, dx: number, dy: number, dz: number) => n.root.position.clone().add(V(dx, dy, dz));
/** a portrait emotion → the 3D figure's (§0: sad → hurt, sly → normal) */
const FIG: Record<string, HeroExpr> = { sad: 'hurt', sly: 'normal', happy: 'happy', angry: 'angry', scared: 'scared', surprised: 'surprised', hurt: 'hurt', sleepy: 'sleepy' };
/** one line (the cast figure of the speaker shows the emotion while it lasts) */
function* line(L: Level3D, l: Line): Script {
  const [who, str, expr] = l;
  const n = (KINDS as string[]).includes(who) ? cast(L)[who as Kind] : null;
  if (n && expr) an(n).expr = FIG[expr] ?? 'normal';
  yield say(L, who, str, expr);
  if (n && expr) an(n).expr = 'normal';
}
/** a close-up of one of the four, in front of the face (whichever way the figure looks) */
const close = (L: Level3D, k: Kind, d = 0.5, side = 1) => {
  const n = cast(L)[k], y = n.root.rotation.y, fx = Math.sin(y), fz = Math.cos(y);
  return L.shot(at(n, fx * 2.1 + fz * 0.8 * side, 1.35, fz * 2.1 - fx * 0.8 * side), at(n, 0, 1.0, 0), d);
};
/** two of the four in one frame (2К): from the side of the line between them, on the side their faces point to */
function pair(L: Level3D, a: Kind, b: Kind, d = 0.5, dist = 3.0, pref?: THREE.Vector3) {
  const A = cast(L)[a].root, B = cast(L)[b].root;
  const mid = A.position.clone().lerp(B.position, 0.5);
  const dx = B.position.x - A.position.x, dz = B.position.z - A.position.z, l = Math.hypot(dx, dz) || 1;
  let px = -dz / l, pz = dx / l;
  const fx = Math.sin(A.rotation.y) + Math.sin(B.rotation.y), fz = Math.cos(A.rotation.y) + Math.cos(B.rotation.y);
  if (pref ? px * pref.x + pz * pref.z < 0 : Math.hypot(fx, fz) > 0.4 ? px * fx + pz * fz < 0 : pz < 0) { px = -px; pz = -pz; }
  const r = Math.max(dist, l * 1.1);
  return L.shot(mid.clone().add(V(px * r, 1.4, pz * r)), mid.clone().add(V(0, 0.95, 0)), d);
}

/** my place in the team (co-op: by sorted member id) */
function slot(L: Level3D) { return L.nl ? Math.max(0, [...net.members.keys()].sort().indexOf(net.myId)) : 0; }
/** MY hero onto his spot of a little formation around (x, z) facing yaw (friends see a jump, not a slide) */
function placeMe(L: Level3D, x: number, y: number, z: number, yaw: number) {
  const p = L.player;
  if (p.dead) return;
  const OFF: [number, number][] = [[0, 0], [1.5, 0], [-1.5, 0], [0.75, 1.4], [-0.75, 1.4], [2.25, 1.4]];
  const [a, b] = OFF[slot(L) % OFF.length];
  const sx = Math.cos(yaw), sz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
  const px = x + sx * a - fx * b, pz = z + sz * a - fz * b;
  const gy = L.phys.groundAt(px, pz, y + 1.5, 0.2);
  L.teleportMe(V(px, (gy > y - 2 ? gy : y) + 0.05, pz), yaw);
}

/** the fight is on (every machine): the boss, its camera, solo — the four by the rail */
function fightOn(L: Level3D) {
  const R = swampOf(L)!;
  L.boss = R.boss;
  L.camModeDefault = 'boss';
  L.tcam.bossPoint = V(ARENA.cx, ARENA.y + 2, ARENA.cz);
  L.def.deathText = DEATH.boss;
  if (L.nl) hideCast(L); else showCastSolo(L);
  audio.playMusic('vampire_boss');
}

/** host: the next scene right after this one (its own scene: the co-op watchdog times each) */
function chain(L: Level3D, id: string) {
  if (L.authority) L.runGen((function* (): Script { yield wait(0.05); L.run(id); })());
}

/** a lily boat with Камыш in it (scene prop); `talk` while `talkingNow` is kamysh and `me()` says it's him */
function kamyshBoat(L: Level3D, o: { lit?: number; lantern?: boolean; yaw?: number; me?: () => boolean } = {}) {
  const g = new THREE.Group();
  g.add(createLilyBoat(1.6));
  const kam = createKamysh();
  kam.lit = o.lit ?? 0;
  kam.lantern.visible = o.lantern ?? true;
  kam.root.rotation.y = o.yaw ?? Math.PI / 2;
  g.add(kam.root);
  L.scene.add(g);
  const upd = (_t: number, dt: number) => {
    const talk = talkingNow(L) === 'kamysh' && (o.me?.() ?? true) ? Math.abs(Math.sin(L.t * 14)) : 0;
    kam.update(dt, talk, g.userData.moving ? 'pole' : 'idle');
  };
  L.updaters.push(upd);
  return { g, kam, dispose() { g.removeFromParent(); const i = L.updaters.indexOf(upd); if (i >= 0) L.updaters.splice(i, 1); } };
}
/** a raven figure for a scene (not Морок's own: the cold open / the castle has its own) */
function sceneVoron(L: Level3D) {
  const rig = createVoron();
  const g = new THREE.Group(); g.add(rig.root);
  const a: VoronAnim = { st: 'perch', talk: 0 };
  L.scene.add(g);
  const upd = (_t: number, dt: number) => { a.talk = Math.max(0, a.talk - dt * 2.5); rig.update(dt, a); };
  L.updaters.push(upd);
  return { g, a, dispose() { g.removeFromParent(); const i = L.updaters.indexOf(upd); if (i >= 0) L.updaters.splice(i, 1); } };
}
const remove = (L: Level3D, f: (t: number, dt: number) => void) => { const i = L.updaters.indexOf(f); if (i >= 0) L.updaters.splice(i, 1); };

const SCRIPTS: Record<string, (L: Level3D) => Script> = {
  // ─────────────────────── 6.0 Последний светлячок (cold open, before the banner) ───────────────────────
  *fangs2_cold(L) {
    L.cutscene(true);
    hideCast(L);
    placeMe(L, MARK.spawn.x, MARK.spawn.y, MARK.spawn.z, Math.PI);
    audio.playMusic('swamp');
    audio.sfx('mist', { volume: 0.5 });
    // the real Камыш: his last firefly in the lantern; facing west (the hummock)
    let speaker: 'real' | 'double' = 'real';
    const real = kamyshBoat(L, { lit: 1, yaw: -Math.PI / 2, me: () => speaker === 'real' });
    const B = MARK.coldBoat, H = MARK.coldHummock;
    real.g.position.set(B.x + 3, B.y, B.z - 9);
    // the double on the hummock, grinning too wide, Кар-Карыч on his shoulder
    const dbl: KamyshRig = createKamysh({ double: true });
    const dg = new THREE.Group(); dg.add(dbl.root);
    dg.position.copy(H); dg.rotation.y = Math.PI / 2;
    dbl.lantern.visible = false;
    L.scene.add(dg);
    const vo = sceneVoron(L);
    const shoulder = () => dg.localToWorld(V(-0.3, 0.86, -0.02));
    vo.g.scale.setScalar(0.85); vo.g.rotation.y = Math.PI / 2;
    let voFree = false;
    const dUpd = (_t: number, dt: number) => {
      dbl.update(dt, talkingNow(L) === 'kamysh' && speaker === 'double' ? Math.abs(Math.sin(L.t * 14)) : 0);
      if (!voFree) { dg.updateMatrixWorld(true); vo.g.position.copy(shoulder()); }
    };
    L.updaters.push(dUpd);
    // the stolen lantern (it rides in the raven's claws)
    const stolen = new THREE.Group();
    const lg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffd84a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
    lg.scale.setScalar(1.1); noOutline(lg); stolen.add(lg);
    const lb = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.28, 8), basic('#3a3a30')); stolen.add(lb);
    stolen.visible = false; L.scene.add(stolen);
    const lanternAt = () => { real.g.updateMatrixWorld(true); return real.kam.lantern.getWorldPosition(new THREE.Vector3()); };
    try {
      // К1 ОП: fog, willows, the boat slides out of the mist
      real.g.userData.moving = true;
      const b0 = real.g.position.clone();
      yield L.shot(V(4, 3.4, 60), V(-6, 1.0, 44), 0);
      yield all(L.shot(V(2, 2.8, 57), V(-6, 1.0, 47), 4), tween(4, (k) => { real.g.position.lerpVectors(b0, B, k); }, ease.outCubic));
      real.g.userData.moving = false;
      // К2 СП Камыш, the lantern lights his face
      yield L.shot(B.clone().add(V(-2.3, 1.25, 1.1)), B.clone().add(V(0, 1.05, 0)), 0);
      yield* line(L, COLD.a);
      // К3 ЧП (Камыш) onto the hummock: a second Камыш, smiling too wide
      yield L.shot(B.clone().add(V(1.5, 1.7, 0.7)), H.clone().add(V(0, 0.7, 0)), 0);
      speaker = 'double';
      yield* line(L, COLD.b);
      speaker = 'real';
      yield* line(L, COLD.c);
      // К4 КП: the raven drops off the double's shoulder and snatches the lantern
      const la = lanternAt();
      yield L.shot(B.clone().add(V(-2.6, 2.3, 2.4)), la.clone().add(V(-1.2, 0.2, 0)), 0);
      voFree = true;
      const v0 = vo.g.position.clone();
      vo.a.st = 'fly'; audio.sfx('batFlap', { pitch: 0.7 });
      yield tween(0.9, (k) => { vo.g.position.lerpVectors(v0, la.clone().add(V(0, 0.35, 0)), k); vo.g.position.y += Math.sin(k * Math.PI) * 0.8; vo.g.scale.setScalar(0.85 + 0.15 * k); vo.g.rotation.y = Math.atan2(la.x - v0.x, la.z - v0.z); }, ease.inOut);
      real.kam.lantern.visible = false; stolen.visible = true;
      vo.a.st = 'carry'; vo.a.talk = 1;
      L.bark(vo.g, COLD.voron, 1.8, 0.9);
      audio.sfx('hiss', { pitch: 2.2, volume: 0.45 });
      const v1 = vo.g.position.clone(), v2 = V(-16, 7, 38);
      yield tween(1.8, (k) => { vo.g.position.lerpVectors(v1, v2, k); vo.g.rotation.y = Math.atan2(v2.x - v1.x, v2.z - v1.z); stolen.position.copy(vo.g.position).add(V(0, -0.15, 0)); }, ease.inOut);
      stolen.visible = false; vo.g.visible = false;
      // К5 ОП: the light is out — a boat's silhouette; the second Камыш laughs in somebody else's voice and turns to fog
      yield L.shot(V(1, 2.6, 57.5), V(-8, 0.8, 47), 0);
      audio.sfx('hiss', { pitch: 1.6, volume: 0.5 });
      audio.sfx('mist', { volume: 0.7 });
      L.fx.emit(H.clone().add(V(0, 0.8, 0)), { count: 46, speed: [0.6, 2.2], life: [0.9, 1.6], size: [0.35, 0.7], size2: 2.2, colors: ['#8a9a9a', '#b8c8c4', '#6a2a8a'], drag: 1.5, g: -0.6 });
      yield wait(0.25);
      dg.visible = false;
      yield* line(L, COLD.d);
      yield wait(0.3);
      // the banner (v2 §6: «Серия 3. Туманные топи — Ночь 2 из 5»)
      yield L.shot(V(-1, 3.4, 58), V(-9, 2, 40), 2.4);
      L.hud.showChapter(TITLE.title, TITLE.subtitle);
      L.bannerShown = true;
      yield wait(2.2);
    } finally {
      real.dispose(); dg.removeFromParent(); vo.dispose(); stolen.removeFromParent(); remove(L, dUpd);
    }
    L.cutscene(false);
    chain(L, 'fangs2_intro');
    yield wait(0.1);
  },

  // ─────────────────────── 6.1 Причал в темноте ───────────────────────
  *fangs2_intro(L) {
    const c = cast(L);
    L.cutscene(true);
    if (!L.bannerShown) { L.hud.showChapter(TITLE.title, TITLE.subtitle); L.bannerShown = true; }
    placeMe(L, MARK.spawn.x, MARK.spawn.y, MARK.spawn.z, Math.PI);
    const boatTo = V(-6.6, 0, 62.6);
    // the four on the boards, 1.5 m from the west edge
    stage(L, '6.1', { tosha: [-3.0, 1, 63.6], bublik: [-3.4, 1, 61.6], pastila: [-2.2, 1, 60.4], noki: [-1.6, 1, 65.0] }, V(-8, 1, 62.4));
    // Камыш's boat out of the mist — no lantern
    const kb = kamyshBoat(L, { lantern: false });
    const boat = kb.g;
    boat.position.set(-24, -0.1, 78);
    const two = (a: Kind, b: Kind) => pair(L, a, b);
    const kamShot = (d = 0.5) => L.shot(V(-4.5, 1.25, 63.6), V(-6.7, 1.0, 62.7), d);
    try {
      // К1 ОП мостки, туман
      yield L.shot(V(7, 5.5, 76), V(-6, 1.2, 56), 0);
      yield all(L.shot(V(5, 3.6, 70), V(-5, 1.6, 58), 3.2), say(L, INTRO[0][0], INTRO[0][1]));
      // К2 2К Бублик и Пастила
      yield two('bublik', 'pastila');
      yield* line(L, INTRO[1]);
      yield* line(L, INTRO[2]);
      // the boat glides in
      boat.userData.moving = true;
      const from = boat.position.clone();
      yield all(L.shot(V(-3, 2.6, 68), V(-10, 0.8, 64), 1.2), tween(3.6, (k) => { boat.position.lerpVectors(from, boatTo, k); boat.rotation.y = lerp(-0.9, 0, k); }, ease.outCubic));
      boat.userData.moving = false;
      // К3 СП Камыш, без фонаря
      yield kamShot();
      yield* line(L, INTRO[3]);
      yield* line(L, INTRO[4]);
      // (2К: Тоша and the boat)
      yield L.shot(V(-1.4, 2.3, 66.4), V(-4.7, 1.0, 63.0), 0.5);
      yield* line(L, INTRO[5]);
      // К4 ОП: the far stilt house with its dim jars [Камыш за кадром]
      yield L.shot(V(-1, 3.0, 58), V(-24, 3.2, 31), 0.8);
      yield* line(L, INTRO[6]);
      // К2
      yield two('bublik', 'pastila');
      an(c.pastila).state = 'cheer';
      yield* line(L, INTRO[7]);
      an(c.pastila).state = 'idle';
      yield* line(L, INTRO[8]);
      yield* line(L, INTRO[9]);
      // К5 ВР: the four and the boat from above
      yield L.shot(V(-2.6, 8.5, 67.5), V(-3.8, 0.8, 62.6), 0.8);
      yield* line(L, INTRO[10]);
      yield* line(L, INTRO[11]);
      yield wait(0.3);
      boat.userData.moving = true;
      const b0 = boat.position.clone();
      const k0 = kb;
      L.runGen((function* (): Script { yield tween(6, (k) => { boat.position.lerpVectors(b0, V(-18, -0.1, 40), k); boat.rotation.y = -2.6; }, ease.inOut); k0.dispose(); })());
    } finally {
      hideCast(L);
    }
    yield L.camBack(0.7);
    L.cutscene(false);
    L.hud.toast(TOASTS.intro, 6);
  },

  // ─────────────────────── 6.2.5 Храбрый Бублик ───────────────────────
  *fangs2_fake(L) {
    const c = cast(L);
    L.cutscene(true);
    const hum = MARK.fakeHummock;
    // (Бублик clear of the launch step's box, x −4.6…−3.6, z −130.6…−129.6: it is hidden for the scene but still solid)
    stage(L, '6.2.5', { tosha: [-2.2, 0.7, -130.0], bublik: [-3.4, 0.7, -131.2], pastila: [-1.0, 0.7, -131.4], noki: [-5.2, 0.7, -132.0] }, hum);
    // the fake Бублик on the hummock, chest out: no shadow at all
    const fake = createHeroModel('bublik');
    fake.root.traverse((o) => { o.castShadow = false; });
    const fg = new THREE.Group(); fg.add(fake.root);
    fg.position.copy(hum); fg.rotation.y = Math.atan2(c.bublik.root.position.x - hum.x, c.bublik.root.position.z - hum.z);
    L.scene.add(fg);
    const fa: HeroAnim = { state: 'cheer', speed: 0, attack: null, weapon: 'none', flash: 0, talk: 0, expr: 'happy', squash: 1.08 };
    let fakeTalk = false, alive = true;
    const upd = (_t: number, dt: number) => {
      if (!alive) return;
      fa.talk = fakeTalk && L.dialog.shown < L.dialog.str.length ? Math.abs(Math.sin(L.t * 16)) : 0;
      if (fakeTalk) c.bublik.talk = 0;
      fake.update(dt, fa);
    };
    L.updaters.push(upd);
    const crows: { g: THREE.Group; r: ReturnType<typeof createCrow>; v: THREE.Vector3 }[] = [];
    // (Ноки's launch stump stands in the way of these shots: out of the picture while the scene plays)
    const props = (L.refs.f2stump as THREE.Object3D[] | undefined) ?? [];
    for (const o of props) o.visible = false;
    const two = (a: Kind, b: Kind) => pair(L, a, b);
    try {
      // К1 ОП: the fork, a Бублик on the hummock ahead
      yield L.shot(V(-0.5, 3.6, -127.4), V(-7, 1.0, -133.5), 0);
      fakeTalk = true;
      yield* line(L, FAKE[0]);
      fakeTalk = false;
      // К2 2К: two Бублики in one shot
      yield L.shot(V(-1.2, 2.6, -128.2), V(-7.0, 0.9, -133.4), 0.5);
      yield* line(L, FAKE[1]);
      // К3 КП: the hummock — moonlight, grass, and no shadow
      yield L.shot(V(hum.x + 2.6, 2.4, hum.z + 2.2), V(hum.x, 0.6, hum.z), 0.6);
      yield* line(L, FAKE[2]);
      // К4 ОП: it bursts into a flock of crows
      audio.sfx('whoosh', { pitch: 0.7, volume: 0.7 });
      audio.sfx('hiss', { pitch: 2.0, volume: 0.5 });
      yield wait(0.3);
      alive = false;
      fg.removeFromParent(); fake.dispose();
      L.fx.emit(hum.clone().setY(hum.y + 0.8), { count: 40, speed: [2, 6], life: [0.5, 1.1], size: [0.15, 0.3], colors: ['#16121c', '#3a2a48', '#6a2a8a'], drag: 2, g: -1 });
      for (let i = 0; i < 11; i++) {
        const r = createCrow(i === 0);
        const g = new THREE.Group(); g.add(r.root); g.position.copy(hum).setY(hum.y + 0.8);
        L.scene.add(g);
        const a = (i / 11) * Math.PI * 2;
        crows.push({ g, r, v: V(Math.cos(a) * 3, 3 + (i % 3), Math.sin(a) * 3 - 2) });
      }
      const fly = (dt: number) => { for (const k of crows) { k.g.position.addScaledVector(k.v, dt); k.g.rotation.y = Math.atan2(k.v.x, k.v.z); k.r.update(dt, { st: 'fly', p: 0, flash: 0, talk: 0, speed: 0 }); } };
      const flyW = (d: number): Waiter => { let t = 0; return { update: (dt) => { fly(dt); return (t += dt) >= d; } }; };
      yield all(L.shot(V(hum.x + 3, 3.2, hum.z + 5), V(hum.x - 1, 4.5, hum.z - 4), 1.0), flyW(1.0));
      yield all(say(L, FAKE[3][0], FAKE[3][1], FAKE[3][2]), flyW(0.01));
      for (const k of crows) k.g.removeFromParent();
      crows.length = 0;
      // К5 СП настоящий Бублик
      yield close(L, 'bublik');
      yield* line(L, FAKE[4]);
      // К6 2К Тоша и Бублик
      faceTo(c.tosha, c.bublik.root.position); faceTo(c.bublik, c.tosha.root.position);
      yield two('tosha', 'bublik');
      yield* line(L, FAKE[5]);
      an(c.bublik).state = 'cheer';
      yield* line(L, FAKE[6]);
      an(c.bublik).state = 'idle';
      // К7 2К Пастила и Ноки
      faceTo(c.pastila, c.noki.root.position); faceTo(c.noki, c.pastila.root.position);
      yield two('pastila', 'noki');
      yield* line(L, FAKE[7]);
      yield* line(L, FAKE[8]);
      // К6 → К7: Тоша steps in
      faceTo(c.tosha, c.noki.root.position);
      yield L.shot(V(-1.4, 2.1, -127.2), V(-3.4, 1.0, -131.4), 0.5);
      yield* line(L, FAKE[9]);
      yield* line(L, FAKE[10]);
    } finally {
      alive = false;
      for (const o of props) o.visible = true;
      fg.removeFromParent();
      for (const k of crows) k.g.removeFromParent();
      remove(L, upd);
      hideCast(L);
    }
    yield L.camBack(0.6);
    L.cutscene(false);
    // 6.2.4 her voice at the fork
    L.shout(SHOUT.fork, 2.6);
  },

  // ─────────────────────── 6.3 Чай будете? ───────────────────────
  *fangs2_boss_intro(L) {
    const R = swampOf(L)!;
    const c = cast(L), boss = R.boss;
    L.cutscene(true);
    audio.stopMusic(1);
    placeMe(L, MARK.veranda.x, MARK.veranda.y, MARK.veranda.z, Math.PI);
    const ch = MARK.chair;
    // the four on the steps of the veranda, ~5 m from the chair (Пастила next to Тоша)
    stage(L, '6.3', { tosha: [-7.3, ARENA.y, -160.8], pastila: [-6.0, ARENA.y, -161.2], bublik: [-8.8, ARENA.y, -160.6], noki: [-10.2, ARENA.y, -161.0] }, ch);
    const chairLook = ch.clone().setY(ARENA.y + 1.2);
    // Пастила in the rocking chair, back to us (Морок's copy); the lady is not there yet; Кар-Карыч on the chair's back
    boss.hideLady = true;
    boss.chair.rotation.y = Math.PI;
    const fake = createHeroModel('pastila');
    fake.root.traverse((o) => { o.castShadow = false; });
    const fg = new THREE.Group(); fg.add(fake.root); fg.position.copy(ch).add(V(0, 0.1, 0)); fg.rotation.y = Math.PI;
    L.scene.add(fg);
    const fa: HeroAnim = { state: 'sit', speed: 0, attack: null, weapon: 'none', flash: 0, talk: 0, expr: 'happy', squash: 1 };
    let fakeTalk = false, fakeOn = true;
    boss.voronScript = true;
    const fUpd = (_t: number, dt: number) => {
      boss.sceneLooks(L, dt);
      if (fakeOn) { fa.talk = fakeTalk && L.dialog.shown < L.dialog.str.length ? Math.abs(Math.sin(L.t * 16)) : 0; if (fakeTalk) c.pastila.talk = 0; fake.update(dt, fa); fg.rotation.y = boss.chair.rotation.y; }
      if (boss.voronScript) { boss.chair.updateMatrixWorld(true); boss.voronG.position.copy(boss.chair.localToWorld(V(0, 1.72, -0.42))); boss.voronG.rotation.y = boss.chair.rotation.y; boss.voronG.scale.setScalar(0.75); boss.voronAnim.st = 'perch'; }
    };
    L.updaters.push(fUpd);
    const moroks = () => L.shot(V(-7.0, 2.3, -162.6), ch.clone().setY(ARENA.y + 1.5), 0.5);
    try {
      // К1 ЧП (Тоша): the rocking chair, back to us
      yield L.shot(at(c.tosha, 0.7, 1.7, 1.6), chairLook, 0);
      audio.sfx('door', { pitch: 1.6, volume: 0.25 });
      fakeTalk = true;
      yield* line(L, BOSS_INTRO[0]);
      fakeTalk = false;
      // К2: the chair turns — СП Пастила in the chair
      yield all(L.shot(V(-8, 2.0, -163.2), ch.clone().setY(ARENA.y + 1.0), 0.6), tween(1.0, (k) => { boss.chair.rotation.y = Math.PI * (1 - k); }, ease.inOut));
      audio.sfx('door', { pitch: 1.9, volume: 0.25 });
      yield wait(0.6);
      // К3 2К: the real Пастила next to Тоша grabs her nose
      faceTo(c.pastila, c.tosha.root.position);
      an(c.pastila).state = 'facepalm';
      faceTo(c.tosha, c.pastila.root.position);
      yield pair(L, 'pastila', 'tosha', 0.4, 2.6, V(0, 0, -1));
      yield* line(L, BOSS_INTRO[1]);
      faceTo(c.tosha, ch);
      an(c.pastila).state = 'idle'; faceTo(c.pastila, ch);
      // К4: Пастила-in-the-chair melts into mist; Морок rises out of it (low angle), the raven on her shoulder
      audio.sfx('mist', { volume: 0.8 });
      L.fx.emit(ch.clone().setY(ARENA.y + 1.0), { count: 50, speed: [0.6, 2.4], life: [0.8, 1.5], size: [0.3, 0.6], size2: 2.4, colors: ['#8a9a9a', '#c8d0d0', '#6a2a8a', '#c060ff'], drag: 1.5, g: -0.8 });
      yield wait(0.35);
      fakeOn = false; fg.visible = false;
      boss.hideLady = false;
      boss.form = 'lady'; boss.act = 'taunt';
      boss.pos.copy(ch).add(V(0, 0, 0.9)); boss.yaw = 0;
      boss.voronScript = false;
      yield L.shot(V(-7.6, ARENA.y + 0.7, -162.4), ch.clone().setY(ARENA.y + 2.1), 0.7);
      boss.talk = 1;
      yield* line(L, BOSS_INTRO[2]);
      // К5 КП ворон
      const sh = boss.voronG.position.clone();
      yield L.shot(sh.clone().add(V(-0.9, 0.3, 1.4)), sh.clone().add(V(0, 0.1, 0)), 0.4);
      boss.voronSay(BOSS_VORON, 2.2, true);
      yield wait(2.0);
      // К4: «Карыч!»
      yield L.shot(V(-7.6, ARENA.y + 0.9, -162.6), ch.clone().setY(ARENA.y + 2.0), 0.3);
      yield* line(L, BOSS_INTRO[3]);
      // К6 СП Морок через плечо Бублика
      yield L.shot(at(c.bublik, -0.5, 1.4, 1.4), ch.clone().setY(ARENA.y + 1.6), 0.5);
      yield* line(L, BOSS_INTRO[4]);
      yield moroks();
      yield* line(L, BOSS_INTRO[5]);
      yield close(L, 'pastila', 0.4);
      yield* line(L, BOSS_INTRO[6]);
      yield moroks();
      yield* line(L, BOSS_INTRO[7]);
      // К7 2К Ноки и Морок лицом к лицу (Ноки делает два шага к креслу)
      const n0 = c.noki.root.position.clone(), n1 = n0.clone().lerp(V(ch.x, n0.y, ch.z), 0.28);
      an(c.noki).state = 'walk'; an(c.noki).speed = 0.3;
      faceTo(c.noki, n1.clone().lerp(boss.pos, 2));
      yield tween(0.8, (k) => { c.noki.root.position.lerpVectors(n0, n1, k); });
      an(c.noki).state = 'idle'; an(c.noki).speed = 0; faceTo(c.noki, boss.pos);
      boss.yaw = Math.atan2(c.noki.root.position.x - boss.pos.x, c.noki.root.position.z - boss.pos.z);
      {
        // side-on: the camera off the line between them, to the east (the house is north, the four south)
        const m = c.noki.root.position.clone().lerp(boss.pos, 0.5);
        const dx = boss.pos.x - c.noki.root.position.x, dz = boss.pos.z - c.noki.root.position.z, l = Math.hypot(dx, dz) || 1;
        let px = -dz / l, pz = dx / l; if (px < 0) { px = -px; pz = -pz; }
        yield L.shot(m.clone().add(V(px * 3.6, 1.5, pz * 3.6)), m.clone().add(V(0, 1.3, 0)), 0.6);
      }
      yield* line(L, BOSS_INTRO[8]);
      yield* line(L, BOSS_INTRO[9]);
      // К8 ОП: the jars under the eaves, Морок spreads her arms
      boss.yaw = 0;
      an(c.tosha).expr = 'angry';
      yield L.shot(V(-8, 3.0, -155.2), V(-8, 3.4, -167), 0.7);
      yield* line(L, BOSS_INTRO[10]);
      boss.act = 'cast';
      audio.sfx('mist', { volume: 0.5 });
      yield* line(L, BOSS_INTRO[11]);
      L.fx.emit(boss.center(), { count: 34, speed: [1.5, 5], life: [0.4, 1.0], size: [0.15, 0.32], colors: ['#16121c', '#3a2a48', '#6a2a8a', '#c060ff'], drag: 2.5, g: -1 });
      audio.sfx('batFlap', { pitch: 0.8 });
    } finally {
      an(c.tosha).expr = 'normal';
      fakeOn = false; fg.removeFromParent(); fake.dispose(); remove(L, fUpd);
      boss.hideLady = false; boss.voronScript = false; boss.chair.rotation.y = 0;
      if (L.authority && boss.form !== 'dead') { boss.form = 'intro'; boss.start(); }
      fightOn(L);
    }
    yield L.camBack(0.6);
    L.cutscene(false);
    L.tcam.mode = 'boss';
    L.hud.toast(L.nl ? TOASTS.bossCoop : TOASTS.boss, 6);
  },

  // a restart in the fight (§12)
  *fangs2_boss_retry(L) {
    const R = swampOf(L)!;
    const boss = R.boss;
    L.cutscene(true);
    // (the candle is out on the walk: back onto the veranda, like the first time)
    placeMe(L, MARK.veranda.x, MARK.veranda.y, MARK.veranda.z, Math.PI);
    boss.form = 'lady'; boss.act = 'taunt';
    boss.pos.set(ARENA.cx, ARENA.y, ARENA.cz - 4);
    yield L.shot(V(ARENA.cx + 2, 2.8, ARENA.cz + 2), boss.center(), 0);
    yield say(L, 'morok', MOROK.retry, 'sly');
    if (L.authority) { boss.form = 'intro'; boss.start(); }
    fightOn(L);
    yield L.camBack(0.5);
    L.cutscene(false);
    L.tcam.mode = 'boss';
  },

  // ─────────────────────── 6.5 Морося ───────────────────────
  *fangs2_boss_defeat(L) {
    const R = swampOf(L)!;
    const boss = R.boss, c = cast(L);
    L.cutscene(true);
    L.hud.bossMax = 0;
    audio.stopMusic(1.5);
    boss.form = 'dead';
    // she falls at the water side of the veranda; the four in a half-circle 3 m from her
    const p0 = MARK.defeat.clone();
    // (she faces the four at first; she turns to her brother when he comes)
    boss.pos.copy(p0); boss.yaw = -Math.PI / 2;
    stage(L, '6.5', { tosha: [p0.x - 3.2, ARENA.y, p0.z + 1.4], bublik: [p0.x - 3.4, ARENA.y, p0.z - 0.4], pastila: [p0.x - 2.3, ARENA.y, p0.z - 2.4], noki: [p0.x - 0.9, ARENA.y, p0.z - 3.0] }, p0);
    placeMe(L, p0.x - 6, ARENA.y, p0.z, Math.PI / 2);
    boss.voronScript = true;
    const vPerch = V(ARENA.cx + ARENA.hx + 0.75, ARENA.y + 1.05, -160.3);
    boss.voronG.position.copy(vPerch); boss.voronG.scale.setScalar(1); boss.voronG.visible = true; boss.voronAnim.st = 'perch';
    boss.voronG.rotation.y = Math.atan2(p0.x - vPerch.x, p0.z - vPerch.z);
    let morosyaTalk = false;
    const mUpd = () => { if (morosyaTalk && talkingNow(L) && (talkingNow(L) === 'morosya' || talkingNow(L) === 'morok')) boss.talk = 0.6; };
    L.updaters.push(mUpd);
    const kb = kamyshBoat(L, { lit: 0, yaw: -Math.PI / 2 });
    kb.g.position.set(16, -0.1, -148);
    // the tina
    const slick = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24).rotateX(-Math.PI / 2), basic('#3a5a2a', { transparent: true, opacity: 0.85 }));
    slick.position.copy(p0).setY(ARENA.y + 0.03); slick.scale.setScalar(0.1);
    L.scene.add(slick);
    const veil = boss.lady.hat.clone();
    let mouse: ReturnType<typeof createMouse> | null = null;
    const mg = new THREE.Group();
    try {
      // К1 СП: Морок in the tina, the veil flies off
      morosyaTalk = true;
      yield L.shot(p0.clone().add(V(-2.6, 1.8, 2.4)), p0.clone().setY(ARENA.y + 1.2), 0);
      yield all(tween(0.6, (k) => slick.scale.setScalar(0.1 + k)), say(L, DEFEAT[0][0], DEFEAT[0][1], DEFEAT[0][2]));
      // the hat with the veil flies away; underneath — a freckled frog face, hidden behind her gloves
      boss.lady.root.updateMatrixWorld(true);
      boss.lady.hat.getWorldPosition(veil.position); veil.rotation.y = boss.yaw;
      L.scene.add(veil);
      boss.lady.setFrog(true);
      boss.pose = 'shy';
      const vp = veil.position.clone();
      L.runGen((function* (): Script { yield tween(1.6, (k) => { veil.position.copy(vp).add(V(-k * 1.5, Math.sin(k * Math.PI) * 1.6 + k * 0.4, k * 3)); veil.rotation.z = k * 4; veil.rotation.x = k * 2; }, ease.outQuad); veil.visible = false; })());
      audio.sfx('whoosh', { pitch: 1.4, volume: 0.5 });
      // К2 КП: the frog face, gloves over it
      yield L.shot(p0.clone().add(V(-1.3, 1.9, 0.4)), p0.clone().setY(ARENA.y + 1.6), 0.5);
      yield wait(1.4);
      // К3 ОП: Камыш's boat comes up to the veranda
      kb.g.userData.moving = true;
      const k0 = kb.g.position.clone();
      yield all(L.shot(V(p0.x - 4, ARENA.y + 3.4, p0.z + 5.5), V(p0.x + 3, 0.8, p0.z - 1), 0.6), tween(3.2, (k) => { kb.g.position.lerpVectors(k0, MARK.defeatBoat, k); kb.g.rotation.y = lerp(0.9, 0, k); }, ease.outCubic));
      kb.g.userData.moving = false;
      // К4 2К Камыш и Морося
      const two = () => L.shot(V(p0.x + 2.0, ARENA.y + 1.5, p0.z + 4.4), V(p0.x + 2.0, ARENA.y + 0.15, p0.z), 0.5);
      yield two();
      yield* line(L, DEFEAT[1]);
      boss.pose = 'fall';
      boss.yaw = Math.PI / 2;
      yield* line(L, DEFEAT[2]);
      yield* line(L, DEFEAT[3]);
      yield* line(L, DEFEAT[4]);
      yield* line(L, DEFEAT[5]);
      // К5 2К Пастила и Ноки
      faceTo(c.pastila, c.noki.root.position); faceTo(c.noki, c.pastila.root.position);
      const pn = c.pastila.root.position.clone().lerp(c.noki.root.position, 0.5);
      yield pair(L, 'pastila', 'noki');
      yield* line(L, DEFEAT[6]);
      yield* line(L, DEFEAT[7]);
      faceTo(c.pastila, p0); faceTo(c.noki, p0);
      // К6 КП ворон
      yield L.shot(vPerch.clone().add(V(-1.4, 0.4, 1.0)), vPerch.clone().add(V(0, 0.35, 0)), 0.4);
      boss.voronAnim.talk = 1;
      L.bark(boss.voronG, DEFEAT_VORON, 1.8, 0.9);
      audio.sfx('hiss', { pitch: 1.6, volume: 0.35 });
      yield wait(1.8);
      // К4
      yield two();
      yield* line(L, DEFEAT[8]);
      morosyaTalk = false;
      // К7 ОП: пуф — a little mouse in a tiny veil; the raven carries her off to the castle; the jars burst one by one
      boss.gone = true;
      L.fx.emit(boss.center(), { count: 30, speed: [1, 4], dir: V(0, 1, 0), spread: 0.9, life: [0.5, 1.1], size: [0.2, 0.42], size2: 1.8, colors: ['#4a5a5a', '#2b2140', '#8ab07a'], g: -1, drag: 2 });
      L.fx.stars(boss.center(), 12, ['#ffe14a', '#ffffff']);
      audio.sfx('batScreech', { pitch: 1.8, volume: 0.4 });
      mouse = createMouse('morok');
      mg.add(mouse.root); mg.position.copy(p0).setY(ARENA.y + 0.4); mg.scale.setScalar(1.6); mg.rotation.y = -Math.PI / 2;
      L.scene.add(mg);
      const ma: MouseAnim = { talk: 0, hop: 1, squeak: 1 };
      const mu = (_t: number, dt: number) => mouse?.update(dt, ma);
      L.updaters.push(mu);
      yield L.shot(V(p0.x - 4.5, ARENA.y + 2.4, p0.z + 4), p0.clone().setY(ARENA.y + 1.2), 0.5);
      // the raven swoops down and takes her
      const vg = boss.voronG, va = boss.voronAnim;
      const pick = p0.clone().setY(ARENA.y + 1.05);
      const v0 = vg.position.clone();
      va.st = 'fly';
      yield tween(0.8, (k) => { vg.position.lerpVectors(v0, pick, k); vg.position.y += Math.sin(k * Math.PI) * 0.8; vg.rotation.y = Math.atan2(pick.x - v0.x, pick.z - v0.z); }, ease.inOut);
      va.st = 'carry';
      const away = V(-0.45, 0.35, -0.65).normalize();
      const c0 = vg.position.clone();
      yield all(
        L.shot(p0.clone().add(V(4, 2, 4)), p0.clone().add(V(-6, 5, -8)), 1.8),
        tween(2.4, (k) => { vg.position.copy(c0).addScaledVector(away, k * 24); vg.rotation.y = Math.atan2(away.x, away.z); mg.position.copy(vg.position).add(V(0, -0.45, 0)); mg.scale.setScalar(1.6 * (1 - k * 0.3)); }),
      );
      remove(L, mu);
      mg.removeFromParent(); vg.visible = false; slick.removeFromParent();
      // the jars burst one by one, the fireflies rise, the bog turns green
      yield L.shot(V(-8, 8, -146), V(-8, 4, -168), 1.0);
      if (L.authority) vamp(L).restoreZone('house');
      vamp(L).night?.set(0.25, 5);
      vamp(L).moonCtl?.set(0.25, 5);
      afterVictory(L, false);
      const j0 = R.jarPopped.size, jn = R.jars.count;
      yield tween(2.4, (k) => {
        const before = R.jarPopped.size;
        burstJars(L, j0 + Math.ceil(k * (jn - j0)) - before, true);
        if (R.jarPopped.size > before && before % 3 === 0) { L.fx.stars(V(-8 + (Math.random() - 0.5) * 16, ARENA.y + 5.4, -168.4), 4, ['#ffe36a', '#fff6c0']); audio.sfx('break', { pitch: 1.4 + Math.random() * 0.4, volume: 0.25 }); }
      });
      burstJars(L, 99, true);
      audio.sfx('break', { pitch: 1.2 }); audio.sfx('colorRestore');
      L.fx.stars(V(-8, ARENA.y + 5.6, -168), 40, ['#ffe36a', '#fff6c0']);
      yield L.shot(V(-8, 14, -136), V(-8, 2, -165), 2.4);
      yield wait(0.6);
    } finally {
      remove(L, mUpd);
      kb.dispose(); slick.removeFromParent(); veil.removeFromParent(); mg.removeFromParent();
      boss.pose = null; boss.gone = true; boss.voronG.visible = false;
      hideCast(L);
    }
    L.cutscene(false);
    chain(L, 'fangs2_ending');
    yield wait(0.1);
  },

  // ─────────────────────── 6.6 Слеза светлячка ───────────────────────
  *fangs2_ending(L) {
    const R = swampOf(L)!;
    const c = cast(L);
    L.cutscene(true);
    audio.playMusic('swamp');
    stage(L, '6.6', { tosha: [-9.8, ARENA.y, -158.2], bublik: [-11.4, ARENA.y, -157.6], pastila: [-6.4, ARENA.y, -159.4], noki: [-4.6, ARENA.y, -158.4] }, V(-8, 2, -164));
    const mother = R.motherG, rig = R.mother;
    mother.visible = true;
    mother.scale.setScalar(0.85);
    R.bottle.visible = true;
    const m0 = mother.position.clone();
    const out = V(-8, ARENA.y + 0.6, -164.2);
    const mom = (d = 0.5) => L.shot(V(-8, 2.8, -156.4), V(-8, 2.6, -164), d);
    try {
      yield L.shot(V(-8, 3.2, -157.5), V(-8, 2.6, -172), 0);
      L.fx.sparks(MARK.bottle.clone().setY(ARENA.y + 3), 30, ['#e8f8ff', '#ffffff', '#cfe8e0']);
      audio.sfx('break', { pitch: 0.7 });
      R.bottle.visible = false;
      yield all(tween(2.4, (k) => { mother.position.lerpVectors(m0, out, k); rig.glow = 0.25 + 0.75 * k; mother.scale.setScalar(0.85 + 0.25 * k); }, ease.inOut), L.shot(V(-8, 2.8, -156.4), V(-8, 2.6, -164), 2.4));
      yield* line(L, ENDING[0]);
      yield* line(L, ENDING[1]);
      // the tear falls — Пастила catches it in her flask
      faceTo(c.pastila, out);
      an(c.pastila).attack = { kind: 'flask', p: 0.35 };
      const tear = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), basic('#fff07a'));
      const tg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffe86a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      tg.scale.setScalar(0.9); tear.add(tg); noOutline(tear);
      const t0 = out.clone().add(V(0.2, 2.1, 0.5)), t1 = c.pastila.root.position.clone().add(V(0, 1.0, 0));
      L.scene.add(tear);
      yield all(L.shot(at(c.pastila, 1.8, 1.6, 2.4), at(c.pastila, -0.4, 1.4, -1.5), 0.5), tween(1.3, (k) => { tear.position.lerpVectors(t0, t1, k); tear.position.y += Math.sin(k * Math.PI) * 0.6; }, ease.inOut));
      tear.removeFromParent();
      L.fx.stars(t1, 20, ['#fff07a', '#ffffff']);
      audio.sfx('artifact');
      an(c.pastila).attack = null; an(c.pastila).state = 'cheer';
      yield* ingredientCard(L, CARD.title, CARD.desc, 'fangs:tear');
      yield* line(L, ENDING[2]);
      an(c.pastila).state = 'idle';
      yield close(L, 'bublik');
      yield* line(L, ENDING[3]);
      // Камыш paddles up to the east gap (his lantern lit again)
      openExit(L);
      yield L.shot(V(1.5, 2.6, -152.5), MARK.exitBoat.clone().setY(1.4), 0.7);
      yield* line(L, ENDING[4]);
      faceTo(c.tosha, c.noki.root.position); faceTo(c.noki, c.tosha.root.position);
      yield L.shot(V(-7.2, 2.4, -154.0), V(-7.2, 1.2, -158.4), 0.6);
      yield* line(L, ENDING[5]);
      yield* line(L, ENDING[6]);
      // 2К Пастила и Ноки
      faceTo(c.pastila, c.noki.root.position); faceTo(c.noki, c.pastila.root.position);
      const pn = c.pastila.root.position.clone().lerp(c.noki.root.position, 0.5);
      const pnShot = (d = 0.5) => pair(L, 'pastila', 'noki', d);
      yield pnShot();
      yield* line(L, ENDING[7]);
      yield* line(L, ENDING[8]);
      yield* line(L, ENDING[9]);
      yield* line(L, ENDING[10]);
      yield close(L, 'bublik');
      yield* line(L, ENDING[11]);
      yield mom();
      yield* line(L, ENDING[12]);
      // ВЗГ Бублика: Ноки looks at the water, where there is no shadow of hers
      const water = V(c.noki.root.position.x + 3, 0, c.noki.root.position.z + 3.5);
      faceTo(c.noki, water);
      yield L.shot(at(c.bublik, 0, 0.8, 0).add(V(0.3, 0, 0)), at(c.noki, 0, 0.9, 0), 0.6);
      yield L.shot(at(c.noki, -1.2, 1.5, -1.0), water.clone().setY(0.2), 1.6);
      yield wait(1.0);
    } finally {
      for (const n of Object.values(c)) an(n).attack = null;
      hideCast(L);
      openExit(L);
      // she stays, glowing over her bog
      mother.position.copy(out).setY(ARENA.y + 1.2);
      rig.glow = 1;
    }
    L.cutscene(false);
    L.tcam.mode = 'follow'; L.camModeDefault = 'follow';
    L.boss = null;
    chain(L, 'fangs2_tag');
    yield wait(0.1);
  },

  // ─────────────────────── 6.7 Тем временем в замке ───────────────────────
  *fangs2_tag(L) {
    const R = swampOf(L);
    L.cutscene(true);
    if (R) R.castleG.visible = false;
    L.hud.toast('Тем временем в замке…', 3);
    try {
      yield* castleTag(L, TAG, { say: (w, s, e) => say(L, w as Spk, s, e), mouse: 'morok', raven: true, shot2At: 3, tugAt: 3, from: V(-8, ARENA.y + 2.2, -156) });
    } finally {
      if (R) R.castleG.visible = true;
    }
    yield L.camBack(0.7);
    L.cutscene(false);
    L.tcam.mode = 'follow'; L.camModeDefault = 'follow';
    L.boss = null;
    L.hud.toast(TOASTS.exit, 6);
  },

  // ─────────────────────── the way home ───────────────────────
  *exit_fangs2_swamp(L) {
    if (L.nl) { L.complete = true; L.exitWait = null; }
    L.cutscene(true);
    const boat = L.refs.f2boat as { obj: THREE.Group } | undefined;
    const b0 = boat ? boat.obj.position.clone() : MARK.exitBoat.clone();
    yield L.shot(b0.clone().add(V(-6, 3.5, 7)), b0.clone().add(V(0, 1, 0)), 0);
    L.player.hidden = true;
    yield all(
      L.shot(b0.clone().add(V(-4, 6, 10)), b0.clone().add(V(14, 1, -8)), 3.2),
      tween(3.2, (k) => { if (boat) boat.obj.position.copy(b0).add(V(k * 14, 0, -k * 8)); }, ease.inOut),
    );
    yield wait(0.3);
    if (L.authority) L.endLevel();
  },
};

/** blob shadows under the story four (Ноки has none: she lost her shadow — §1.7) */
export function castShadows(L: Level3D) {
  const c = cast(L);
  for (const k of ['tosha', 'bublik', 'pastila'] as Kind[]) {
    const b = makeBlob(0.45);
    b.position.y = 0.03;
    c[k].root.add(b);
  }
  c.noki.rig.root.traverse((o) => { o.castShadow = false; });
}

export const FANGS2_SCRIPTS = SCRIPTS;
