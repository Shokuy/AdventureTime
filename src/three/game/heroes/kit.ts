import type * as THREE from 'three';
import type { HeroFx } from '../../models/hero';
import type { HeroKind } from '../../../net/profile';
import type { Level3D } from '../level';
import type { Player3 } from '../player';
import type { RemoteHero3 } from '../remoteHero';

/**
 * A hero's abilities, plugged into Player3 (my hero). Player3 keeps the shared core — camera-relative movement,
 * jump + coyote time, physics, hurt / downed / revive, heal, emotes, boost jumps on friends' heads, the net state —
 * and asks the kit at a few points. Every hook is optional: no hook = Tosha's behaviour there (the `tosha` kit
 * has none, so he plays exactly as before). Kits live in src/three/game/heroes/<kind>.ts.
 *
 * Order inside Player3.update (free hero, not dead / downed / grabbed):
 *   pre → (locked? no steering) → dash (dash / special-as-dash) → dashTick → jump (airJump) → shoot → attack → special
 *   → physics → post → attack processing (processAttack)
 */
export interface HeroKit {
  readonly kind: HeroKind;
  /** run speed (m/s; Tosha 7.6) */
  run: number;
  /** jump take-off speed (Tosha 11.6) */
  jump: number;
  /** may swap weapons (Tosha's sword / fork) */
  swap?: boolean;
  /** moves this hero has from the start (Tosha earns them in the prologue: save.data.abilities) */
  innate?: { sling?: boolean; doubleJump?: boolean; dash?: boolean };
  /** the pose of a shot with the shared slingshot code (default 'sling') */
  shotAtk?: import('../../models/hero').HeroAtk;

  /** every tick before movement is read (ctl: the player may act) */
  pre?(L: Level3D, dt: number, ctl: boolean): void;
  /** the hero is rooted (bridging, pulling…): no steering, no walking, no jumping */
  locked?(): boolean;
  /** walking speed factor (1 = normal) */
  moveMul?(): number;
  /** dash pressed (ground or air dash allowed): start the kit's dash, true if it started. None = Tosha's dash */
  dash?(L: Level3D, mx: number, mz: number): boolean;
  /** while p.dashT > 0: drive the body (None = Tosha's straight 21 m/s dash) */
  dashTick?(L: Level3D, dt: number): void;
  /** jump pressed in the air (no coyote): true if handled. None = Tosha's double jump (when unlocked) */
  airJump?(L: Level3D): boolean;
  /** replaces the slingshot (the shoot button) entirely */
  shoot?(L: Level3D, dt: number, ctl: boolean): void;
  /**
   * keeps the shared slingshot controls (tap = auto-aimed shot, hold = aim mode; needs `innate.sling`) but fires the
   * hero's own shot instead of a pea, ammo-free: `dir` is a unit vector from `from`. Returns the cooldown (s).
   */
  fire?(L: Level3D, from: THREE.Vector3, dir: THREE.Vector3): number;
  /** how far the quick shot's auto-aim looks for a target (m, default 24) */
  fireRange?: number;
  /** co-op: how fast this hero lifts a downed friend (1 = normal; Пастила 2) */
  reviveMul?: number;
  /** kit UI on the HUD canvas (after the HUD; e.g. Пастила's gadget wheel) */
  hud?(ctx: CanvasRenderingContext2D, L: Level3D): void;
  /** attack pressed: start the kit's attack (set p.atk / atkDur / atkCD), true if handled */
  attack?(L: Level3D): boolean;
  /** attack in progress (k = 0..1): hit detection; true if handled */
  processAttack?(L: Level3D, k: number): boolean;
  /** the special / team move button (input 'special'), every tick. None = it works as a dash */
  special?(L: Level3D, dt: number, ctl: boolean): void;
  /** every tick after the physics step */
  post?(L: Level3D, dt: number): void;
  /** I got hurt / knocked down / grabbed: drop whatever the kit holds (bridge, balloon, grapple) */
  interrupt?(L: Level3D): void;
  /** respawn / level start */
  reset?(): void;
  /** what the rig shows (HeroFx) */
  fx(): HeroFx;
  /** extra expression while a kit move is on (e.g. straining while bridging) */
  expr?(): 'angry' | 'surprised' | 'happy' | null;
  /** ability bar in the HUD: 0..1 cooldown fill + label (optional) */
  meter?(): { k: number; label: string } | null;
  dispose?(L: Level3D): void;
}

/** a friend's hero kit as seen here: colliders friends' physics can use, effects from his state stream */
export interface RemoteKitView {
  update(L: Level3D, r: RemoteHero3, fx: HeroFx, dt: number): void;
  dispose(L: Level3D): void;
}

/** kits get the player they belong to */
export type KitFactory = (p: Player3) => HeroKit;
