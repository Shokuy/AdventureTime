import * as THREE from 'three';
import type { Collider, Hazard, BoxCol, CylCol } from './types';

/** A character body: vertical cylinder standing on `pos` (feet center). */
export interface Body {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  r: number;
  h: number;
  onGround: boolean;
  ground: Collider | null;
  gravity: number;
  maxFall: number;
  hitWall: boolean;
  bounced: boolean;
  /** collider landed on this frame (for crumble/jelly reactions) */
  landedOn: Collider | null;
  stepUp: number;
}

export function makeBody(r: number, h: number): Body {
  return {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), r, h,
    onGround: false, ground: null, gravity: 32, maxFall: 40, hitWall: false, bounced: false, landedOn: null, stepUp: 0.42,
  };
}

const top = (c: Collider) => (c.kind === 'box' ? c.max.y : c.y1);
const bottom = (c: Collider) => (c.kind === 'box' ? c.min.y : c.y0);

/** distance (xz) from point to collider footprint; negative-ish inside */
function xzDist(c: Collider, x: number, z: number): number {
  if (c.kind === 'box') {
    const cx = Math.max(c.min.x, Math.min(x, c.max.x));
    const cz = Math.max(c.min.z, Math.min(z, c.max.z));
    return Math.hypot(x - cx, z - cz);
  }
  return Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r);
}

export class PhysWorld {
  cols: Collider[] = [];
  hazards: Hazard[] = [];
  /** extra solid colliders that move (boss hands etc) can be pushed here and removed later */

  add(c: Collider | Collider[]) { if (Array.isArray(c)) this.cols.push(...c); else this.cols.push(c); }
  addHazards(h?: Hazard[]) { if (h) this.hazards.push(...h); }
  remove(c: Collider) { const i = this.cols.indexOf(c); if (i >= 0) this.cols.splice(i, 1); }

  private on(c: Collider) { return c.active !== false; }

  /** Move a body for dt seconds with collisions. */
  move(b: Body, dt: number) {
    const speed = Math.hypot(b.vel.x, b.vel.z);
    const steps = Math.max(1, Math.ceil((speed * dt) / (b.r * 0.8)));
    const sdt = dt / steps;
    b.hitWall = false; b.bounced = false; b.landedOn = null;
    const wasGround = b.onGround;
    for (let i = 0; i < steps; i++) this.horizontal(b, sdt, wasGround);
    this.vertical(b, dt, wasGround);
  }

  private horizontal(b: Body, dt: number, grounded: boolean) {
    b.pos.x += b.vel.x * dt;
    b.pos.z += b.vel.z * dt;
    const step = grounded ? b.stepUp : 0.08;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.cols) {
        if (!this.on(c) || (c.kind === 'cyl' && c.oneWay)) continue;
        const t = top(c), bo = bottom(c);
        if (t <= b.pos.y + step) continue; // low enough to step onto / stand on
        if (bo >= b.pos.y + b.h - 0.02) continue; // above head
        if (c.kind === 'box') this.pushBox(b, c);
        else this.pushCyl(b, c);
      }
    }
  }

  private pushBox(b: Body, c: BoxCol) {
    const x = b.pos.x, z = b.pos.z, r = b.r;
    if (x < c.min.x - r || x > c.max.x + r || z < c.min.z - r || z > c.max.z + r) return;
    const cx = Math.max(c.min.x, Math.min(x, c.max.x));
    const cz = Math.max(c.min.z, Math.min(z, c.max.z));
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) return;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = r - d;
      b.pos.x += (dx / d) * push; b.pos.z += (dz / d) * push;
      // remove velocity into the wall
      const nx = dx / d, nz = dz / d;
      const vn = b.vel.x * nx + b.vel.z * nz;
      if (vn < 0) { b.vel.x -= vn * nx; b.vel.z -= vn * nz; }
    } else {
      // center inside: push out through the nearest face
      const l = x - c.min.x, rr = c.max.x - x, f = z - c.min.z, k = c.max.z - z;
      const m = Math.min(l, rr, f, k);
      if (m === l) { b.pos.x = c.min.x - r; if (b.vel.x > 0) b.vel.x = 0; }
      else if (m === rr) { b.pos.x = c.max.x + r; if (b.vel.x < 0) b.vel.x = 0; }
      else if (m === f) { b.pos.z = c.min.z - r; if (b.vel.z > 0) b.vel.z = 0; }
      else { b.pos.z = c.max.z + r; if (b.vel.z < 0) b.vel.z = 0; }
    }
    b.hitWall = true;
  }

  private pushCyl(b: Body, c: CylCol) {
    const dx = b.pos.x - c.x, dz = b.pos.z - c.z;
    const R = b.r + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) return;
    const d = Math.sqrt(d2) || 0.0001;
    const nx = dx / d, nz = dz / d;
    b.pos.x = c.x + nx * R; b.pos.z = c.z + nz * R;
    const vn = b.vel.x * nx + b.vel.z * nz;
    if (vn < 0) { b.vel.x -= vn * nx; b.vel.z -= vn * nz; }
    b.hitWall = true;
  }

  private vertical(b: Body, dt: number, wasGround: boolean) {
    if (b.gravity) b.vel.y = Math.max(b.vel.y - b.gravity * dt, -b.maxFall);
    const ny = b.pos.y + b.vel.y * dt;
    const foot = b.r * 0.62;
    if (b.vel.y <= 0) {
      const allowUp = wasGround ? b.stepUp : 0.02;
      let gy = -Infinity; let gc: Collider | null = null;
      for (const c of this.cols) {
        if (!this.on(c)) continue;
        const t = top(c);
        if (t > b.pos.y + allowUp) continue;
        if (c.kind === 'cyl' && c.oneWay && (b.pos.y < t - 0.05 || b.vel.y > 0)) continue;
        if (t < ny - 0.001 && !(wasGround && t >= b.pos.y - 0.45)) continue;
        if (xzDist(c, b.pos.x, b.pos.z) > foot) continue;
        if (t > gy) { gy = t; gc = c; }
      }
      if (gc && (ny <= gy || (wasGround && gy >= b.pos.y - 0.45))) {
        b.pos.y = gy;
        const bounce = gc.bounce;
        if (bounce && b.vel.y < -2) {
          b.vel.y = bounce; b.bounced = true; b.onGround = false; b.ground = null;
        } else {
          b.vel.y = 0; b.onGround = true; b.ground = gc;
        }
        if (!wasGround) b.landedOn = gc;
        return;
      }
      b.pos.y = ny; b.onGround = false; b.ground = null;
      return;
    }
    // moving up: ceilings
    let cy = Infinity;
    for (const c of this.cols) {
      if (!this.on(c) || (c.kind === 'cyl' && c.oneWay)) continue;
      const bo = bottom(c);
      if (bo < b.pos.y + b.h - 0.05 || bo > ny + b.h) continue;
      if (xzDist(c, b.pos.x, b.pos.z) > foot) continue;
      cy = Math.min(cy, bo);
    }
    if (cy < Infinity) { b.pos.y = cy - b.h; b.vel.y = 0; }
    else b.pos.y = ny;
    b.onGround = false; b.ground = null;
  }

  /** highest walkable surface at (x,z) at or below maxY */
  groundAt(x: number, z: number, maxY: number, radius = 0): number {
    let gy = -Infinity;
    for (const c of this.cols) {
      if (!this.on(c)) continue;
      const t = top(c);
      if (t > maxY) continue;
      if (xzDist(c, x, z) > radius) continue;
      if (t > gy) gy = t;
    }
    return gy;
  }

  pointInSolid(p: THREE.Vector3, ignoreTag?: string) {
    for (const c of this.cols) {
      if (!this.on(c) || (c.kind === 'cyl' && c.oneWay)) continue;
      if (ignoreTag && c.tag === ignoreTag) continue;
      if (c.kind === 'box') {
        if (p.x >= c.min.x && p.x <= c.max.x && p.y >= c.min.y && p.y <= c.max.y && p.z >= c.min.z && p.z <= c.max.z) return c;
      } else if (p.y >= c.y0 && p.y <= c.y1 && Math.hypot(p.x - c.x, p.z - c.z) <= c.r) return c;
    }
    return null;
  }

  /** ray cast against all colliders (but those `skip` says no to); returns hit distance or maxDist */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, skip?: (c: Collider) => boolean): number {
    let best = maxDist;
    for (const c of this.cols) {
      if (!this.on(c) || (c.kind === 'cyl' && c.oneWay) || (skip && skip(c))) continue;
      const t = c.kind === 'box' ? rayBox(o, d, c) : rayCyl(o, d, c);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }

  hazardAt(b: Body): Hazard | null {
    for (const h of this.hazards) {
      if (b.pos.x + b.r * 0.7 < h.min.x || b.pos.x - b.r * 0.7 > h.max.x) continue;
      if (b.pos.z + b.r * 0.7 < h.min.z || b.pos.z - b.r * 0.7 > h.max.z) continue;
      if (b.pos.y + b.h < h.min.y || b.pos.y > h.max.y) continue;
      return h;
    }
    return null;
  }
}

function rayBox(o: THREE.Vector3, d: THREE.Vector3, c: BoxCol): number {
  let tmin = -Infinity, tmax = Infinity;
  for (const ax of ['x', 'y', 'z'] as const) {
    const od = d[ax], oo = o[ax];
    if (Math.abs(od) < 1e-9) {
      if (oo < c.min[ax] || oo > c.max[ax]) return -1;
    } else {
      let t1 = (c.min[ax] - oo) / od, t2 = (c.max[ax] - oo) / od;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}

function rayCyl(o: THREE.Vector3, d: THREE.Vector3, c: CylCol): number {
  const ox = o.x - c.x, oz = o.z - c.z;
  const a = d.x * d.x + d.z * d.z;
  const bq = 2 * (ox * d.x + oz * d.z);
  const cq = ox * ox + oz * oz - c.r * c.r;
  let t = -1;
  if (cq <= 0) { if (o.y >= c.y0 && o.y <= c.y1) return 0; }
  if (a > 1e-9) {
    const disc = bq * bq - 4 * a * cq;
    if (disc >= 0) {
      const t1 = (-bq - Math.sqrt(disc)) / (2 * a);
      if (t1 >= 0) { const y = o.y + d.y * t1; if (y >= c.y0 && y <= c.y1) t = t1; }
    }
  }
  // caps
  if (Math.abs(d.y) > 1e-9) {
    for (const yy of [c.y0, c.y1]) {
      const tc = (yy - o.y) / d.y;
      if (tc >= 0 && (t < 0 || tc < t)) {
        const x = ox + d.x * tc, z = oz + d.z * tc;
        if (x * x + z * z <= c.r * c.r) t = tc;
      }
    }
  }
  return t;
}
