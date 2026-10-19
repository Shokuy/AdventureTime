/** Wire format: message envelope, quantization helpers and the reserved message type names. */

export { PROTOCOL_VERSION } from './config';

/** one message on a data channel / in a relay batch: [type, data] */
export type Envelope = [type: string, data: unknown];

/** a decoded data-channel message; seq > 0 = reliable, numbered per sender → receiver (re-ordered on receipt) */
export interface Decoded { seq: number; type: string; data: unknown }

export function encode(type: string, data: unknown): string {
  return JSON.stringify(data === undefined ? [type] : [type, data]);
}

/** an encoded message with its sequence number in front: [seq, type, data] (cheap: no second stringify) */
export function withSeq(encoded: string, seq: number): string {
  return '[' + seq + ',' + encoded.slice(1);
}

export function decode(raw: unknown): Envelope | null {
  const d = decodeSeq(raw);
  return d ? [d.type, d.data] : null;
}

/** [type, data] or [seq, type, data] */
export function decodeSeq(raw: unknown): Decoded | null {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return null;
    if (typeof v[0] === 'string') return { seq: 0, type: v[0], data: v[1] };
    if (typeof v[0] === 'number' && v[0] > 0 && Number.isInteger(v[0]) && typeof v[1] === 'string') return { seq: v[0], type: v[1], data: v[2] };
  } catch { /* garbage */ }
  return null;
}

/** quantize a number to a step so JSON stays short: q(1.23456, 0.01) === 1.23 */
export function q(v: number, step: number): number {
  if (!Number.isFinite(v)) return 0;
  if (step >= 1) return Math.round(v / step) * step;
  const inv = Math.round(1 / step);
  return Math.round(v * inv) / inv;
}

/** quantize every component: qv([x, y, z], 0.01) */
export function qv(values: ArrayLike<number>, step: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) out.push(q(values[i], step));
  return out;
}

/** angle in radians -> 0..255 (one byte of JSON-friendly int) and back */
export const qAngle = (a: number) => ((Math.round((a / (Math.PI * 2)) * 256) % 256) + 256) % 256;
export const dqAngle = (b: number) => (b / 256) * Math.PI * 2;

/**
 * Game message types reserved by the co-op update (docs/MULTIPLAYER.md). Use these names with
 * net.send / net.on so systems don't collide. "u" = send unreliable (state stream), else reliable.
 */
export const MSG = {
  // replication
  heroState: 'st', //            u  every client -> all: my hero pose/anim/hp (≈15 Hz)
  snapshot: 'snap', //           u  host -> all: enemies / boss / movers
  hit: 'hit', //                    attacker -> host: I hit enemy X
  hurt: 'hurt', //                  host -> owner: your hero takes damage
  spawn: 'spawn', //                host -> all: projectile / faller / shockwave / bomb
  kill: 'kill', //                  host -> all: enemy died (clients spawn their own loot)
  event: 'ev', //                   host -> all: generic level event (trigger, arena, door)
  // flow
  lobbyCfg: 'lobbycfg', //          host -> all: chapter + difficulty picked in the lobby
  start: 'start', //                host -> all: load scene (chapter, seed, checkpoint)
  scene: 'scene', //                host -> all: scene change / restart from candle
  candle: 'candle', //              any -> all: checkpoint lit (shared candles)
  exit: 'exit', //                  host -> all: exit door state / countdown
  den: 'den', //                    host -> all: team den (shop) state
  // social
  phrase: 'phrase', //              any -> all: quick phrase id
  mark: 'mark', //                  any -> all: ping marker on ground / enemy
  emote: 'emote', //                any -> all: wave / dance / bow / facepalm
  // co-op
  down: 'down', //                  owner -> all: I'm downed / back up
  revive: 'revive', //              reviver -> all: revive progress / done
  boost: 'boost', //                jumper -> all: boost jump off a friend's head
  plate: 'plate', //                host -> all: two-player plate state
  gift: 'gift', //                  giver -> receiver: honey jar / crumbs
  rescue: 'rescue', //              any -> host: freed a grabbed friend
  clap: 'clap', //                  any -> host: hit one of the King's stuck palms
  toss: 'toss', //                  host -> owner: straggler tossed forward to the group
  // competition
  score: 'score', //                any -> all: my stats (crumbs, kills, damage, revives, downs)
  results: 'results', //            host -> all: chapter results (MVP, titles)
  walnut: 'walnut', //              finder -> all: found a golden walnut
  leader: 'leader', //              host -> all: current score leader (King's favourite target)
  pvp: 'pvp', //                    host -> all: «Крошечная лихорадка» start / end / scores
  crumbDrop: 'crumbdrop', //        victim -> all: dropped crumbs after a PvP hit
} as const;

export type GameMsg = (typeof MSG)[keyof typeof MSG];

/** net-internal types start with '_' (ping, pong, flood test…) and never reach net.on handlers */
export const SYS = {
  /** [t, term, host, seen] — round trip, clock, host announcement and who I hear (liveness gossip) */
  ping: '_pi',
  /** [t0, roomClock, term, host] */
  pong: '_po',
  /** host -> member: you are kicked (only accepted from the current host) */
  kick: '_ki',
  /** I'm leaving (over the data channel = authenticated; the room-channel 'bye' is only a hint) */
  bye: '_by',
} as const;
export const isSysType = (t: string) => t.charCodeAt(0) === 95; // '_'

export type NetErrorCode = 'bad_code' | 'not_found' | 'full' | 'version' | 'network' | 'busy' | 'taken' | 'cancelled';

/** errors thrown by net.create / join / quickMatch; message is ready to show to the player */
export class NetError extends Error {
  constructor(public code: NetErrorCode, message: string) {
    super(message);
    this.name = 'NetError';
  }
}

export const ERR_TEXT: Record<NetErrorCode, string> = {
  bad_code: 'Неверный код комнаты — нужно 5 букв или цифр',
  not_found: 'Комната не найдена — проверь код',
  full: 'Комната заполнена (6 из 6)',
  version: 'В этой комнате другая версия игры — обновите страницу',
  network: 'Нет связи с сервером — проверь интернет',
  busy: 'Подключение уже идёт',
  taken: 'Код занят',
  cancelled: 'Подключение отменено',
};
