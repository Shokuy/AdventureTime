/**
 * «Стеклянная оранжерея» (Серия 4, `fangs3_garden`) — every line, bark, toast, sign and card of the episode.
 * Source of truth: docs/script-fangs-v2.md §7 (+ §10 cards, §11 signs, §12 retry lines); what v2 keeps from v1 is
 * taken from docs/script-fangs.md §7 unchanged. Players are addressed with «вы» (one or six of them).
 */
export const BANNER = 'Серия 4. Стеклянная оранжерея';
/** §7 the banner's subtitle (v2: «Ночь N из 5») */
export const NIGHT = 'Ночь 3 из 5';

/** §11 signs of `fangs3_garden` */
export const SIGNS = {
  gate: 'Оранжерея королевы Карамели',
  quiet: 'Тише! Растения спят',
  mirror: 'Поверните зеркало к куполу',
  root: 'Полуденник. Поливать в полдень. Любить всегда',
} as const;

/** §7.2.2 Карамель's diary pages along the way (signs) + the bark when a hero reads one (закладка Б) */
export const NOTES: { key: string; sign: string; barks: [Bk, string][] }[] = [
  { key: 'court', sign: 'Опыт 212: взорвалось.', barks: [['pastila', 'У прабабушки тоже взрывалось?!']] },
  { key: 'hall', sign: 'Опыт 213: взорвалось меньше. Прогресс!', barks: [['pastila', 'Прогресс! Я запомню.']] },
  { key: 'wing', sign: 'Грядка Шуршика. Не трогать — он стесняется.', barks: [['bublik', 'Кто такой Шуршик?']] },
  { key: 'maze', sign: 'Ноки опять играла цветам. Цветы росли быстрее. Наука в шоке.', barks: [['pastila', 'Ноки… играла цветам?'], ['noki', '…Не отвлекайтесь.']] },
];
export type Bk = 'tosha' | 'bublik' | 'noki' | 'pastila';
/** the names over a bark said for a hero who isn't here (solo / nobody plays them) */
export const NAMES: Record<Bk, string> = { tosha: 'Тоша', bublik: 'Бублик', noki: 'Ноки', pastila: 'Пастила' };

/** §7.2.3 the girl with the guitar in the maze's mirrors (закладка А) */
export const MAZE_GIRL: [Bk, string][] = [['bublik', 'Вон она! В зеркале! С гитарой!'], ['pastila', 'Тень в зеркале. Записываю: ничего не понимаю.']];

/** §12 the line under «ОЙ-ОЙ-ОЙ!» */
export const DEATH = ['Кто-то невидимый толкнул. Ещё раз!', 'Стекло — скользкое. Ещё раз!'] as const;

/** §7.2.4 Шёпот along the level (whispers «из воздуха» near a hero) */
export const WHISPERS = ['…ш-ш-ш… я здесь…', '…не смотрите в зеркала…', '…я поливаю… а они сереют…', '…Карамель?.. нет… не она…'] as const;
/** §7.2.4 the echo: a bar of the four comes back after 1.5 s as its last two words, at most once in 10 s */
export const ECHO = { delay: 1.5, every: 10 } as const;
/** the echo of a line: its last two words, whispered — «…держитесь вместе…» */
export function echoOf(str: string): string | null {
  const w = str.replace(/[«»"“”„()[\]—–]/g, ' ').replace(/[!?.,:;…]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return null;
  return '…' + w.slice(-2).join(' ').toLowerCase() + '…';
}

/** §7.2.3 grey flowers (пресняки), restored ones */
export const FLOWER_SLEEPY = ['Не цвету… не хочу…', 'Зачем цвести… если всё равно…'] as const;
export const FLOWER_THANKS = ['Я снова цвету!', 'Ой, у меня бутон!', 'Пахну! Я снова пахну!'] as const;
/** §7.2.3 glass spikes */
export const GLASS = 'Дзынь!';

/** §7.2.4 (v1 §7.2.4) the four's barks (said by the matching hero when it happens to him) */
export const FOUR = {
  tosha: 'Следы на пыльце!',
  bublik: 'Я наступил на что-то невидимое. Оно пискнуло',
  noki: 'Аккорд — и смотрите',
  pastila: 'Не разбейте прабабушкины колбы!',
} as const;
/** §7.2.5 Тоша, once, in the wing */
export const TOSHA_WING = 'Тсс. Слушаем, откуда шепчет.';

/** §7.4 the fight: quiet italic whispers from where he is */
export const BOSS = {
  idle: ['…сзади…', '…слева… нет, справа…', '…ш-ш-ш…', '…холодно…'],
  split: ['…нас много… нас нет…'],
  water: ['…полью… вас тоже полью…', '…расти… серым…'],
  snuff: ['…ни полудня… ни солнца…'],
  seen: ['…не смотрите!..', '…уши… не смотрите на уши…', '…погасите свет!..'],
  hurt: ['…ой…', '…больно… по-настоящему…'],
} as const;
/** §7.4 phase 2: the decoys echo the heroes' barks (+ whatever the heroes said lately) */
export const DECOY_ECHO = ['…я длинный… я длинный…', '…бей, пока лежит…', '…откуда шёпот…', '…мы не смеёмся…', '…вон он…', '…смотрите…'] as const;
/** §7.4 the four in the fight (solo: the NPCs on the dome's balconies; co-op: over the hero who plays them) */
export const HELP = {
  tosha: 'Тихо! Слушайте, откуда шёпот!',
  bublik: 'Шуршик! Мы не смеёмся! Честно!',
  noki: 'Аккорд! Смотрите!',
  pastila: 'Маяк горит! Вон он!',
  pastilaDark: 'Темно… Это просто опыт номер 214!',
} as const;
/** §12 the boss again after a restart */
export const RETRY = '…опять вы… тёплые… опять…';

/** §10 the cards */
export const CARD = { title: 'Корень полуденника', desc: 'Тёплый, как сковородка в полдень. Его вывела прапрабабушка Пастилы. Второй ингредиент.' } as const;
export const PAGE = { title: 'Страница из дневника', desc: 'Пожелтевшая, сложенная вчетверо. Почерк Карамели. Для девочки с гитарой.' } as const;

/** toasts: §7.1 / §7.2.1 / §7.3 / §7.4 + (доп.) ones of docs/script-fangs.md §7.8 */
export const TOAST = {
  intro: 'Невидимок видно в зеркалах, по следам на пыльце и в свете маяка-солнышка. Аккорд проявляет их на пару секунд',
  mirror: 'Поворачивайте зеркала [E], чтобы луч попал на купол',
  boss: 'Шёпота слышно. Следите за следами на пыльце и отражениями. Аккорд и маяк его проявляют',
  // (доп.) §7.8
  turn: 'Повернуть зеркало',
  mirrorN: (n: number) => `Зеркало ${n} из 4 смотрит на купол`,
  domeShut: 'Купол закрыт. Нужны лучи всех четырёх зеркал',
  pollen: 'Ударьте большой цветок — облако пыльцы проявит невидимок',
  maze: 'В зеркалах видно то, чего не видно глазами. Ищите в отражениях выход',
  fakeMirror: 'Это не зеркало, а проход!',
  split: 'Шёпот раздвоился! Настоящего видно в зеркалах — у шёпотов-обманок отражения нет',
  dark: 'Шёпот гасит купол! Зажигайте солнышки ударом и поворачивайте зеркала обратно к клумбе',
  noon: 'Полуденный луч! Пока горят два зеркала, клумба вспыхивает и проявляет Шёпота',
  can: 'Лейка Шёпота! Где она наклонилась — будет серая лужа. Ударьте лейку — и он проявится',
  canHit: 'Лейка выбита! Шёпот виден — бейте!',
  exit: 'Корень у Пастилы. Выход — за разбитым зеркалом, по лунной дорожке',
  sprinkler: 'Поливалка крутится — перепрыгивайте струю',
} as const;
