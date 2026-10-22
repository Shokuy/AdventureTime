import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { choose, clamp, ease, lerp, rand, W, H } from '../../../../engine/util';
import { type Script, type Waiter, wait, tween, all, until } from '../../../../game/coroutine';
import type { Level3D, Npc3 } from '../../level';
import { net } from '../../../../net/session';
import { G, part, Mats } from '../../../models/kit';
import { noOutline } from '../../../gfx';
import { vamp, ambient } from '../vampires';
import { safeMark } from '../shared/safeMark';
import { F5, type Line } from './lines';
import { say, speakingNow, type SpeakerId } from './speech';
import { Midnight3, ROOF, CANNON_AT, PASTILA_AT } from './boss';
import { createSunCannon, girlTex, type CannonRig } from './kingRig';
import { createMouse, type MouseKind, type MouseAnim } from './rigs';
import { discAt, landingSpot, SPOTS } from './level';
import { Daybreak, Fade, ItemCard, ShadowGirl, createMirror, buildSquare, SQUARE, type Square } from './finale';
import { buildFeast, SEAT, PIE_AT, TABLE, type Feast } from './feast';
import type { Rig } from '../../../models/rig';

/*
 * The scenes of «Замок Полночь» (docs/script-fangs-v2.md §9) and the level's hook. Co-op: the host starts a scene and
 * every machine plays it (lines advance by themselves); presentation (camera, the story cast, props) runs everywhere,
 * world actions (the boss starting, the level's end) only where L.authority is true. «Сюжетный состав» (GDD §8): the
 * four heroes of every scene are story NPCs on marks (castScenes hides the players' figures while the bars are down).
 * Long scenes are split so none of them comes near the co-op watchdog (120 s): the cold open and the gate are two, the
 * spoon and Ноки's shadow are two, the morning and the letter are two (the host chains them).
 * v2: the cold open (the King alone at his table for a hundred, a stolen pie, «Ничего.»), the dinner table on the roof,
 * the mice heckling from the parapet in phase 2, Ноки's shadow at the cannon (boss.ts), no killing blow — a spoon.
 */

type CastKind = 'tosha' | 'bublik' | 'noki' | 'pastila';
const CAST: CastKind[] = ['tosha', 'bublik', 'noki', 'pastila'];
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ───────────────────────── the story cast ─────────────────────────
class Cast {
  n: Record<CastKind, Npc3>;
  constructor(private L: Level3D) {
    this.n = {} as Record<CastKind, Npc3>;
    for (const k of CAST) { const npc = L.npc(k, 0, -200, 0, 0); npc.root.visible = false; this.n[k] = npc; }
    // Ноки has no shadow until the end (bible §1.7)
    this.shadow('noki', false);
  }
  shadow(k: CastKind, on: boolean) { this.n[k].root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = on; }); }
  at(k: CastKind, x: number, y: number, z: number, yaw: number, state = 'idle', expr = 'normal') {
    const n = this.n[k];
    n.root.position.set(x, y, z); n.root.rotation.y = yaw; n.root.visible = true;
    n.anim.state = state; n.anim.expr = expr; n.anim.attack = null; n.anim.speed = 0;
    return n;
  }
  /** (v2 §0) a new mark through safeMark: on the ground, clear of walls, props and the other marks */
  place(k: CastKind, x: number, y: number, z: number, yaw: number, state = 'idle', expr = 'normal') {
    const p = safeMark(this.L, V3(x, y, z), { label: 'fangs5 ' + k });
    return this.at(k, p.x, p.y, p.z, yaw, state, expr);
  }
  face(k: CastKind, x: number, z: number) { const r = this.n[k].root; r.rotation.y = Math.atan2(x - r.position.x, z - r.position.z); }
  hide(...ks: CastKind[]) { for (const k of ks.length ? ks : CAST) this.n[k].root.visible = false; }
  /** walk a figure to (x, z) over `secs` (on the ground under it: up a step, down a step) */
  walk(k: CastKind, x: number, z: number, secs: number): Waiter {
    const n = this.n[k];
    const from = n.root.position.clone();
    n.root.rotation.y = Math.atan2(x - from.x, z - from.z);
    n.anim.state = 'run'; n.anim.speed = 0.5;
    return tween(secs, (q) => {
      const p = n.root.position;
      p.x = lerp(from.x, x, q); p.z = lerp(from.z, z, q);
      const gy = this.L.phys.groundAt(p.x, p.z, p.y + 0.9, 0.25);
      if (gy > p.y - 3) p.y = gy;
      if (q >= 1) { n.anim.state = 'idle'; n.anim.speed = 0; }
    });
  }
  head(k: CastKind, dy = 0.95) { return this.n[k].root.position.clone().setY(this.n[k].root.position.y + dy); }
}

/** (v2 §9.5) the little things in hands: Пастила's charger pot with the last of the syrup, Бублик's spoon */
interface Props { pot: THREE.Group; spoon: THREE.Group; drop: THREE.Mesh }
function buildProps(L: Level3D): Props {
  const M = new Mats();
  const pot = new THREE.Group();
  part(pot, G.sphere(), M.get('#c87a3a'), [0, 0.1, 0], [0.16, 0.12, 0.16]);
  part(pot, G.torus(0.14, 0.02, 6, 18), M.get('#e8a050'), [0, 0.19, 0], 1, [Math.PI / 2, 0, 0]);
  const syrup = part(pot, G.cyl(), new THREE.MeshBasicMaterial({ color: '#ffc830' }), [0, 0.16, 0], [0.12, 0.01, 0.12]);
  noOutline(syrup);
  const spoon = new THREE.Group();
  part(spoon, G.cyl(), M.get('#d8d8e4'), [0, 0, -0.14], [0.012, 0.28, 0.012], [Math.PI / 2, 0, 0]);
  part(spoon, G.sphere(), M.get('#d8d8e4'), [0, 0, 0.02], [0.05, 0.018, 0.065]);
  const drop = new THREE.Mesh(G.sphere(), new THREE.MeshBasicMaterial({ color: '#ffc830' }));
  drop.scale.set(0.035, 0.014, 0.045); drop.position.set(0, 0.012, 0.02); drop.visible = false; noOutline(drop);
  spoon.add(drop);
  spoon.scale.setScalar(1.7);
  pot.visible = spoon.visible = false;
  L.scene.add(pot, spoon);
  return { pot, spoon, drop };
}

/** (v2 §9.6) the memory flash: the girl with the guitar before the King, holding out her hand, against the moon */
class MemoryFlash {
  t = -1;
  constructor(L: Level3D) {
    L.updaters.push((_t, dt) => { if (this.t >= 0) { this.t += dt; if (this.t > 1.25) this.t = -1; } });
    L.overlayDraw.push((ctx) => this.draw(ctx));
  }
  show() { this.t = 0; }
  private draw(ctx: CanvasRenderingContext2D) {
    if (this.t < 0) return;
    const a = clamp(Math.min(this.t / 0.15, (1.25 - this.t) / 0.3), 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    const fx = 70, fy = 50, fw = W - 140, fh = H - 100;
    const g = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.5, fw * 0.7);
    g.addColorStop(0, '#f4c8b0'); g.addColorStop(0.35, '#c8506a'); g.addColorStop(1, '#3a1022');
    ctx.fillStyle = g; ctx.fillRect(fx, fy, fw, fh);
    // the moon
    ctx.fillStyle = '#ffe8d8'; ctx.beginPath(); ctx.arc(W / 2, H * 0.4, fh * 0.32, 0, Math.PI * 2); ctx.fill();
    // the hill / the old town's roofs
    ctx.fillStyle = '#1a0812';
    ctx.beginPath(); ctx.moveTo(fx, fy + fh); ctx.lineTo(fx, fy + fh * 0.8);
    for (let i = 0; i <= 12; i++) { const x = fx + (fw / 12) * i; ctx.lineTo(x, fy + fh * (0.78 - (i % 3 === 1 ? 0.07 : 0.02))); }
    ctx.lineTo(fx + fw, fy + fh); ctx.closePath(); ctx.fill();
    // the King: tall, the crown, the cloak
    const kx = W / 2 + 120, ky = fy + fh * 0.8;
    ctx.beginPath(); ctx.moveTo(kx - 70, ky); ctx.lineTo(kx - 26, ky - 300); ctx.lineTo(kx + 26, ky - 300); ctx.lineTo(kx + 70, ky); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(kx, ky - 330, 30, 0, Math.PI * 2); ctx.fill();
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(kx + i * 12 - 6, ky - 352); ctx.lineTo(kx + i * 12, ky - 378 - (i === 0 ? 10 : 0)); ctx.lineTo(kx + i * 12 + 6, ky - 352); ctx.fill(); }
    ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a0812';
    ctx.beginPath(); ctx.moveTo(kx - 22, ky - 270); ctx.lineTo(kx - 80, ky - 210); ctx.stroke();
    // the girl with the guitar, holding out her hand
    const img = girlTex().image as CanvasImageSource;
    const gx = W / 2 - 130, gy = ky - 200;
    ctx.save(); ctx.translate(gx, gy); ctx.scale(-1, 1); ctx.drawImage(img, -66, 0, 132, 198); ctx.restore();
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(gx + 14, gy + 74); ctx.lineTo(gx + 74, gy + 60); ctx.stroke();
    // the white frame
    ctx.lineWidth = 14; ctx.strokeStyle = '#ffffff'; ctx.strokeRect(fx, fy, fw, fh);
    ctx.restore();
  }
}

interface Refs {
  cast: Cast; boss: Midnight3; cannon: CannonRig; cart: CannonRig; day: Daybreak; fade: Fade; card: ItemCard; girl: ShadowGirl;
  mice: { kind: MouseKind; rig: Rig<MouseAnim>; anim: MouseAnim; g: THREE.Group }[];
  square: Square; mirror: THREE.Group; gateEyes: THREE.Group;
  feast: Feast; props: Props; memory: MemoryFlash;
  /** the mice are on the parapet (phase 2 on): positions are set by the updater */
  parapet: boolean;
}
const R = (L: Level3D) => L.refs.f5 as Refs;

/** a line, and its speaker's figure faces the camera a little (the mouth moves by speakingNow) */
function line(L: Level3D, l: Line): Waiter { return say(L, l[0], l[1], l[2]); }
function mine(L: Level3D, f: () => void) { ambient(L, f); }
/** the camera to a spot looking at a point (instant cut by default) */
const shot = (L: Level3D, from: THREE.Vector3, to: THREE.Vector3, d = 0) => L.shot(from, to, d);
/** a face close-up of a cast figure: the camera in front of it (along its facing) */
function faceShot(L: Level3D, k: CastKind, dist = 2.3, side = 0.6, d = 0) {
  const c = R(L).cast.n[k].root;
  const yaw = c.rotation.y;
  const f = V3(Math.sin(yaw), 0, Math.cos(yaw)), s = V3(Math.cos(yaw), 0, -Math.sin(yaw));
  const head = c.position.clone().setY(c.position.y + (k === 'bublik' ? 0.7 : 0.95));
  return L.shot(head.clone().addScaledVector(f, dist).addScaledVector(s, side).setY(head.y + 0.25), head, d);
}
function endScene(L: Level3D, keep: CastKind[] = []) {
  const r = R(L);
  r.cast.hide(...(['tosha', 'bublik', 'noki', 'pastila'] as CastKind[]).filter((k) => !keep.includes(k)));
}
function finish(L: Level3D) { if (L.authority) L.endLevel(); }
function exitStart(L: Level3D) { if (L.nl) { L.complete = true; L.exitWait = null; } }
/** the host starts the next scene once this one is over (each stays under the co-op watchdog) */
function chain(L: Level3D, next: string) {
  if (L.authority) L.runGen((function* () { yield wait(0.1); yield until(() => !L.storyOn()); if (!L.seen.has(next)) L.run(next); })());
}
/** the King's head (world) */
function kingHead(L: Level3D) { const v = new THREE.Vector3(); R(L).boss.rig.head.getWorldPosition(v); return v; }
/** a close shot of the King's face from `dist` along his facing (+ side), looking at his head */
function kingFace(L: Level3D, dist = 2.4, side = 0.5, dy = 0.15, d = 0) {
  const b = R(L).boss, h = kingHead(L), yaw = b.root.rotation.y;
  return shot(L, h.clone().add(V3(Math.sin(yaw) * dist + Math.cos(yaw) * side, dy, Math.cos(yaw) * dist - Math.sin(yaw) * side)), h, d);
}

// ═════════════════════════════ the scenes ═════════════════════════════
const scripts: Record<string, (L: Level3D) => Script> = {
  // 9.0 — the cold open (before the title): the King alone at his table for a hundred, Вторник's pie. «Ничего.»
  *fangs5_cold(L) {
    const r = R(L), boss = r.boss, f = r.feast;
    L.cutscene(true);
    mine(L, () => audio.stopMusic(0.4));
    kingAtTable(boss);
    f.hold = true; f.setAway(0);
    f.pie.grey(0);
    const girlM = (boss.rig.girl as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material;
    // [К1] the table runs into the moon
    // (high over his shoulder: the throne's back would hide him from straight behind)
    yield shot(L, V3(2.4, ROOF.y + 4.6, SEAT.z + 5.4), V3(0, ROOF.y + 0.6, TABLE.z1 - 6));
    mine(L, () => audio.sfx('whoosh', { pitch: 0.4, volume: 0.35 }));
    yield shot(L, V3(1.8, ROOF.y + 4.0, SEAT.z + 4.0), V3(0, ROOF.y + 5, TABLE.z1 - 26), 3.4);
    // [К2] the place cards, a slow ride along the table (over the backs of the empty chairs)
    yield shot(L, V3(1.75, ROOF.y + 2.45, TABLE.z0 - 0.8), V3(0.25, ROOF.y + 0.9, TABLE.z0 - 2.4));
    yield shot(L, V3(1.75, ROOF.y + 2.45, TABLE.z0 - 9.5), V3(0.25, ROOF.y + 0.9, TABLE.z0 - 11.1), 3.2);
    // [К3] the King at the head of the table
    yield kingFace(L, 3.2, 0.9, 0.0);
    yield wait(0.9);
    // [К4] the knife goes into the pie — and the pie greys from the knife to the edge
    yield shot(L, PIE_AT.clone().add(V3(0.75, 0.55, -0.55)), PIE_AT.clone().add(V3(0, 0.05, 0)));
    boss.anim.st = 'cut';
    const kn = f.knife;
    kn.visible = true;
    const k0 = V3(PIE_AT.x + 0.12, PIE_AT.y + 0.6, PIE_AT.z + 0.05), k1 = V3(PIE_AT.x + 0.12, PIE_AT.y + 0.22, PIE_AT.z + 0.05);
    kn.rotation.set(0, 0, 0.15);
    yield tween(0.7, (k) => { kn.position.set(k0.x, lerp(k0.y, k1.y, ease.inOut(k)) - f.root.position.y, k0.z); });
    mine(L, () => audio.sfx('clang', { pitch: 1.8, volume: 0.15 }));
    f.pie.cutAt(0.12, 0.05);
    yield tween(2.2, (k) => f.pie.grey(k));
    f.pie.grey(1);
    kn.visible = false;
    // [К5] he chews. Long.
    boss.anim.st = 'eat';
    yield kingFace(L, 1.5, 0.25, 0.05);
    let chew = 0;
    yield tween(1.6, (_k) => { chew += 0.016; boss.talkT = Math.sin(chew * 9) > 0 ? 0.05 : 0; });
    boss.anim.st = 'sit';
    yield kingLine(L, F5.cold[0]);
    // [К6] he looks at the moon
    boss.anim.look = 1;
    // (from the front-side, low: his lifted face; from behind the throne's back hid him)
    { const h = kingHead(L); yield shot(L, V3(2.5, ROOF.y + 1.25, SEAT.z - 1.9), h.clone().add(V3(0, 0.15, 0))); }
    yield kingLine(L, F5.cold[1]);
    yield kingLine(L, F5.cold[2]);
    boss.anim.look = 0;
    // [К7] the cloak: the little shadow of a girl stretches to the edge of the roof, down, to the bridge
    yield shot(L, V3(0.9, ROOF.y + 1.9, SEAT.z + 2.4), V3(0, ROOF.y + 1.3, SEAT.z));
    yield tween(1.0, (k) => { girlM.opacity = k * 0.95; });
    const gs = r.girl.ground, gm = gs.material as THREE.MeshBasicMaterial;
    gs.visible = true; gs.position.set(SEAT.x + 0.15, ROOF.y + 0.03, SEAT.z + 0.4); gs.rotation.y = Math.PI; gs.scale.set(1, 1, 0.3);
    const edge = ROOF.z + ROOF.r + 1.6 - gs.position.z;
    mine(L, () => audio.sfx('mist', { pitch: 1.4, volume: 0.4 }));
    yield all(
      shot(L, V3(1.2, ROOF.y + 5.5, SEAT.z - 2), V3(0, ROOF.y - 4, ROOF.z + ROOF.r + 12), 2.6),
      tween(2.6, (k) => { gm.opacity = 0.8 * Math.min(1, k * 3); gs.scale.set(1, 1, lerp(0.3, edge / 2.4, ease.inOut(k))); girlM.opacity = 0.95 * (1 - k); }),
    );
    mine(L, () => audio.playMusic('castle'));
    yield kingLine(L, F5.cold[3]);
    yield tween(0.6, (k) => { gm.opacity = 0.8 * (1 - k); });
    gs.visible = false; gs.scale.set(1, 1, 1); girlM.opacity = 0;
    f.hold = false;
    // the title, the bridge: the next scene (the host starts it for everyone)
    chain(L, 'fangs5_intro');
  },

  // 9.1 — the bridge, the gate opens by itself
  *fangs5_intro(L) {
    const r = R(L), c = r.cast;
    L.cutscene(true);
    L.hud.showChapter(F5.chapter.title, F5.chapter.sub);
    c.at('tosha', -0.9, 0, 72.4, Math.PI); c.at('bublik', 0.8, 0, 73, Math.PI, 'idle', 'scared'); c.at('noki', -1.9, 0, 71.2, Math.PI); c.at('pastila', 1.9, 0, 75.6, Math.PI);
    r.cart.root.visible = true; r.cart.root.position.set(1.9, 0, 74); r.cart.root.rotation.y = Math.PI;
    yield shot(L, V3(-17, 4, 106), V3(0, 18, 10));
    yield all(shot(L, V3(-12, 3, 98), V3(0, 19, 6), 5), line(L, F5.intro[0]));
    yield faceShot(L, 'bublik', 2.0, 0.5);
    yield line(L, F5.intro[1]);
    yield shot(L, V3(4.6, 1.6, 71.2), V3(1.9, 1, 74.6));
    yield line(L, F5.intro[2]);
    c.n.pastila.anim.expr = 'scared';
    yield faceShot(L, 'pastila', 2.2, -0.4);
    yield line(L, F5.intro[3]);
    c.face('noki', 1.9, 75.6);
    yield faceShot(L, 'noki', 2.3, -0.5);
    yield line(L, F5.intro[4]);
    c.n.pastila.anim.expr = 'normal';
    yield faceShot(L, 'tosha', 2.2, 0.5);
    c.n.tosha.anim.expr = 'angry';
    yield line(L, F5.intro[5]);
    // the gate opens by itself
    yield shot(L, V3(0.4, 2.2, 64), V3(0, 3.2, 46));
    mine(L, () => audio.sfx('door', { pitch: 0.5 }));
    const g = L.refs.f5gate as { leaves: THREE.Group[]; col: { active?: boolean } };
    yield all(tween(2.2, (k) => { g.leaves[0].rotation.y = -1.6 * ease.inOut(k); g.leaves[1].rotation.y = 1.6 * ease.inOut(k); }), wait(0.4));
    g.col.active = false;
    r.gateEyes.visible = true;
    c.n.bublik.anim.expr = 'scared';
    yield line(L, F5.intro[6]);
    r.gateEyes.visible = false;
    yield faceShot(L, 'bublik', 2.0, -0.4);
    yield line(L, F5.intro[7]);
    yield shot(L, V3(-0.5, 1.8, 77.5), V3(0, 2.5, 60));
    c.n.noki.anim.expr = 'angry';
    yield line(L, F5.intro[8]);
    // the four walk to the gate; Пастила wheels the cannon in
    const cart0 = r.cart.root.position.clone();
    yield all(c.walk('tosha', -0.9, 60, 2.2), c.walk('bublik', 0.8, 60.6, 2.2), c.walk('noki', -1.9, 59, 2.1), c.walk('pastila', 1.9, 63, 2.2),
      tween(2.2, (k) => { r.cart.root.position.z = lerp(cart0.z, 61.4, k); }));
    r.cart.root.visible = false;
    endScene(L);
    yield L.camBack(0.7);
    L.cutscene(false);
    audio.playMusic('castle');
  },

  // 9.2.1 — Ноки's portrait, and the servants as they were before the deal
  *fangs5_portraits(L) {
    const c = R(L).cast;
    L.cutscene(true);
    c.at('noki', 5.5, 0, -6, Math.PI / 2); c.at('pastila', 4.3, 0, -4.3, Math.PI / 2 + 0.55, 'idle', 'surprised'); c.at('bublik', 5.3, 0, -7.4, Math.PI / 2 - 0.5); c.at('tosha', 3.0, 0, -5.8, Math.PI / 2);
    // (Бублик by Ноки: at (4.2, −7.8) he stood inside the hall's column at (4.6, −8), his close-up shot from behind it)
    yield shot(L, V3(3.8, 2.2, -7.3), V3(7.4, 3.9, -6));
    yield shot(L, V3(4.6, 2.0, -7.0), V3(7.4, 4.1, -6), 2.5);
    yield faceShot(L, 'pastila', 2.2, 0.4);
    yield line(L, F5.portraits[0]);
    c.n.noki.anim.expr = 'sad';
    // her profile and the portrait together
    yield shot(L, V3(5.4, 1.45, -9.4), V3(6.6, 1.45, -6));
    yield line(L, F5.portraits[1]);
    c.face('noki', 3.0, -5.8);
    yield faceShot(L, 'bublik', 2.0, 0.4);
    yield line(L, F5.portraits[2]);
    c.n.noki.anim.expr = 'happy';
    yield faceShot(L, 'noki', 2.3, 0.4);
    yield line(L, F5.portraits[3]);
    // [К4] Тоша's eyes: along the portraits of the servants (the tailor, the frog, the eared boy)
    c.face('tosha', 7.4, -1.5);
    yield shot(L, V3(3.0, 1.75, -5.8), V3(7.4, 3.6, -1.5));
    yield all(shot(L, V3(3.0, 1.75, -5.8), V3(7.4, 3.6, -14.5), 4.2), line(L, F5.portraits[4]));
    // [К5] Пастила
    c.face('pastila', 7.4, -10);
    yield faceShot(L, 'pastila', 2.2, -0.4);
    c.n.pastila.anim.expr = 'sad';
    yield line(L, F5.portraits[5]);
    endScene(L);
    yield L.camBack(0.6);
    L.cutscene(false);
  },

  // 9.2.2 — the library (two lines)
  *fangs5_library(L) {
    const c = R(L).cast;
    L.cutscene(true);
    c.at('bublik', -0.8, 0, -40.2, Math.PI, 'idle', 'surprised'); c.at('tosha', 0.9, 0, -40.6, Math.PI, 'idle', 'surprised');
    yield shot(L, V3(0.2, 2.0, -37.2), V3(-10, 4.5, -52));
    yield shot(L, V3(0.4, 2.4, -37.6), V3(-12, 5, -50), 2.2);
    c.face('bublik', 0.9, -40.6);
    yield faceShot(L, 'bublik', 2.0, -0.5);
    yield line(L, F5.library[0]);
    c.n.tosha.anim.expr = 'angry';
    yield faceShot(L, 'tosha', 2.2, 0.5);
    yield line(L, F5.library[1]);
    endScene(L);
    yield L.camBack(0.5);
    L.cutscene(false);
  },

  // 9.2.3 — the five little bats on the stairs (v2: the twins look at each other)
  *fangs5_stairs(L) {
    const r = R(L), c = r.cast;
    L.cutscene(true);
    const l = discAt(SPOTS.stairsLanding);
    const at = (i: number, da: number) => { const d = discAt(i); const a = d.a + da; return V3(Math.sin(a) * 7.4, d.y, -86 + Math.cos(a) * 7.4); };
    const up = at(SPOTS.stairsLanding + 2, 0);
    // (Тоша a little back from the next step: at +0.6 her head was inside its disc)
    const marks: [CastKind, number, number][] = [['tosha', 0.15, -0.2], ['bublik', 0.5, 0.2], ['noki', 0.7, -0.7], ['pastila', 1.0, 0.5]];
    for (const [k, kk, da] of marks) { const p = landingSpot(SPOTS.stairsLanding, kk, da); c.at(k, p.x, l.y, p.z, Math.atan2(up.x - p.x, up.z - p.z)); }
    // the mice on the next steps, wings spread
    r.parapet = false;
    r.mice.forEach((m, i) => {
      const p = at(SPOTS.stairsLanding + 1 + Math.floor(i / 2), (i % 2 ? 0.16 : -0.16) + (i === 4 ? 0.0 : 0));
      m.g.position.set(p.x, p.y + 0.02 + (i === 4 ? 0.2 : 0), p.z);
      m.g.rotation.y = Math.atan2(l.x - p.x, l.z - p.z);
      m.g.visible = true;
    });
    const mid = r.mice[2].g.position.clone();
    const lp = at(SPOTS.stairsLanding, 0);
    // (from the open shaft, looking out at the steps: no disc in the way)
    const fromShaft = (p: THREE.Vector3, k: number, dy: number) => { const dx = p.x, dz = p.z + 86, d = Math.hypot(dx, dz) || 1; return V3(dx / d * (d - k), p.y + dy, -86 + dz / d * (d - k)); };
    yield shot(L, fromShaft(mid, 5.2, 1.4), mid.clone().setY(mid.y + 0.4));
    const twinFace = () => { const a = r.mice[3].g, b = r.mice[4].g; a.rotation.y = Math.atan2(b.position.x - a.position.x, b.position.z - a.position.z); b.rotation.y = Math.atan2(a.position.x - b.position.x, a.position.z - b.position.z); };
    for (let i = 0; i < 5; i++) {
      const m = r.mice[i];
      // the twins: each looks at the other (they can, now)
      if (i === 3) twinFace();
      yield shot(L, fromShaft(m.g.position, 2.6, 0.7), m.g.position.clone().setY(m.g.position.y + 0.35), i ? 0.35 : 0);
      yield line(L, F5.stairs[i]);
    }
    c.n.bublik.anim.expr = 'happy'; c.n.bublik.anim.state = 'cheer';
    yield faceShot(L, 'bublik', 2.0, 0.4);
    yield line(L, F5.stairs[5]);
    c.n.bublik.anim.state = 'idle';
    yield faceShot(L, 'noki', 2.3, -0.4);
    yield line(L, F5.stairs[6]);
    // they step over the mice; the mice squeak after them
    yield shot(L, lp.clone().setY(l.y + 3.2).lerp(V3(0, l.y + 3.2, -86), 0.3), mid, 0.4);
    for (const m of r.mice) m.anim.squeak = 1;
    mine(L, () => { audio.sfx('batScreech', { pitch: 2.2, volume: 0.4 }); });
    // (up the steps one by one — a straight line to the fourth step ran through the stair and over the shaft)
    const upSteps = (k: CastKind, i: number): Waiter => {
      let j = 0, w: Waiter | null = null;
      return { update: (dt) => {
        while (!w || w.update(dt)) {
          if (++j > 4) return true;
          const d = discAt(SPOTS.stairsLanding + j);
          w = c.walk(k, d.x + Math.cos(i * 1.6) * 0.6, d.z + Math.sin(i * 1.6) * 0.6, 0.4);
          dt = 0;
        }
        return false;
      } };
    };
    yield all(...marks.map(([k], i) => upSteps(k, i)), tween(1.6, (k) => { for (const m of r.mice) m.anim.hop = k; }));
    // Шуршик, after them
    const sh = r.mice[2].g.position;
    yield shot(L, fromShaft(sh, 2.4, 0.6), sh.clone().setY(sh.y + 0.35));
    yield line(L, F5.stairs[7]);
    endScene(L);
    // (the mice flutter off up the shaft)
    L.runGen((function* () {
      const p0 = r.mice.map((m) => m.g.position.clone());
      yield tween(2.5, (k) => r.mice.forEach((m, i) => { m.g.position.set(p0[i].x * (1 - k * 0.8), p0[i].y + k * 9 + Math.sin(k * 9 + i) * 0.4, -86 + (p0[i].z + 86) * (1 - k * 0.8)); }));
      if (!r.parapet) for (const m of r.mice) m.g.visible = false;
    })());
    yield L.camBack(0.5);
    L.cutscene(false);
  },

  // 9.3 — dinner: the King gets up from his table for a hundred
  *fangs5_boss_intro(L) {
    const r = R(L), c = r.cast, boss = r.boss, f = r.feast;
    L.cutscene(true);
    // (the little bats' scene, if it was skipped, stays skipped: no story beat behind the fight)
    for (const tr of L.triggers) if (tr.script === 'fangs5_stairs') tr.fired = true;
    if (L.authority) { const i = L.checkpoints.findIndex((k) => k.pos.y > ROOF.y - 1); if (i >= 0) L.lightCandle(i); }
    boss.manual = true;
    kingAtTable(boss);
    f.hold = true; f.setAway(0); f.pie.grey(1);
    audio.playMusic('castle');
    // the four 6 m south of him, Ноки a step ahead
    const kz = SEAT.z + 0.4;
    c.place('noki', -0.4, ROOF.y, kz + 4.6, Math.PI, 'idle', 'angry');
    c.place('tosha', -1.6, ROOF.y, kz + 6, Math.PI);
    c.place('bublik', 0.9, ROOF.y, kz + 6.2, Math.PI);
    c.place('pastila', 2.2, ROOF.y, kz + 6.6, Math.PI);
    // [К1] he gets up from the table
    yield shot(L, V3(2.2, ROOF.y + 2.0, kz + 9.5), V3(0, ROOF.y + 1.6, kz - 2));
    yield wait(0.4);
    mine(L, () => audio.sfx('door', { pitch: 1.6, volume: 0.25 }));
    boss.anim.st = 'idle';
    const s0 = boss.root.position.clone();
    yield tween(1.0, (k) => { boss.root.position.set(s0.x, ROOF.y, lerp(s0.z, kz, k)); boss.root.rotation.y = lerp(Math.PI, Math.PI * 2, ease.inOut(k)); });
    boss.root.rotation.y = 0;
    yield kingLine(L, F5.bossIntro[0]);
    // [К2] the cloak: in its folds — the tailor, the frog, the eared boy, the twins… and the girl with the guitar
    yield shot(L, V3(0.9, ROOF.y + 2.2, kz - 2.6), V3(0, ROOF.y + 1.7, kz), 0);
    yield shot(L, V3(0.5, ROOF.y + 2.0, kz - 2.0), V3(0, ROOF.y + 1.5, kz), 1.8);
    boss.anim.st = 'talk'; boss.anim.stir = 1;
    yield tween(1.6, (k) => { (boss.rig.girl as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = Math.sin(k * Math.PI) * 0.9; });
    boss.anim.st = 'idle'; boss.anim.stir = 0.2;
    // [К3] Ноки and the King
    yield shot(L, V3(5.2, ROOF.y + 1.9, kz + 3.0), V3(-0.3, ROOF.y + 1.5, kz + 2.4));
    yield line(L, F5.bossIntro[1]);
    // [К4] the King
    yield kingFace(L, 2.6, 0.5);
    yield kingLine(L, F5.bossIntro[2]);
    yield kingLine(L, F5.bossIntro[3]);
    // [К5] Тоша
    c.n.tosha.anim.expr = 'angry';
    yield faceShot(L, 'tosha', 2.3, 0.4);
    yield line(L, F5.bossIntro[4]);
    // [К6] the King against the moon, the light on his face goes out
    yield shot(L, V3(0.6, ROOF.y + 1.0, kz + 3.2), kingHead(L).add(V3(0, 0.3, 0)));
    boss.anim.look = 0.6;
    yield kingLine(L, F5.bossIntro[5]);
    boss.anim.look = 0;
    yield kingLine(L, F5.bossIntro[6]);
    // [К7] Бублик
    c.n.bublik.anim.expr = 'angry';
    yield faceShot(L, 'bublik', 2.0, 0.4);
    yield line(L, F5.bossIntro[7]);
    // [К4] the King
    yield kingFace(L, 2.4, -0.5);
    yield kingLine(L, F5.bossIntro[8]);
    // [К8] Пастила goes to the cannon
    yield shot(L, V3(PASTILA_AT.x + 3.4, ROOF.y + 1.8, PASTILA_AT.z + 1.8), V3(PASTILA_AT.x - 0.6, ROOF.y + 1.0, PASTILA_AT.z - 0.2));
    yield all(c.walk('pastila', PASTILA_AT.x, PASTILA_AT.z, 1.6), line(L, F5.bossIntro[9]));
    c.n.pastila.root.rotation.y = Math.PI;
    // [К9] the shadow sword
    yield shot(L, V3(0, ROOF.y + 2.6, kz + 10), V3(0, ROOF.y + 1.8, kz - 3));
    boss.anim.sword = 0;
    mine(L, () => audio.sfx('whoosh', { pitch: 0.5 }));
    boss.anim.st = 'cast';
    yield tween(0.7, (k) => { boss.anim.sword = k; });
    boss.anim.st = 'idle';
    yield kingLine(L, F5.bossIntro[10]);
    // the table: a shadow drags it to the north edge and it sinks into the roof
    mine(L, () => { audio.sfx('mist', { pitch: 0.6 }); audio.sfx('door', { pitch: 0.4, volume: 0.5 }); });
    yield tableAway(L, 1.4);
    boss.main.pos.set(0, ROOF.y, kz); boss.main.yaw = 0;
    startFight(L);
    endScene(L, ['pastila']);
    c.at('pastila', PASTILA_AT.x, ROOF.y, PASTILA_AT.z, Math.PI);
    yield L.camBack(0.7);
    L.cutscene(false);
    L.toast(F5.bossIntroToast);
    audio.playMusic('vampire_boss');
    if (L.authority) boss.start();
  },

  // after a restart (solo respawn / co-op team wipe)
  *fangs5_boss_retry(L) {
    const r = R(L), boss = r.boss;
    L.cutscene(true);
    boss.manual = true;
    kingAtTable(boss);
    r.feast.hold = true; r.feast.setAway(0); r.feast.pie.grey(1);
    const kz = SEAT.z + 0.4;
    yield shot(L, V3(1.6, ROOF.y + 2.0, kz + 4.4), V3(0, ROOF.y + 1.6, kz - 1));
    yield wait(0.3);
    boss.anim.st = 'idle';
    const s0 = boss.root.position.clone();
    yield tween(0.8, (k) => { boss.root.position.set(s0.x, ROOF.y, lerp(s0.z, kz, k)); boss.root.rotation.y = lerp(Math.PI, Math.PI * 2, ease.inOut(k)); });
    boss.root.rotation.y = 0;
    yield kingLine(L, ['polnoch', F5.retry]);
    yield tableAway(L, 1.0);
    boss.main.pos.set(0, ROOF.y, kz); boss.main.yaw = 0;
    startFight(L);
    r.cast.at('pastila', PASTILA_AT.x, ROOF.y, PASTILA_AT.z, Math.PI);
    yield L.camBack(0.6);
    L.cutscene(false);
    audio.playMusic('vampire_boss');
    if (L.authority) boss.start();
  },

  // 9.5 — the spoon (the host starts it when the solar shot has burnt his cloak). No last blow.
  *fangs5_boss_defeat(L) {
    const r = R(L), c = r.cast, boss = r.boss, V = vamp(L), f = r.feast;
    L.cutscene(true);
    L.hud.bossMax = 0;
    boss.manual = true;
    r.parapet = false;
    for (const m of r.mice) m.g.visible = false;
    audio.stopMusic(1.2);
    // [К1] the cloak bursts: a hundred shadows fly home over Хрумляндия
    yield shot(L, V3(0, ROOF.y + 3, ROOF.z + 20), V3(0, ROOF.y + 13, ROOF.z - 26));
    const shadows: { m: THREE.Mesh; v: THREE.Vector3 }[] = [];
    const sm = new THREE.MeshBasicMaterial({ map: girlTex(), transparent: true, depthWrite: false, color: '#20103a', side: THREE.DoubleSide });
    const from = V3(0, ROOF.y + 10, ROOF.z - 28);
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5), sm);
      m.position.copy(from).add(V3(rand(-3, 3), rand(-3, 4), rand(-2, 2)));
      L.scene.add(m);
      const a = rand(0, Math.PI * 2);
      shadows.push({ m, v: V3(Math.cos(a) * rand(8, 22), rand(2, 12), Math.sin(a) * rand(8, 22)) });
    }
    mine(L, () => { audio.sfx('mist', { pitch: 0.6 }); audio.sfx('batScreech', { pitch: 0.7, volume: 0.4 }); audio.sfx('colorRestore', { pitch: 0.7 }); });
    yield tween(2.6, (k) => {
      boss.fadeK = Math.min(1, k * 1.4);
      for (const s of shadows) { s.m.position.addScaledVector(s.v, 0.016); s.m.lookAt(L.tcam.cam.position); }
      sm.opacity = 1 - k * 0.8;
    });
    for (const s of shadows) s.m.removeFromParent();
    boss.giant.root.visible = false;
    // the land gets its colours back
    if (L.authority) for (const z of V.zones) V.restoreZone(z.id);
    if (L.authority) V.restoreAround([0, 0, 22], 40, null);
    V.moonCtl?.set(0, 4); V.night?.set(0, 4);
    // [К2] the giant shrinks: the King on one knee by his table — small, grey
    f.hold = true; f.gone = false; f.setAway(0);
    const kz = SEAT.z + 0.6;
    boss.root.visible = true; boss.rig.root.visible = true;
    boss.root.position.set(0, ROOF.y, kz); boss.root.rotation.y = 0; boss.root.scale.setScalar(1);
    boss.anim.st = 'kneel'; boss.anim.burn = 0; boss.anim.sword = 0; boss.anim.wings = 0; boss.anim.stir = 0;
    c.hide();
    yield kingFace(L, 2.3, 0.6, 0.2);
    yield kingLine(L, F5.defeat[0]);
    // [К3] low: Ноки leaps from a merlon with the axe-guitar up — and stops a step away
    const n = c.at('noki', -12.6, ROOF.y + 1.9, kz + 2.5, Math.atan2(12.6, -2.5), 'jump', 'angry');
    n.anim.attack = { kind: 'axe', p: 0.12 };
    const p1 = safeMark(L, V3(0, ROOF.y, kz + 1.2), { label: 'fangs5 noki 9.5', wall: 0.6 });
    yield shot(L, V3(1.6, ROOF.y + 0.4, kz + 4.6), V3(-4, ROOF.y + 3.6, kz + 1.4));
    const p0 = n.root.position.clone();
    mine(L, () => audio.sfx('whoosh', { pitch: 0.8 }));
    yield tween(1.3, (k) => { n.root.position.lerpVectors(p0, p1, k); n.root.position.y += Math.sin(k * Math.PI) * 4.2; n.anim.state = k < 0.95 ? 'jump' : 'idle'; n.anim.attack = { kind: 'axe', p: 0.12 }; n.root.rotation.y = Math.atan2(p1.x - p0.x, p1.z - p0.z); });
    n.root.rotation.y = Math.PI;
    n.anim.state = 'idle'; n.anim.attack = { kind: 'axe', p: 0.12 };
    mine(L, () => audio.sfx('land', { volume: 0.6 }));
    // [К4] the two of them; a pause; she lowers the axe
    yield shot(L, V3(2.4, ROOF.y + 1.3, kz + 0.6), V3(0, ROOF.y + 1.2, kz + 0.6));
    yield wait(1.4);
    n.anim.attack = null; n.anim.expr = 'sad';
    yield wait(0.5);
    yield line(L, F5.defeat[1]);
    c.at('tosha', -1.3, ROOF.y, kz + 4.2, Math.PI); c.at('bublik', 1.0, ROOF.y, kz + 4.0, Math.PI);
    c.at('pastila', PASTILA_AT.x, ROOF.y, PASTILA_AT.z, Math.PI * 0.85);
    c.n.noki.anim.expr = 'normal';
    c.face('noki', PASTILA_AT.x, PASTILA_AT.z);
    yield faceShot(L, 'noki', 2.2, -0.4);
    yield line(L, F5.defeat[2]);
    // [К5] Пастила at the cannon: one spoonful left in the charger pot
    const pa = c.n.pastila.root;
    const pr = r.props;
    pr.pot.visible = true;
    const potAt = () => pr.pot.position.copy(pa.position).add(V3(Math.sin(pa.rotation.y) * 0.42, 0.4, Math.cos(pa.rotation.y) * 0.42));
    potAt();
    yield faceShot(L, 'pastila', 2.0, 0.3);
    yield line(L, F5.defeat[3]);
    // [К6] Бублик's spoon
    const bu = c.n.bublik.root;
    c.face('bublik', 0, kz);
    pr.spoon.visible = true;
    const spoonAt = () => { pr.spoon.position.copy(bu.position).add(V3(Math.sin(bu.rotation.y) * 0.62, 0.5, Math.cos(bu.rotation.y) * 0.62)); pr.spoon.rotation.y = bu.rotation.y; };
    spoonAt();
    { const y = bu.rotation.y; yield shot(L, pr.spoon.position.clone().add(V3(Math.sin(y) * 1.3 + Math.cos(y) * 0.5, 0.35, Math.cos(y) * 1.3 - Math.sin(y) * 0.5)), pr.spoon.position.clone().add(V3(-Math.sin(y) * 0.3, 0.05, -Math.cos(y) * 0.3))); }
    yield line(L, F5.defeat[4]);
    // Пастила brings the pot over, a golden drop into the spoon; Бублик takes it to the King (1 m right of Ноки)
    const pMark = safeMark(L, V3(bu.position.x + 0.9, ROOF.y, bu.position.z + 0.5), { label: 'fangs5 pastila 9.5' });
    yield shot(L, V3(4.2, ROOF.y + 2.6, kz + 6.4), V3(0.4, ROOF.y + 0.8, kz + 2));
    yield all(c.walk('pastila', pMark.x, pMark.z, 1.8), tween(1.8, () => potAt()));
    c.face('pastila', bu.position.x, bu.position.z);
    potAt();
    pr.drop.visible = true;
    mine(L, () => { audio.sfx('splash', { pitch: 1.8, volume: 0.4 }); L.fx.stars(pr.spoon.position.clone().setY(pr.spoon.position.y + 0.1), 8, ['#ffd34a', '#ffffff']); });
    yield wait(0.5);
    pr.pot.visible = false;
    const bMark = V3(p1.x + 1.0, ROOF.y, p1.z + 0.1);
    yield all(c.walk('bublik', bMark.x, bMark.z, 1.2), tween(1.2, () => spoonAt()));
    c.face('bublik', 0, kz); spoonAt();
    c.at('tosha', -1.3, ROOF.y, kz + 3.6, Math.PI);
    // [К7] he tastes. Colour comes into his grey face — a little, a blush. One guitar note.
    boss.anim.st = 'taste';
    const head = kingHead(L);
    const sp0 = pr.spoon.position.clone();
    const sp1 = head.clone().add(V3(0, -0.12, 0.2));
    yield shot(L, head.clone().add(V3(1.0, 0.1, 1.2)), head.clone().add(V3(0, -0.05, 0.1)));
    yield tween(0.9, (k) => { pr.spoon.position.lerpVectors(sp0, sp1, ease.inOut(k)); });
    pr.drop.visible = false;
    mine(L, () => { audio.sfx('clang', { pitch: 2.2, volume: 0.35 }); audio.sfx('colorRestore', { pitch: 1.4, volume: 0.35 }); });
    yield all(tween(0.6, (k) => { pr.spoon.position.lerpVectors(sp1, sp0, k); }), tween(2.0, (k) => { boss.anim.blush = k; }));
    yield kingLine(L, F5.defeat[5]);
    yield kingLine(L, F5.defeat[6]);
    // [К8] Бублик and the King
    yield shot(L, V3(3.2, ROOF.y + 1.4, kz + 2.0), V3(0.4, ROOF.y + 1.0, kz + 0.6));
    c.n.bublik.anim.expr = 'happy';
    yield line(L, F5.defeat[7]);
    boss.anim.st = 'kneel';
    yield kingFace(L, 2.0, -0.4, 0.15);
    yield kingLine(L, F5.defeat[8]);
    yield shot(L, V3(3.2, ROOF.y + 1.4, kz + 2.0), V3(0.4, ROOF.y + 1.0, kz + 0.6));
    c.n.bublik.anim.state = 'cheer';
    yield line(L, F5.defeat[9]);
    c.n.bublik.anim.state = 'idle';
    pr.spoon.visible = false;
    // [К9] the sun comes up; the King melts in the dawn
    r.day.go('dawn', 6);
    mine(L, () => audio.playMusic('credits'));
    boss.anim.st = 'idle';
    yield shot(L, V3(-5.2, ROOF.y + 2.4, kz + 7), V3(0, ROOF.y + 1.8, kz - 1), 0);
    const mats: THREE.Material[] = [];
    boss.rig.root.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && !mats.includes(m)) mats.push(m); });
    for (const m of mats) { m.transparent = true; m.needsUpdate = true; }
    yield all(
      kingLine(L, F5.defeat[10]),
      shot(L, V3(-4.2, ROOF.y + 2.6, kz + 5.6), V3(0, ROOF.y + 2.2, kz - 1), 4),
    );
    mine(L, () => audio.sfx('colorRestore', { pitch: 0.9, volume: 0.6 }));
    yield tween(2.4, (k) => {
      for (const m of mats) (m as THREE.MeshBasicMaterial).opacity = 1 - k;
      boss.root.position.y = ROOF.y + k * 0.8;
      if (Math.random() < 0.6) L.fx.emit(V3(rand(-0.5, 0.5), ROOF.y + rand(0.3, 2.6) + k, kz + rand(-0.4, 0.4)), { count: 2, speed: [0.4, 1.4], life: [0.6, 1.2], size: [0.15, 0.35], colors: ['#ffe0b0', '#ffb0c8', '#ffffff'], g: -2, drag: 1 });
    });
    boss.root.visible = false;
    for (const m of mats) { (m as THREE.MeshBasicMaterial).opacity = 1; }
    boss.root.position.y = ROOF.y;
    // (the next scene — Ноки's shadow — follows straight on: the host starts it)
  },

  // 9.6 — Ноки's shadow
  *fangs5_shadow(L) {
    const r = R(L), c = r.cast;
    L.cutscene(true);
    r.day.go('dawn', 4);
    mine(L, () => audio.stopMusic(3));
    const V = vamp(L);
    V.moonCtl?.set(0, 1);
    r.boss.root.visible = false;
    const nk = c.at('noki', 0, ROOF.y, -110.4, Math.PI / 2);
    c.at('bublik', -1.8, ROOF.y, -108.8, Math.PI / 2 + 0.7); c.at('tosha', -1.7, ROOF.y, -112.2, Math.PI / 2 - 0.6); c.at('pastila', 1.7, ROOF.y, -109, -Math.PI / 2 - 0.9);
    r.cast.shadow('noki', false);
    // a little shadow — the girl with the guitar — circles over the roof and comes down to Ноки's feet
    const g = r.girl;
    g.fly.visible = true;
    (g.fly.material as THREE.MeshBasicMaterial).opacity = 0;
    yield shot(L, V3(-3.5, ROOF.y + 1.6, -104.4), V3(0, ROOF.y + 5, -116.4));
    const c0 = V3(0, ROOF.y + 7, -118.4);
    yield tween(3.4, (k) => {
      const a = k * Math.PI * 2.4;
      const rr = lerp(6, 0.4, k);
      g.fly.position.set(c0.x + Math.cos(a) * rr, lerp(c0.y, ROOF.y + 0.9, ease.inOut(k)), lerp(c0.z, -110.4, k) + Math.sin(a) * rr);
      g.fly.lookAt(L.tcam.cam.position);
      (g.fly.material as THREE.MeshBasicMaterial).opacity = Math.min(1, k * 4) * (1 - Math.max(0, k - 0.85) / 0.15);
    }, (k) => k);
    g.fly.visible = false;
    g.ground.visible = true;
    g.ground.scale.set(1, 1, 1);
    g.ground.position.set(nk.root.position.x, ROOF.y + 0.03, nk.root.position.z);
    g.ground.rotation.y = Math.PI / 2;
    yield tween(0.8, (k) => { (g.ground.material as THREE.MeshBasicMaterial).opacity = 0.75 * k; });
    r.cast.shadow('noki', true);
    mine(L, () => audio.sfx('colorRestore', { pitch: 1.3, volume: 0.6 }));
    c.n.bublik.anim.expr = 'surprised';
    yield shot(L, V3(-1.4, ROOF.y + 1.9, -108.2), V3(-0.7, ROOF.y + 0.2, -110.4));
    yield line(L, F5.shadow[0]);
    c.n.noki.anim.expr = 'surprised';
    yield faceShot(L, 'noki', 2.2, 0.4);
    yield line(L, F5.shadow[1]);
    // the memory flash: the girl before the King, holding out her hand
    mine(L, () => audio.sfx('clang', { pitch: 2.2, volume: 0.35 }));
    r.memory.show();
    yield wait(1.25);
    c.n.noki.anim.expr = 'normal';
    yield line(L, F5.shadow[2]);
    // Пастила holds out a little mirror
    const mirror = r.mirror;
    mirror.visible = true;
    mirror.position.copy(c.n.pastila.root.position).add(V3(-0.3, 1.0, -0.2));
    mirror.lookAt(nk.root.position.clone().setY(ROOF.y + 1.2));
    yield faceShot(L, 'pastila', 2.2, 0.5);
    yield line(L, F5.shadow[3]);
    const mp = V3(0.62, ROOF.y + 1.18, -110.45);
    const m0 = mirror.position.clone();
    yield tween(0.8, (k) => { mirror.position.lerpVectors(m0, mp, ease.inOut(k)); mirror.lookAt(V3(0, ROOF.y + 1.2, -110.4)); });
    // over her shoulder: the reflection. A long pause.
    c.n.noki.anim.expr = 'surprised';
    yield shot(L, V3(-0.55, ROOF.y + 1.42, -110.15), mp.clone().setY(mp.y + 0.02), 0.8);
    yield wait(2.2);
    c.n.noki.anim.expr = 'sad';
    yield line(L, F5.shadow[4]);
    yield line(L, F5.shadow[5]);
    mirror.visible = false;
    c.n.tosha.anim.expr = 'happy';
    yield faceShot(L, 'tosha', 2.2, 0.4);
    yield line(L, F5.shadow[6]);
    c.n.noki.anim.expr = 'happy';
    yield faceShot(L, 'noki', 2.4, -0.4);
    yield line(L, F5.shadow[7]);
    yield faceShot(L, 'bublik', 2.1, 0.4);
    c.n.bublik.anim.expr = 'happy';
    yield line(L, F5.shadow[8]);
    // the sun comes up; Ноки squints but doesn't hide
    yield shot(L, V3(-3.2, ROOF.y + 1.6, -112.6), V3(6, ROOF.y + 2.2, -108.4), 1.2);
    r.day.go('day', 5);
    c.n.noki.anim.expr = 'sleepy';
    yield line(L, F5.shadow[9]);
    c.n.noki.anim.expr = 'happy';
    L.hud.showBanner(F5.shadowBanner, '#ffd34a');
    mine(L, () => audio.sfx('victory', { volume: 0.6 }));
    yield wait(1.6);
    endScene(L);
    V.moonCtl?.dispose(); V.moonCtl = null;
    r.feast.hold = false;
    openExit(L);
    yield L.camBack(0.7);
    L.cutscene(false);
    L.toast(F5.afterToast);
    audio.playMusic('hub_day');
  },

  // 9.7 — the morning square and the pie (the team walked to the roof door)
  *exit_fangs5_castle(L) {
    const r = R(L), c = r.cast, S = r.square;
    exitStart(L);
    L.cutscene(true);
    // (close-ups at 1.4 m: farther, the camera stood inside the long table in front of the four)
    yield r.fade.out(0.8);
    r.day.go('day', 0);
    // my hero (hidden) waits at the square, so the sun's shadows are drawn there
    const slot = L.nl ? Math.max(0, [...net.members.keys()].sort().indexOf(net.myId)) : 0;
    L.teleportMe(V3(SQUARE.x - 8 + slot * 1.3, 0.05, SQUARE.z + 12), Math.PI);
    for (const k of ['tosha', 'bublik', 'noki', 'pastila'] as CastKind[]) { const m = S.marks[k]; c.at(k, m.x, 0, m.z, Math.atan2(S.table.x - m.x, S.table.z - m.z), 'idle', 'happy'); }
    r.cast.shadow('noki', true);
    const bear = L.npcs.bear;
    if (bear) { bear.root.visible = true; bear.root.position.copy(S.marks.bear); bear.root.rotation.y = Math.atan2(S.table.x - S.marks.bear.x, S.table.z - S.marks.bear.z); bear.anim.state = 'stand'; }
    S.folk.ponchik.g.visible = false;
    yield shot(L, V3(SQUARE.x + 2, 6, SQUARE.z - 11), V3(SQUARE.x, 1.2, SQUARE.z + 4));
    yield r.fade.in(1.0);
    yield all(shot(L, V3(SQUARE.x + 1, 4.4, SQUARE.z - 7), V3(SQUARE.x, 1.3, SQUARE.z + 4), 4), line(L, F5.ending[0]));
    const fshot = (f: { g: THREE.Group }, side = 0.4) => { const p = f.g.position, y = f.g.rotation.y; return shot(L, V3(p.x + Math.sin(y) * 2.6 + Math.cos(y) * side, 1.5, p.z + Math.cos(y) * 2.6 - Math.sin(y) * side), p.clone().setY(1.0)); };
    yield fshot(S.folk.zefirych);
    S.folk.zefirych.anim.state = 'wave';
    yield line(L, F5.ending[1]);
    S.folk.zefirych.anim.state = 'idle';
    // «Пирог-то вернулся!» — the raspberry pie, close
    yield shot(L, S.table.clone().add(V3(1.6, 2.6, 2.6)), S.table.clone().add(V3(0, 1.6, 0)));
    S.folk.beze.anim.state = 'cheer';
    if (bear) bear.anim.talk = 0;
    yield line(L, F5.ending[2]);
    S.folk.beze.anim.state = 'idle';
    yield faceShot(L, 'bublik', 1.4, 0.3);
    yield line(L, F5.ending[3]);
    yield faceShot(L, 'tosha', 1.4, -0.3);
    yield line(L, F5.ending[4]);
    if (bear) { const p = bear.root.position; yield shot(L, V3(p.x + 1.5, 2.2, p.z + 3.4), p.clone().setY(1.6)); }
    yield line(L, F5.ending[5]);
    c.n.tosha.anim.state = 'cheer';
    yield faceShot(L, 'tosha', 1.4, 0.3);
    yield line(L, F5.ending[6]);
    c.n.tosha.anim.state = 'idle';
    yield faceShot(L, 'pastila', 1.4, 0.3);
    yield line(L, F5.ending[7]);
    yield faceShot(L, 'bublik', 1.4, -0.3);
    c.n.bublik.anim.expr = 'happy';
    yield line(L, F5.ending[8]);
    // Пончик runs in with a yellow envelope; it steams sourly
    const P = S.folk.ponchik;
    P.g.visible = true;
    P.g.position.copy(S.ponchikFrom);
    S.letter.visible = true;
    yield shot(L, V3(SQUARE.x + 7, 2.4, SQUARE.z + 12), V3(SQUARE.x + 9, 1.2, SQUARE.z + 14));
    const to = V3(SQUARE.x + 4.5, 0, SQUARE.z + 7);
    P.anim.state = 'walk'; P.anim.speed = 1;
    P.g.rotation.y = Math.atan2(to.x - P.g.position.x, to.z - P.g.position.z);
    const from = P.g.position.clone();
    yield tween(2.0, (k) => {
      P.g.position.lerpVectors(from, to, k);
      S.letter.position.copy(P.g.position).add(V3(0.4, 0.9, 0.2));
      if (Math.random() < 0.4) L.fx.emit(S.letter.position.clone().setY(S.letter.position.y + 0.3), { count: 1, speed: [0.3, 0.8], dir: V3(0, 1, 0), spread: 0.3, life: [0.6, 1.1], size: [0.15, 0.3], size2: 2, colors: ['#d8f040', '#b8d820', '#f4ff8a'], g: -1.2, drag: 1 });
    });
    P.anim.state = 'talk'; P.anim.speed = 0;
    P.g.rotation.y = Math.atan2(S.table.x - to.x, S.table.z - to.z);
    yield shot(L, V3(to.x - 0.6, 1.6, to.z + 2.6), to.clone().setY(0.9));
    yield line(L, F5.ending[9]);
    P.anim.state = 'idle';
    yield faceShot(L, 'noki', 1.4, 0.3);
    // the letter is a scene of its own (the scene watchdog): the host starts it right after this one
    chain(L, 'exit_fangs5_letter');
    yield line(L, F5.ending[10]);
  },

  // 9.8 — Граф Кислоплюй's letter: a second invitation (the rhyme of the King's card); then the episode is over
  *exit_fangs5_letter(L) {
    const r = R(L), c = r.cast, S = r.square;
    exitStart(L);
    L.cutscene(true);
    const pa = c.n.pastila.root;
    S.letter.visible = true;
    S.letter.position.copy(pa.position).add(V3(0, 1.15, 0)).addScaledVector(V3(Math.sin(pa.rotation.y), 0, Math.cos(pa.rotation.y)), 0.45);
    S.letter.rotation.y = pa.rotation.y;
    r.card.show(F5.card.title, F5.card.text, 3.6);
    mine(L, () => audio.sfx('artifact', { pitch: 0.8 }));
    yield shot(L, S.letter.position.clone().add(V3(Math.sin(pa.rotation.y) * 1.1, 0.25, Math.cos(pa.rotation.y) * 1.1)), S.letter.position.clone());
    for (let i = 0; i < 3; i++) yield line(L, F5.letter[i]);
    // «…ваша пастила — приторная»: Пастила close
    c.n.pastila.anim.expr = 'angry';
    yield faceShot(L, 'pastila', 1.4, 0.2);
    yield line(L, F5.letter[3]);
    yield line(L, F5.letter[4]);
    S.letter.visible = false;
    yield faceShot(L, 'bublik', 1.4, 0.3);
    c.n.bublik.anim.expr = 'sad';
    yield line(L, F5.letter[5]);
    yield faceShot(L, 'noki', 1.4, 0.3);
    yield line(L, F5.letter[6]);
    c.n.tosha.anim.state = 'cheer';
    yield faceShot(L, 'tosha', 1.4, -0.3);
    yield line(L, F5.letter[7]);
    c.n.tosha.anim.state = 'idle';
    yield faceShot(L, 'noki', 1.4, -0.3);
    yield line(L, F5.letter[8]);
    yield all(shot(L, V3(SQUARE.x + 1, 9, SQUARE.z - 16), V3(SQUARE.x, 1.6, SQUARE.z + 4), 3), line(L, F5.letter[9]));
    L.toast(F5.letterToast);
    yield wait(1.2);
    finish(L);
  },
};

// ───────────────────────── helpers of the boss scenes ─────────────────────────
/** the King seated at the head of his table, facing north down it (v2: where he waits) */
function kingAtTable(boss: Midnight3) {
  boss.root.visible = true; boss.rig.root.visible = true;
  boss.root.position.copy(SEAT);
  boss.root.rotation.y = Math.PI; boss.root.scale.setScalar(1);
  boss.anim.st = 'sit'; boss.anim.sword = 0; boss.anim.wings = 0; boss.anim.look = 0; boss.anim.blush = 0; boss.anim.burn = 0;
  boss.rig.update(0.016, boss.anim);
}
/** a shadow drags the table to the north edge and it sinks into the roof (the start of the fight) */
function tableAway(L: Level3D, secs: number): Waiter {
  const f = R(L).feast;
  f.hold = true;
  return tween(secs, (k) => {
    f.setAway(k);
    if (Math.random() < 0.7) mine(L, () => L.fx.emit(V3(rand(-1.4, 1.4), ROOF.y + 0.3, rand(TABLE.z1, TABLE.z0) - 3.2 * k), { count: 2, speed: [0.5, 2], life: [0.5, 1], size: [0.4, 0.8], colors: ['#1a1028', '#3a2a5a'], g: -1, drag: 2 }));
    if (k >= 1) { f.gone = true; f.hold = false; }
  });
}
/** a line of the King: his mouth moves while it types */
function kingLine(L: Level3D, l: Line): Waiter {
  const boss = R(L).boss;
  boss.talkT = 0.4 + l[1].length * 0.045;
  return line(L, l);
}
/** the fight's camera and the boss bar (every machine) */
function startFight(L: Level3D) {
  const boss = R(L).boss;
  boss.manual = false;
  R(L).feast.gone = true;
  L.boss = boss;
  L.camModeDefault = 'boss';
  L.tcam.bossPoint = boss.focusPt;
}
function openExit(L: Level3D) {
  L.exit(-2.2, ROOF.y - 1, -100.2, 2.2, ROOF.y + 4, -95.6);
  L.refs.f5after = true;
}

/** (v2 §9.4) the five mice on the north parapet from phase 2 on, heckling the King for how he uses their powers */
const PARAPET_I = [22, 24, 26, 28, 30];
function parapetActor(L: Level3D) {
  let lastPower = 'none', t = 0;
  const pending: { at: number; kind: string; text: string }[] = [];
  return (_t: number, dt: number) => {
    const r = R(L);
    if (!r) return;
    const b = r.boss;
    t += dt;
    const want = b.phase >= 2 && (b.state === 'fight' || b.state === 'transform' || b.state === 'shadow') && !b.manual;
    if (want !== r.parapet) {
      r.parapet = want;
      for (const m of r.mice) m.g.visible = want;
    }
    if (!want) { lastPower = b.power; return; }
    r.mice.forEach((m, i) => {
      const a = (PARAPET_I[i] / 52) * Math.PI * 2;
      const x = ROOF.x + Math.sin(a) * (ROOF.r + 1.0), z = ROOF.z + Math.cos(a) * (ROOF.r + 1.0);
      m.g.position.set(x, ROOF.y + 1.9 + Math.abs(Math.sin(t * 3 + i)) * 0.06, z);
      m.g.rotation.y = Math.atan2(ROOF.x - x, ROOF.z - z);
      m.g.scale.setScalar(1.6);
    });
    // a new power: the mouse whose power it is heckles (bars over the mice, each machine for itself)
    if (b.power !== lastPower) {
      lastPower = b.power;
      const lines = (F5.heckle as Record<string, [string, string][]>)[b.power];
      if (lines && b.state === 'fight') lines.forEach(([kind, text], k) => pending.push({ at: t + 1.4 + k * 2.2, kind: kind === 'shurshik' ? 'shepot' : kind, text }));
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (t < p.at) continue;
      pending.splice(i, 1);
      const m = r.mice.find((mm) => mm.kind === p.kind);
      if (m && m.g.visible) { L.bark(m.g, p.text, 2.6, 1.2); m.anim.squeak = 1; m.anim.hop = 1; audio.sfx('batScreech', { pitch: 2.4, volume: 0.25 }); }
    }
  };
}

// ═════════════════════════════ the level's hook (every build, every machine) ═════════════════════════════
const special: Record<string, (L: Level3D) => void> = {
  fangs5_castle(L) {
    const r2 = () => L.refs.f5 as Refs;
    const cast = new Cast(L);
    const cannon = createSunCannon();
    cannon.root.position.copy(CANNON_AT); cannon.root.rotation.y = Math.PI + 0.25;
    L.scene.add(cannon.root);
    const cart = createSunCannon();
    cart.root.visible = false; cart.root.scale.setScalar(0.85);
    L.scene.add(cart.root);
    const boss = new Midnight3(L, {
      pastila: () => cast.n.pastila,
      cannon,
      bell: L.refs.f5bell as THREE.Object3D,
      lanterns: () => (L.refs.f5roofLanterns as { lit: boolean; snuff(): void }[]) ?? [],
    });
    boss.manual = true;
    // (v2) the dinner table for a hundred; the King waits at its head
    const feast = buildFeast(L);
    if (L.seen.has('fangs5_cold')) feast.pie.grey(1);
    kingAtTable(boss);
    // the five little bats of the stairs
    const mice = (['netopyr', 'morok', 'shepot', 'nochka', 'tenka'] as MouseKind[]).map((kind) => {
      const rig = createMouse(kind);
      const g = new THREE.Group(); g.add(rig.root); g.visible = false; g.scale.setScalar(1.6);
      L.scene.add(g);
      return { kind, rig, anim: { talk: 0, hop: 0, squeak: 0 } as MouseAnim, g };
    });
    // red eyes in the dark of the gate (the King's voice in the intro)
    const gateEyes = new THREE.Group();
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2030' })); e.position.set(s * 0.32, 0, 0); e.scale.set(1.4, 0.5, 0.4); gateEyes.add(e); }
    gateEyes.position.set(0, 3.4, 42); gateEyes.visible = false;
    L.scene.add(gateEyes);
    const mirror = createMirror(); mirror.visible = false; L.scene.add(mirror);
    const square = buildSquare(L);
    L.npc('bear', SQUARE.x - 5.6, 0, SQUARE.z + 2.4, 0).root.visible = false;
    const refs: Refs = { cast, boss, cannon, cart, day: new Daybreak(L), fade: new Fade(L), card: new ItemCard(L), girl: new ShadowGirl(L), mice, square, mirror, gateEyes,
      feast, props: buildProps(L), memory: new MemoryFlash(L), parapet: false };
    L.refs.f5 = refs;
    L.refs.f5boss = boss;
    // the boss draws (and waits) before his fight too
    L.actors.push({ update: (L2, dt) => { if (L2.boss !== boss) boss.update(L2, dt); } });
    // the host decides the victory; every machine plays the two scenes after it
    boss.onDefeat = () => {
      if (!L.authority) return;
      L.runGen((function* () {
        yield wait(0.6);
        yield until(() => !L.storyOn());
        L.run('fangs5_boss_defeat');
        yield wait(0.2);
        yield until(() => !L.storyOn());
        L.run('fangs5_shadow');
      })());
    };
    // the way on: story triggers appear as each part is done; the goal arrow points at what is left to do
    const flow = flowActor(L);
    L.actors.push(flow);
    // speakers' mouths: the cast and the mice
    L.updaters.push((_t, dt) => {
      const id = speakingNow(L) as SpeakerId | null;
      if (id && (CAST as string[]).includes(id)) cast.n[id as CastKind].talk = 0.35;
      for (const m of mice) {
        m.anim.talk = (id === 'shurshik' ? 'shepot' : id) === m.kind ? Math.abs(Math.sin(L.t * 16)) : 0;
        m.anim.hop = Math.max(0, m.anim.hop - (r2().parapet ? dt * 2 : 0));
        m.anim.squeak = Math.max(0, m.anim.squeak - dt * 0.4);
        if (m.g.visible) m.rig.update(dt, m.anim);
      }
    });
    // (v2) the table: gone while the King fights (dragged off by the boss intro / retry), back for the spoon
    L.updaters.push(() => { if (!feast.hold) feast.setAway(feast.gone ? 1 : 0); });
    // (v2) the mice on the parapet from phase 2 on, heckling
    L.updaters.push(parapetActor(L));
    // portraits murmur as you pass (each machine for its own hero)
    // (the bark's anchor is dropped by this updater, not by L.runGen: a running script counts as a cutscene for
    // L.inCutscene, which holds the story triggers, the goal arrow and the aim marker)
    let murmur = 4;
    const anchors: { o: THREE.Object3D; t: number }[] = [];
    L.updaters.push((_t, dt) => {
      for (let i = anchors.length - 1; i >= 0; i--) if ((anchors[i].t -= dt) <= 0) { anchors[i].o.removeFromParent(); anchors.splice(i, 1); }
      const p = L.player;
      if (L.letterbox > 0.1 || p.pos.z > 3 || p.pos.z < -34 || p.pos.y > 4) return;
      murmur -= dt;
      if (murmur > 0) return;
      murmur = rand(5, 8);
      const at = new THREE.Object3D();
      at.position.set(p.pos.x > 0 ? 7 : -7, 4.6, p.pos.z + rand(-4, 4));
      L.scene.add(at);
      L.bark(at, choose(F5.portraitBarks), 2.2, 0);
      anchors.push({ o: at, t: 2.4 });
    });
    // a restart after the fight began: the host plays the retry for everyone once all are in
    if (L.seen.has('fangs5_shadow')) afterVictory(L);
    // (a restart after the fight began: flowActor plays the retry once a hero is back on the roof)
  },
};

/** rebuilt after the King (a co-op late loader / a restart at dawn): no King, morning, the door open */
function afterVictory(L: Level3D) {
  const r = R(L);
  r.boss.state = 'dead';
  r.boss.root.visible = false; r.boss.giant.root.visible = false;
  r.boss.manual = true;
  r.feast.gone = false;
  r.day.go('day', 0);
  const V = vamp(L);
  V.moonCtl?.dispose(); V.moonCtl = null;
  r.cast.hide();
  openExit(L);
}

/** story triggers in order, the goal arrow, the library's bars */
function flowActor(L: Level3D) {
  const added = new Set<string>();
  const addTrig = (id: string, box: [number, number, number, number, number, number]) => {
    if (added.has(id)) return;
    added.add(id);
    L.trigger(...box, id);
  };
  const bars = L.refs.f5libBars as { bars: THREE.Group; col: { active?: boolean } };
  let retried = false;
  let barsK = 0;
  const hint = new THREE.Vector3();
  return {
    update(L2: Level3D, dt: number) {
      // the chained scenes (cold open → the gate; the morning → the letter): the host starts the next one once the
      // previous is over — here in a persistent actor too (in co-op the scene's own follow-up coroutine never ran)
      if (L2.authority && !L2.storyOn() && !L2.inCutscene && !(L2.nl && L2.nl.waiting)) {
        if (L2.seen.has('fangs5_cold') && !L2.seen.has('fangs5_intro')) L2.run('fangs5_intro');
        else if (L2.seen.has('exit_fangs5_castle') && !L2.seen.has('exit_fangs5_letter')) L2.run('exit_fangs5_letter');
      }
      const siege = L2.refs.f5siege as { won: boolean } | undefined;
      const candles = L2.refs.f5candles as { solved: boolean; n: number } | undefined;
      const arena = L2.arenas[0];
      if (siege?.won) addTrig('fangs5_portraits', [-7.5, -1, -8.5, 7.5, 4, -3.5]);
      if (candles?.solved) addTrig('fangs5_library', [-3, -1, -42, 3, 4, -37.6]);
      const libDone = arena && arena.state === 'done';
      if (libDone) {
        barsK = Math.min(1, barsK + dt / 1.5);
        const l = discAt(SPOTS.stairsLanding);
        // (not once the roof scene played: walking back down mid-fight mustn't start it)
        if (!L2.seen.has('fangs5_boss_intro')) addTrig('fangs5_stairs', [l.x - 2.6, l.y - 0.6, l.z - 2.6, l.x + 2.6, l.y + 2.6, l.z + 2.6]);
        // the roof opens with the tower, not with the little bats' scene: a hero who got past landing 20 without
        // standing on it (the chandelier, Бублик's ring, a glide) must still meet the King
        addTrig('fangs5_boss_intro', [-4, ROOF.y - 1, -104.8, 4, ROOF.y + 3, -99.2]);
      }
      bars.bars.position.y = barsK * 4.6;
      bars.col.active = barsK < 0.5;
      // after a restart (solo respawn / co-op team wipe) once the fight had begun: the host plays the retry as soon as
      // everyone is in and a hero stands on the roof; a client that loads into a running fight takes it up at once
      const r = R(L2);
      if (r && L2.seen.has('fangs5_boss_intro') && !L2.seen.has('fangs5_shadow') && L2.boss !== r.boss && !L2.storyOn()) {
        if (L2.authority) {
          const onRoof = L2.alivePlayers().some((h) => h.pos.y > ROOF.y - 1 && h.pos.z < -99);
          if (!retried && onRoof && !(L2.nl && L2.nl.waiting)) { retried = true; L2.run('fangs5_boss_retry'); }
        } else if (r.boss.state === 'fight' || r.boss.state === 'transform' || r.boss.state === 'shadow') {
          startFight(L2);
          r.feast.gone = true;
          r.cast.at('pastila', PASTILA_AT.x, ROOF.y, PASTILA_AT.z, Math.PI);
        }
      }
      // the arrow: the next unlit lantern / candle, the ambush, the tower top
      const p = L2.player.pos;
      let goal: THREE.Vector3 | null = null;
      const V = vamp(L2);
      if (siege && !siege.won) {
        let bd = Infinity;
        for (const ln of V.lanterns) if (!ln.lit && ln.pos.z > 0 && ln.pos.distanceTo(p) < bd) { bd = ln.pos.distanceTo(p); goal = hint.copy(ln.pos); }
      } else if (candles && !candles.solved && L2.seen.has('fangs5_portraits')) {
        const at = [[-6.2, -18], [6.2, -18], [-6.2, -26], [6.2, -26]][candles.n];
        if (at) goal = hint.set(at[0], 0, at[1]);
      } else if (arena && arena.state !== 'done' && L2.seen.has('fangs5_library')) goal = hint.copy(arena.center);
      L2.refs.goalHint = goal ?? undefined;
    },
  };
}

export const F5_SCRIPTS = { scripts, special };
void PASTILA_AT; void CANNON_AT; void choose;
