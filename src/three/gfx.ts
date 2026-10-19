import * as THREE from 'three';

/**
 * Shared look for the 3D game: cartoon toon shading (4 light bands with anti-aliased edges + a soft
 * rim light, see installToonLook), outlines / AO / grade are drawn by a screen-space post pass
 * (see render.ts), so meshes don't need hull copies.
 *
 * Units: 1 unit ≈ the hero's height. Characters face +Z in their local space.
 */

/** [band start (dotNL·0.5+0.5), light level] — 4 toon bands; edges are smoothed over ±BAND_SOFT */
const BANDS: [number, number][] = [[0, 0.34], [0.38, 0.58], [0.53, 0.8], [0.69, 1]];
const BAND_SOFT = 0.022;
let gradient: THREE.DataTexture | null = null;
export function toonGradient() {
  if (gradient) return gradient;
  // a 128-px ramp with LinearFilter: still reads as hard cartoon bands, but band edges are anti-aliased
  // instead of the 1-texel stair-steps a 3-px NearestFilter ramp produces on curved surfaces.
  const N = 128;
  const data = new Uint8Array(N * 4);
  const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < N; i++) {
    const c = (i + 0.5) / N;
    let v = BANDS[0][1];
    for (let k = 1; k < BANDS.length; k++) v += (BANDS[k][1] - BANDS[k - 1][1]) * sstep(BANDS[k][0] - BAND_SOFT, BANDS[k][0] + BAND_SOFT, c);
    const b = Math.round(Math.min(1, v) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  gradient = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.LinearFilter;
  gradient.magFilter = THREE.LinearFilter;
  gradient.wrapS = gradient.wrapT = THREE.ClampToEdgeWrapping;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

// ───────────────────────── global shader tweaks ─────────────────────────

/** Rim light for every MeshToonMaterial (strength, fresnel band, fade-out distance in units). */
export const RIM = { strength: 0.16, lo: 0.58, hi: 0.86, fadeFrom: 22, fadeTo: 55 };

const glf = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
/**
 * Soft cartoon rim: a fresnel band tinted by the sun (stronger on the sun-facing side) + a bit of sky.
 * Kept off up-facing surfaces (floors / table tops seen at grazing angles would otherwise glow) and
 * faded with distance, so it reads as roundness on characters & props, not haze on the level.
 */
const RIM_GLSL = /* glsl */`
	// ── toon rim (gfx.ts installToonLook) ──
	{
		float rimFres = 1.0 - clamp( dot( normal, geometryViewDir ), 0.0, 1.0 );
		float rimBand = smoothstep( ${glf(RIM.lo)}, ${glf(RIM.hi)}, rimFres );
		vec3 rimUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
		rimBand *= 1.0 - smoothstep( 0.5, 0.88, dot( normal, rimUp ) );
		rimBand *= 1.0 - smoothstep( ${glf(RIM.fadeFrom)}, ${glf(RIM.fadeTo)}, length( vViewPosition ) );
		vec3 rimCol = vec3( 0.0 );
		#if NUM_DIR_LIGHTS > 0
			rimCol += directionalLights[ 0 ].color * clamp( dot( normal, directionalLights[ 0 ].direction ) * 0.55 + 0.45, 0.0, 1.0 );
		#endif
		#if NUM_HEMI_LIGHTS > 0
			rimCol += hemisphereLights[ 0 ].skyColor * 0.4;
		#endif
		outgoingLight += diffuseColor.rgb * rimCol * ( rimBand * ${glf(RIM.strength)} );
	}
`;

let installed = false;
/**
 * Patch three's built-in shaders once, before anything compiles (runs on import of this module):
 *  - toon fragment: + rim light (applies to EVERY MeshToonMaterial — gfx.mat/matU, world/kit.tmat,
 *    models/kit Mats, ad-hoc `new MeshToonMaterial` — because they all share ShaderLib.toon);
 *  - PCF shadows: fixed (not per-pixel IGN-rotated) sample disc, so penumbrae don't crawl with the
 *    camera, and shadows fade out near the shadow-frustum border instead of ending in a hard line.
 */
export function installToonLook() {
  if (installed) return;
  installed = true;
  const toon = THREE.ShaderLib.toon;
  if (!toon.fragmentShader.includes('toon rim')) {
    toon.fragmentShader = toon.fragmentShader.replace('#include <opaque_fragment>', `${RIM_GLSL}\n\t#include <opaque_fragment>`);
  }
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  let sm = chunks.shadowmap_pars_fragment;
  const head = 'float getShadow( sampler2DShadow shadowMap';
  const at = sm.indexOf(head);
  if (at >= 0 && !sm.includes('toon shadow fade')) {
    let pcf = sm.slice(at);
    pcf = pcf.replace('float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;', 'float phi = 0.7; // toon: stable (screen-independent) PCF pattern');
    pcf = pcf.replace('bool frustumTest = inFrustum && shadowCoord.z <= 1.0;',
      'bool frustumTest = inFrustum && shadowCoord.z <= 1.0;\n\t\t\t// toon shadow fade near the frustum border\n\t\t\tshadowIntensity *= smoothstep( 0.0, 0.045, min( min( shadowCoord.x, 1.0 - shadowCoord.x ), min( shadowCoord.y, 1.0 - shadowCoord.y ) ) );');
    sm = sm.slice(0, at) + pcf;
    chunks.shadowmap_pars_fragment = sm;
  }
}
installToonLook();

export interface MatOpts {
  map?: THREE.Texture | null;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  flat?: boolean;
}

const cache = new Map<string, THREE.MeshToonMaterial>();

/** Shared (cached) toon material. Do NOT mutate it — use matU() for per-object materials (e.g. hit flash). */
export function mat(color: THREE.ColorRepresentation, o: MatOpts = {}): THREE.MeshToonMaterial {
  if (o.map) return matU(color, o);
  const key = `${new THREE.Color(color).getHexString()}|${o.emissive ?? ''}|${o.emissiveIntensity ?? ''}|${o.transparent ? o.opacity : ''}|${o.side ?? ''}|${o.flat ? 1 : 0}`;
  let m = cache.get(key);
  if (!m) { m = matU(color, o); cache.set(key, m); }
  return m;
}

/** Unique toon material (safe to mutate per instance). */
export function matU(color: THREE.ColorRepresentation, o: MatOpts = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    gradientMap: toonGradient(),
    map: o.map ?? null,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
  if (o.emissive !== undefined) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
  if (o.flat) (m as unknown as { flatShading: boolean }).flatShading = true;
  return m;
}

/** Unlit material (for eyes' black pupils, glows, sky, etc.) */
export function basic(color: THREE.ColorRepresentation, o: { transparent?: boolean; opacity?: number; side?: THREE.Side; additive?: boolean; map?: THREE.Texture; depthWrite?: boolean; fog?: boolean } = {}) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: !!o.transparent || o.additive || o.opacity !== undefined,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    map: o.map ?? null,
    depthWrite: o.depthWrite ?? !(o.additive || o.transparent),
    fog: o.fog ?? true,
  });
}

/** Make a mesh with shadows on by default. */
export function mesh(geo: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], o: { cast?: boolean; receive?: boolean; name?: string } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = o.cast ?? true;
  m.receiveShadow = o.receive ?? true;
  if (o.name) m.name = o.name;
  return m;
}

/** Objects on this layer are excluded from the outline (normal/depth edge) pass: particles, glows, sky, transparent fx. */
export const LAYER_NO_OUTLINE = 1;
export function noOutline(o: THREE.Object3D) {
  o.traverse((c) => { c.layers.set(LAYER_NO_OUTLINE); });
  return o;
}

/** Procedural canvas texture. draw() gets a 2D context of size w×h. */
export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, o: { repeat?: [number, number]; wrap?: boolean; nearest?: boolean } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  // CPU-backed: texture painters read pixels back (noise passes); a GPU canvas would stall on every readback
  const g = c.getContext('2d', { willReadFrequently: true })!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (o.wrap || o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
  if (o.nearest) { t.magFilter = THREE.NearestFilter; }
  return t;
}

/** Palette (shared with the 2D version, so the worlds feel like the same cartoon). */
export const PAL = {
  outline: '#2a1b1a',
  // hero (Тоша)
  skin: '#ffd9b3', skinD: '#efbf94', beanie: '#ff8a2a', band: '#e0621a', pom: '#fff3da',
  scarf: '#e8383d', shirt: '#3fb8a8', shorts: '#6b4a3a', boot: '#4a2f25',
  woodBlade: '#e2b77a', woodDark: '#8a5530', steel: '#cdd6e2',
  // watermelon guards
  melon: '#3e9a3a', melonStripe: '#20662a', rind: '#d9f0a8', flesh: '#ff5468', seed: '#2a1b1a',
  capRed: '#d8343a', capBlue: '#3a6ad8', capGold: '#f0c040', skewer: '#e8c88a', olive: '#5c8a2a',
  // king
  kingSkin: '#c6a2e4', kingSkinD: '#a882cc', robe: '#a8243a', robeD: '#7e1428', gold: '#f2c23a', ermine: '#fbf6ec', stache: '#e2762c', stacheD: '#b8541a',
  // bear (Вторник)
  bear: '#8a5634', bearLight: '#c98e5a', moss: '#97a874', vest: '#b0453a', thimble: '#c7ccd6', glasses: '#c8a040',
  // dog (Бублик)
  dog: '#b0612e', dogBelly: '#e0a066', dogDark: '#7a3e1c', collar: '#d8343a', bagel: '#e8a850',
  // food & props
  meat: '#a8402a', meatball: '#8c4a2c', jelly: '#ff5f9e', noodle: '#f6d06a', sauce: '#c8402a',
  wood: '#b47a46', woodD: '#7a4a2c', woodL: '#d89a5e', cloth: '#f6efe0', clothRed: '#d2323c',
  cheese: '#f6c945', bread: '#c8823a', jamRed: '#c8203a', jamOrange: '#e88a20', glass: '#cfe8ff',
  stone: '#5a4a6e', stoneD: '#3e3250', carpet: '#b8323a',
};

export const BOOK_COLORS = ['#c0392b', '#2e86c1', '#27ae60', '#8e44ad', '#d35400', '#16a085', '#7f5539', '#b03a6a', '#2c3e8f', '#c9a227'];

/** Recursively set castShadow/receiveShadow. */
export function shadows(o: THREE.Object3D, cast = true, receive = true) {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; } });
  return o;
}
