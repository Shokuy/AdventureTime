import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { choose, rand } from '../../../../engine/util';
import { Enemy3, ENEMY_KINDS, type EnemyOpts } from '../../enemies';
import type { Level3D } from '../../level';
import { vamp, type FolkLike } from '../vampires/kit';
import { markCharacter, greyHandle } from '../vampires/greyShader';
import { createStars, spinStars } from '../vampires/models';
import { ambient } from '../vampires/fxUtil';
import { Mats, G, part, grp, damp } from '../../../models/kit';
import { FLOWER_SLEEPY, FLOWER_THANKS } from './lines';

/**
 * Цветы-пресняки (docs/script-fangs.md §7.2.3): grey potted night flowers the vampires drained, drooping and sighing.
 * Like the townsfolk of the kit (they count for «Расколдовано N из M» and a grey zone's auto-restore): any hit stuns
 * them (stars), a sword / spin / fork hit while stunned — or a 'chord' / 'syrup' hit, or vamp(L).restoreAround —
 * makes them bloom again: colour, petals open, a thank-you. Never harmful. Host decides; clients follow 'gone'.
 */

declare module '../../enemies' {
  interface ExtraEnemyKinds { gflower: true }
}

const RESTORE = new Set(['sword', 'spin', 'fork', 'punch']);
const COLORS = [['#d0409a', '#ff8ad8'], ['#7a3ac8', '#c08aff'], ['#ff8a3a', '#ffd34a'], ['#3a7ad8', '#8ad0ff']] as const;

interface FlowerRig { root: THREE.Group; M: Mats; update(dt: number, droop: number, stun: boolean, bloom: number, t: number): void; top: number }

function createGreyFlower(seed: number): FlowerRig {
  const M = new Mats();
  const root = new THREE.Group();
  const [c1, c2] = COLORS[seed % COLORS.length];
  // a terracotta pot with a face
  const pot = grp(root, [0, 0, 0]);
  part(pot, G.cyl(), M.get('#c0704a'), [0, 0.22, 0], [0.28, 0.44, 0.28]);
  part(pot, G.torus(0.3, 0.05), M.get('#a85a3a'), [0, 0.44, 0], 1, [Math.PI / 2, 0, 0]);
  part(pot, G.cyl(), M.get('#4a3428'), [0, 0.44, 0], [0.26, 0.04, 0.26]);
  const eyeM = M.get('#2a1b1a');
  const eyes: THREE.Mesh[] = [];
  for (const s of [-1, 1]) eyes.push(part(pot, G.ball(), eyeM, [s * 0.09, 0.27, 0.27], [0.035, 0.02, 0.02], undefined, { cast: false }));
  const mouth = part(pot, G.arc(0.05, 0.012, Math.PI), eyeM, [0, 0.17, 0.28], 1, [0, 0, 0], { cast: false });
  // the stem bends at its base
  const stem = grp(root, [0, 0.44, 0]);
  part(stem, G.cyl(), M.get('#3a8a4a'), [0, 0.45, 0], [0.045, 0.9, 0.045]);
  for (const s of [-1, 1]) part(stem, G.sphere(), M.get('#4a9a5a'), [s * 0.16, 0.3, 0], [0.18, 0.03, 0.08], [0, 0, s * 0.5]);
  const head = grp(stem, [0, 0.92, 0]);
  part(head, G.sphere(), M.get('#ffd34a'), [0, 0, 0], 0.11);
  const petals: THREE.Group[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const pv = grp(head, [0, 0, 0], [0, a, 0]);
    part(pv, G.sphere(), M.get(i % 2 ? c1 : c2), [0, 0, 0.2], [0.09, 0.025, 0.2]);
    petals.push(pv);
  }
  return {
    root, M, top: 1.5,
    update(dt, droop, stun, bloom, t) {
      stem.rotation.x = droop * 1.1 + (stun ? Math.sin(t * 9) * 0.15 : Math.sin(t * 1.3) * 0.05);
      stem.rotation.z = Math.sin(t * 0.9) * 0.06 * (1 - droop);
      for (const pv of petals) pv.rotation.x = -0.2 - (1 - bloom) * 1.1 + bloom * 0.35;
      head.scale.setScalar(0.85 + bloom * 0.3 + (bloom > 0.9 ? Math.sin(t * 4) * 0.03 : 0));
      for (const e of eyes) e.scale.y = droop > 0.5 ? 0.008 : 0.02 + bloom * 0.025;
      mouth.rotation.z = bloom > 0.5 ? Math.PI : 0;
      void dt;
    },
  };
}

export class Flower3 extends Enemy3 implements FolkLike {
  readonly folk = true as const;
  rig: FlowerRig;
  stars = createStars();
  private setGrey: (k: number) => void;
  private grey = 1;
  private bloom = 0;
  private droop = 1;
  private netStun = false;
  private yawnT = rand(5, 12);
  private checked = false;
  private thanks = '';
  private thankT = -1;
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('gflower', pos, 0.32, 1.2);
    const seed = Math.abs(Math.round(pos.x * 7 + pos.z * 13));
    this.rig = createGreyFlower(seed);
    this.root.add(this.rig.root);
    markCharacter(this.rig.root);
    this.setGrey = greyHandle(this.rig.root);
    this.setGrey(1);
    this.stars.position.y = this.rig.top;
    this.root.add(this.stars);
    this.hp = this.maxHp = 1; this.loot = 0; this.contact = 0;
    this.yaw = o.yaw ?? rand(0, Math.PI * 2);
    this.body.gravity = 0;
  }
  provoke() { /* flowers don't fight */ }

  update(L: Level3D, dt: number) {
    if (!this.checked) {
      this.checked = true;
      vamp(L).folkTotal++;
      if (this.key && L.seen.has(this.key)) { this.bloomQuiet(L); return; }
    }
    if (this.thankT >= 0) { this.afterBloom(L, dt); return; }
    super.update(L, dt);
  }

  tick(L: Level3D, dt: number) {
    if (this.stun > 0) this.stun -= dt;
    this.body.vel.set(0, 0, 0);
    if ((this.yawnT -= dt) <= 0) {
      this.yawnT = rand(9, 16);
      if (L.heroes().some((h) => h.pos.distanceTo(this.body.pos) < 9)) L.bark(this.root, choose(FLOWER_SLEEPY as unknown as string[]), 1.8, this.rig.top + 0.3);
    }
  }

  hurt(L: Level3D, _dmg: number, _from: THREE.Vector3, kind: string) {
    if (!L.authority || this.dead || this.thankT >= 0) return;
    if (kind === 'chord' || kind === 'syrup' || kind === 'sun' || (this.stun > 0 && RESTORE.has(kind))) { this.restore(L, L.attacker); return; }
    const fresh = this.stun <= 0;
    this.stun = 5;
    this.flash = 1;
    audio.sfx('pogo', { pitch: 1.1, volume: 0.5 });
    L.fx.stars(this.center().setY(this.body.pos.y + this.rig.top), 10);
    if (fresh) L.hint('f3flower', 'Цветок оглушён! Ударьте его ещё раз — и он снова зацветёт');
  }

  /** bloom again (host / solo) */
  restore(L: Level3D, by: string | null = null) {
    if (!L.authority || this.dead || this.thankT >= 0) return;
    const li = Math.floor(Math.random() * FLOWER_THANKS.length);
    L.nl?.gone(this, 'restore', this.center(), { li, by: by ?? undefined });
    this.dead = true; // (leaves the enemy list; keeps drawing itself as an actor below)
    this.hp = 0;
    this.burst(L, li);
    for (let i = 0; i < 2; i++) L.dropPickup('crumb', this.center());
    L.countKill(this);
    vamp(L).restoredOne(this, by);
  }

  private burst(L: Level3D, li: number) {
    const c = this.center().setY(this.body.pos.y + 1.3);
    const cols = COLORS[Math.abs(Math.round(this.body.pos.x * 7 + this.body.pos.z * 13)) % COLORS.length];
    ambient(L, () => {
      audio.sfx('colorRestore', { pitch: 1.15 });
      L.fx.stars(c, 22, [cols[0], cols[1], '#ffe27a']);
      L.fx.emit(c, { count: 24, speed: [1, 3], life: [0.6, 1.2], size: [0.1, 0.2], colors: [cols[0], cols[1], '#ffffff'], g: 3, drag: 1.5 });
      L.fx.ring(this.body.pos.clone().setY(this.body.pos.y + 0.08), 1.8, cols[0], 0.45);
    });
    this.thanks = FLOWER_THANKS[li % FLOWER_THANKS.length];
    this.thankT = 0;
    this.stars.visible = false;
    // keep showing (it is out of L.enemies now): an actor drives the bloom
    L.actors.push({ update: (L2, dt) => this.afterBloom(L2, dt), dead: false });
  }
  private bloomQuiet(L: Level3D) {
    this.dead = true;
    L.nl?.remove(this);
    this.grey = 0; this.bloom = 1; this.droop = 0; this.thankT = 99;
    this.setGrey(0);
    vamp(L).restoredOne(this, null, true);
    L.actors.push({ update: (L2, dt) => this.afterBloom(L2, dt) });
    // (the enemy list drops it, but the root stays in the scene)
    queueMicrotask(() => { if (!this.root.parent) L.scene.add(this.root); });
  }
  private afterBloom(L: Level3D, dt: number) {
    if (!this.root.parent) L.scene.add(this.root);
    this.t += dt;
    this.thankT += dt;
    this.grey = damp(this.grey, 0, 4, dt);
    this.bloom = damp(this.bloom, 1, 3, dt);
    this.droop = damp(this.droop, 0, 4, dt);
    this.setGrey(this.grey);
    if (this.thanks && this.thankT > 0.3) { L.bark(this.root, this.thanks, 2.2, this.rig.top + 0.3); this.thanks = ''; }
    this.root.position.copy(this.body.pos);
    this.rig.update(dt, this.droop, false, this.bloom, this.t);
  }

  netEvent(L: Level3D, ev: string, data?: unknown) {
    if (ev === 'gone') {
      const d = (data ?? {}) as { how?: string; li?: number; by?: string };
      if (d.how === 'restore' && this.thankT < 0) {
        this.dead = true;
        L.countKill(this);
        this.burst(L, d.li ?? 0);
        vamp(L).restoredOne(this, d.by ?? null);
        return;
      }
    }
    super.netEvent(L, ev);
  }
  protected netExtra(): number[] { return [this.stun > 0 ? 1 : 0]; }
  protected netExtraApply(a: number[], i: number) { this.netStun = !!a[i]; }

  sync(L: Level3D, dt: number) {
    super.sync(L, dt);
    const stunned = L.authority ? this.stun > 0 : this.netStun;
    this.stars.visible = stunned && !this.dead;
    if (stunned) spinStars(this.stars, this.t, 0.3);
  }
  syncRig(dt: number) {
    const stunned = this.stun > 0 || this.netStun;
    this.droop = damp(this.droop, stunned ? 1.2 : 1, 6, dt);
    this.setGrey(this.grey);
    this.rig.M.flash(this.flash);
    this.rig.update(dt, this.droop, stunned, this.bloom, this.t);
  }
  deathFx() { /* bloomed, not killed */ }
}

ENEMY_KINDS.gflower = (p, o) => new Flower3(p, o);
