import { createHero, type HeroRig } from './hero';
import { createBublik } from './bublik';
import { createNoki } from './noki';
import { createPastila } from './pastila';
import { DEFAULT_LOOKS, HERO_KINDS, isHeroKind, type HeroKind, type HeroLook } from '../../net/profile';

export type { HeroKind } from '../../net/profile';
export { HERO_KINDS, isHeroKind } from '../../net/profile';

/**
 * «Хрумляндия»: a playable hero's model by kind. Every rig has Tosha's interface (HeroRig: root, update(dt, HeroAnim),
 * weaponTip, look, setLook, dispose) — idle / run / walk / sneak / jump / fall / dash / hurt / grabbed / dead / sit /
 * cheer / lookUp / tumble / wave / dance / bow / facepalm / downed, talk, expressions, its own attack poses
 * (HeroAtk) and kit visuals (HeroFx). The look is that hero's own (see HERO_SLOTS); missing fields → its defaults.
 * Feet at the root's origin, facing +Z, ≈1 unit ≈ Tosha's height. Story NPC: `L.npc('noki', x, y, z, yaw)`.
 */
export function createHeroModel(kind: HeroKind, look?: Partial<HeroLook>): HeroRig {
  switch (kind) {
    case 'bublik': return createBublik({ ...DEFAULT_LOOKS.bublik, ...look });
    case 'noki': return createNoki({ ...DEFAULT_LOOKS.noki, ...look });
    case 'pastila': return createPastila({ ...DEFAULT_LOOKS.pastila, ...look });
    default: return createHero(look ?? DEFAULT_LOOKS.tosha);
  }
}

/** what the picker / HUD say about each hero (ability glyphs are input actions, see ui/glyphs.ts) */
export interface HeroInfo {
  name: string;
  /** one line: who they are in play */
  role: string;
  /** signature colour (cards, markers) */
  color: string;
  abilities: Array<{ act: 'attack' | 'shoot' | 'jump' | 'dash' | 'special'; name: string; text: string }>;
}

export const HERO_INFO: Record<HeroKind, HeroInfo> = {
  tosha: {
    name: 'Тоша', role: 'Мальчишка-герой: меч, рогатка, двойной прыжок', color: '#ff8a2a',
    abilities: [
      { act: 'attack', name: 'Меч / вилка', text: 'в воздухе — вертушка' },
      { act: 'shoot', name: 'Рогатка', text: 'держи — прицел' },
      { act: 'jump', name: 'Двойной прыжок', text: 'ещё раз в воздухе' },
      { act: 'dash', name: 'Рывок', text: 'сквозь удары' },
      { act: 'special', name: 'Геройский клич', text: 'друзьям рядом скорость и щит (раз в 20 с)' },
    ],
  },
  bublik: {
    name: 'Бублик', role: 'Тянущийся пёс: бьёт издалека, мост и батут для друзей', color: '#e8a850',
    abilities: [
      { act: 'attack', name: 'Лапа-пружина', text: 'удар на 3 м, в воздухе — мельница' },
      { act: 'shoot', name: 'Лапа-крюк', text: 'цепляется за кольца, края, врагов' },
      { act: 'dash', name: 'Перекат', text: 'вместо рывка; двойного прыжка нет' },
      { act: 'special', name: 'Мост', text: 'держи — тянется над пропастью до 12 м' },
      { act: 'special', name: 'Батут', text: 'нажми — надуется, друзья отскакивают' },
    ],
  },
  noki: {
    name: 'Ноки', role: 'Полувампирша-рокерша: топор-гитара, гроза вампиров', color: '#c8304a',
    abilities: [
      { act: 'attack', name: 'Топор-гитара', text: 'держи — тяжёлый удар; вампирам ×1,5' },
      { act: 'shoot', name: 'Щипок', text: 'звуковая нота на 10 м' },
      { act: 'jump', name: 'Парение', text: 'держи прыжок в воздухе' },
      { act: 'dash', name: 'Летучая мышь', text: 'сквозь врагов и узкие щели' },
      { act: 'special', name: 'Аккорд', text: 'оглушает вампиров, друзьям +1 ♥' },
    ],
  },
  pastila: {
    name: 'Пастила', role: 'Принцесса-учёная: сироп, гаджеты, поднимает друзей вдвое быстрее', color: '#ff78b4',
    abilities: [
      { act: 'attack', name: 'Колба-хлоп', text: 'ближний удар' },
      { act: 'shoot', name: 'Шприц-пистолет', text: 'липкий сироп, без гороха' },
      { act: 'dash', name: 'Короткий рывок', text: '' },
      { act: 'special', name: 'Гаджет', text: 'батут, сиропный щит, маяк-солнышко' },
      { act: 'special', name: 'Колесо гаджетов', text: 'держи — выбрать' },
    ],
  },
};

/** the colour slots each hero offers in «Мой герой» (field of HeroLook → label) */
export const HERO_SLOTS: Record<HeroKind, Array<{ key: keyof HeroLook; label: string; palette: string[] }>> = {
  tosha: [], // Tosha keeps his full editor (hat, back item, colours) in customize.ts
  bublik: [
    { key: 'shirtColor', label: 'Шерсть', palette: ['#b0612e', '#d8a050', '#8a5a3a', '#f0e0c0', '#6a6a72', '#3a2a24', '#c84a2a', '#e8c890'] },
    { key: 'shortsColor', label: 'Уши и пятна', palette: ['#7a3e1c', '#3a2418', '#f6efe0', '#5a4a40', '#a83a2a', '#2a2a32', '#c88a50'] },
    { key: 'bootColor', label: 'Лапы и пузо', palette: ['#e0a066', '#fff3e0', '#f0c890', '#c8a090', '#ffd8b0', '#d8d0c8'] },
    { key: 'scarfColor', label: 'Ошейник', palette: ['#d8343a', '#3a6ad8', '#5ac85a', '#ffd34a', '#8a5ae0', '#ff6aa8', '#2a2a3a', '#f6f0e4'] },
    { key: 'hatColor', label: 'Жетон-бублик', palette: ['#e8a850', '#c8823a', '#f6d06a', '#ff6aa8', '#8ad8ff', '#f6f0e4'] },
  ],
  noki: [
    { key: 'shirtColor', label: 'Куртка', palette: ['#4a3270', '#3b2c4e', '#2a2a32', '#6a1c2c', '#2a3a5a', '#4a3a2a', '#5a2a6a', '#1c3a3a', '#7a7a8a'] },
    { key: 'shortsColor', label: 'Юбка', palette: ['#8e1e3c', '#26202e', '#3a2a5a', '#1c1c24', '#5a3a2a', '#c8304a', '#2a4a4a'] },
    { key: 'bootColor', label: 'Сапоги', palette: ['#2a2030', '#4a2232', '#5a3a2a', '#3a2a5a', '#7a1c2c', '#2a3a2a', '#d8d0e0'] },
    { key: 'scarfColor', label: 'Чокер и шнурки', palette: ['#d02848', '#8a5ae0', '#3fb8a8', '#ffd34a', '#f6f0e4', '#ff6aa8', '#5ad8ff'] },
    { key: 'hatColor', label: 'Прядь', palette: ['#e0306a', '#8a5ae0', '#3fd8c8', '#ffd34a', '#5a9aff', '#f6f0e4', '#5ae05a', '#ff8a2a'] },
    { key: 'backColor', label: 'Топор-гитара', palette: ['#b8283a', '#2a2a32', '#5a3ad8', '#e8e0f0', '#3a8a5a', '#ff8a2a', '#8a1c6a'] },
  ],
  pastila: [
    { key: 'shirtColor', label: 'Платье', palette: ['#ff78b4', '#c88aff', '#7ad8ff', '#ffd34a', '#7ae0a0', '#ff8a6a', '#f6f0e4', '#e8383d'] },
    { key: 'scarfColor', label: 'Бант и пояс', palette: ['#ff4a8a', '#8a5ae0', '#3fb8a8', '#ffd34a', '#3a6ad8', '#e8383d', '#f6f0e4'] },
    { key: 'shortsColor', label: 'Чулочки', palette: ['#ffe0ec', '#ffffff', '#f0e0ff', '#e0f4ff', '#ffd8e8', '#ff9cc4', '#3a2a4a'] },
    { key: 'bootColor', label: 'Туфельки', palette: ['#a8306a', '#5a2a8a', '#2a2a3a', '#e8383d', '#3a6ad8', '#f6f0e4', '#d8a040'] },
    { key: 'hatColor', label: 'Камни короны', palette: ['#4ad8e0', '#ff4a8a', '#8aff6a', '#ffd34a', '#a87aff', '#ff6a3a', '#ffffff'] },
    { key: 'backColor', label: 'Сироп', palette: ['#ff3a7a', '#ffb020', '#5ad85a', '#3ac8ff', '#a85aff', '#ff6a3a'] },
  ],
};

export function heroName(kind: unknown): string { return isHeroKind(kind) ? HERO_INFO[kind].name : HERO_INFO.tosha.name; }
void HERO_KINDS;
