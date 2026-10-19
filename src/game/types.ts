import type { SolidStyle, HazardStyle, Decor } from '../art/props';
import type { Theme } from '../art/backgrounds';
import type { MusicName } from '../engine/audio';
import type { Rect } from '../engine/util';

export interface Solid extends Rect {
  id: number;
  style: SolidStyle;
  seed: number;
  color?: string;
  oneway?: boolean;
  bounce?: number;
  crumbly?: boolean;
  crumble?: number;
  gone?: number;
  wob?: number;
  legs?: number;
  active: boolean;
  gate?: boolean;
}

export interface SolidDef extends Rect {
  style: SolidStyle; seed?: number; color?: string; oneway?: boolean; bounce?: number; crumbly?: boolean; legs?: number;
}

export interface Hazard extends Rect { style: HazardStyle; dmg: number }

export type EnemyKind = 'guard' | 'spitter' | 'meatball' | 'jelly' | 'book';
export interface EnemyDef { kind: EnemyKind; x: number; y: number; range?: number; facing?: number; hue?: number }

export type PickupKind = 'crumb' | 'bigcrumb' | 'heart' | 'peas' | 'honey' | 'container' | 'doubleJump' | 'dash' | 'fork' | 'sling';
export interface PickupDef { kind: PickupKind; x: number; y: number; id?: string }

export interface NoodleDef { x: number; y: number; len: number; dir?: 1 | -1 }
export interface SignDef { x: number; y: number; label: string; text: string }
export interface TriggerDef extends Rect { script: string; once?: boolean }
export interface TrapDef extends Rect { drops: number[]; dropY: number }
export interface ArenaDef { x: number; w: number; floorY: number; waves: EnemyDef[][]; reward?: PickupDef[] }
export interface NpcDef { kind: 'bear' | 'kingBg' | 'dog'; x: number; y: number; s?: number; facing?: number }

export interface LevelDef {
  id: string;
  chapter: number;
  title: string;
  subtitle: string;
  theme: Theme;
  music: MusicName;
  w: number; h: number;
  spawn: { x: number; y: number };
  solids: SolidDef[];
  hazards: Hazard[];
  enemies: EnemyDef[];
  pickups: PickupDef[];
  decor: Decor[];
  signs: SignDef[];
  checkpoints: { x: number; y: number }[];
  noodles: NoodleDef[];
  triggers: TriggerDef[];
  traps: TrapDef[];
  arenas: ArenaDef[];
  npcs: NpcDef[];
  exit?: Rect;
  special?: 'chase' | 'boss';
  startScript?: string;
  zoom?: number;
  darkness?: number;
}
