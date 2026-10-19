import * as THREE from 'three';
import { LAYER_NO_OUTLINE } from './gfx';

const QUAD_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * Half-resolution screen-space ambient occlusion (SAO-style, normal-oriented hemisphere, Vogel disc).
 * Output: r = AO (1 = open), g = linear view depth of the pixel (for the bilateral upsample).
 */
const AO_SAMPLES = 12;
const AO_FS = /* glsl */`
  #include <packing>
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform vec2 resolution;   // full-res size of tDepth (px)
  uniform float cameraNear;
  uniform float cameraFar;
  uniform vec2 viewScale;    // (tan(fovX/2), tan(fovY/2))
  uniform float projScale;   // px per unit at distance 1 (full res)
  uniform float radius;      // world units
  uniform float intensity;
  uniform float bias;
  varying vec2 vUv;
  float linZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
  vec3 viewPos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * viewScale * z, -z); }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = vec4(1.0, 1.0e4, 0.0, 1.0); return; }
    float z = -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
    vec3 P = viewPos(vUv, z);
    vec3 N = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);
    float rPx = radius * projScale / z;
    // tiny on screen (far away): AO would only add noise
    float vis = smoothstep(1.5, 4.0, rPx);
    rPx = min(rPx, 56.0); // cap the kernel: huge close-up kernels thrash the texture cache
    float phi = ign(gl_FragCoord.xy) * 6.2831853;
    float r2 = radius * radius;
    float sum = 0.0;
    for (int i = 0; i < ${AO_SAMPLES}; i++) {
      float t = (float(i) + 0.5) / ${AO_SAMPLES}.0;
      float a = float(i) * 2.3999632 + phi;
      // clamp to the screen: off-screen taps would read the clamped edge depth at the wrong position (false AO at the borders)
      vec2 suv = clamp(vUv + vec2(cos(a), sin(a)) * (sqrt(t) * rPx) / resolution, vec2(0.5) / resolution, vec2(1.0) - vec2(0.5) / resolution);
      vec3 v = viewPos(suv, linZ(suv)) - P;
      float vv = dot(v, v);
      float vn = dot(v, N);
      float f = max(r2 - vv, 0.0);
      sum += f * f * f * max((vn - bias) / (0.01 + vv), 0.0);
    }
    float ao = max(0.0, 1.0 - sum * intensity / (r2 * r2 * r2) * (5.0 / ${AO_SAMPLES}.0));
    gl_FragColor = vec4(mix(1.0, ao, vis), z, 0.0, 1.0);
  }
`;

const COMPOSITE_FS = /* glsl */`
  #include <packing>
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform sampler2D tAO;
  uniform vec2 resolution;
  uniform vec2 aoResolution;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float fogNear;
  uniform float fogFar;
  uniform float thickness;
  uniform vec3 outlineColor;
  uniform float outlineOn;
  uniform float aoOn;
  uniform float aoStrength;
  uniform float gradeOn;
  varying vec2 vUv;

  float viewZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
  vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    float rawD = texture2D(tDepth, vUv).x;
    bool sky = rawD >= 0.99999;
    float zc = -perspectiveDepthToViewZ(rawD, cameraNear, cameraFar);
    float fogK = sky ? 1.0 : smoothstep(fogNear, fogFar, zc);

    // ── ambient occlusion: joint-bilateral 3×3 upsample of the half-res AO (also blurs its noise) ──
    if (aoOn > 0.5 && !sky) {
      vec2 tx = 1.0 / aoResolution;
      float sa = 0.0, sw = 0.0;
      float tol = 0.035 * zc + 0.05;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 s = texture2D(tAO, vUv + vec2(float(x), float(y)) * tx).xy;
          float w = max(0.0, 1.0 - abs(s.y - zc) / tol);
          w *= w * ((x == 0 && y == 0) ? 1.0 : 0.7);
          sa += s.x * w; sw += w;
        }
      }
      float ao = sw > 1e-3 ? sa / sw : 1.0;
      c *= mix(1.0, ao, aoStrength * (1.0 - fogK));
    }

    // ── outlines ──
    if (outlineOn > 0.5 && !sky) {
      vec2 px = thickness / resolution;
      // Laplacian of INVERSE depth: 1/z is linear in screen space across any plane, so flat surfaces
      // seen at grazing angles (shelf tops, floors) give ~0 here instead of false, flickering edges.
      float wc = 1.0 / zc;
      float w1 = 1.0 / viewZ(vUv + vec2(px.x, 0.0));
      float w2 = 1.0 / viewZ(vUv - vec2(px.x, 0.0));
      float w3 = 1.0 / viewZ(vUv + vec2(0.0, px.y));
      float w4 = 1.0 / viewZ(vUv - vec2(0.0, px.y));
      float lap = abs(w1 + w2 + w3 + w4 - 4.0 * wc) / wc;
      float depthEdge = smoothstep(0.06, 0.16, lap);
      vec3 nc = nrm(vUv);
      float n1 = dot(nc, nrm(vUv + vec2(px.x, 0.0)));
      float n2 = dot(nc, nrm(vUv - vec2(px.x, 0.0)));
      float n3 = dot(nc, nrm(vUv + vec2(0.0, px.y)));
      float n4 = dot(nc, nrm(vUv - vec2(0.0, px.y)));
      float nmin = min(min(n1, n2), min(n3, n4));
      float normalEdge = smoothstep(0.55, 0.25, nmin);
      float edge = max(depthEdge, normalEdge);
      edge *= (1.0 - fogK * 0.9);
      c = mix(c, outlineColor, edge * 0.92);
    }

    // ── gentle grade: a touch more saturation, cool shadows / warm lights, soft vignette ──
    if (gradeOn > 0.5) {
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(mix(vec3(l), c, 1.1), 0.0);
      c *= mix(vec3(0.95, 0.98, 1.06), vec3(1.035, 1.0, 0.955), smoothstep(0.015, 0.45, l));
      vec2 q = (vUv - 0.5) * vec2(1.0, 0.9);
      c *= mix(0.8, 1.0, smoothstep(0.78, 0.3, length(q) * 1.15));
    }

    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
    // ±½ LSB dither: no banding in dark gradients / vignette after the 8-bit sRGB conversion
    gl_FragColor.rgb += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  }
`;

/**
 * Renderer with a cartoon post-process:
 *  1) scene → MSAA colour target (with depth texture)
 *  2) scene (layer 0 only) with a normal override → normal target          (outlines and/or AO)
 *  3) half-res SAO from depth + normals                                    (AO)
 *  4) full-screen composite: colour × AO, edges from depth & normal discontinuities (fog-faded),
 *     colour grade + vignette.
 * Toggles: `outlines` (menu "Контуры"), `ao`, `grade`. The scene always goes through the MSAA target,
 * so switching outlines off doesn't lose anti-aliasing.
 */
export class Renderer3D {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  private rtColor: THREE.WebGLRenderTarget;
  private rtNormal: THREE.WebGLRenderTarget;
  private rtAO: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private composite: THREE.ShaderMaterial;
  private aoMat: THREE.ShaderMaterial;
  outlines = true;
  ao = true;
  grade = true;
  /** AO tuning (world units / strength) */
  aoRadius = 1.1;
  aoIntensity = 1.0;
  aoStrength = 0.6;
  width = 1;
  height = 1;
  pixelRatio = 1;
  /** settings «Чёткость»: render at most this many pixels per CSS pixel (1.5 high, 1 medium, 0.75 low) */
  maxRatio = 1.5;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // r186: PCFSoftShadowMap is gone; softness = light.shadow.radius
    this.renderer.setClearColor(0x120b0d, 1);
    this.rtColor = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType });
    this.rtColor.depthTexture = new THREE.DepthTexture(4, 4);
    this.rtColor.depthTexture.type = THREE.UnsignedIntType;
    this.rtNormal = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType });
    this.rtAO = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType, depthBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.aoMat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: this.rtColor.depthTexture },
        tNormal: { value: this.rtNormal.texture },
        resolution: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        viewScale: { value: new THREE.Vector2(1, 1) },
        projScale: { value: 1 },
        radius: { value: this.aoRadius },
        intensity: { value: this.aoIntensity },
        bias: { value: 0.02 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: AO_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rtColor.texture },
        tDepth: { value: this.rtColor.depthTexture },
        tNormal: { value: this.rtNormal.texture },
        tAO: { value: this.rtAO.texture },
        resolution: { value: new THREE.Vector2(1, 1) },
        aoResolution: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        fogNear: { value: 50 },
        fogFar: { value: 200 },
        thickness: { value: 1.2 },
        outlineColor: { value: new THREE.Color('#2a1b1a') },
        outlineOn: { value: 1 },
        aoOn: { value: 1 },
        aoStrength: { value: this.aoStrength },
        gradeOn: { value: 1 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: COMPOSITE_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** change «Чёткость» (re-sizes the targets at once) */
  setMaxRatio(r: number) {
    if (r === this.maxRatio) return;
    this.maxRatio = r;
    this.setSize(this.width, this.height, this.dpr);
  }

  setSize(w: number, h: number, dpr: number) {
    this.width = w; this.height = h; this.dpr = dpr;
    this.pixelRatio = Math.min(dpr, this.maxRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    const pw = Math.floor(w * this.pixelRatio), ph = Math.floor(h * this.pixelRatio);
    const aw = Math.max(1, Math.floor(pw / 2)), ah = Math.max(1, Math.floor(ph / 2));
    this.rtColor.setSize(pw, ph);
    this.rtNormal.setSize(pw, ph);
    this.rtAO.setSize(aw, ah);
    this.composite.uniforms.resolution.value.set(pw, ph);
    this.composite.uniforms.aoResolution.value.set(aw, ah);
    this.aoMat.uniforms.resolution.value.set(pw, ph);
    this.composite.uniforms.thickness.value = Math.max(1, ph / 720) * 1.15;
  }

  private drawQuad(mat: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const r = this.renderer;
    const needNormals = this.outlines || this.ao;
    // colour (all layers), always through the MSAA target
    camera.layers.enable(LAYER_NO_OUTLINE);
    r.setRenderTarget(this.rtColor);
    r.render(scene, camera);
    if (needNormals) {
      // normals (layer 0 only: no particles / glows / sky)
      camera.layers.disable(LAYER_NO_OUTLINE);
      const oldOverride = scene.overrideMaterial, oldBg = scene.background, oldFog = scene.fog;
      scene.overrideMaterial = this.normalMat;
      scene.background = null;
      scene.fog = null;
      const autoShadow = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false;
      r.setRenderTarget(this.rtNormal);
      r.setClearColor(0x8080ff, 1);
      r.clear();
      r.render(scene, camera);
      r.setClearColor(0x120b0d, 1);
      r.shadowMap.autoUpdate = autoShadow;
      scene.overrideMaterial = oldOverride; scene.background = oldBg; scene.fog = oldFog;
      camera.layers.enable(LAYER_NO_OUTLINE);
    }
    const near = camera.near, far = camera.far;
    if (this.ao) {
      const a = this.aoMat.uniforms;
      const pm = camera.projectionMatrix.elements;
      const tanX = 1 / pm[0], tanY = 1 / pm[5];
      a.cameraNear.value = near; a.cameraFar.value = far;
      a.viewScale.value.set(tanX, tanY);
      a.projScale.value = 0.5 * this.composite.uniforms.resolution.value.y / tanY;
      a.radius.value = this.aoRadius;
      a.intensity.value = this.aoIntensity;
      this.drawQuad(this.aoMat, this.rtAO);
    }
    const u = this.composite.uniforms;
    u.cameraNear.value = near; u.cameraFar.value = far;
    const fog = scene.fog as THREE.Fog | null;
    u.fogNear.value = fog?.near ?? 60; u.fogFar.value = fog?.far ?? 300;
    u.outlineOn.value = this.outlines ? 1 : 0;
    u.aoOn.value = this.ao ? 1 : 0;
    u.aoStrength.value = this.aoStrength;
    u.gradeOn.value = this.grade ? 1 : 0;
    this.drawQuad(this.composite, null);
  }
}
