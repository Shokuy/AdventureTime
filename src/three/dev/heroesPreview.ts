import * as THREE from 'three';
import { Renderer3D } from '../render';
import { setupSun } from '../lighting';
import { mat } from '../gfx';
import { createHeroModel, type HeroKind } from '../models/heroes';
import type { HeroAnim, HeroAtk, HeroFx, HeroRig, HeroState, HeroExpr } from '../models/hero';
import { HERO_KINDS } from '../../net/profile';

/* Dev page: http://localhost:5173/heroes-preview.html — the four playable heroes side by side with the game's renderer
 * (toon + outlines). URL: ?kinds=tosha,bublik&state=run&atk=punch&p=0.4&fx=reach:2,bridge:6&yaw=0.6&dist=4&h=1&expr=happy
 * Script API: window.__pv.set({...same keys}) then __pv.frame(n) (steps n×1/60 s and renders). */

const canvas = document.getElementById('c') as HTMLCanvasElement;
const r3 = new Renderer3D(canvas);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fc8e8');
scene.fog = new THREE.Fog('#9fc8e8', 30, 80);
scene.add(new THREE.HemisphereLight('#fff1dc', '#6a7858', 1.25));
const sun = new THREE.DirectionalLight('#fff4e0', 2.3);
setupSun(sun);
sun.position.set(6, 12, 8);
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat('#8cc068'));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);
const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 200);

const q = new URLSearchParams(location.search);
interface Cfg { kinds: HeroKind[]; state: HeroState; atk: HeroAtk | ''; p: number; fx: HeroFx; yaw: number; dist: number; h: number; expr: HeroExpr; gap: number; talk: number; speed: number; camYaw: number; look: number }
const parseFx = (s: string | null): HeroFx => Object.fromEntries((s ?? '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split(':'); return [k, Number(v)]; })) as HeroFx;
const cfg: Cfg = {
  kinds: (q.get('kinds')?.split(',') as HeroKind[]) ?? [...HERO_KINDS],
  state: (q.get('state') as HeroState) ?? 'idle', atk: (q.get('atk') as HeroAtk) ?? '', p: Number(q.get('p') ?? 0.4),
  fx: parseFx(q.get('fx')), yaw: Number(q.get('yaw') ?? 0.5), dist: Number(q.get('dist') ?? 4.2), h: Number(q.get('h') ?? 1.1),
  expr: (q.get('expr') as HeroExpr) ?? 'normal', gap: Number(q.get('gap') ?? 1.5), talk: 0, speed: 1, camYaw: Number(q.get('cy') ?? 0), look: 0,
};
let rigs: { k: HeroKind; rig: HeroRig; g: THREE.Group }[] = [];
function build() {
  for (const r of rigs) { scene.remove(r.g); r.rig.dispose(); }
  rigs = cfg.kinds.map((k, i) => {
    const rig = createHeroModel(k);
    const g = new THREE.Group(); g.add(rig.root);
    g.position.x = (i - (cfg.kinds.length - 1) / 2) * cfg.gap;
    scene.add(g);
    return { k, rig, g };
  });
}
build();
let t = 0;
function step(dt: number) {
  t += dt;
  for (const r of rigs) {
    r.g.rotation.y = cfg.yaw;
    const a: HeroAnim = { state: cfg.state, speed: cfg.speed, attack: cfg.atk ? { kind: cfg.atk, p: cfg.p < 0 ? (t % 1) : cfg.p } : null, weapon: 'sword', flash: 0, talk: cfg.talk, expr: cfg.expr, squash: 1, fx: cfg.fx };
    r.rig.update(dt, a);
  }
}
function render() {
  const w = window.innerWidth, hh = window.innerHeight;
  r3.setSize(w, hh, 1);
  cam.aspect = w / hh; cam.updateProjectionMatrix();
  cam.position.set(Math.sin(cfg.camYaw) * cfg.dist, cfg.h + cfg.dist * 0.25, Math.cos(cfg.camYaw) * cfg.dist);
  cam.lookAt(0, cfg.h * 0.55, 0);
  r3.render(scene, cam);
}
(window as unknown as Record<string, unknown>).__pv = {
  set(o: Partial<Cfg> & { rebuild?: boolean }) { const kinds = o.kinds; Object.assign(cfg, o); if (kinds || o.rebuild) build(); return true; },
  frame(n = 1) { for (let i = 0; i < n; i++) step(1 / 60); render(); return true; },
  rigs: () => rigs,
};
let last = performance.now();
function loop(now: number) { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!q.has('frozen')) { step(dt); render(); } requestAnimationFrame(loop); }
step(0.016); render();
requestAnimationFrame(loop);
