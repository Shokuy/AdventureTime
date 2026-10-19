import type * as THREE from 'three';
import type { Level3D } from '../../level';

/** an overlay the hub shows over the town (input goes to it while it is open) */
export interface TownOverlay {
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
  /** true once it closed itself */
  done(): boolean;
  dispose?(): void;
}

/**
 * Hooks other modules can fill to plug into the hub town:
 *  • heroPicker — the hero roster's picker for «Зеркало героев» (the mirror opens it; null → a «скоро» toast);
 *  • labScene — a scene the lab plays on entry for a given arc stage (interludes between series, 5.9 / 6.7 …):
 *    return a story script name (registered with addScripts) or null.
 */
export const TOWN_HOOKS: {
  heroPicker: ((L: Level3D, at: THREE.Vector3, close: () => void) => TownOverlay | null) | null;
  labScene: ((stage: number) => string | null) | null;
} = { heroPicker: null, labScene: null };
