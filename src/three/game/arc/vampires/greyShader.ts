import * as THREE from 'three';

/**
 * «Цвет мира»: one patch of three's toon shader (every MeshToonMaterial — world props, rooms, characters).
 *
 *  • Grey zones: up to GZ_MAX discs on the map (x, z, radius, soft edge) wash the colour out of everything inside
 *    (per pixel, by world position) — and a restore paints it back as a warm front growing from the centre.
 *    The numbers live in shared Float32Arrays: three copies a uniform's value by reference when it is a typed array
 *    (cloneUniforms clones only three objects / plain arrays), so every toon material reads the same zones and
 *    a level only has to fill them in before it renders (zones.ts does that in scene.onBeforeRender).
 *  • Characters (heroes, vampires, townsfolk) are marked (markCharacter): they ignore the zones and get their own
 *    greyness instead (`gzSelf`, per material: a bitten hero goes «пресный», a пресняк is grey until restored).
 *
 * Installed at import time (before anything compiles): three caches programs by material type + parameters, not by
 * source, so a patch after the first toon compile would never reach the cached programs. With no zones (gzI.x = 0)
 * the loop is skipped — the prologue renders as before.
 */

export const GZ_MAX = 8;
/** per zone: centre x, y, z, radius */
export const gzZ = new Float32Array(GZ_MAX * 4);
/** per zone: amount 0..1, soft edge (m), restore front radius (m, < 0 = none), front glow 0..1 */
export const gzP = new Float32Array(GZ_MAX * 4);
/** x = zones in use */
export const gzI = new Float32Array(4);

const PARS = /* glsl */`
varying vec3 vGzW;
uniform vec4 gzZ[ ${GZ_MAX} ];
uniform vec4 gzP[ ${GZ_MAX} ];
uniform vec4 gzI;
#ifdef GZ_SELF
uniform float gzSelf;
#endif
`;

const FRAG = /* glsl */`
	// ── grey zones / «пресный» (arc/vampires/greyShader.ts) ──
	{
		float gzG = 0.0;
		float gzRing = 0.0;
		#ifdef GZ_SELF
			gzG = clamp( gzSelf, 0.0, 1.0 );
		#else
			if ( gzI.x > 0.5 ) {
				for ( int i = 0; i < ${GZ_MAX}; i ++ ) {
					if ( float( i ) >= gzI.x ) break;
					vec4 z = gzZ[ i ];
					vec4 p = gzP[ i ];
					if ( p.x <= 0.001 ) continue;
					float d = length( vGzW.xz - z.xz );
					float k = 1.0 - smoothstep( z.w - p.y, z.w, d );
					// the colour front of a restore: colour inside it, a warm glow on it
					k *= smoothstep( p.z - 1.2, p.z + 1.2, d );
					float u = ( d - p.z ) / 1.3;
					gzRing = max( gzRing, p.w * exp( - u * u ) * step( 0.0, p.z ) * ( 1.0 - smoothstep( z.w, z.w + p.y, d ) ) );
					gzG = max( gzG, k * p.x );
				}
			}
		#endif
		if ( gzG > 0.001 ) {
			float gzL = dot( outgoingLight, vec3( 0.299, 0.587, 0.114 ) );
			outgoingLight = mix( outgoingLight, vec3( gzL ) * vec3( 0.84, 0.86, 0.94 ), gzG );
		}
		outgoingLight += vec3( 1.0, 0.8, 0.42 ) * ( gzRing * 0.55 );
	}
`;

const WORLD = /* glsl */`
	{
		vec4 gzw = vec4( transformed, 1.0 );
		#ifdef USE_BATCHING
			gzw = batchingMatrix * gzw;
		#endif
		#ifdef USE_INSTANCING
			gzw = instanceMatrix * gzw;
		#endif
		vGzW = ( modelMatrix * gzw ).xyz;
	}
`;

let installed = false;
export function installGreyShader() {
  if (installed) return;
  installed = true;
  const toon = THREE.ShaderLib.toon as { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string };
  if (toon.fragmentShader.includes('grey zones')) return;
  toon.uniforms.gzZ = { value: gzZ };
  toon.uniforms.gzP = { value: gzP };
  toon.uniforms.gzI = { value: gzI };
  toon.vertexShader = toon.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vGzW;')
    .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD}`);
  toon.fragmentShader = toon.fragmentShader
    .replace('#include <common>', `#include <common>\n${PARS}`)
    .replace('#include <opaque_fragment>', `${FRAG}\n\t#include <opaque_fragment>`);
}
installGreyShader();

// ───────────────────────── characters ─────────────────────────

interface Marked { gz: { value: number } }
/** one function for every marked material: its source is the program cache key (all marked materials share programs) */
function gzSelfCompile(this: THREE.Material, shader: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string }) {
  shader.uniforms.gzSelf = (this.userData as Marked).gz;
  shader.fragmentShader = '#define GZ_SELF\n' + shader.fragmentShader;
}
const defaultCompile = THREE.Material.prototype.onBeforeCompile;
/** materials markCharacter already looked at (marked or left alone) */
const looked = new WeakSet<THREE.Material>();

function toonMats(root: THREE.Object3D, out = new Set<THREE.MeshToonMaterial>()) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) if ((x as THREE.MeshToonMaterial).isMeshToonMaterial) out.add(x as THREE.MeshToonMaterial);
  });
  return out;
}

/**
 * A character's own materials stop following the grey zones and get a greyness of their own (setGrey).
 * Only materials nobody else uses are marked (`scene` given: materials also found outside `root` — e.g. cached
 * gfx.mat() ones shared with props — are left alone). Idempotent; returns how many materials it marked.
 */
export function markCharacter(root: THREE.Object3D, scene?: THREE.Object3D | null): number {
  const mats = toonMats(root);
  for (const m of mats) looked.add(m);
  if (scene) {
    scene.traverse((o) => {
      if (!mats.size) return;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return;
      const m = (o as THREE.Mesh).material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) mats.delete(x as THREE.MeshToonMaterial);
    });
  }
  let n = 0;
  for (const m of mats) {
    const ud = m.userData as Partial<Marked>;
    if (ud.gz) continue;
    if (m.onBeforeCompile !== defaultCompile) continue; // somebody else's shader hook: leave it
    ud.gz = { value: 0 };
    m.onBeforeCompile = gzSelfCompile;
    m.needsUpdate = true;
    n++;
  }
  return n;
}

/** a rig got materials markCharacter hasn't seen yet (a hero swapped his model) */
export function hasNewMats(root: THREE.Object3D) {
  for (const m of toonMats(root)) if (!looked.has(m)) return true;
  return false;
}

/** greyness of a marked character (0 = its colours, 1 = «пресный» grey) */
export function setGrey(root: THREE.Object3D, k: number) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) { const gz = (x.userData as Partial<Marked>).gz; if (gz) gz.value = k; }
  });
}

/** cached list of a rig's marked uniforms (setGrey every frame without a traverse) */
export function greyHandle(root: THREE.Object3D): (k: number) => void {
  const list: { value: number }[] = [];
  for (const m of toonMats(root)) { const gz = (m.userData as Partial<Marked>).gz; if (gz) list.push(gz); }
  let last = -1;
  return (k: number) => {
    if (Math.abs(k - last) < 0.002) return;
    last = k;
    for (const u of list) u.value = k;
  };
}
