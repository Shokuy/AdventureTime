import * as THREE from 'three';
import { W, H, clamp, ease } from '../../engine/util';
import { input } from '../../engine/input';
import { audio } from '../../engine/audio';
import { text, rrect, wrap, OUT } from '../../art/draw';
import { net } from '../../net/session';
import { MSG } from '../../net/protocol';
import { ChatPanel, QUICK_PHRASES, QP_ACTIONS, memberColor } from '../../ui/chat';
import { voiceUI, drawMicBadge } from '../../ui/voiceHud';
import { basic, noOutline } from '../gfx';
import { toUI } from '../runtime';
import { LEVEL_PLUGINS, type Level3D, type LevelPlugin } from './level';
import { coopFlow } from './coopFlow';

/*
 * In-level social layer for co-op (a LEVEL_PLUGINS module, solo never creates it):
 *  • chat: T opens a box, lines fade in the bottom-left panel and pop up as bubbles over heads (mine too);
 *  • quick phrases (1–4 / d-pad): a big bubble + a blip for everyone ('phrase' {i});
 *  • pings (G / L3): a glowing marker on the ground or an enemy for 6 s, in the pinger's colour,
 *    with a name + distance label and an arrow at the screen edge when it is off-screen ('mark' {p, e?});
 *  • voice: my hero's "talking" flag follows the mic (friends see the speaker icon), mic badge bottom-left;
 *  • event feed: someone joined the room (they come in at the next chapter).
 */

type C = CanvasRenderingContext2D;
const PING_LIFE = 6;
const PING_GAP = 0.8;
const QP_GAP = 0.6;
const BUBBLE_S = 6;
const CHAT_Y = H - 292;

interface Mark {
  from: string;
  name: string;
  color: string;
  pos: THREE.Vector3;
  /** an enemy it sticks to */
  ent: { body?: { pos: THREE.Vector3; h?: number }; dead?: boolean } | null;
  t: number;
  g: THREE.Group;
  parts: { ring: THREE.Mesh; disc: THREE.Mesh; beam: THREE.Mesh; gem: THREE.Mesh };
}

type Inbox = { k: 'phrase'; from: string; i: number } | { k: 'mark'; from: string; p: number[]; e?: number } | { k: 'chat'; from: string; text: string };

let GEO: { ring: THREE.RingGeometry; disc: THREE.CircleGeometry; beam: THREE.CylinderGeometry; gem: THREE.OctahedronGeometry } | null = null;
function geo() {
  return (GEO ??= {
    ring: new THREE.RingGeometry(0.55, 0.8, 36).rotateX(-Math.PI / 2),
    disc: new THREE.CircleGeometry(0.55, 28).rotateX(-Math.PI / 2),
    beam: new THREE.CylinderGeometry(0.1, 0.32, 7, 14, 1, true),
    gem: new THREE.OctahedronGeometry(0.32, 0),
  });
}

const tmp = new THREE.Vector3();
const dir = new THREE.Vector3();

class SocialPlugin implements LevelPlugin {
  chat: ChatPanel;
  private myBubble: { text: string; t: number } | null = null;
  private marks = new Map<string, Mark>();
  private inbox: Inbox[] = [];
  private offs: (() => void)[] = [];
  private known = new Set<string>();
  private t = 0;
  private lastQP = -9;
  private lastPing = -9;
  private lift = 0;

  constructor(private L: Level3D) {
    this.chat = new ChatPanel({ x: 16, y: CHAT_Y, w: 430, h: 236, fade: true, onLine: (from, txt) => this.inbox.push({ k: 'chat', from, text: txt }) });
    this.chat.attach();
    for (const id of net.members.keys()) this.known.add(id);
    this.offs.push(net.on(MSG.phrase, (d: { i?: number }, from) => this.inbox.push({ k: 'phrase', from, i: Number(d?.i) })));
    this.offs.push(net.on(MSG.mark, (d: { p?: number[]; e?: number }, from) => {
      if (Array.isArray(d?.p) && d.p.length === 3 && d.p.every(Number.isFinite)) this.inbox.push({ k: 'mark', from, p: d.p, e: typeof d.e === 'number' ? d.e : undefined });
    }));
    this.offs.push(net.onMembers(() => this.onMembers()));
  }

  wantsInput() { return this.chat.typing; }

  dispose() {
    for (const o of this.offs) o();
    this.offs = [];
    this.chat.detach();
    for (const m of this.marks.values()) this.dropMark(m);
    this.marks.clear();
    this.L.player.talking = false;
  }

  private onMembers() {
    for (const m of net.members.values()) {
      if (this.known.has(m.id)) continue;
      this.known.add(m.id);
      if (!m.isMe) this.L.feed(`${m.name} в комнате — присоединится в следующей главе`, m.look.tagColor || '#ffd34a');
    }
    for (const id of [...this.known]) if (!net.members.has(id)) this.known.delete(id);
  }

  // ───────────────────────── tick ─────────────────────────
  update(dt: number) {
    const L = this.L;
    this.t += dt;
    const blocked = L.paused || !!L.results;
    // a dialog box at the bottom pushes the chat up
    this.lift = clamp(this.lift + ((L.dialog.appear > 0.05 && !L.dialog.top ? 1 : 0) - this.lift) * Math.min(1, dt * 10), 0, 1);
    this.chat.o.y = CHAT_Y - this.lift * 190;
    this.chat.update(dt, { allowOpen: !blocked, mouse: false });
    for (const m of this.inbox.splice(0)) this.handle(m);
    const notice = coopFlow.takeNotice(); // host changed etc.
    if (notice) L.toast(notice);
    if (this.myBubble) { this.myBubble.t += dt; if (this.myBubble.t > BUBBLE_S) this.myBubble = null; }

    // voice: friends see a speaker over my head while my mic sends
    L.player.talking = voiceUI.talking;

    if (!this.chat.typing && !blocked) {
      for (let i = 0; i < 4; i++) if (input.pressed(QP_ACTIONS[i])) { this.phrase(i); break; }
      if (input.pressed('ping')) this.ping();
    }
    for (const [id, m] of this.marks) {
      m.t += dt;
      if (m.ent && !m.ent.dead && m.ent.body) m.pos.copy(m.ent.body.pos);
      if (m.t > PING_LIFE) { this.dropMark(m); this.marks.delete(id); continue; }
      this.animMark(m);
    }
  }

  private handle(m: Inbox) {
    const L = this.L;
    if (m.k === 'chat') { this.bubble(m.from, m.text); return; }
    if (m.k === 'phrase') {
      if (!(m.i >= 0 && m.i < QUICK_PHRASES.length)) return;
      const txt = QUICK_PHRASES[m.i];
      this.bubble(m.from, txt);
      const who = net.members.get(m.from);
      this.chat.sys(`${who?.name ?? '?'}: ${txt}`, memberColor(m.from));
      audio.sfx('textBlip', { pitch: 1.6, volume: 0.7 });
      return;
    }
    // a ping: stick to an enemy when the pinger aimed at one
    const ent = m.e !== undefined ? (L.nl?.get(m.e) as Mark['ent'] | undefined) ?? null : null;
    this.addMark(m.from, new THREE.Vector3(m.p[0], m.p[1], m.p[2]), ent);
    audio.sfx('alert', { pitch: 1.5, volume: 0.45 });
  }

  /** a chat line / phrase over a hero's head */
  private bubble(from: string, txt: string) {
    if (from === net.myId) { this.myBubble = { text: txt, t: 0 }; return; }
    const r = this.L.remote(from);
    if (r) r.bubble = { text: txt, t: 0 };
  }

  private phrase(i: number) {
    if (this.t - this.lastQP < QP_GAP) return;
    this.lastQP = this.t;
    net.send('all', MSG.phrase, { i });
    const txt = QUICK_PHRASES[i];
    this.myBubble = { text: txt, t: 0 };
    this.chat.sys(`${net.me?.name ?? 'Я'}: ${txt}`, memberColor(net.myId));
    audio.sfx('textBlip', { pitch: 1.6 });
  }

  // ───────────────────────── pings ─────────────────────────
  /** what the camera looks at: the world (colliders) or an enemy in the way */
  private ping() {
    if (this.t - this.lastPing < PING_GAP) return;
    this.lastPing = this.t;
    const L = this.L;
    const cam = L.tcam.cam;
    const o = cam.position;
    // a bit above the screen centre: the follow camera looks at my own Tosha, the ping goes past him
    dir.set(0, 0.3, 0.5).unproject(cam).sub(o).normalize();
    let best = L.phys.raycast(o, dir, 140);
    let hitEnemy: { netId: number; body: { pos: THREE.Vector3 } } | null = null;
    for (const e of L.enemies) {
      if (e.dead) continue;
      const c = e.center(tmp);
      const vx = c.x - o.x, vy = c.y - o.y, vz = c.z - o.z;
      const tca = vx * dir.x + vy * dir.y + vz * dir.z;
      if (tca < 1) continue;
      const d2 = vx * vx + vy * vy + vz * vz - tca * tca;
      const r = Math.max(0.9, e.body.r * 1.7);
      if (d2 > r * r) continue;
      const te = tca - Math.sqrt(r * r - d2);
      if (te < best) { best = te; hitEnemy = e; }
    }
    let p: THREE.Vector3;
    if (hitEnemy) p = hitEnemy.body.pos.clone();
    else if (Number.isFinite(best) && best < 140) p = o.clone().addScaledVector(dir, best);
    else {
      // nothing in sight: a spot ahead of my hero on the ground
      const pl = L.player;
      p = pl.pos.clone().addScaledVector(pl.forward(tmp), 5);
      const gy = L.phys.groundAt(p.x, p.z, p.y + 3, 0.1);
      if (gy > -1e8) p.y = gy;
    }
    const q = (v: number) => Math.round(v * 100) / 100;
    const netId = hitEnemy && hitEnemy.netId && L.nl?.get(hitEnemy.netId) ? hitEnemy.netId : undefined;
    net.send('all', MSG.mark, { p: [q(p.x), q(p.y), q(p.z)], e: netId });
    this.addMark(net.myId, p, hitEnemy as Mark['ent']);
    audio.sfx('alert', { pitch: 1.7, volume: 0.5 });
  }

  private addMark(from: string, pos: THREE.Vector3, ent: Mark['ent']) {
    const old = this.marks.get(from);
    if (old) this.dropMark(old);
    const m0 = net.members.get(from);
    const color = m0?.look.tagColor || '#ffd34a';
    const G = geo();
    const g = new THREE.Group();
    const ring = new THREE.Mesh(G.ring, basic(color, { additive: true, opacity: 0.95, side: THREE.DoubleSide, fog: false }));
    const disc = new THREE.Mesh(G.disc, basic(color, { additive: true, opacity: 0.35, side: THREE.DoubleSide, fog: false }));
    const beam = new THREE.Mesh(G.beam, basic(color, { additive: true, opacity: 0.3, side: THREE.DoubleSide, fog: false }));
    const gem = new THREE.Mesh(G.gem, basic(color, { fog: false }));
    ring.position.y = 0.06; disc.position.y = 0.05; beam.position.y = 3.5; gem.position.y = 2.3;
    for (const x of [ring, disc, beam, gem]) { x.renderOrder = 5; g.add(x); }
    noOutline(g);
    g.position.copy(pos);
    this.L.scene.add(g);
    const m: Mark = { from, name: m0?.name ?? '?', color, pos: pos.clone(), ent, t: 0, g, parts: { ring, disc, beam, gem } };
    this.marks.set(from, m);
    this.animMark(m);
  }

  private animMark(m: Mark) {
    const k = clamp(Math.min(m.t * 4, PING_LIFE - m.t), 0, 1);
    const pulse = 1 + Math.sin(m.t * 7) * 0.18 + Math.max(0, 0.6 - m.t) * 2;
    m.g.position.copy(m.pos);
    const P = m.parts;
    P.ring.scale.setScalar(pulse);
    P.disc.scale.setScalar(0.8 + 0.2 * Math.sin(m.t * 7 + 1));
    P.gem.position.y = 2.3 + Math.sin(m.t * 3) * 0.15 + (m.ent ? (m.ent.body?.h ?? 1) : 0);
    P.gem.rotation.y = m.t * 2.5;
    P.gem.scale.setScalar(ease.outBack(clamp(m.t * 3, 0, 1)));
    (P.ring.material as THREE.MeshBasicMaterial).opacity = 0.95 * k;
    (P.disc.material as THREE.MeshBasicMaterial).opacity = 0.35 * k;
    (P.beam.material as THREE.MeshBasicMaterial).opacity = 0.3 * k;
    (P.gem.material as THREE.MeshBasicMaterial).opacity = k;
    (P.gem.material as THREE.MeshBasicMaterial).transparent = k < 1;
  }

  private dropMark(m: Mark) {
    this.L.scene.remove(m.g);
    for (const x of Object.values(m.parts)) (x.material as THREE.Material).dispose();
  }

  // ───────────────────────── draw ─────────────────────────
  draw(ctx: C) {
    const L = this.L;
    const cam = L.tcam.cam;
    // edge arrows stay above the boss bar (bottom centre) while it is shown
    const bottom = (x: number, m: number) => (L.hud.bossMax > 0 && Math.abs(x - W / 2) < 360 ? H - 104 : H - m);
    // ping labels / off-screen arrows
    for (const m of this.marks.values()) {
      const a = clamp(Math.min(m.t * 4, PING_LIFE - m.t), 0, 1);
      const top = tmp.copy(m.pos).setY(m.pos.y + 2.9 + (m.ent ? (m.ent.body?.h ?? 1) : 0));
      const s = toUI(top, cam);
      const dist = Math.round(m.pos.distanceTo(L.player.pos));
      const label = `${m.from === net.myId ? 'Ты' : m.name} · ${dist} м`;
      ctx.save();
      ctx.globalAlpha = a;
      if (s.vis && s.x > 30 && s.x < W - 30 && s.y > 30 && s.y < H - 30) {
        ctx.font = '700 16px Rubik, sans-serif';
        const w = ctx.measureText(label).width + 18;
        rrect(ctx, s.x - w / 2, s.y - 24, w, 24, 10, 'rgba(20,10,16,0.75)', 0);
        text(ctx, label, s.x, s.y - 6, { size: 16, weight: 700, color: m.color, align: 'center' });
      } else {
        // arrow at the screen edge toward the marker
        const v = tmp.copy(m.pos).project(cam);
        let ax = v.x, ay = -v.y;
        if (v.z > 1) { ax = -ax; ay = -ay; }
        const len = Math.hypot(ax, ay) || 1;
        const ex = W / 2 + (ax / len) * (W / 2 - 46), ey = H / 2 + (ay / len) * (H / 2 - 46);
        const cx = clamp(ex, 46, W - 46), cy = clamp(ey, 46, bottom(ex, 46));
        const pul = 1 + Math.sin(m.t * 8) * 0.12;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(ay, ax)); ctx.scale(pul, pul);
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-10, -15); ctx.lineTo(-4, 0); ctx.lineTo(-10, 15); ctx.closePath();
        ctx.fillStyle = m.color; ctx.fill(); ctx.lineWidth = 3.5; ctx.lineJoin = 'round'; ctx.strokeStyle = OUT; ctx.stroke();
        ctx.restore();
        const lx = clamp(cx - (ax / len) * 34, 60, W - 60), ly = clamp(cy - (ay / len) * 34, 30, H - 20);
        text(ctx, label, lx, ly + 5, { size: 15, weight: 700, color: m.color, align: 'center', stroke: 4 });
      }
      ctx.restore();
    }
    // friends out of sight: a small arrow in their colour at the screen edge (downed ones get level.ts's red arrow)
    if (!L.worldCut) for (const r of L.nl?.remotes.values() ?? []) {
      if (r.hidden || r.downed || r.dead || r.stale) continue;
      // (the same head point as the nameplate: a friend whose nameplate is on screen gets no arrow as well)
      const s = toUI(tmp.copy(r.pos).setY(r.pos.y + 1.55), cam);
      if (s.vis && s.x > 0 && s.x < W && s.y > 0 && s.y < H) continue;
      const v = tmp.copy(r.pos).project(cam);
      let ax = v.x, ay = -v.y;
      if (v.z > 1) { ax = -ax; ay = -ay; }
      const len = Math.hypot(ax, ay) || 1;
      const cx = clamp(W / 2 + (ax / len) * (W / 2 - 30), 30, W - 30), cy = clamp(H / 2 + (ay / len) * (H / 2 - 30), 30, bottom(W / 2 + (ax / len) * (W / 2 - 30), 30));
      const col = r.look.tagColor || '#ffd34a';
      ctx.save(); ctx.globalAlpha = 0.85;
      ctx.translate(cx, cy); ctx.rotate(Math.atan2(ay, ax));
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, -9); ctx.lineTo(-7, 9); ctx.closePath();
      ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.restore();
      const lx = clamp(cx - (ax / len) * 26, 50, W - 50), ly = clamp(cy - (ay / len) * 22, 24, H - 12);
      text(ctx, r.name, lx, ly + 5, { size: 13, weight: 700, color: col, align: 'center', stroke: 3, alpha: 0.85 });
    }
    // my own speech bubble
    if (this.myBubble && !L.player.dead) {
      const head = toUI(tmp.copy(L.player.pos).setY(L.player.pos.y + 1.55), cam);
      if (head.vis) drawBubble(ctx, this.myBubble.text, head.x, head.y - 30, this.myBubble.t);
    }
    this.chat.draw(ctx);
    drawMicBadge(ctx, 18, H - 32 - this.lift * 190, { t: this.t, alpha: 0.9 });
  }
}

function drawBubble(ctx: C, s: string, x: number, y: number, t: number) {
  const a = clamp(Math.min(t / 0.15, (BUBBLE_S - t) / 0.6), 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = '400 18px Pangolin, sans-serif';
  const lines = wrap(ctx, s, 260).slice(0, 4);
  const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24, bh = lines.length * 22 + 14;
  rrect(ctx, x - bw / 2, y - bh, bw, bh, 12, '#fffaf0', 3);
  ctx.beginPath(); ctx.moveTo(x - 7, y - 1); ctx.lineTo(x, y + 10); ctx.lineTo(x + 7, y - 1); ctx.closePath();
  ctx.fillStyle = '#fffaf0'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
  lines.forEach((l, i) => text(ctx, l, x, y - bh + 26 + i * 22, { size: 18, font: 'body', color: OUT, align: 'center' }));
  ctx.restore();
}

LEVEL_PLUGINS.push((L) => (L.nl ? new SocialPlugin(L) : null));
