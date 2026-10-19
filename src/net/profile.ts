/**
 * Who I am online: a per-tab id, a name and how my Tosha looks (shared with everyone in the room).
 * The id lives in sessionStorage; a duplicated tab inherits it, so every tab announces its id on a
 * BroadcastChannel at startup and takes a new one if another live tab answers (before any room is joined).
 */

export type HatKind = 'beanie' | 'cap' | 'crown' | 'pirate' | 'bunny' | 'chef' | 'viking' | 'none';
export type BackKind = 'none' | 'backpack' | 'cape' | 'wings';

export interface HeroLook {
  hat: HatKind;
  hatColor: string;
  scarfColor: string;
  shirtColor: string;
  shortsColor: string;
  bootColor: string;
  back: BackKind;
  backColor: string;
  /** nameplate / marker colour */
  tagColor: string;
}

/** the classic Tosha (what single-player always uses unless the player customizes) */
export const DEFAULT_LOOK: HeroLook = {
  hat: 'beanie', hatColor: '#ff8a2a', scarfColor: '#e8383d', shirtColor: '#3fb8a8', shortsColor: '#6b4a3a', bootColor: '#4a2f25',
  back: 'none', backColor: '#8a5a3a', tagColor: '#ffd34a',
};

/**
 * «Хрумляндия»: the playable heroes. Every hero has its own look (same fields as Tosha's; each model maps the
 * colour slots onto its own parts — see HERO_SLOTS in models/heroes.ts; Tosha's hat / back item kinds are his only).
 * The name and the nameplate colour (tagColor) are the player's, shared by all heroes.
 */
export type HeroKind = 'tosha' | 'bublik' | 'noki' | 'pastila';
export const HERO_KINDS: readonly HeroKind[] = ['tosha', 'bublik', 'noki', 'pastila'];
export const isHeroKind = (k: unknown): k is HeroKind => typeof k === 'string' && (HERO_KINDS as readonly string[]).includes(k);
export const DEFAULT_LOOKS: Record<HeroKind, HeroLook> = {
  tosha: DEFAULT_LOOK,
  // hat = the bagel tag, scarf = collar, shirt = fur, shorts = ears & spots, boot = paws & muzzle
  bublik: { hat: 'none', hatColor: '#e8a850', scarfColor: '#d8343a', shirtColor: '#b0612e', shortsColor: '#7a3e1c', bootColor: '#e0a066', back: 'none', backColor: '#8a5a3a', tagColor: '#ffd34a' },
  // hat = hair streak, scarf = choker & laces, shirt = jacket, shorts = skirt, boot = boots, back = the axe-guitar's body
  noki: { hat: 'none', hatColor: '#e0306a', scarfColor: '#d02848', shirtColor: '#4a3270', shortsColor: '#8e1e3c', bootColor: '#2a2030', back: 'none', backColor: '#b8283a', tagColor: '#ffd34a' },
  // hat = crown gems, scarf = bow & sash, shirt = dress, shorts = stockings, boot = shoes, back = the syrup in the syringe
  pastila: { hat: 'none', hatColor: '#4ad8e0', scarfColor: '#ff4a8a', shirtColor: '#ff78b4', shortsColor: '#ffe0ec', bootColor: '#a8306a', back: 'none', backColor: '#ff3a7a', tagColor: '#ffd34a' },
};
/** what a member plays (meta `hero`): the chosen hero and its look */
export interface HeroPick { kind: HeroKind; look: HeroLook }

export const TAG_COLORS = ['#ffd34a', '#5ad8ff', '#ff6a8a', '#8ae05a', '#c08aff', '#ff9a3a'];

const HATS: HatKind[] = ['beanie', 'cap', 'crown', 'pirate', 'bunny', 'chef', 'viking', 'none'];
const BACKS: BackKind[] = ['none', 'backpack', 'cape', 'wings'];
const COLOR_KEYS = ['hatColor', 'scarfColor', 'shirtColor', 'shortsColor', 'bootColor', 'backColor', 'tagColor'] as const;
/** a stored / received look with unknown parts or broken colours falls back to the classic Tosha (or `base`) */
export function cleanLook(l: Partial<HeroLook> | null | undefined, base: HeroLook = DEFAULT_LOOK): HeroLook {
  const o: HeroLook = { ...base };
  if (!l || typeof l !== 'object') return o;
  if (HATS.includes(l.hat as HatKind)) o.hat = l.hat as HatKind;
  if (BACKS.includes(l.back as BackKind)) o.back = l.back as BackKind;
  for (const k of COLOR_KEYS) { const v = l[k]; if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) o[k] = v.toLowerCase(); }
  return o;
}

/** a hero pick from storage / the network (unknown kind → Tosha with `tosha`, the member's Tosha look) */
export function cleanPick(p: unknown, tosha: HeroLook = DEFAULT_LOOK): HeroPick {
  const o = (p && typeof p === 'object' ? p : {}) as Partial<HeroPick>;
  const kind = isHeroKind(o.kind) ? o.kind : 'tosha';
  if (kind === 'tosha') return { kind, look: cleanLook(o.look ?? tosha) };
  return { kind, look: cleanLook(o.look, { ...DEFAULT_LOOKS[kind], tagColor: tosha.tagColor }) };
}

const NAME_KEY = 'gk-profile-v1';
const ID_KEY = 'gk-tab-id';

function makeId() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/** tabs of this browser announce their ids here (a duplicated tab inherits sessionStorage, and so the id) */
const ID_CHANNEL = 'gk-tab-ids';
/** how long a new tab listens for "that id is mine" before it may join a room */
const ID_CHECK_MS = 250;

type IdMsg = { k: 'hello'; id: string; inst: string } | { k: 'taken'; id: string; inst: string; to: string };

class Profile {
  /** unique per browser tab (so two tabs on one PC are two players); final once `ready` resolved */
  id: string;
  name = '';
  /** my Tosha's look (as before; what the prologue and older builds show) */
  look: HeroLook = { ...DEFAULT_LOOK };
  /** the hero I play after the prologue (persisted) */
  kind: HeroKind = 'tosha';
  /** the other heroes' looks (Tosha's is `look`) */
  private looks: Partial<Record<HeroKind, HeroLook>> = {};
  /** resolves once no other live tab claims my id (a duplicated tab gets a fresh one) */
  readonly ready: Promise<void>;
  /** in a room: my id must not change any more */
  private locked = false;
  private subs = new Set<() => void>();

  constructor() {
    let id: string | null = null;
    try { id = sessionStorage.getItem(ID_KEY); } catch { /* storage blocked */ }
    if (!id) { id = makeId(); try { sessionStorage.setItem(ID_KEY, id); } catch { /* */ } }
    this.id = id;
    try {
      const raw = localStorage.getItem(NAME_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { name?: string; look?: Partial<HeroLook>; kind?: string; looks?: Record<string, Partial<HeroLook>> };
        this.name = (p.name ?? '').slice(0, 16);
        this.look = cleanLook(p.look);
        if (isHeroKind(p.kind)) this.kind = p.kind;
        for (const k of HERO_KINDS) if (k !== 'tosha' && p.looks?.[k]) this.looks[k] = cleanLook(p.looks[k], DEFAULT_LOOKS[k]);
      }
    } catch { /* */ }
    if (!this.name) this.name = defaultName(this.id);
    this.ready = this.claimId();
  }

  /** announce my id to the other tabs of this browser; one that already uses it answers and I take a new one */
  private claimId(): Promise<void> {
    if (typeof BroadcastChannel === 'undefined') return Promise.resolve();
    let bc: BroadcastChannel;
    try { bc = new BroadcastChannel(ID_CHANNEL); } catch { return Promise.resolve(); }
    const inst = makeId();
    bc.onmessage = (e: MessageEvent) => {
      const m = e.data as IdMsg;
      if (!m || typeof m !== 'object' || m.inst === inst || m.id !== this.id) return;
      if (m.k === 'hello') {
        // someone else started with my id: it's theirs to change (I may already be in a room)
        bc.postMessage({ k: 'taken', id: this.id, inst, to: m.inst } satisfies IdMsg);
      } else if (m.k === 'taken' && m.to === inst && !this.locked) {
        const old = this.id;
        this.id = makeId();
        try { sessionStorage.setItem(ID_KEY, this.id); } catch { /* */ }
        if (this.name === defaultName(old)) this.name = defaultName(this.id);
        bc.postMessage({ k: 'hello', id: this.id, inst } satisfies IdMsg);
        for (const f of this.subs) f();
      }
    };
    bc.postMessage({ k: 'hello', id: this.id, inst } satisfies IdMsg);
    return new Promise((r) => setTimeout(r, ID_CHECK_MS));
  }

  /** joining a room: the id is final from now on (other tabs that start with it change theirs) */
  lock() { this.locked = true; }

  private write() {
    try { localStorage.setItem(NAME_KEY, JSON.stringify({ name: this.name, look: this.look, kind: this.kind, looks: this.looks })); } catch { /* */ }
    for (const f of this.subs) f();
  }
  setName(n: string) { this.name = n.trim().slice(0, 16) || this.name; this.write(); }
  /** patch my Tosha's look (the nameplate colour goes for every hero) */
  setLook(patch: Partial<HeroLook>) { this.look = { ...this.look, ...patch }; this.write(); }
  /** a hero's look (with my nameplate colour) */
  lookOf(kind: HeroKind): HeroLook {
    if (kind === 'tosha') return { ...this.look };
    return { ...(this.looks[kind] ?? DEFAULT_LOOKS[kind]), tagColor: this.look.tagColor };
  }
  /** patch a hero's look (tagColor: the player's, set on Tosha's look for all) */
  setLookOf(kind: HeroKind, patch: Partial<HeroLook>) {
    if (kind === 'tosha') { this.setLook(patch); return; }
    const { tagColor, ...rest } = patch;
    if (tagColor) this.look = { ...this.look, tagColor };
    this.looks[kind] = { ...(this.looks[kind] ?? DEFAULT_LOOKS[kind]), ...rest };
    this.write();
  }
  /** pick the hero I play after the prologue */
  setKind(kind: HeroKind) { if (isHeroKind(kind) && kind !== this.kind) { this.kind = kind; this.write(); } }
  /** what the room sees me play (meta `hero`) */
  pick(): HeroPick { return { kind: this.kind, look: this.lookOf(this.kind) }; }
  onChange(f: () => void) { this.subs.add(f); return () => { this.subs.delete(f); }; }
}

function defaultName(id: string) { return 'Тоша-' + id.slice(0, 3).toUpperCase(); }

export const profile = new Profile();
