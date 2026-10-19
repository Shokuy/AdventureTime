import * as THREE from 'three';
import { basic } from '../gfx';
import { G, Mats, Blinker, cached, merge, part, surf, vis, clamp } from './kit';
import type { HeroExpr } from './hero';

/*
 * A cartoon face for the playable heroes (Noki, Pastila): eyes with every expression Tosha has (normal, happy ^^,
 * angry, scared / surprised wide, hurt > <, sleepy —), brows, a mouth that talks, optional iris colour, eyeliner
 * wings, lashes, half-lidded eyes and a little fang. Everything sits on the head sphere (radius R) via surf().
 */
export interface FaceOpts {
  R: number;
  /** eye centres: yaw (± spread) and pitch on the sphere */
  eyeYaw: number; eyePitch: number;
  /** eye oval half-size (x, y) */
  eyeW: number; eyeH: number;
  /** coloured iris ring around the pupil (crimson for Noki); none = Tosha-style black oval */
  iris?: string;
  /** upper lid (the skin colour) covering this much of the eye at rest (0..1): sleepy / sarcastic look */
  lid?: number;
  skin: string;
  /** dark eyeliner wing at the outer corner */
  liner?: boolean;
  /** three lashes at the outer top */
  lashes?: boolean;
  brow: string;
  /** brows always shown (thin, raised) instead of only for angry / scared */
  browsAlways?: boolean;
  mouthPitch: number;
  mouthW?: number;
  /** a fang under the smile (on the +X side) */
  fang?: boolean;
  cheek?: string;
  nose?: string;
  /** a second, smaller glint (big cute eyes) */
  glint2?: boolean;
}

export interface Face {
  update(dt: number, ex: HeroExpr, talk: number, t: number): void;
  dispose(): void;
}

/** the lid line droops a touch toward the outer corner */
const e_tilt = (s: number) => s * -0.12;

export function buildFace(head: THREE.Object3D, M: Mats, o: FaceOpts): Face {
  const R = o.R;
  const fo = { cast: false };
  const black = basic('#1b1214');
  const white = basic('#ffffff');
  const mouthDark = basic('#6a1622');
  const tongueM = basic('#ff7f8e');
  const browM = M.get(o.brow);
  const irisM = o.iris ? basic(o.iris) : null;
  const linerM = black;
  const ew = o.eyeW, eh = o.eyeH;

  interface Eye {
    g: THREE.Group; s: number; sclera: THREE.Mesh; iris: THREE.Mesh | null; pupil: THREE.Mesh; glint: THREE.Mesh; glint2: THREE.Mesh | null;
    happy: THREE.Mesh; closed: THREE.Mesh; chev: THREE.Mesh; lid: THREE.Mesh | null; deco: THREE.Group; brow: THREE.Mesh;
  }
  const eyes: Eye[] = [];
  for (const s of [1, -1]) {
    const g = surf(head, s * o.eyeYaw, o.eyePitch, R * 0.985);
    const sclera = part(g, G.ball(), white, [0, 0, 0.002], [ew * 1.18, eh * 1.08, 0.02], undefined, fo);
    const iris = irisM ? part(g, G.ball(), irisM, [0, -eh * 0.05, 0.006], [ew * 0.82, eh * 0.86, 0.02], undefined, fo) : null;
    const pupil = part(g, G.ball(), black, [0, -eh * 0.05, 0.01], irisM ? [ew * 0.46, eh * 0.56, 0.022] : [ew, eh, 0.022], undefined, fo);
    const glint = part(g, G.ball(), white, [ew * 0.3, eh * 0.38, 0.026], ew * 0.3, undefined, fo);
    const glint2 = o.glint2 ? part(g, G.ball(), white, [-ew * 0.32, -eh * 0.42, 0.026], ew * 0.14, undefined, fo) : null;
    const happy = part(g, G.arc(ew * 0.78, ew * 0.25, Math.PI), black, [0, -eh * 0.2, 0.012], [1, 1, 0.6], undefined, fo);
    const closed = part(g, G.capsule(ew * 0.23, ew * 1.1), black, [0, -eh * 0.2, 0.014], 1, [0, 0, Math.PI / 2], fo);
    const dir = s > 0 ? -1 : 1;
    const chev = part(g, cached(`face-chev${dir}|${ew}`, () => merge([
      { g: G.capsule(ew * 0.22, ew * 0.8), p: [0, eh * 0.2, 0], r: [0, 0, dir * -0.55 - Math.PI / 2] },
      { g: G.capsule(ew * 0.22, ew * 0.8), p: [0, -eh * 0.2, 0], r: [0, 0, dir * 0.55 - Math.PI / 2] },
    ])), black, [0, 0, 0.014], 1, undefined, fo);
    // half-lidded look: a dark upper-lid line lowered over a flattened eye (see update)
    const lid = o.lid ? part(g, G.capsule(ew * 0.16, ew * 1.9), black, [0, eh * 0.5, 0.024], 1, [0, 0, Math.PI / 2 + e_tilt(s)], fo) : null;
    // eyeliner wing + lashes (follow the open eye)
    const deco = new THREE.Group();
    g.add(deco);
    if (o.liner) {
      part(deco, G.capsule(ew * 0.16, ew * 0.9), linerM, [s * ew * 1.0, eh * 0.55, 0.02], 1, [0, 0, Math.PI / 2 + s * 0.55], fo);
      part(deco, G.capsule(ew * 0.12, ew * 1.6), linerM, [0, eh * 0.95, 0.018], 1, [0, 0, Math.PI / 2], fo);
    }
    if (o.lashes) {
      for (let i = 0; i < 3; i++) {
        const a = 0.35 + i * 0.32;
        part(deco, G.capsule(ew * 0.1, ew * 0.42), black, [s * (ew * 0.55 + i * ew * 0.22), eh * (0.92 - i * 0.18), 0.02], 1, [0, 0, s * -a], fo);
      }
    }
    const browG = surf(head, s * o.eyeYaw * 1.02, o.eyePitch + eh / R * 1.9, R * 1.0);
    const brow = part(browG, G.capsule(ew * 0.22, ew * 1.3), browM, undefined, 1, [0, 0, Math.PI / 2], fo);
    eyes.push({ g, s, sclera, iris, pupil, glint, glint2, happy, closed, chev, lid, deco, brow });
  }
  if (o.nose) part(surf(head, 0, o.eyePitch - 0.16, R * 0.99), G.ball(), M.get(o.nose), undefined, [R * 0.07, R * 0.055, R * 0.05], undefined, fo);
  const cheeks: THREE.Mesh[] = [];
  if (o.cheek) {
    const cm = basic(o.cheek);
    for (const s of [-1, 1]) cheeks.push(part(surf(head, s * o.eyeYaw * 1.65, o.eyePitch - 0.2, R * 0.985), G.ball(), cm, undefined, [R * 0.16, R * 0.095, 0.01], undefined, fo));
  }
  const mw = o.mouthW ?? R * 0.13;
  const mouth = surf(head, 0, o.mouthPitch, R * 0.985);
  const smile = part(mouth, G.arc(mw, mw * 0.25, Math.PI), black, [0, mw * 0.55, 0.004], [1, 1, 0.6], [0, 0, Math.PI], fo);
  const frown = part(mouth, G.arc(mw * 0.8, mw * 0.25, Math.PI), black, [0, -mw * 0.6, 0.004], [1, 1, 0.6], undefined, fo);
  const open = part(mouth, G.ball(), mouthDark, [0, -0.004, 0.002], [mw * 1.2, mw * 0.9, 0.018], undefined, fo);
  const tongue = part(mouth, G.ball(), tongueM, [0, -0.02, 0.012], [mw * 0.7, mw * 0.32, 0.01], undefined, fo);
  const fang = o.fang ? part(mouth, G.cone(), white, [mw * 0.55, -mw * 0.05, 0.012], [mw * 0.18, mw * 0.42, mw * 0.12], [Math.PI, 0, 0], fo) : null;

  const blinker = new Blinker();
  function update(dt: number, ex: HeroExpr, talk: number, t: number) {
    const blink = blinker.update(dt);
    const wide = ex === 'scared' || ex === 'surprised';
    const openEyes = ex === 'normal' || ex === 'angry' || wide;
    for (const e of eyes) {
      vis(e.pupil, openEyes); vis(e.glint, openEyes); vis(e.sclera, openEyes && (wide || !!e.iris));
      if (e.iris) vis(e.iris, openEyes);
      if (e.glint2) vis(e.glint2, openEyes && !wide);
      vis(e.happy, ex === 'happy'); vis(e.closed, ex === 'sleepy'); vis(e.chev, ex === 'hurt');
      vis(e.deco, openEyes || ex === 'happy');
      const bl = 1 - blink * 0.92;
      if (openEyes) {
        const tr = ex === 'scared' ? Math.sin(t * 40 + e.s) * 0.003 : 0;
        e.sclera.position.set(0, 0, 0.002);
        if (e.iris) e.iris.position.set(0, -eh * 0.05, 0.006);
        if (wide) {
          e.sclera.scale.set(ew * 1.25, eh * 1.2 * bl, 0.02);
          if (e.iris) e.iris.scale.set(ew * 0.55, eh * 0.6 * bl, 0.02);
          e.pupil.scale.set(ew * (e.iris ? 0.3 : 0.55), eh * (e.iris ? 0.36 : 0.55) * bl, 0.022);
          e.pupil.position.set(tr, -eh * 0.05, 0.012);
        } else {
          e.sclera.scale.set(ew * 1.18, eh * 1.08 * bl * (ex === 'angry' ? 0.82 : 1), 0.02);
          if (e.iris) e.iris.scale.set(ew * 0.82, eh * 0.86 * bl * (ex === 'angry' ? 0.8 : 1), 0.02);
          const k = e.iris ? [0.46, 0.56] : [1, 1];
          e.pupil.scale.set(ew * k[0], eh * k[1] * bl * (ex === 'angry' ? 0.8 : 1), 0.022);
          e.pupil.position.set(0, -eh * 0.05 - (ex === 'angry' ? eh * 0.1 : 0), 0.01);
        }
        e.glint.scale.setScalar(ew * (wide ? 0.2 : 0.3) * Math.max(0.2, bl));
        e.deco.scale.set(1, Math.max(0.3, bl), 1);
      }
      if (e.lid) {
        // the lid covers the top of the eye: squash the eye pieces from above and draw the lid line on the cut
        const cover = !openEyes ? 0 : wide ? 0.05 : ex === 'angry' ? Math.max(o.lid ?? 0, 0.32) : (o.lid ?? 0);
        const k = 1 - cover;
        vis(e.lid, openEyes);
        if (openEyes) {
          for (const m of [e.sclera, e.iris, e.pupil]) if (m) { m.scale.y *= k; m.position.y -= eh * cover; }
          e.glint.position.y = eh * (0.38 - cover * 0.8);
          e.lid.position.y = eh * (1.0 - cover * 1.9) * Math.max(0.15, 1 - blink);
          e.deco.position.y = -eh * cover * 0.9;
        }
      }
      const browOn = o.browsAlways || ex === 'angry' || wide || ex === 'hurt';
      vis(e.brow, browOn);
      if (browOn) {
        let rz = 0, dy = 0;
        if (ex === 'angry') { rz = 0.5 * e.s; dy = -eh * 0.35; }
        else if (ex === 'hurt' || ex === 'sleepy') { rz = -0.35 * e.s; dy = -eh * 0.1; }
        else if (wide) { rz = -0.28 * e.s; dy = eh * (ex === 'surprised' ? 0.45 : 0.25); }
        else if (ex === 'happy') { rz = -0.15 * e.s; dy = eh * 0.2; }
        else { rz = 0.08 * e.s; dy = 0; }
        e.brow.rotation.set(0, 0, Math.PI / 2 + rz);
        e.brow.position.set(0, dy, 0);
      }
    }
    for (const c of cheeks) c.scale.set(R * (ex === 'happy' ? 0.19 : 0.16), R * (ex === 'happy' ? 0.11 : 0.095), 0.01);
    const baseOpen = ex === 'happy' ? 0.4 : ex === 'scared' ? 0.45 : ex === 'surprised' ? 0.75 : ex === 'hurt' ? 0.35 : 0;
    const op = Math.max(baseOpen, clamp(talk) * 0.95);
    const isOpen = op > 0.08;
    vis(open, isOpen); vis(tongue, isOpen && op > 0.25);
    const smiley = ex === 'normal' || ex === 'happy' || ex === 'sleepy';
    vis(smile, !isOpen && smiley);
    vis(frown, !isOpen && !smiley);
    if (fang) vis(fang, !isOpen ? smiley || ex === 'angry' : op < 0.6);
    if (isOpen) {
      const wdt = ex === 'surprised' ? mw * 0.7 : ex === 'happy' ? mw * 1.2 : mw;
      open.scale.set(wdt, mw * (0.2 + 0.85 * op), 0.018);
      open.position.y = -0.004 - mw * 0.3 * op;
      tongue.position.y = -0.008 - mw * 0.7 * op;
      if (fang) fang.position.y = -0.004 + mw * 0.45 * op - mw * 0.05;
    } else if (fang) fang.position.y = -mw * 0.05;
    smile.scale.set(ex === 'sleepy' ? 0.6 : 1, ex === 'sleepy' ? 0.6 : 1, 0.6);
  }
  return {
    update,
    dispose() { for (const m of [black, white, mouthDark, tongueM, irisM]) m?.dispose(); for (const c of cheeks) (c.material as THREE.Material).dispose(); },
  };
}
