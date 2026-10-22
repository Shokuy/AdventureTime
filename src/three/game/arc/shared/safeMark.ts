import * as THREE from 'three';
import type { Level3D } from '../../level';
import type { Collider } from '../../../physics/types';

/*
 * safeMark — the «правило меток» of docs/script-fangs-v2.md §0: a scene mark never stands inside a house.
 *
 *   const p = safeMark(L, V(x, 0, z));                          // → a Vector3 on the ground, free of walls / roofs
 *   const p = safeMark(L, V(x, 0, z), { wall: 0.8, label: '5.1 Мармеладка' });
 *   cast.place('tosha', ...safeMark(L, V(x, y, z)).toArray(), yaw);
 *
 * What it does: drops the mark onto `phys.groundAt` (the highest walkable surface under it, up to `maxRise` above the
 * given y); then, if there is a roof / ceiling above it (a collider whose bottom is 0.3–3 m over the mark), or a wall /
 * prop closer than `wall` m (default 1.2), or another mark claimed by this level in the last ~3 s closer than `spacing`
 * m (default 0.9), it walks a spiral out from the mark (rings every 0.5 m, up to `maxR`, default 4 m) and takes the first
 * free spot at about the same ground height. In dev it warns in the console whenever a mark had to move (or no free
 * spot was found — then the original, grounded mark is returned). Cheap enough for every place() of a scene.
 */

export interface SafeMarkOpts {
  /** keep at least this far (m) from walls and props (default 1.2; the doc's lab rule is 1.5) */
  wall?: number;
  /** keep at least this far (m) from other marks claimed in the last few seconds (default 0.9) */
  spacing?: number;
  /** how far (m) the search may move the mark (default 4) */
  maxR?: number;
  /** check for a roof / ceiling over the mark (default true; turn off inside rooms with a low ceiling) */
  roof?: boolean;
  /** the ground may be at most this much above the given y (default 1.2: steps and kerbs, not roofs) */
  maxRise?: number;
  /** don't snap to the ground (marks in the air: a ladder top, a parapet you want exactly) */
  keepY?: boolean;
  /** colliders to ignore (e.g. the figure's own blocker, a table you WANT them at) */
  ignore?: (c: Collider) => boolean;
  /** extra marks to keep clear of (besides the auto-registry) */
  others?: THREE.Vector3[];
  /** don't record this mark in the registry (it won't push later marks away) */
  noClaim?: boolean;
  /** a name for the dev warning */
  label?: string;
}

interface Claim { p: THREE.Vector3; at: number }
const claims = new WeakMap<Level3D, Claim[]>();
const CLAIM_LIFE = 3000;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const DEV = (() => { try { return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV; } catch { return false; } })();

/** forget the marks this level has claimed (call at the top of a scene if marks of the previous one linger) */
export function clearMarks(L: Level3D) { claims.delete(L); }

function live(L: Level3D): Claim[] {
  const t = now();
  const list = (claims.get(L) ?? []).filter((c) => t - c.at < CLAIM_LIFE);
  claims.set(L, list);
  return list;
}

const on = (c: Collider) => c.active !== false && !(c.kind === 'cyl' && c.oneWay);
const bottomOf = (c: Collider) => (c.kind === 'box' ? c.min.y : c.y0);
const topOf = (c: Collider) => (c.kind === 'box' ? c.max.y : c.y1);
/** horizontal distance from (x, z) to the collider's footprint (0 inside) */
function xzDist(c: Collider, x: number, z: number) {
  if (c.kind === 'box') {
    const dx = Math.max(c.min.x - x, 0, x - c.max.x), dz = Math.max(c.min.z - z, 0, z - c.max.z);
    return Math.hypot(dx, dz);
  }
  return Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r);
}

/** why (x, y, z) is not a good mark ('' = fine) */
function problem(L: Level3D, x: number, y: number, z: number, o: Required<Pick<SafeMarkOpts, 'wall' | 'spacing' | 'roof'>> & SafeMarkOpts, marks: THREE.Vector3[]): string {
  for (const c of L.phys.cols) {
    if (!on(c) || (o.ignore && o.ignore(c))) continue;
    const b = bottomOf(c), t = topOf(c);
    // (the floor itself, and anything that tops out under the knees, is not a wall)
    if (t <= y + 0.35) continue;
    const d = xzDist(c, x, z);
    if (o.roof && b > y + 0.3 && b <= y + 3 && d <= 0.25) return 'roof';
    if (b > y + 1.7) continue; // over the head: a lintel, a balcony — only a roof if right above
    // a figure's own blocker (small cylinder right on the spot) is not a wall
    if (c.kind === 'cyl' && c.r < 0.6 && Math.hypot(c.x - x, c.z - z) < 0.3) continue;
    if (d < o.wall) return d <= 0 ? 'inside' : 'wall';
  }
  for (const m of marks) if (Math.hypot(m.x - x, m.z - z) < o.spacing) return 'crowd';
  return '';
}

/** a scene mark on the ground, clear of walls, roofs and other marks (see the file's header) */
export function safeMark(L: Level3D, v: THREE.Vector3, opts: SafeMarkOpts = {}): THREE.Vector3 {
  const o = { wall: 1.2, spacing: 0.9, roof: true, ...opts };
  const maxR = opts.maxR ?? 4, rise = opts.maxRise ?? 1.2;
  const marks = [...live(L).map((c) => c.p), ...(opts.others ?? [])];
  const ground = (x: number, z: number, y: number) => {
    if (opts.keepY) return y;
    const gy = L.phys.groundAt(x, z, y + rise, 0.2);
    return isFinite(gy) && gy > y - 6 ? gy : y;
  };
  const y0 = ground(v.x, v.z, v.y);
  let best = new THREE.Vector3(v.x, y0, v.z);
  const why = problem(L, v.x, y0, v.z, o, marks);
  if (why) {
    let found: THREE.Vector3 | null = null;
    outer: for (let r = 0.5; r <= maxR + 1e-6; r += 0.5) {
      const n = Math.max(8, Math.round((Math.PI * 2 * r) / 0.5));
      for (let i = 0; i < n; i++) {
        // start toward the open side of the spiral alternately (left/right of the first angle)
        const k = i % 2 ? -Math.ceil(i / 2) : Math.ceil(i / 2);
        const a = (k / n) * Math.PI * 2;
        const x = v.x + Math.sin(a) * r, z = v.z + Math.cos(a) * r;
        const y = ground(x, z, v.y);
        if (Math.abs(y - y0) > 0.6) continue;
        if (!problem(L, x, y, z, o, marks)) { found = new THREE.Vector3(x, y, z); break outer; }
      }
    }
    if (DEV) console.warn(`[safeMark] ${opts.label ?? 'mark'} (${v.x.toFixed(1)}, ${v.z.toFixed(1)}): ${why} → ${found ? `moved to (${found.x.toFixed(1)}, ${found.z.toFixed(1)})` : 'no free spot nearby, kept'}`);
    if (found) best = found;
  }
  if (!opts.noClaim) live(L).push({ p: best.clone(), at: now() });
  return best;
}

/** safeMark for a list of marks at once (in order: earlier marks push later ones) */
export function safeMarks<K extends string>(L: Level3D, marks: Record<K, THREE.Vector3>, opts: SafeMarkOpts = {}): Record<K, THREE.Vector3> {
  const out = {} as Record<K, THREE.Vector3>;
  for (const k of Object.keys(marks) as K[]) out[k] = safeMark(L, marks[k], { ...opts, label: `${opts.label ?? ''}${opts.label ? ' ' : ''}${k}` });
  return out;
}

/** a mark offset from a landmark: base + (dx, dz) rotated by `yaw` (the landmark's facing), then safeMark */
export function markFrom(L: Level3D, base: THREE.Vector3, dx: number, dz: number, opts: SafeMarkOpts & { yaw?: number } = {}): THREE.Vector3 {
  const yaw = opts.yaw ?? 0, s = Math.sin(yaw), c = Math.cos(yaw);
  const v = new THREE.Vector3(base.x + dx * c + dz * s, base.y, base.z - dx * s + dz * c);
  return safeMark(L, v, opts);
}
