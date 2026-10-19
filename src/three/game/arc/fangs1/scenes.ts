import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { ease } from '../../../../engine/util';
import { wait, tween, all, type Script } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { coop } from '../../coop';
import { coopFlow } from '../../coopFlow';
import { hasStoryFlag } from '../../episodes';
import { vamp, ambient } from '../vampires';
import { say, type Spk } from './speech';
import { CAST, type Cast, type CastKind } from './cast';
import { NightTown, TOWER, MARKS } from './town';
import { Roofs, HALL, GALLERY } from './roofs';
import { INTRO, INTRO_MEET, EXIT_TOWN, ROOFS_INTRO, BOSS_INTRO, DEFEAT, ENDING, TOAST, BARK, COUNT, TITLE, type Line } from './lines';

/*
 * World scenes of «Клыки в пастиле» (docs/script-fangs.md §5.1–5.8). The host starts them (L.run) and every machine
 * plays them with its own camera; lines advance by themselves in co-op (≤ 14 a scene, under the 120 s watchdog — the
 * boss's defeat and the ending are two scenes). The story four act on their marks (Cast, castScenes); world actions —
 * the boss starting, zones restoring, the next scene, the level's end — happen where L.authority is true.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const town = (L: Level3D) => L.refs.f1town as NightTown | undefined;
const roofs = (L: Level3D) => L.refs.f1roofs as Roofs | undefined;
const CAST_SPK = new Set<string>(CAST);

/** lines in a row; the speaker of the story four turns to the others a little, the rest face where they face */
function* lines(L: Level3D, cast: Cast | null, ls: Line[]): Script {
  for (const [who, text, expr] of ls) {
    if (cast && CAST_SPK.has(who) && cast.shown(who as CastKind)) { cast.expr(who as CastKind, (expr as never) ?? 'normal'); }
    yield say(L, who as Spk, text, expr);
    if (cast && CAST_SPK.has(who) && cast.shown(who as CastKind)) cast.expr(who as CastKind, 'normal');
  }
}

/** an exit / ending scene: the level is over for everyone (co-op: the host's word made it so) */
function exitStart(L: Level3D) { L.complete = true; L.exitWait = null; }
function finish(L: Level3D) { if (L.authority) L.endLevel(); }
/** the room's progress (co-op: the host's map) */
const roomMet = () => hasStoryFlag('hub_lab_plan', coop.active ? coopFlow.mapProg() : undefined);

// ═════════════════════════════ fangs1_town ═════════════════════════════

/** 5.1 fangs1_intro — midnight on the square */
function* intro(L: Level3D): Script {
  const T = town(L);
  if (!T) return;
  const K = vamp(L), cast = T.cast;
  T.introOn = true;
  L.cutscene(true);
  for (const k of CAST) { const m = MARKS[k]; cast.place(k, m.x, 0, m.z, 0.8); }
  cast.look('noki', V(0, 0, 0));
  const count = T.deco.count;
  // the square, the festive lanterns, the tower
  yield L.shot(V(15, 8.5, 15), V(-6, 3.5, -8), 0);
  if (!roomMet()) yield* lines(L, cast, INTRO_MEET);
  yield all(L.shot(V(11, 6.5, 11.5), V(-7, 3.4, -9), 3.5), say(L, 'narrator', INTRO.a[0][1]));
  // Зефирыч on his stepladder
  const lad = MARKS.ladder.clone().add(V(0.9, 0, 0.9));
  const zefShot = () => L.shot(V(lad.x - 3.6, 2.5, lad.z + 2.2), V(lad.x, 2.6, lad.z), 0.6);
  yield zefShot();
  yield say(L, 'zefirych', INTRO.a[1][1], INTRO.a[1][2]);
  // the four at the tower's foot
  yield L.shot(V(-12.2, 1.75, -6.4), V(-15.4, 1.1, -10.4), 0.6);
  cast.look('pastila', lad);
  yield* lines(L, cast, INTRO.a.slice(2, 3));
  cast.look('noki', V(-13, 20, -30));
  cast.pose('noki', 'lookUp');
  yield* lines(L, cast, INTRO.a.slice(3));
  // midnight: БОМ… БОМ… — the moon turns red
  for (const k of CAST) cast.pose(k, 'lookUp');
  const md = new THREE.Vector3(...L.def.sun.dir).normalize();
  const eye = V(-12, 1.8, -6.5);
  yield L.shot(eye, eye.clone().addScaledVector(md, 40), 0.9);
  for (let i = 0; i < 3; i++) { ambient(L, () => audio.sfx('clang', { pitch: 0.35, volume: 0.8 })); L.tcam.shake(0.08); yield wait(0.55); }
  K.night?.set(1, 2.6); K.moonCtl?.set(1, 2.6);
  yield wait(2.2);
  yield L.shot(V(-10.8, 1.6, -5.8), V(-13.4, 1.0, -8.8), 0.5);
  for (const k of CAST) cast.pose(k, null);
  cast.look('bublik', MARKS.tosha);
  yield* lines(L, cast, INTRO.b);
  // the roofs: a flock bursts out; on the spire — a silhouette in a cape
  T.batsBurst();
  yield all(L.shot(V(-3, 3.2, -1), V(-16, 9, -22), 0.8), wait(1.2));
  if (count) { count.g.visible = true; count.anim.st = 'perch'; count.g.rotation.y = 0.7; }
  yield L.shot(V(-7.4, 15.6, -7.4), TOWER.spire.clone().add(V(0, 1.2, 0)), 0.9);
  ambient(L, () => audio.sfx('hiss', { pitch: 0.6 }));
  yield* lines(L, null, INTRO.c);
  // the bats dive at the townsfolk — the grey wave
  yield L.shot(V(12, 13, 13), V(-3, 0, -4), 0.8);
  T.greyWave(2.2);
  yield wait(2.4);
  yield zefShot();
  yield say(L, 'zefirych', INTRO.d[0][1], INTRO.d[0][2]);
  yield L.shot(V(-11.6, 1.6, -6.4), V(-14.2, 1.2, -9.6), 0.4);
  for (const k of CAST) cast.look(k, TOWER.spire);
  cast.pose('tosha', 'lookUp');
  yield* lines(L, cast, INTRO.d.slice(1, 2));
  cast.pose('tosha', null);
  // «Ловите меня на крышах» — off he flies
  yield L.shot(V(-7.4, 15.6, -7.4), TOWER.spire.clone().add(V(0, 1.2, 0)), 0.5);
  yield say(L, 'netopyr', INTRO.d[2][1]);
  if (count) {
    count.anim.st = 'fly';
    const from = count.g.position.clone(), to = V(26, 20, -36);
    ambient(L, () => audio.sfx('batFlap', { pitch: 0.7 }));
    yield tween(1.4, (k) => { count.g.position.lerpVectors(from, to, k); count.g.position.y += Math.sin(k * Math.PI) * 3; count.g.rotation.y = Math.atan2(to.x - from.x, to.z - from.z); }, ease.inOut);
    count.g.visible = false;
  }
  // the brushes with the trial syrup; the way: through the square to the tower
  yield L.shot(V(-12.2, 1.75, -6.4), V(-15.4, 1.1, -10.4), 0.5);
  for (const k of CAST) cast.look(k, V(-7, 0, -5));
  yield* lines(L, cast, INTRO.d.slice(3));
  T.endIntro();
  L.cutscene(false);
  yield L.camBack(0.6);
  L.hud.showChapter(TITLE.banner, TITLE.town);
  L.bannerShown = true;
  L.hud.toast(NightTown.presnyakToast(), 7);
}

/** 5.3 exit_fangs1_town — at the clock tower's door */
function* exitTown(L: Level3D): Script {
  const T = town(L);
  exitStart(L);
  if (!T) { finish(L); return; }
  const cast = T.cast;
  L.cutscene(true);
  const d = TOWER.door;
  cast.place('tosha', d.x + 0.9, 0, d.z + 2.6, Math.PI);
  cast.place('bublik', d.x + 2.0, 0, d.z + 3.0, Math.PI);
  cast.place('pastila', d.x - 0.9, 0, d.z + 2.5, Math.PI);
  cast.place('noki', d.x - 2.0, 0, d.z + 3.1, Math.PI + 0.3);
  // from below, up the tower
  yield L.shot(V(d.x + 1.5, 0.8, d.z + 6.5), V(d.x, 12, d.z - 2), 0);
  cast.pose('tosha', 'lookUp');
  yield* lines(L, cast, EXIT_TOWN.slice(0, 1));
  cast.pose('tosha', null);
  yield L.shot(V(d.x + 2.5, 1.8, d.z + 7.0), V(d.x, 1.2, d.z + 2.6), 0.6);
  cast.look('pastila', cast.pos('tosha'));
  yield* lines(L, cast, EXIT_TOWN.slice(1));
  // the door creaks, they go in
  ambient(L, () => audio.sfx('door', { pitch: 0.7 }));
  yield all(cast.walk('tosha', d.x, d.z + 0.2, 2.4, 2), cast.walk('bublik', d.x + 0.4, d.z + 0.4, 2.4, 2), cast.walk('pastila', d.x - 0.3, d.z + 0.3, 2.4, 2), cast.walk('noki', d.x - 0.5, d.z + 0.5, 2.4, 2), wait(1.6));
  L.fadeFlash();
  cast.hideAll();
  yield wait(0.4);
  finish(L);
}

// ═════════════════════════════ fangs1_roofs ═════════════════════════════

/** 5.4 fangs1_roofs_intro — out of the clock tower onto the roofs */
function* roofsIntro(L: Level3D): Script {
  const R = roofs(L);
  if (!R) return;
  const cast = R.cast, g = GALLERY;
  L.cutscene(true);
  const dir = Math.atan2(HALL.c.x - g.x, HALL.c.z - g.z);
  const at = (a: number, r: number) => V(g.x + Math.sin(dir + a) * r, g.y, g.z + Math.cos(dir + a) * r);
  const marks: Record<CastKind, THREE.Vector3> = { tosha: at(-0.18, 3.7), bublik: at(0.12, 3.75), pastila: at(0.42, 3.6), noki: at(-0.5, 3.6) };
  for (const k of CAST) cast.place(k, marks[k].x, marks[k].y, marks[k].z, dir);
  // over their shoulders: the sea of roofs, the dome far away, the Count on the weathervane
  const behind = V(g.x + Math.sin(dir) * 2.9, g.y + 3.2, g.z + Math.cos(dir) * 2.9);
  yield L.shot(behind, HALL.perch.clone(), 0);
  yield wait(0.6);
  yield all(L.shot(behind.clone().add(V(0, 0.4, 0)), HALL.c.clone().add(V(0, 3, 0)), 3.2), wait(1.2));
  yield L.shot(at(0.12, 6.4).setY(g.y + 1.7), at(0.1, 3.4).setY(g.y + 1.1), 0.6);
  for (const k of CAST) cast.look(k, cast.pos('bublik'));
  yield* lines(L, cast, ROOFS_INTRO.slice(0, 2));
  cast.pose('noki', 'lookUp');
  yield* lines(L, cast, ROOFS_INTRO.slice(2));
  cast.pose('noki', null);
  yield L.shot(behind, HALL.perch.clone(), 0.6);
  L.shout(BARK.countHere, 2.6);
  ambient(L, () => audio.sfx('batScreech', { pitch: 0.7, volume: 0.6 }));
  yield wait(1.6);
  cast.hideAll();
  L.cutscene(false);
  yield L.camBack(0.6);
  L.hud.showChapter(TITLE.banner, TITLE.roofs);
  L.bannerShown = true;
}

/** the four in a row on the dome, facing the middle */
function rowMarks(): Record<CastKind, THREE.Vector3> {
  const c = HALL.c;
  return { tosha: V(c.x - 0.8, c.y, c.z + 6.6), bublik: V(c.x + 0.9, c.y, c.z + 6.8), pastila: V(c.x - 2.5, c.y, c.z + 6.4), noki: V(c.x + 2.6, c.y, c.z + 6.2) };
}
/** after the intro: solo — the three (not me) stand on the rim to help (GDD §8); co-op — they leave */
function castToRim(L: Level3D, cast: Cast) {
  cast.hideAll();
  if (L.nl) return;
  const c = HALL.c;
  const spots: Record<CastKind, number> = { pastila: Math.PI * 0.72, noki: -Math.PI * 0.72, bublik: Math.PI * 0.28, tosha: -Math.PI * 0.28 };
  for (const k of CAST) {
    if (k === L.player.kind) continue;
    const a = spots[k], r = HALL.R - 2.6;
    cast.place(k, c.x + Math.sin(a) * r, c.y, c.z + Math.cos(a) * r, a + Math.PI);
  }
}
function bossOn(L: Level3D) {
  const R = roofs(L);
  if (!R) return;
  L.camModeDefault = 'boss';
  L.tcam.bossPoint = R.boss.pos;
  audio.playMusic('vampire_boss');
  if (L.authority) R.boss.start();
}

/** 5.5 fangs1_boss_intro — the Count comes down from the weathervane */
function* bossIntro(L: Level3D): Script {
  const R = roofs(L);
  if (!R) return;
  const cast = R.cast, boss = R.boss, c = HALL.c;
  L.cutscene(true);
  boss.manual = true;
  const m = rowMarks();
  for (const k of CAST) cast.place(k, m[k].x, m[k].y, m[k].z, Math.PI);
  // he spreads his cape and comes down
  yield L.shot(V(c.x + 2, c.y + 1.2, c.z + 5.5), boss.pos.clone().add(V(0, 1.5, 0)), 0);
  const from = boss.pos.clone(), to = V(c.x, c.y + 3.2, c.z + 1.5);
  boss.anim.st = 'fly';
  ambient(L, () => audio.sfx('batFlap', { pitch: 0.6 }));
  yield all(tween(1.6, (k) => { boss.pos.lerpVectors(from, to, k); boss.yaw = 0; }, ease.inOut), L.shot(V(c.x + 1.6, c.y + 1.0, c.z + 6.4), to.clone().add(V(0, 1.4, 0)), 1.6));
  boss.anim.st = 'perch';
  boss.anim.small = 0;
  for (const k of CAST) cast.look(k, to);
  yield* lines(L, cast, BOSS_INTRO.slice(0, 1));
  // the four in a row
  yield L.shot(V(c.x, c.y + 2.2, c.z + 1.2), V(c.x, c.y + 1.1, c.z + 6.6), 0.6);
  yield* lines(L, cast, BOSS_INTRO.slice(1, 2));
  yield L.shot(V(c.x + 1.6, c.y + 1.0, c.z + 6.4), to.clone().add(V(0, 1.4, 0)), 0.5);
  yield* lines(L, cast, BOSS_INTRO.slice(2, 3));
  yield L.shot(V(c.x - 1.0, c.y + 1.8, c.z + 3.8), m.pastila.clone().setY(c.y + 1.2), 0.5);
  yield* lines(L, cast, BOSS_INTRO.slice(3, 4));
  // the Count and Ноки, face to face
  cast.walk('noki', m.noki.x - 0.4, m.noki.z - 1.6, 2, 1.5);
  yield L.shot(V(m.noki.x + 2.6, c.y + 1.6, m.noki.z - 0.4), V((m.noki.x + to.x) / 2, c.y + 2.0, (m.noki.z + to.z) / 2), 0.6);
  yield* lines(L, cast, BOSS_INTRO.slice(4, 7));
  yield L.shot(V(c.x + 1.6, c.y + 1.0, c.z + 6.4), to.clone().add(V(0, 1.4, 0)), 0.4);
  boss.anim.st = 'summon';
  yield* lines(L, cast, BOSS_INTRO.slice(7));
  boss.manual = false;
  castToRim(L, cast);
  L.cutscene(false);
  yield L.camBack(0.5);
  bossOn(L);
  L.hud.toast(TOAST.knock, 7);
}

/** a retry at the dome (§12: «Снова вы? Как мило!») */
function* bossRetry(L: Level3D): Script {
  const R = roofs(L);
  if (!R) return;
  const boss = R.boss, c = HALL.c;
  L.cutscene(true);
  yield L.shot(V(c.x + 2.2, c.y + 1.4, c.z + 7.5), boss.pos.clone().add(V(0, 1.4, 0)), 0);
  yield say(L, 'netopyr', COUNT.retry, 'sly');
  castToRim(L, R.cast);
  L.cutscene(false);
  yield L.camBack(0.4);
  bossOn(L);
}

/** 5.7 fangs1_boss_defeat — the Count becomes a little bat */
function* bossDefeat(L: Level3D): Script {
  const R = roofs(L);
  if (!R) return;
  const cast = R.cast, boss = R.boss, c = HALL.c, K = vamp(L);
  L.cutscene(true);
  L.hud.bossMax = 0;
  audio.stopMusic(1.5);
  boss.manual = true;
  boss.lanesOff();
  const spot = V(c.x, c.y, c.z + 2.8);
  boss.pos.copy(spot); boss.yaw = 0;
  boss.anim.st = 'down'; boss.anim.small = 0; boss.anim.flash = 0;
  const m = rowMarks();
  cast.hideAll();
  for (const k of CAST) { cast.place(k, m[k].x, m[k].y, m[k].z - 1.6, Math.PI); cast.look(k, spot); }
  // (from a step back: the four on the left of the frame, Ноки no longer right against the lens)
  yield L.shot(V(c.x + 5.2, c.y + 2.0, c.z + 2.4), spot.clone().add(V(-0.4, 0.8, 0.6)), 0);
  yield say(L, 'netopyr', DEFEAT.a[1], DEFEAT.a[2]);
  // puff! — a little bat
  ambient(L, () => { L.fx.emit(spot.clone().add(V(0, 1, 0)), { count: 40, speed: [1, 4], life: [0.5, 1], size: [0.3, 0.6], size2: 2, colors: ['#3b2b52', '#5d4880', '#b31c3c', '#ffffff'], g: -1, drag: 2 }); audio.sfx('whoosh', { pitch: 1.6 }); });
  yield tween(0.6, (k) => { boss.anim.small = k; });
  boss.anim.st = 'fly';
  yield say(L, 'netopyr', DEFEAT.b[1], DEFEAT.b[2]);
  // off to the castle on its rock
  const castle = (L.refs.castleAt as THREE.Vector3 | undefined) ?? V(-210, 80, -330);
  const from = boss.pos.clone();
  const far = from.clone().lerp(castle, 0.25);
  yield all(L.shot(V(c.x + 3, c.y + 2.2, c.z + 8), far, 2.6), tween(2.6, (k) => { boss.pos.lerpVectors(from, far, k); boss.pos.y += Math.sin(k * Math.PI * 6) * 0.3; boss.yaw = Math.atan2(far.x - from.x, far.z - from.z); }, ease.inOut));
  boss.root.visible = false;
  // the colour comes back from the dome: roofs pink, lanterns lit
  if (L.authority) {
    for (const z of K.zones) if (z.state === 'grey') K.restoreZone(z.id);
    for (const l of K.lanterns) if (!l.lit) l.set(true);
  }
  boss.dark = 0;
  yield L.shot(V(c.x, c.y + 7, c.z + 18), V(c.x, c.y - 2, c.z - 4), 1.0);
  for (const k of CAST) cast.look(k, V(c.x, c.y, c.z + 30));
  yield* lines(L, cast, DEFEAT.c);
  yield wait(0.2);
  // 5.8 follows (its own scene, so each fits the watchdog)
  if (L.authority) L.runGen((function* (): Script { yield wait(0.05); L.run('exit_fangs1_roofs'); })());
  yield wait(0.1);
}

/** 5.8 fangs1_ending — what's next (then the level ends: the episode is done) */
function* ending(L: Level3D): Script {
  const R = roofs(L);
  exitStart(L);
  if (!R) { finish(L); return; }
  const cast = R.cast, c = HALL.c, K = vamp(L);
  L.cutscene(true);
  L.hud.bossMax = 0;
  audio.playMusic('night_town');
  // pre-dawn: the moon goes down, still red
  K.moonCtl?.set(0.75, 6);
  const edge = (a: number) => V(c.x + Math.sin(a) * (HALL.R - 1.6), c.y, c.z + Math.cos(a) * (HALL.R - 1.6));
  const look = V(c.x, c.y + 1.5, c.z + 40);
  const pos: Record<CastKind, THREE.Vector3> = { pastila: edge(-0.42), tosha: edge(-0.14), noki: edge(0.14), bublik: edge(0.42) };
  for (const k of CAST) { cast.place(k, pos[k].x, pos[k].y, pos[k].z, 0); cast.look(k, look); }
  // backs to the camera, the coloured quarter around, the grey town beyond
  yield L.shot(V(c.x, c.y + 3.2, c.z - 1.5), look, 0);
  const face = (k: CastKind, side = 0) => L.shot(pos[k].clone().add(V(side * 0.8, 1.55, 2.3)), pos[k].clone().setY(c.y + 1.25), 0.5);
  const seq: [CastKind, number, number][] = [['pastila', 0, 1], ['tosha', 1, 2], ['pastila', 2, 4], ['noki', 4, 7], ['bublik', 7, 8], ['noki', 8, 9], ['tosha', 9, 10], ['pastila', 10, 11], ['noki', 11, 12]];
  for (const [k, a, b] of seq) {
    yield face(k, k === 'noki' ? -1 : 1);
    yield* lines(L, cast, ENDING.slice(a, b));
  }
  // the last shot: Ноки and Тоша
  cast.look('tosha', cast.pos('noki')); cast.look('noki', cast.pos('tosha'));
  yield L.shot(V((pos.tosha.x + pos.noki.x) / 2, c.y + 1.6, (pos.tosha.z + pos.noki.z) / 2 + 2.6), V((pos.tosha.x + pos.noki.x) / 2, c.y + 1.2, (pos.tosha.z + pos.noki.z) / 2), 0.6);
  yield* lines(L, cast, ENDING.slice(12));
  yield wait(0.6);
  finish(L);
}

export const FANGS1_SCRIPTS: Record<string, (L: Level3D) => Script> = {
  fangs1_intro: intro,
  exit_fangs1_town: exitTown,
  fangs1_roofs_intro: roofsIntro,
  fangs1_boss_intro: bossIntro,
  fangs1_boss_retry: bossRetry,
  fangs1_boss_defeat: bossDefeat,
  exit_fangs1_roofs: ending,
};

/** per-level hooks (run once the level is built): the boss's defeat starts 5.7 (host) */
export const FANGS1_SPECIAL: Record<string, (L: Level3D) => void> = {
  fangs1_roofs(L) {
    const R = roofs(L);
    if (!R) return;
    R.boss.onDefeat = () => {
      if (!L.authority) return;
      L.runGen((function* (): Script { yield wait(1.0); L.run('fangs1_boss_defeat'); })());
    };
  },
};

