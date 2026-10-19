import * as THREE from 'three';
import type { Level3D } from '../../level';
import type { Level3Def } from '../../levels';
import { mat, mesh } from '../../../gfx';
import { vamp } from './kit';

/**
 * `vamp_test` — a small night square to try the whole vampire kit (not part of any episode):
 * every vampire, townsfolk, two grey zones (west: restores itself when cleared; east: by script / test), lanterns
 * (one out — hit it to light it), a dust patch, the red moon. Open it with __goLevel('vamp_test', 0) (dev testkit).
 */

function block(L: Level3D, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string) {
  const m = mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat(color));
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  L.deco(m);
  L.col({ kind: 'box', min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) });
  return m;
}

/** a candy house: walls, a pointed roof, a lit window */
function house(L: Level3D, x: number, z: number, w: number, d: number, h: number, wall: string, roof: string) {
  block(L, x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, wall);
  const r = mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, h * 0.7, 4), mat(roof));
  r.position.set(x, h + h * 0.35, z); r.rotation.y = Math.PI / 4; r.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
  L.deco(r);
  const win = mesh(new THREE.PlaneGeometry(0.9, 1.1), mat('#ffd98a', { emissive: '#ffb040', emissiveIntensity: 0.6 }), { cast: false });
  win.position.set(x, h * 0.55, z + d / 2 + 0.02);
  L.deco(win);
}

export function vampTestLevel(): Level3Def {
  return {
    id: 'vamp_test', chapter: 0, title: 'Вампирский набор', subtitle: 'Тестовая площадь',
    music: 'night_town',
    spawn: [0, 0, 22], yaw: Math.PI, killY: -20,
    bg: '#141a3c', fog: ['#1d2450', 30, 110],
    hemi: ['#7d8cd0', '#2a1d40', 0.9], sun: { color: '#c4d0ff', intensity: 1.4, dir: [-0.45, 0.62, -0.65] },
    build(L) {
      const V = vamp(L);
      V.nightLook({ red: 0.85 });
      V.moon({ size: 30 });
      // the square: cobbles, a fountain, candy houses around
      block(L, -42, -1, -40, 42, 0, 34, '#8a7f9c');
      block(L, -3, 0, -3, 3, 0.8, 3, '#d8b8e8');
      block(L, -1, 0.8, -1, 1, 2.4, 1, '#f0d8f8');
      house(L, -24, -30, 8, 6, 5, '#ffb3c8', '#c0405a');
      house(L, -10, -32, 7, 6, 6, '#c2f0d8', '#3a8a6a');
      house(L, 6, -31, 8, 6, 5.5, '#ffe0a8', '#d07a2a');
      house(L, 22, -30, 9, 6, 6, '#d8c8ff', '#6a4ac0');
      house(L, -34, 0, 6, 9, 5, '#ffd0a8', '#a0502a');
      house(L, 34, -4, 6, 9, 6, '#ffb3c8', '#8a3060');
      // a terrace (the flyer's perch)
      block(L, 26, 0, 14, 36, 2.2, 26, '#b8a0c8');
      block(L, 23, 0, 14, 26, 1.1, 20, '#c8b0d8');

      // colour of the world
      V.greyZone('west', [-18, 0, -8], 13, { auto: 'clear' });
      V.greyZone('east', [18, 0, -8], 12, { auto: 'none' });
      // light
      V.lantern(0, 0, 11);
      V.lantern(-7, 0, 1);
      V.lantern(9, 0, -13, { lit: false });
      V.lantern(-4, 0, 16, { r: 4.5 });
      V.dustZone([24, 0, -14], 4);

      // west: biters and sleepy townsfolk
      L.enemy('fanger', -18, 0, -12);
      L.enemy('fanger', -22, 0, -4);
      V.folk(-14, 0, -4, 'zefir');
      V.folk(-20, 0, -14, 'pryanik');
      V.folk(-24, 0, -8, 'marmelad');
      // east: the big one, the mist one, the invisible one
      L.enemy('brute', 18, 0, -6);
      L.enemy('mist', 14, 0, -14);
      L.enemy('servant', 22, 0, -12);
      V.folk(20, 0, -2, 'marmelad');
      V.folk(14, 0, -4, 'zefir');
      // the sky: a flyer over the terrace, a flock of bats over the fountain
      L.enemy('flyer', 30, 6, 20);
      V.flock(0, 4, -12, 4);
      L.signAt(0, 0, 18, 'Вампирский набор: солнышки (фонари) отпугивают вампиров. Оглушите пресняка и ударьте ещё раз — он снова цветной!');
    },
  };
}
