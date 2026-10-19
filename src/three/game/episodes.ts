import { save, type EpisodeProgress } from '../../engine/save';
import { game, STORY, type StoryStep, type Scene } from '../../game/game';
import { LEVELS3 } from './levels';

/*
 * «Хрумляндия»: the series (episodes) and their nodes on the world map.
 *  • the prologue (series 1) is the old story chain STORY (intro → chapters → ending → credits); its end opens the map;
 *  • every other episode plays its `levels` in order: Level3Def ids from LEVELS3, or 'scene:<id>' steps from
 *    EPISODE_SCENES. An id that isn't built yet plays as a clearly marked «Серия в разработке» card (the stub scene),
 *    so the whole flow (map → episode → done → next node opens → map) already works end to end;
 *  • adding an episode = one entry in EPISODES (+ its levels in LEVELS3 when they exist). The map draws a plain node for
 *    it; a region of its own (props, colours) is optional (worldMap.ts, keyed by `node.look`).
 * Progress lives in save.data.episodes ({ done, medal, at }); in co-op the room plays on the HOST's map.
 * Story flags (setStoryFlag) — story beats that open map nodes (a scene seen: `fangs1` opens once the hub's lab scene
 * `hub_lab_plan` played) — are kept in the same record as entries `@<flag>` ({ done: true }), so they are saved, merged
 * and sent with the host's map progress in co-op exactly like episodes (coopFlow.mapProg, the map messages).
 */

export type EpState = 'locked' | 'available' | 'done';

export interface EpisodeNode {
  /** the place's name on the map label */
  name: string;
  /** map position (world units; x → east, z → south) */
  x: number; z: number;
  /** which diorama region the map builds around it (worldMap.ts); unknown → a plain node */
  look?: string;
}

export interface Episode {
  id: string;
  /** series number (the prologue = 1, the vampire arc = 2–6); 0 = not a series (the hub town, future lands) */
  n: number;
  title: string;
  subtitle: string;
  /** the story arc ('' = none) */
  arc: string;
  node: EpisodeNode;
  /** what it plays, in order: Level3Def ids / 'scene:<id>' (unbuilt → «Серия в разработке») */
  levels: string[];
  /** episodes this one opens when done */
  unlocks: string[];
  /** paths on the map (both ways; listing a link on one side is enough) */
  links: string[];
  /** the card's text: the pitch (available / done), the mystery (soon) */
  teaser?: string;
  /** a free-walk place: always open after the prologue, never «done», no medals */
  hub?: boolean;
  /** a future land: always locked, in fog, with a mysterious caption */
  soon?: boolean;
  /** opens when this story flag is set (setStoryFlag) — besides `unlocks` of other episodes */
  flag?: string;
  /** the locked card's line when a story flag (not a series) opens it */
  lockHint?: string;
}

export const ARC_FANGS = 'Ночь клыков';

const EP_LIST: Episode[] = [
  {
    id: 'prologue', n: 1, title: 'Громадное королевство', subtitle: 'Побег из ямы', arc: '',
    node: { name: 'Яма Громадин', x: -40, z: 18, look: 'pit' },
    levels: ['pantry', 'feast', 'library', 'chase', 'throne'], unlocks: ['hub'], links: ['hub'],
    teaser: 'Тоша попал в яму к Королю Громадин — и выбрался наверх. Пять глав: Кладовая, Пир, Библиотека, Погоня, Тронный зал.',
  },
  {
    id: 'hub', n: 0, title: 'Пастильное королевство', subtitle: 'Город из пастилы, пряников и зефира', arc: '',
    node: { name: 'Пастильное королевство', x: -16, z: 6, look: 'pastila' },
    levels: ['hub'], unlocks: [], links: ['fangs1', 'lemon'], hub: true,
    teaser: 'Зефирные башни, пряничные домики и принцесса-учёная Пастила. Здесь лавка, Зеркало героев и лаборатория.',
  },
  {
    id: 'fangs1', n: 2, title: 'Клыки в пастиле', subtitle: 'Граф Нетопырь', arc: ARC_FANGS,
    node: { name: 'Пастильная площадь', x: 2, z: 16, look: 'square' },
    levels: ['fangs1_town', 'fangs1_roofs'], unlocks: ['fangs2'], links: ['fangs2'],
    // the arc starts after the meeting in Пастила's lab (docs/script-fangs.md 4.4, scene `hub_lab_plan`)
    flag: 'hub_lab_plan', lockHint: 'Туман. Сначала — лаборатория принцессы в Пастильном королевстве',
    teaser: 'Над городом встала Алая луна. Жители стали серыми и сонными, а на крышах кто-то шуршит крыльями…',
  },
  {
    id: 'fangs2', n: 3, title: 'Туманные топи', subtitle: 'Мадам Морок', arc: ARC_FANGS,
    node: { name: 'Туманные топи', x: 24, z: 10, look: 'swamp' },
    levels: ['fangs2_swamp'], unlocks: ['fangs3'], links: ['fangs3', 'carnival'],
    teaser: 'Дома на сваях, огоньки над водой и оборотень, который умеет становиться кем угодно. Даже тобой.',
  },
  {
    id: 'fangs3', n: 4, title: 'Стеклянная оранжерея', subtitle: 'Шёпот', arc: ARC_FANGS,
    node: { name: 'Стеклянная оранжерея', x: 10, z: -12, look: 'glass' },
    levels: ['fangs3_garden'], unlocks: ['fangs4'], links: ['fangs4', 'ice'],
    teaser: 'Хрустальный сад, зеркала и лунный свет. Здесь живёт тот, кого не видно — только слышно.',
  },
  {
    id: 'fangs4', n: 5, title: 'Чёрный перевал', subtitle: 'Сёстры Близняшки', arc: ARC_FANGS,
    node: { name: 'Чёрный перевал', x: 32, z: -20, look: 'pass' },
    levels: ['fangs4_pass'], unlocks: ['fangs5'], links: ['fangs5', 'fire'],
    teaser: 'Дорога к замку: шаткие мосты над пропастью, ветер и две сестры, которые никогда не смотрят в одну сторону.',
  },
  {
    id: 'fangs5', n: 6, title: 'Замок Полночь', subtitle: 'Король Полночь', arc: ARC_FANGS,
    node: { name: 'Замок Полночь', x: 46, z: -36, look: 'castle' },
    levels: ['fangs5_castle'], unlocks: [], links: [],
    teaser: 'Замок на скале под огромной луной. Король Полночь ждёт. Пастиле нужно время, чтобы зарядить Солнечную пушку.',
  },
  // future lands: on the map, locked, in fog
  {
    id: 'lemon', n: 0, title: 'Лимонное графство', subtitle: 'Скоро', arc: '', soon: true,
    node: { name: 'Лимонное графство', x: -46, z: -14, look: 'lemon' }, levels: [], unlocks: [], links: [],
    teaser: 'Оттуда пахнет кислым. И кто-то оттуда очень любит писать письма…',
  },
  {
    id: 'ice', n: 0, title: 'Ледяная гора', subtitle: 'Скоро', arc: '', soon: true,
    node: { name: 'Ледяная гора', x: -16, z: -34, look: 'ice' }, levels: [], unlocks: [], links: [],
    teaser: 'Говорят, на вершине кто-то поёт — и от этой песни замерзают облака.',
  },
  {
    id: 'fire', n: 0, title: 'Огненное царство', subtitle: 'Скоро', arc: '', soon: true,
    node: { name: 'Огненное царство', x: 56, z: 2, look: 'fire' }, levels: [], unlocks: [], links: [],
    teaser: 'Земля там тёплая, как свежий пирожок. Слишком тёплая.',
  },
  {
    id: 'carnival', n: 0, title: 'Конфетный карнавал', subtitle: 'Скоро', arc: '', soon: true,
    node: { name: 'Конфетный карнавал', x: 30, z: 32, look: 'carnival' }, levels: [], unlocks: [], links: [],
    teaser: 'Музыка играет там каждую ночь. Только музыкантов никто ни разу не видел.',
  },
];

export const EPISODES: Record<string, Episode> = Object.fromEntries(EP_LIST.map((e) => [e.id, e]));
export const episodeList = () => EP_LIST;

/** map paths: every link once, as [a, b] */
export function mapEdges(): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const e of EP_LIST) for (const l of e.links) {
    if (!EPISODES[l]) continue;
    const k = [e.id, l].sort().join('|');
    if (!seen.has(k)) { seen.add(k); out.push([e.id, l]); }
  }
  return out;
}
export function neighbours(id: string): string[] {
  const out: string[] = [];
  for (const [a, b] of mapEdges()) { if (a === id) out.push(b); else if (b === id) out.push(a); }
  return out;
}

/**
 * Extra steps an episode can list as 'scene:<id>' (a cutscene between levels…). The scene ends its step with
 * stepDone() (coopFlow.ts) — solo: next step, co-op: ready / the host moves the room on. Unregistered → the stub card.
 */
export const EPISODE_SCENES: Record<string, () => Scene> = {};

// ───────────────────────── progress ─────────────────────────
export type Progress = Record<string, EpisodeProgress>;

/** STORY index of the ending: a save that reached it has finished the prologue (saves from before the map) */
const ENDING = STORY.findIndex((s) => s.kind === 'story' && s.id === 'ending');

/** my progress (the prologue also counts as done for old saves that reached the ending) */
export function myProgress(): Progress {
  const p: Progress = { ...save.data.episodes };
  if (!p.prologue?.done && save.data.reached >= ENDING) p.prologue = { done: true, medal: p.prologue?.medal ?? 0 };
  return p;
}

export function prologueDone(prog: Progress = myProgress()) { return !!prog.prologue?.done; }

/** some of its levels exist (the prologue always; an episode of stubs only plays «Серия в разработке» cards) */
export function isBuilt(ep: Episode) { return ep.id === 'prologue' || ep.levels.some((l) => !!LEVELS3[l] || !!EPISODE_SCENES[l.replace(/^scene:/, '')]); }

/** what the map shows for an episode, from a progress (mine solo, the host's in co-op) */
export function epState(ep: Episode, prog: Progress = myProgress()): EpState {
  if (ep.soon) return 'locked';
  if (prog[ep.id]?.done && !ep.hub) return 'done';
  if (ep.id === 'prologue') return 'available';
  for (const o of EP_LIST) if (o.unlocks.includes(ep.id) && prog[o.id]?.done) return 'available';
  if (ep.flag && hasStoryFlag(ep.flag, prog)) return 'available';
  if (ep.hub && prologueDone(prog)) return 'available';
  return 'locked';
}

/** the episode that opens this one (for the locked card's hint) */
export function openedBy(ep: Episode): Episode | null {
  return EP_LIST.find((o) => o.unlocks.includes(ep.id)) ?? null;
}

/** the medal an episode earns now: the worst of its built levels' best medals (0 when none is built yet) */
export function epMedal(ep: Episode): number {
  const ids = ep.levels.filter((l) => !!LEVELS3[l]);
  if (!ids.length) return 0;
  return Math.min(...ids.map((l) => save.data.medals[l] ?? 0));
}

/** episodes that just opened (the map plays their reveal once) */
const reveal: string[] = [];
export function takeReveal(): string[] { return reveal.splice(0); }

/** an episode is finished on this machine: mark it, keep the best medal; returns the episodes it opened */
export function completeEpisode(id: string): string[] {
  const ep = EPISODES[id];
  if (!ep || ep.hub || ep.soon) return [];
  const before = new Set(EP_LIST.filter((e) => epState(e) !== 'locked').map((e) => e.id));
  const p = save.data.episodes[id] ?? { done: false, medal: 0 };
  p.done = true;
  p.medal = Math.max(p.medal, epMedal(ep));
  delete p.at;
  save.data.episodes[id] = p;
  save.data.mapAt = id;
  save.write();
  const fresh = EP_LIST.filter((e) => !before.has(e.id) && epState(e) !== 'locked').map((e) => e.id);
  reveal.push(...fresh);
  return fresh;
}

/**
 * Old saves: finished the prologue before the map existed → it's marked done (with its medal), so the map is open;
 * already went into the arc before series 2 waited for the lab scene (played / finished any of it) → the lab's story
 * flag is set, so nothing that was open closes again.
 */
export function migrateEpisodes() {
  let dirty = false;
  if (!save.data.episodes.prologue?.done && save.data.reached >= ENDING) {
    save.data.episodes.prologue = { done: true, medal: epMedal(EPISODES.prologue) };
    dirty = true;
  }
  for (const ep of EP_LIST) {
    if (!ep.flag || hasStoryFlag(ep.flag, save.data.episodes)) continue;
    const went = EP_LIST.some((e) => e.arc && e.arc === ep.arc && (save.data.episodes[e.id]?.done || save.data.episodes[e.id]?.at !== undefined));
    if (went) { save.data.episodes[FLAG(ep.flag)] = { done: true, medal: 0 }; dirty = true; }
  }
  if (dirty) save.write();
}

// ───────────────────────── story flags ─────────────────────────
const FLAG = (f: string) => '@' + f;
/** a story flag is set in a progress (mine by default; in co-op pass the room's: coopFlow.mapProg()) */
export function hasStoryFlag(f: string, prog: Progress = myProgress()): boolean { return !!prog[FLAG(f)]?.done; }
/**
 * A story beat happened on this machine (a scene played): set the flag in my save; returns the episodes it opened
 * (the map plays their reveal). In co-op every machine that played the scene sets it; the room's map shows the host's.
 */
export function setStoryFlag(f: string): string[] {
  if (save.data.episodes[FLAG(f)]?.done) return [];
  const before = new Set(EP_LIST.filter((e) => epState(e) !== 'locked').map((e) => e.id));
  save.data.episodes[FLAG(f)] = { done: true, medal: 0 };
  save.write();
  const fresh = EP_LIST.filter((e) => !before.has(e.id) && epState(e) !== 'locked').map((e) => e.id);
  reveal.push(...fresh);
  return fresh;
}

// ───────────────────────── playing ─────────────────────────
/** the steps an episode plays (the prologue's are the STORY chain, not listed here) */
export function stepsOf(ep: Episode): StoryStep[] {
  return ep.levels.map((l): StoryStep => {
    if (l.startsWith('scene:')) return { kind: 'scene', id: l.slice(6), ep: ep.id };
    const def = LEVELS3[l];
    if (def) return { kind: 'level', id: l, title: `${ep.title}: ${def().title}` };
    return { kind: 'scene', id: l, ep: ep.id };
  });
}

/** where the prologue picks up from its node (its current STORY step; finished → from the start) */
export function prologueStep(): number {
  return prologueDone() && save.data.story >= ENDING - 1 ? 0 : save.data.story;
}

/** solo: play an episode from step `step` (no lock check: the map only offers open ones) */
export function playEpisode(id: string, step = 0) {
  const ep = EPISODES[id];
  if (!ep || ep.soon) return;
  save.data.mapAt = id;
  if (id === 'prologue') { game.story(step || prologueStep()); return; }
  game.play({
    id, steps: stepsOf(ep), i: step,
    at: (i) => { if (ep.hub) return; const p = save.data.episodes[id] ?? { done: false, medal: 0 }; if (!p.done) p.at = i; save.data.episodes[id] = p; save.write(); },
    done: () => { completeEpisode(id); game.toMap(); },
  }, step);
}

/** the card's line for a level / scene id of an episode ('Часть 2 из 3') */
export function partName(ep: Episode, i: number) { return ep.levels.length > 1 ? `Часть ${i + 1} из ${ep.levels.length}` : ''; }
