import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { ease } from '../../../../engine/util';
import { wait, tween, all, type Script, type Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { coop } from '../../coop';
import { coopFlow } from '../../coopFlow';
import { hasStoryFlag } from '../../episodes';
import { vamp, ambient } from '../vampires';
import { ShadowGirl } from '../vampires/shadowGirl';
import { safeMark } from '../shared/safeMark';
import { castleTag } from '../shared/castleTag';
import { showCard } from '../shared/storyCard';
import { say, type Spk } from './speech';
import { CAST, type Cast, type CastKind } from './cast';
import { NightTown, TOWER, MARKS } from './town';
import { JURY, JUDGE_AT, CONTEST } from './stage';
import { Roofs, HALL, ROOF_DOOR, GALLERY_MARKS } from './roofs';
import { INTRO, INTRO_MEET, EXIT_TOWN, ROOFS_INTRO, BOSS_INTRO, DEFEAT, ENDING, MENU_CARD, TAG, TOAST, BARK, COUNT, TITLE, type Line } from './lines';

/*
 * World scenes of «Клыки в пастиле» (docs/script-fangs-v2.md §5.1–5.9). The host starts them (L.run) and every machine
 * plays them with its own camera; lines advance by themselves in co-op (≤ 14 a scene, under the 120 s watchdog — the
 * boss's defeat, the ending and the castle tag are three scenes). The story four act on their marks (Cast,
 * castScenes; new / changed marks go through the shared safeMark, v2 §0); world actions — the boss starting, zones
 * restoring, the next scene, the level's end — happen where L.authority is true.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const town = (L: Level3D) => L.refs.f1town as NightTown | undefined;
const roofs = (L: Level3D) => L.refs.f1roofs as Roofs | undefined;
const CAST_SPK = new Set<string>(CAST);

/** lines in a row; the speaker of the story four shows the line's emotion */
function* lines(L: Level3D, cast: Cast | null, ls: Line[]): Script {
  for (const [who, text, expr] of ls) {
    const mine = cast && CAST_SPK.has(who) && cast.shown(who as CastKind);
    if (mine) cast!.expr(who as CastKind, figExpr(expr));
    yield say(L, who as Spk, text, expr);
    if (mine) cast!.expr(who as CastKind, 'normal');
  }
}
/** v2 §0: figures have no sad / sly (sad → hurt, sly → normal) */
function figExpr(e?: string): never { return (e === 'sad' ? 'hurt' : !e || e === 'sly' ? 'normal' : e) as never; }
const line = (L: Level3D, cast: Cast | null, l: Line) => lines(L, cast, [l]);

/** a mark (v2 §0 safeMark) → the figure stands there facing `at` */
function place(L: Level3D, cast: Cast, k: CastKind, v: THREE.Vector3, at: THREE.Vector3, label: string, o: { wall?: number } = {}) {
  const p = safeMark(L, v.clone(), { label, wall: o.wall });
  cast.place(k, p.x, p.y, p.z, Math.atan2(at.x - p.x, at.z - p.z));
  return p;
}
/** 2К: both in the frame, from the side they face (toward `toward`) */
function two(L: Level3D, a: THREE.Vector3, b: THREE.Vector3, toward: THREE.Vector3, d = 2.4, side = 1, dur = 0.5) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = toward.clone().sub(mid).setY(0).normalize();
  const perp = V(-dir.z, 0, dir.x);
  const span = Math.hypot(a.x - b.x, a.z - b.z);
  const cam = mid.clone().addScaledVector(dir, d + span * 0.45).addScaledVector(perp, side * 0.7).setY(mid.y + 1.5);
  return L.shot(cam, mid.clone().setY(mid.y + 1.05), dur);
}
/** СП: one figure from where it looks */
function one(L: Level3D, p: THREE.Vector3, toward: THREE.Vector3, d = 2.0, side = 0.5, dur = 0.5, h = 1.5) {
  const dir = toward.clone().sub(p).setY(0).normalize();
  const perp = V(-dir.z, 0, dir.x);
  return L.shot(p.clone().addScaledVector(dir, d).addScaledVector(perp, side).setY(p.y + h), p.clone().setY(p.y + 1.2), dur);
}

/** an exit / ending scene: the level is over for everyone (co-op: the host's word made it so) */
function exitStart(L: Level3D) { L.complete = true; L.exitWait = null; }
function finish(L: Level3D) { if (L.authority && !L.results) L.endLevel(); }
/** the room's progress (co-op: the host's map) */
const roomMet = () => hasStoryFlag('hub_lab_plan', coop.active ? coopFlow.mapProg() : undefined);

// ═════════════════════════════ fangs1_town ═════════════════════════════

/** v2 5.1 fangs1_intro «Судья из-за гор» — the lantern contest at midnight (cold open, then the series banner) */
function* intro(L: Level3D): Script {
  const T = town(L);
  if (!T) return;
  const K = vamp(L), cast = T.cast;
  T.introOn = true;
  L.cutscene(true);
  const J = JURY.c, f = JURY.f, r = JURY.r;
  const up = (v: THREE.Vector3, y: number) => v.clone().setY(y);
  const P = {} as Record<CastKind, THREE.Vector3>;
  for (const k of CAST) P[k] = place(L, cast, k, MARKS[k], J, '5.1 ' + k);
  const count = T.deco.count;
  const ca = count?.anim;
  const faceTo = (at: THREE.Vector3, dur = 0.45): Waiter => {
    if (!count) return wait(0);
    const from = count.g.rotation.y, want = Math.atan2(at.x - count.g.position.x, at.z - count.g.position.z);
    const d = Math.atan2(Math.sin(want - from), Math.cos(want - from));
    return tween(dur, (k) => { count.g.rotation.y = from + d * k; }, ease.inOut);
  };
  const spot = (id: string) => CONTEST.find((c) => c.id === id)!.at;
  // К1: the square in its garlands from up high, a slow push-in to the stage
  yield L.shot(V(17, 10, 17), V(-4, 2, -4), 0);
  if (!roomMet()) yield* lines(L, cast, INTRO_MEET);
  yield all(L.shot(J.clone().addScaledVector(f, 9).addScaledVector(r, -2).setY(4.6), up(J, 1.4), 3.5), say(L, 'narrator', INTRO.k1[1]));
  // К2: Зефирыч on his stepladder, the host of the contest
  const lad = MARKS.ladder.clone().add(V(0.9, 0, 0.9));
  // (close and in front of him: from farther back the garlands' bulbs hung right in front of the lens)
  const zefShot = (d = 0.6) => L.shot(V(lad.x - 2.0, 2.6, lad.z + 1.1), V(lad.x, 2.75, lad.z), d);
  yield zefShot();
  yield* line(L, null, INTRO.k2);
  // К3: low on the stage — the tall dandy bows (the monocle and the smile)
  if (ca) ca.st = 'bow';
  yield L.shot(J.clone().addScaledVector(f, 3.4).addScaledVector(r, 1.0).setY(0.55), up(J, 2.3), 0.6);
  yield wait(0.5);
  // К4: over his shoulder onto the three; he leans to each («на троечку… на двоечку…»)
  const mid = CONTEST.reduce((s, c) => s.add(c.at), V(0, 0, 0)).multiplyScalar(1 / 3);
  yield L.shot(J.clone().addScaledVector(f, -1.5).addScaledVector(r, 1.3).setY(3.5), up(mid, 0.55), 0.6);
  yield faceTo(spot('ponchik'));
  L.runGen((function* (): Script { yield wait(2.2); yield faceTo(spot('beze')); })());
  yield* line(L, null, INTRO.k3);
  yield faceTo(spot('marmeladka'));
  if (ca) ca.p = 1.6; // (a deep bow: sniffing the green lantern)
  yield* line(L, null, INTRO.k4);
  if (ca) { ca.p = 1; ca.st = 'perch'; }
  // К5: Бублик and Тоша; then Пастила looks at the ground by the stage: no shadow under the guest
  for (const k of CAST) cast.look(k, J);
  yield two(L, P.tosha, P.bublik, J, 2.0, -1);
  yield* line(L, cast, INTRO.k5a);
  yield L.shot(up(P.pastila, 1.45), up(J, 0.2), 0.7);
  yield* lines(L, null, INTRO.k5b.slice(0, 1));
  yield two(L, P.pastila, P.noki, J, 2.2, 1);
  yield* lines(L, cast, INTRO.k5b.slice(1));
  // К6: midnight — БОМ… БОМ… — the moon turns red
  for (const k of CAST) cast.pose(k, 'lookUp');
  const md = new THREE.Vector3(...L.def.sun.dir).normalize();
  const eye = V(-12, 1.8, -6.5);
  yield L.shot(eye, eye.clone().addScaledVector(md, 40), 0.9);
  for (let i = 0; i < 3; i++) { ambient(L, () => audio.sfx('clang', { pitch: 0.35, volume: 0.8 })); L.tcam.shake(0.08); yield wait(0.55); }
  K.night?.set(1, 2.6); K.moonCtl?.set(1, 2.6);
  yield wait(2.0);
  for (const k of CAST) cast.pose(k, null);
  // К7: the monocle goes, the cape opens into wings — the lining of drunk colours
  if (count) { yield faceTo(mid, 0.3); count.anim.st = 'reveal'; count.rig.lining(2); }
  ambient(L, () => audio.sfx('batFlap', { pitch: 0.6, volume: 0.7 }));
  yield L.shot(J.clone().addScaledVector(f, 3.6).addScaledVector(r, -0.8).setY(1.5), up(J, 2.1), 0.5);
  yield* line(L, null, INTRO.k7);
  // К8: Мармеладка's lantern — its colour runs off in a ribbon into his mouth; the lantern goes grey
  const mar = T.contest.get('marmeladka');
  if (count && mar) {
    yield faceTo(spot('marmeladka'), 0.3);
    count.anim.st = 'bow'; count.anim.p = 1.2;
    const h = mar.head();
    const mouth = () => count.rig.monocle.getWorldPosition(new THREE.Vector3()).add(V(0, -0.22, 0));
    const m0 = h.clone().lerp(mouth(), 0.5);
    const side = V(-(mouth().z - h.z), 0, mouth().x - h.x).normalize();
    yield L.shot(m0.clone().addScaledVector(side, 2.2).add(V(0, 0.2, 0)), m0, 0.5);
    ambient(L, () => audio.sfx('hiss', { pitch: 0.6 }));
    ambient(L, () => audio.sfx('drain', { pitch: 0.9 }));
    let acc = 0;
    yield tween(1.9, (k) => {
      count.anim.talk = 1;
      mar.grey = Math.min(1, k * 1.3); mar.apply();
      if (k - acc < 0.015) return;
      acc = k;
      const mo = mouth();
      for (let i = 0; i < 3; i++) {
        const q = (k * 2.5 + i / 3) % 1;
        const p = h.clone().lerp(mo, q); p.y += Math.sin(q * Math.PI) * 0.5;
        L.fx.emit(p, { count: 1, speed: [0.05, 0.25], life: [0.2, 0.35], size: [0.08, 0.15], colors: ['#6af07a', '#b8ffb0', '#ffffff'], drag: 4 });
      }
    });
    count.anim.talk = 0; count.anim.st = 'perch'; count.anim.p = 1;
  }
  // К9: the grey wave rolls off the stage, the bats burst from the roofs; Зефирыч goes grey on his ladder
  T.batsBurst();
  yield L.shot(V(9, 12, 10), up(J, 0), 0.7);
  T.greyWave(2.2, J.clone());
  for (const c of CONTEST) { const pl = T.contest.get(c.id); if (pl && pl !== mar) L.runGen((function* (): Script { yield tween(1.2, (k) => { pl.grey = Math.max(pl.grey, k); pl.apply(); }); })()); }
  yield wait(2.4);
  yield zefShot(0.5);
  yield* line(L, null, INTRO.k9);
  // К10: Тоша; the Count up on the spire; off to the town hall
  cast.look('tosha', J);
  yield one(L, P.tosha, J, 2.0, 0.6);
  yield* line(L, cast, INTRO.k10a);
  if (count) {
    count.anim.st = 'fly';
    const from = count.g.position.clone(), to = TOWER.spire.clone().add(V(0, 0.2, 0));
    ambient(L, () => audio.sfx('batFlap', { pitch: 0.7 }));
    yield all(L.shot(V(TOWER.x + 5.5, 1.2, TOWER.z + 7.5), to.clone().add(V(0, 1.0, 0)), 1.2),
      tween(1.2, (k) => { count.g.position.lerpVectors(from, to, k); count.g.position.y += Math.sin(k * Math.PI) * 2; count.g.rotation.y = Math.atan2(to.x - from.x, to.z - from.z); }, ease.inOut));
    count.anim.st = 'perch'; count.g.rotation.y = 0.7;
  }
  for (const k of CAST) { cast.look(k, TOWER.spire); }
  cast.pose('tosha', 'lookUp');
  yield* line(L, null, INTRO.k10b);
  cast.pose('tosha', null);
  if (count) {
    count.anim.st = 'fly';
    const from = count.g.position.clone(), to = V(26, 20, -36);
    ambient(L, () => audio.sfx('batFlap', { pitch: 0.7 }));
    yield tween(1.4, (k) => { count.g.position.lerpVectors(from, to, k); count.g.position.y += Math.sin(k * Math.PI) * 3; count.g.rotation.y = Math.atan2(to.x - from.x, to.z - from.z); }, ease.inOut);
    count.g.visible = false;
  }
  // К11: the four at the tower: the syrup brushes, the way through the square
  for (const k of CAST) cast.look(k, V(-7, 0, -3));
  const m4 = CAST.reduce((s, k) => s.add(P[k]), V(0, 0, 0)).multiplyScalar(0.25);
  yield L.shot(m4.clone().add(V(3.4, 1.7, 3.0)), m4.clone().setY(1.0), 0.6);
  yield* lines(L, cast, INTRO.k11);
  T.endIntro();
  L.cutscene(false);
  yield L.camBack(0.6);
  L.hud.showChapter(TITLE.banner, TITLE.townSub);
  L.bannerShown = true;
  // (after the chapter banner: the long two-line toast used to run into its lines)
  T.toastLater(NightTown.presnyakToast(), 3.6, 8);
}

/** v2 5.3 exit_fangs1_town — at the clock tower's door */
function* exitTown(L: Level3D): Script {
  const T = town(L);
  exitStart(L);
  if (!T) { finish(L); return; }
  const cast = T.cast;
  L.cutscene(true);
  const d = TOWER.door;
  // (in front of the porch, clear of the flowerbed east of it: x −12.5…−9.5, z −11.3…−8.7 — the walk-in marks
  // are tight to the porch on purpose: kept as they are)
  cast.place('tosha', d.x + 0.4, 0, d.z + 2.4, Math.PI);
  cast.place('bublik', d.x + 1.0, 0, d.z + 3.3, Math.PI - 0.2);
  cast.place('pastila', d.x - 0.9, 0, d.z + 2.5, Math.PI);
  cast.place('noki', d.x - 2.0, 0, d.z + 3.1, Math.PI + 0.3);
  // from low on the square: Тоша looking up, the porch and the tower rising over the four (Тоша kept above the box)
  yield L.shot(V(d.x + 2.6, 1.0, d.z + 10.5), V(d.x, 4.2, d.z - 1), 0);
  cast.pose('tosha', 'lookUp');
  yield* lines(L, cast, EXIT_TOWN.slice(0, 1));
  cast.pose('tosha', null);
  yield L.shot(V(d.x + 2.5, 1.8, d.z + 7.0), V(d.x, 1.2, d.z + 2.6), 0.6);
  cast.look('pastila', cast.pos('tosha'));
  yield* lines(L, cast, EXIT_TOWN.slice(1, 4));
  // the last line: КП Пастила («А внутри темно? …Я спрашиваю для науки.»)
  const pp = cast.pos('pastila');
  cast.look('pastila', cast.pos('tosha'));
  yield L.shot(pp.clone().add(V(1.25, 1.5, 1.35)), pp.clone().setY(pp.y + 1.25), 0.5);
  yield* lines(L, cast, EXIT_TOWN.slice(4));
  // in through the open doors, two by two, and up the stair into the dark (d: the porch's mouth)
  T.door.set(true);
  yield L.shot(V(d.x + 2.2, 1.7, d.z + 5.6), V(d.x, 1.3, d.z - 0.6), 0.6);
  ambient(L, () => audio.sfx('door', { pitch: 0.7 }));
  yield all(cast.walk('tosha', d.x - 0.35, d.z + 0.9, 2.4, 2.5), cast.walk('bublik', d.x + 0.4, d.z + 1.1, 2.4, 2.5), cast.walk('pastila', d.x - 0.6, d.z + 2.0, 2.4, 2.5), cast.walk('noki', d.x + 0.7, d.z + 2.2, 2.4, 2.5));
  yield all(cast.walk('tosha', d.x - 0.35, d.z - 1.05, 2.2, 2.5), cast.walk('bublik', d.x + 0.35, d.z - 0.95, 2.2, 2.5), cast.walk('pastila', d.x - 0.35, d.z + 0.9, 2.4, 2.5), cast.walk('noki', d.x + 0.4, d.z + 1.1, 2.4, 2.5));
  // the last two follow; the camera climbs the tower with them (up there: the roofs)
  cast.walk('tosha', d.x + 0.3, d.z - 1.25, 1.6, 2);
  cast.walk('bublik', d.x - 0.3, d.z - 1.2, 1.6, 2);
  yield all(L.shot(V(d.x + 2.4, 1.0, d.z + 6.8), V(d.x, 15.5, d.z - 4.3), 1.6), cast.walk('pastila', d.x - 0.35, d.z - 0.7, 2.2, 2.5), cast.walk('noki', d.x + 0.35, d.z - 0.6, 2.2, 2.5), wait(1.7));
  L.fadeFlash();
  cast.hideAll();
  ambient(L, () => audio.sfx('door', { pitch: 0.55, volume: 0.6 }));
  T.door.set(false);
  yield wait(0.5);
  finish(L);
}

// ═════════════════════════════ fangs1_roofs ═════════════════════════════

/** 5.4 fangs1_roofs_intro — out of the clock tower onto the roofs (through the little door in the clock box) */
function* roofsIntro(L: Level3D): Script {
  const R = roofs(L);
  if (!R) return;
  const cast = R.cast, D = ROOF_DOOR, M = GALLERY_MARKS;
  L.cutscene(true);
  cast.hideAll();
  // the door in the clock box creaks open; one after another they step out onto the gallery
  yield L.shot(V(8.8, 14.9, 4.4), V(3.3, 13.9, 0.5), 0);
  ambient(L, () => audio.sfx('door', { pitch: 0.75 }));
  yield tween(0.5, (k) => R.doorOpen(k), ease.outQuad);
  const order: CastKind[] = ['noki', 'bublik', 'tosha', 'pastila'];
  for (const k of order) {
    cast.place(k, D.x + 0.28, 13, D.z, Math.PI / 2);
    // (round the door's swung leaf: out first, then along the box to the mark)
    const m = M[k];
    L.runGen((function* (): Script { yield cast.walk(k, D.x + 0.5, D.z - 0.5, 2.4, 1); yield cast.walk(k, m.x, m.z, 2.4, 2); cast.look(k, V(12, 13, m.z * 0.4)); })());
    yield wait(0.5);
  }
  yield wait(0.9);
  // the sea of roofs from above the tower: the dome far away, the Count on its weathervane
  const high = V(5.5, 25, 6.0);
  yield L.shot(high, HALL.perch.clone(), 0.6);
  for (const k of CAST) { const m = M[k]; cast.place(k, m.x, m.y, m.z, Math.PI / 2); }
  yield all(L.shot(high.clone().add(V(0, 0.4, 0)), HALL.c.clone().add(V(0, 3, 0)), 3.2), wait(1.2));
  // the four on the gallery, the bridge behind the camera
  yield L.shot(V(8.4, 15.3, 0.0), V(3.6, 13.95, -0.05), 0.6);
  for (const k of CAST) cast.look(k, cast.pos('bublik'));
  cast.look('bublik', V(9, 13, 0));
  yield* lines(L, cast, ROOFS_INTRO.slice(0, 2));
  cast.pose('noki', 'lookUp');
  yield* lines(L, cast, ROOFS_INTRO.slice(2));
  cast.pose('noki', null);
  yield L.shot(high, HALL.perch.clone(), 0.6);
  L.shout('Граф Нетопырь: ' + BARK.countHere, 2.8);
  ambient(L, () => audio.sfx('batScreech', { pitch: 0.7, volume: 0.6 }));
  yield wait(1.6);
  cast.hideAll();
  L.cutscene(false);
  yield L.camBack(0.6);
  L.hud.showChapter(TITLE.banner, TITLE.roofsSub);
  L.bannerShown = true;
}

/** the four in a row on the dome, facing the middle (v2 §5.5: 6.2–6.8 m south of HALL.c) */
function rowMarks(L: Level3D, dz = 0): Record<CastKind, THREE.Vector3> {
  const c = HALL.c;
  const raw: Record<CastKind, THREE.Vector3> = { tosha: V(c.x - 0.8, c.y, c.z + 6.6 + dz), bublik: V(c.x + 0.9, c.y, c.z + 6.8 + dz), pastila: V(c.x - 2.5, c.y, c.z + 6.4 + dz), noki: V(c.x + 2.6, c.y, c.z + 6.2 + dz) };
  const out = {} as Record<CastKind, THREE.Vector3>;
  for (const k of CAST) out[k] = safeMark(L, raw[k], { label: 'dome ' + k });
  return out;
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

/** v2 5.5 fangs1_boss_intro «Подкладка» — the Count sipping on the weathervane, then down to the show */
function* bossIntro(L: Level3D): Script {
  const R = roofs(L);
  if (!R) return;
  const cast = R.cast, boss = R.boss, c = HALL.c;
  L.cutscene(true);
  boss.manual = true;
  boss.rig.lining(3);
  const m = rowMarks(L);
  for (const k of CAST) cast.place(k, m[k].x, m[k].y, m[k].z, Math.PI);
  // К1: low, up at the weathervane: the Count with a straw
  boss.anim.st = 'sip';
  yield L.shot(V(c.x + 2.2, c.y + 1.0, c.z + 5.8), boss.pos.clone().add(V(0, 1.8, 0)), 0);
  yield* line(L, null, BOSS_INTRO.k1);
  // К3: the four in a row
  boss.anim.st = 'perch';
  yield L.shot(V(c.x, c.y + 2.2, c.z + 1.4), V(c.x, c.y + 1.1, c.z + 6.6), 0.6);
  yield* line(L, cast, BOSS_INTRO.k3);
  // К2: he spreads his cape and glides down — talking on the way
  const from = boss.pos.clone(), to = V(c.x, c.y + 3.2, c.z + 1.5);
  boss.anim.st = 'fly';
  ambient(L, () => audio.sfx('batFlap', { pitch: 0.6 }));
  L.runGen((function* (): Script { yield tween(1.6, (k) => { boss.pos.lerpVectors(from, to, k); boss.yaw = 0; }, ease.inOut); boss.anim.st = 'perch'; boss.anim.small = 0; })());
  for (const k of CAST) cast.look(k, to);
  yield L.shot(V(c.x + 1.6, c.y + 1.0, c.z + 6.4), to.clone().add(V(0, 1.4, 0)), 1.6);
  yield* line(L, null, BOSS_INTRO.k2);
  // Пастила
  yield one(L, m.pastila, to, 2.2, -0.6);
  yield* line(L, cast, BOSS_INTRO.pastila);
  // К4: the cape thrown open — the lining of patches
  boss.anim.st = 'reveal';
  ambient(L, () => audio.sfx('batFlap', { pitch: 0.5, volume: 0.7 }));
  yield L.shot(to.clone().add(V(0.9, -1.2, 4.2)), to.clone().add(V(0, 1.3, 0)), 0.5);
  yield* line(L, null, BOSS_INTRO.k4);
  boss.anim.st = 'perch';
  // К5: Ноки steps forward — the two of them
  cast.walk('noki', m.noki.x - 0.4, m.noki.z - 1.6, 2, 1.5);
  yield L.shot(V(m.noki.x + 2.6, c.y + 1.6, m.noki.z - 0.4), V((m.noki.x + to.x) / 2, c.y + 2.0, (m.noki.z + to.z) / 2), 0.6);
  yield* lines(L, cast, BOSS_INTRO.k5);
  // К6: «к показу»
  yield L.shot(V(c.x + 1.6, c.y + 1.0, c.z + 6.4), to.clone().add(V(0, 1.4, 0)), 0.4);
  boss.anim.st = 'summon';
  yield* line(L, cast, BOSS_INTRO.k6);
  boss.manual = false;
  castToRim(L, cast);
  L.cutscene(false);
  yield L.camBack(0.5);
  bossOn(L);
  L.hud.toast(TOAST.knock, 7);
}

/** a retry at the dome (v2 §12: «Снова вы, душечки? Как мило! Второй выход!») */
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

/** v2 5.7 fangs1_boss_defeat «Подкладка выцветает» — Финтифлюш the tailor; the monocle; a shadow with a guitar */
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
  boss.anim.st = 'down'; boss.anim.small = 0; boss.anim.flash = 0; boss.anim.glint = 0;
  boss.rig.lining(5);
  const m = rowMarks(L, -1.6);
  cast.hideAll();
  for (const k of CAST) { cast.place(k, m[k].x, m[k].y, m[k].z, Math.PI); cast.look(k, spot); }
  // К1: the cape in a heap (from a step back: the four on the left of the frame)
  yield L.shot(V(c.x + 5.2, c.y + 2.0, c.z + 2.4), spot.clone().add(V(-0.4, 0.8, 0.6)), 0);
  yield* line(L, null, DEFEAT.k1);
  // К2: the lining fades — colour runs off it in streams across the dome, back to the quarters
  yield L.shot(spot.clone().add(V(1.6, 1.1, 2.2)), spot.clone().add(V(0, 0.7, 0)), 0.5);
  ambient(L, () => audio.sfx('colorRestore', { pitch: 0.8, volume: 0.6 }));
  const cols = ['#e8285a', '#ff8ab8', '#5ad86a', '#ff9a3a', '#7ad8ff'];
  let acc = 0;
  yield tween(2.2, (k) => {
    boss.rig.lining(5, k);
    if (k - acc < 0.022) return;
    acc = k;
    cols.forEach((col, i) => {
      const a = (i / cols.length) * Math.PI * 2 + 0.4;
      const d = 0.6 + k * (HALL.R - 1);
      L.fx.emit(V(spot.x + Math.sin(a) * d, c.y + 0.25, spot.z + Math.cos(a) * d), { count: 2, speed: [0.2, 0.8], life: [0.4, 0.8], size: [0.12, 0.24], colors: [col, '#ffffff'], g: -0.5, drag: 3 });
    });
  });
  // К3: Бублик and the Count
  cast.walk('bublik', spot.x + 0.9, spot.z + 1.9, 2, 1.5);
  yield L.shot(spot.clone().add(V(-2.6, 1.3, 2.4)), spot.clone().add(V(0.5, 0.7, 1.0)), 0.6);
  yield* line(L, cast, DEFEAT.k3a);
  yield* line(L, null, DEFEAT.k3b);
  // К4: Пастила
  yield one(L, cast.pos('pastila'), spot, 2.0, -0.5);
  yield* line(L, cast, DEFEAT.k4);
  // К3 again: «Спросите Ноки…» — and the squeak
  yield L.shot(spot.clone().add(V(-2.6, 1.3, 2.4)), spot.clone().add(V(0.5, 0.7, 1.0)), 0.4);
  yield* line(L, null, DEFEAT.k3c);
  // К5: puff! — a little bat; the monocle drops and rings on the dome
  ambient(L, () => { L.fx.emit(spot.clone().add(V(0, 1, 0)), { count: 40, speed: [1, 4], life: [0.5, 1], size: [0.3, 0.6], size2: 2, colors: ['#3b2b52', '#5d4880', '#b31c3c', '#ffffff'], g: -1, drag: 2 }); audio.sfx('whoosh', { pitch: 1.6 }); });
  const mono = monocleProp();
  mono.position.copy(boss.rig.monocle.getWorldPosition(new THREE.Vector3()));
  L.scene.add(mono);
  yield tween(0.6, (k) => { boss.anim.small = k; });
  boss.anim.st = 'fly';
  const m0 = mono.position.clone(), m1 = V(spot.x + 0.3, c.y + 0.04, spot.z + 0.9);
  yield L.shot(m1.clone().add(V(1.2, 0.7, 1.4)), m1.clone().add(V(0, 0.3, 0)), 0.3);
  yield tween(0.55, (k) => { mono.position.lerpVectors(m0, m1, k); mono.position.y = m0.y + (m1.y - m0.y) * k * k; mono.rotation.x = k * 5; });
  ambient(L, () => { audio.sfx('clang', { pitch: 2.6, volume: 0.6 }); L.fx.sparks(m1.clone(), 6, ['#ffe14a', '#ffffff']); });
  yield tween(0.35, (k) => { mono.position.y = m1.y + Math.sin(k * Math.PI) * 0.18; mono.rotation.x = Math.PI / 2; });
  ambient(L, () => audio.sfx('clang', { pitch: 3.0, volume: 0.35 }));
  // off to the castle on its rock
  const castle = (L.refs.castleAt as THREE.Vector3 | undefined) ?? V(-210, 80, -330);
  const from = boss.pos.clone();
  const far = from.clone().lerp(castle, 0.25);
  yield all(L.shot(V(c.x + 3, c.y + 2.2, c.z + 8), far, 2.4), tween(2.4, (k) => { boss.pos.lerpVectors(from, far, k); boss.pos.y += Math.sin(k * Math.PI * 6) * 0.3; boss.yaw = Math.atan2(far.x - from.x, far.z - from.z); }, ease.inOut));
  boss.root.visible = false;
  // К6: from above — the colour wave: roofs pink, lanterns lit
  if (L.authority) {
    for (const z of K.zones) if (z.state === 'grey') K.restoreZone(z.id);
    for (const l of K.lanterns) if (!l.lit) l.set(true);
  }
  boss.dark = 0;
  yield L.shot(V(c.x, c.y + 7, c.z + 18), V(c.x, c.y - 2, c.z - 4), 1.0);
  for (const k of CAST) cast.look(k, V(c.x, c.y, c.z + 30));
  yield* line(L, cast, DEFEAT.k6);
  // К7: Бублик's eyes — on the parapet, in a lantern's glow, a little shadow with a guitar waves… and is gone
  const a = Math.PI / 2 + 0.28;
  const rim = V(c.x + Math.sin(a) * (HALL.R - 0.25), c.y + 0.5, c.z + Math.cos(a) * (HALL.R - 0.25));
  const girl = new ShadowGirl(L);
  girl.waveOnWall(rim, V(-Math.sin(a), 0, -Math.cos(a)), 0.75);
  const bp = cast.pos('bublik');
  cast.look('bublik', rim);
  ambient(L, () => audio.sfx('menuSelect', { pitch: 0.5, volume: 0.35 }));
  yield L.shot(bp.clone().setY(bp.y + 1.0), rim.clone().add(V(0, 0.55, 0)), 0.6);
  yield* line(L, null, DEFEAT.k7);
  girl.hide();
  yield wait(0.5);
  // К8: Тоша and Бублик
  cast.look('tosha', rim);
  yield two(L, cast.pos('tosha'), bp, V(c.x - 6, c.y, c.z + 2), 1.8, 1);
  yield* lines(L, cast, DEFEAT.k8);
  girl.dispose();
  yield wait(0.2);
  // 5.8 follows (its own scene, so each fits the watchdog)
  if (L.authority) L.runGen((function* (): Script { yield wait(0.05); L.run('exit_fangs1_roofs'); })());
  yield wait(0.1);
}

/** the Count's monocle (falls on the dome in 5.7 and stays there) */
function monocleProp() {
  const g = new THREE.Group();
  const gold = new THREE.MeshToonMaterial({ color: '#e8c24a', emissive: '#806010', emissiveIntensity: 0.3 });
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.016, 8, 24), gold));
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.085, 20), new THREE.MeshBasicMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  g.add(glass);
  return g;
}

/** a black invitation card whose back shows the silver menu in the lantern's warmth (5.8 К2) */
function menuCard() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 170;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (k: number) => {
    const g = c.getContext('2d')!;
    g.fillStyle = '#16101e'; g.fillRect(0, 0, 256, 170);
    g.strokeStyle = '#9a9ab8'; g.lineWidth = 3; g.strokeRect(8, 8, 240, 154);
    g.globalAlpha = 0.25 + 0.75 * k;
    g.fillStyle = '#e8e8f8'; g.textAlign = 'center';
    g.font = '700 22px Rubik, sans-serif'; g.fillText('МЕНЮ', 128, 38);
    g.font = '400 17px Pangolin, sans-serif';
    ['Закуска — топи', 'Горячее — оранжерея', 'Десерт — перевал', 'Главное — Алая полночь'].forEach((s, i) => { g.globalAlpha = Math.max(0, Math.min(1, k * 4 - i)) ; g.fillText(s, 128, 68 + i * 25); });
    g.globalAlpha = 1;
    tex.needsUpdate = true;
  };
  draw(0);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.28), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  return { m, draw };
}

/** v2 5.8 exit_fangs1_roofs «Меню» — the menu shows on the invitation's back; then the castle tag (5.9) */
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
  const raw: Record<CastKind, THREE.Vector3> = { pastila: edge(-0.36), tosha: edge(-0.12), noki: edge(0.14), bublik: edge(0.4) };
  const pos = {} as Record<CastKind, THREE.Vector3>;
  for (const k of CAST) pos[k] = place(L, cast, k, raw[k], look, '5.8 ' + k, { wall: 0.9 });
  // К1: backs to the camera, the coloured quarter around, the grey town beyond
  yield L.shot(V(c.x, c.y + 3.2, c.z - 1.5), look, 0);
  yield* line(L, cast, ENDING.k1);
  // К2: the card in the warmth of the nearest lantern: silver lines come through
  let lan = R.arenaLanterns[0];
  for (const l of R.arenaLanterns) if (l.pos.distanceTo(pos.pastila) < lan.pos.distanceTo(pos.pastila)) lan = l;
  cast.look('pastila', lan.pos);
  const card = menuCard();
  const cp = pos.pastila.clone().lerp(lan.pos, 0.45).setY(c.y + 1.15);
  card.m.position.copy(cp);
  card.m.lookAt(cp.clone().add(V(-(lan.pos.z - pos.pastila.z), 0, lan.pos.x - pos.pastila.x).normalize()));
  L.scene.add(card.m);
  const n = V(-(lan.pos.z - pos.pastila.z), 0, lan.pos.x - pos.pastila.x).normalize();
  const camP = cp.clone().addScaledVector(n, 1.0).add(V(0, 0.15, 0));
  card.m.lookAt(camP);
  yield L.shot(camP, cp, 0.5);
  ambient(L, () => audio.sfx('artifact', { pitch: 0.9 }));
  L.runGen((function* (): Script { yield tween(3.0, (k) => card.draw(k)); })());
  yield* line(L, null, ENDING.k2);
  yield showCard(L, MENU_CARD.title, MENU_CARD.desc, { icon: 'menu', secs: 4 });
  card.m.removeFromParent();
  // turn round to the others
  const mid = CAST.reduce((s, k) => s.add(pos[k]), V(0, 0, 0)).multiplyScalar(0.25).setY(c.y);
  const inward = V(c.x, c.y, c.z);
  for (const k of CAST) cast.look(k, mid.clone().lerp(inward, 0.3));
  const face = (k: CastKind) => one(L, pos[k], inward, 2.2, k === 'noki' ? -0.6 : 0.6, 0.45);
  yield face('pastila'); yield* line(L, cast, ENDING.k3);
  yield face('noki'); yield* line(L, cast, ENDING.k4);
  yield face('pastila'); yield* lines(L, cast, ENDING.k3b);
  yield face('noki'); yield* line(L, cast, ENDING.k4b);
  const tb = () => two(L, pos.tosha, pos.bublik, inward, 2.0, 1, 0.45);
  yield tb(); yield* line(L, cast, ENDING.k5a);
  yield face('noki'); yield* line(L, cast, ENDING.k4c);
  yield tb(); yield* line(L, cast, ENDING.k5b[0]);
  yield face('noki'); yield* line(L, cast, ENDING.k5b[1]);
  yield tb(); yield* line(L, cast, ENDING.k5b[2]);
  // К6: Тоша and Ноки
  cast.look('tosha', pos.noki); cast.look('noki', pos.tosha);
  yield two(L, pos.tosha, pos.noki, inward, 1.8, 1, 0.6);
  yield* lines(L, cast, ENDING.k6);
  yield wait(0.5);
  // 5.9 the castle tag (its own scene; it ends the level)
  if (L.authority) L.runGen((function* (): Script { yield wait(0.05); L.run('fangs1_tag'); })());
  yield wait(0.1);
}

/** v2 5.9 fangs1_tag «Тем временем в замке» — the little bat flies into the castle's window; the King off screen */
function* tag(L: Level3D): Script {
  exitStart(L);
  try {
    const R = roofs(L);
    L.cutscene(true);
    R?.cast.hideAll();
    yield* castleTag(L, TAG, { say: (w, s, e) => say(L, w as Spk, s, e), mouse: 'netopyr', shot2At: 2, tugAt: 3, clang: true });
    yield wait(0.4);
  } finally {
    // (also when the watchdog / the host force-ends it: the episode is won all the same)
    finish(L);
  }
}

export const FANGS1_SCRIPTS: Record<string, (L: Level3D) => Script> = {
  fangs1_intro: intro,
  exit_fangs1_town: exitTown,
  fangs1_roofs_intro: roofsIntro,
  fangs1_boss_intro: bossIntro,
  fangs1_boss_retry: bossRetry,
  fangs1_boss_defeat: bossDefeat,
  exit_fangs1_roofs: ending,
  fangs1_tag: tag,
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

void JUDGE_AT;
