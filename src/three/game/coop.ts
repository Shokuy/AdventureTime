import { net } from '../../net/session';
import { save } from '../../engine/save';

/**
 * Co-op session state that outlives a single level (levels are rebuilt on team wipes, scenes change):
 * whether a co-op game is running, the room settings the host picked, and my personal per-level seen-sets.
 */
/** the room's difficulty: `easy` and `hard` never both true (hard = «Хардкор», co-op rooms only) */
export interface RoomCfg { easy: boolean; hard: boolean; chapter: number }
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
/** how players see it (lobby, pause menu, results card) */
export const DIFF_NAME: Record<Difficulty, string> = { easy: 'лёгкая', normal: 'нормальная', hard: 'хардкор' };
export const DIFF_COLOR: Record<Difficulty, string> = { easy: '#9ae06a', normal: '#ffe680', hard: '#ff5a6a' };
/**
 * Hardcore (co-op only): a big fall in the library knocks you out where you land (friends must come down for you,
 * no bleed-out), every exit needs the whole team (no 20 s countdown, downed friends count), enemies have
 * HARD_HP× health on top of the party scaling, and heart drops are halved.
 */
export const HARD_HP = 1.3;
type Abilities = typeof save.data.abilities;

class Coop {
  /** a co-op game is running (set by the lobby when the host starts) */
  started = false;
  cfg: RoomCfg = { easy: false, hard: false, chapter: 1 };
  /** my personal pickups / hints per level id (world state comes from the host) */
  private mine = new Map<string, Set<string>>();

  get active() { return this.started && net.active; }
  get isHost() { return net.isHost; }
  /** how many heroes are playing (for difficulty scaling) */
  get players() { return this.active ? Math.max(1, net.members.size) : 1; }

  mySeen(levelId: string) {
    let s = this.mine.get(levelId);
    if (!s) { s = new Set(); this.mine.set(levelId, s); }
    return s;
  }
  resetLevel(levelId: string) { this.mine.delete(levelId); }

  /** easy mode: the room's setting in co-op, my own setting solo */
  get easy() { return this.active ? this.cfg.easy : save.data.settings.easy; }
  /** hardcore: a co-op room setting only (solo has two difficulties) */
  get hard() { return this.active && this.cfg.hard; }
  /** the difficulty in effect right now (co-op: the room's, solo: my own) */
  get diff(): Difficulty { return this.hard ? 'hard' : this.easy ? 'easy' : 'normal'; }

  /** the room's difficulty as one value (lobby / messages) */
  cfgDiff(c: RoomCfg = this.cfg): Difficulty { return c.hard ? 'hard' : c.easy ? 'easy' : 'normal'; }
  setCfgDiff(d: Difficulty) { this.cfg.easy = d === 'easy'; this.cfg.hard = d === 'hard'; }
  /** apply a difficulty from a host message ({ easy, hard }; older messages have no `hard`) */
  takeDiff(d: { easy?: unknown; hard?: unknown }) {
    if (typeof d.easy === 'boolean') this.cfg.easy = d.easy;
    this.cfg.hard = d.hard === true && !this.cfg.easy;
  }

  /** enemy health multiplier for the current party size (hardcore: HARD_HP× on top) */
  hpScale() { const n = this.players; return (1 + 0.4 * (n - 1)) * (this.hard ? HARD_HP : 1); }

  // ───────────── the room's kit ─────────────
  /** my solo abilities, set aside while I play with the room's kit (null: not lent) */
  private real: Abilities | null = null;
  private wrapped = false;
  /**
   * Co-op: everyone plays with the same kit — the chapter's loadout plus what the team found since the room started —
   * never with whatever each one unlocked solo. My solo abilities are kept aside and are what gets saved.
   */
  lendKit(give: (keyof Abilities)[]) {
    const ab = save.data.abilities;
    if (!this.real) {
      this.real = { ...ab };
      for (const k of Object.keys(ab) as (keyof Abilities)[]) ab[k] = false;
      // once: every save in between writes my own abilities (PvP's kit wraps on top of this the same way)
      if (!this.wrapped) {
        this.wrapped = true;
        const write = save.write.bind(save);
        save.write = () => {
          if (!this.real) { write(); return; }
          const lent = { ...save.data.abilities };
          Object.assign(save.data.abilities, this.real);
          try { write(); } finally { Object.assign(save.data.abilities, lent); }
        };
      }
    }
    for (const a of give) ab[a] = true;
  }
  /** back to my solo abilities (room over / back in the lobby) */
  returnKit() {
    if (!this.real) return;
    Object.assign(save.data.abilities, this.real);
    this.real = null;
  }

  stop() { this.started = false; this.mine.clear(); this.returnKit(); }
}

export const coop = new Coop();
