export interface SaveData {
  version: number;
  started: boolean;
  /** index into STORY */
  story: number;
  /** highest STORY index reached */
  reached: number;
  crumbs: number;
  maxHp: number;
  dmg: number;
  ammoMax: number;
  potions: number;
  abilities: { slingshot: boolean; doubleJump: boolean; fork: boolean; dash: boolean };
  collected: string[];
  bought: { heart: number; sharp: number; bag: number };
  /** one-off shop upgrades */
  upgrades: { magnet: boolean; lid: boolean; comb: boolean; windCloak: boolean; nutHeart: boolean; nutSling: boolean };
  /** golden walnuts in the pocket (spent at the bear's) */
  nuts: number;
  /** best medal per level (0 none, 1 bronze, 2 silver, 3 gold) */
  medals: Record<string, number>;
  deaths: number;
  playTime: number;
  bossBeaten: boolean;
  /** «Хрумляндия»: progress per episode id (src/three/game/episodes.ts); the prologue is the STORY chain */
  episodes: Record<string, EpisodeProgress>;
  /** the world-map node my figurine stands on */
  mapAt: string;
  settings: Settings;
}

/** an episode: finished (counts for unlocking the next ones), best medal, the step reached in an unfinished one */
export interface EpisodeProgress { done: boolean; medal: number; at?: number }

/**
 * Player settings (kept by «Новая игра»). Volumes are slider positions 0..1 in 20 steps; audio.ts turns them into
 * gain with a loudness taper (sliderGain), so the first step is really quiet. Saves from before `volCurve: 2`
 * stored linear gains and are converted once on load (see migrateVolume).
 */
export interface Settings {
  music: number; sfx: number;
  /** everything at once (music, sounds) */
  master: number;
  /** friends' voices (read by net/voice.ts) and whether they come from where their Tosha stands */
  voice: number; voice3d: boolean;
  /** 2 = volumes are perceptual slider positions */
  volCurve: number;
  shake: boolean;
  /** easy: +3 hearts, no crumbs lost on death, a slower King */
  easy: boolean;
  /** picture: toon outlines, soft shadows (AO), render resolution cap (× device pixels) */
  outlines: boolean; ao: boolean; res: number;
  /** camera: orbit distance (the wheel / zoom keys change it too), field of view */
  camDist: number; fov: number;
  /** look sensitivity multipliers (mouse, right stick), invert the vertical look */
  sens: number; padSens: number; invertY: boolean;
  rumble: boolean;
  /** rebinds over the defaults in engine/input.ts: key codes ('KeyW', 'Mouse0') / standard pad button indices */
  binds: { kb: Record<string, string[]>; pad: Record<string, number[]> };
  /** one-time tips already shown (they outlive «Новая игра») */
  seen: string[];
}

export function defaultSettings(): Settings {
  return {
    music: 0.8, sfx: 0.9, master: 1, voice: 0.8, voice3d: true, volCurve: 2,
    shake: true, easy: false,
    outlines: true, ao: true, res: 1.5,
    camDist: 7.5, fov: 58,
    sens: 1, padSens: 1, invertY: false, rumble: true,
    binds: { kb: {}, pad: {} },
    seen: [],
  };
}

/**
 * Old saves: music/sfx were linear gains (default 0.55 / 0.8; one of ten squares = 0.1 ≈ −20 dB, still loud).
 * Above 0.5 the new position keeps the same loudness (defaults sound as before); below it the scale is squeezed
 * toward silence so the low steps become really quiet. Snapped to the 20-step grid.
 */
export function migrateVolume(old: unknown, fallback: number): number {
  if (typeof old !== 'number' || !isFinite(old)) return fallback;
  const g = Math.min(1, Math.max(0, old));
  // position whose taper gain equals g (inverse of audio.ts sliderGain: dB = −50·(1−v)^1.5)
  const pos = (x: number) => 1 - Math.pow(Math.min(50, -20 * Math.log10(x)) / 50, 2 / 3);
  const v = g >= 0.5 ? pos(g) : (g / 0.5) * pos(0.5);
  return Math.round(v * 20) / 20;
}

let KEY = 'gromadnoe-korolevstvo-save-v1';
export function setSaveKey(k: string) { KEY = k; }

export function freshSave(settings?: SaveData['settings']): SaveData {
  return {
    version: 1,
    started: false,
    story: 0,
    reached: 0,
    crumbs: 0,
    maxHp: 5,
    dmg: 1,
    ammoMax: 10,
    potions: 1,
    abilities: { slingshot: false, doubleJump: false, fork: false, dash: false },
    collected: [],
    bought: { heart: 0, sharp: 0, bag: 0 },
    upgrades: { magnet: false, lid: false, comb: false, windCloak: false, nutHeart: false, nutSling: false },
    nuts: 0,
    medals: {},
    deaths: 0,
    playTime: 0,
    bossBeaten: false,
    episodes: {},
    mapAt: 'prologue',
    settings: settings ?? defaultSettings(),
  };
}

/** saved settings over the defaults (unknown / wrong-typed fields fall back), old volume scale converted */
function loadSettings(base: Settings, raw: Partial<Settings> | undefined): Settings {
  const s: Settings = { ...base };
  if (!raw || typeof raw !== 'object') return s;
  for (const k of Object.keys(base) as (keyof Settings)[]) {
    const v = raw[k];
    if (v !== undefined && typeof v === typeof base[k] && !Array.isArray(base[k])) (s as unknown as Record<string, unknown>)[k] = v;
  }
  if (raw.volCurve !== 2) {
    s.music = migrateVolume(raw.music, base.music);
    s.sfx = migrateVolume(raw.sfx, base.sfx);
    s.volCurve = 2;
  }
  const b = raw.binds;
  s.binds = { kb: { ...(b && typeof b.kb === 'object' ? b.kb : {}) }, pad: { ...(b && typeof b.pad === 'object' ? b.pad : {}) } };
  s.seen = Array.isArray(raw.seen) ? raw.seen.filter((x) => typeof x === 'string') : [];
  return s;
}

class SaveStore {
  data: SaveData = freshSave();

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveData>;
        const base = freshSave();
        this.data = {
          ...base, ...parsed,
          abilities: { ...base.abilities, ...(parsed.abilities ?? {}) },
          bought: { ...base.bought, ...(parsed.bought ?? {}) },
          upgrades: { ...base.upgrades, ...(parsed.upgrades ?? {}) },
          medals: { ...(parsed.medals ?? {}) },
          episodes: { ...(parsed.episodes && typeof parsed.episodes === 'object' ? parsed.episodes : {}) },
          settings: loadSettings(base.settings, parsed.settings),
          collected: parsed.collected ?? [],
        };
      }
    } catch {
      this.data = freshSave();
    }
  }

  write() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
  }

  reset() {
    this.data = freshSave(this.data.settings);
    this.write();
  }

  has(id: string) { return this.data.collected.includes(id); }
  collect(id: string) { if (!this.has(id)) this.data.collected.push(id); }
}

export const save = new SaveStore();
