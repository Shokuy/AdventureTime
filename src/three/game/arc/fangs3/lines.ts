/**
 * «Стеклянная оранжерея» (Серия 4, `fangs3_garden`) — every line, bark, toast, sign and card of the episode.
 * Source of truth: docs/script-fangs.md §7 (+ §10 card, §11 signs, §12 retry lines); what the script lacked is added
 * there marked (доп.) and copied here. Players are addressed with «вы» (one or six of them).
 */
export const BANNER = 'Серия 4. Стеклянная оранжерея';

/** §11 signs of `fangs3_garden` */
export const SIGNS = {
  gate: 'Оранжерея королевы Карамели',
  quiet: 'Тише! Растения спят',
  mirror: 'Поверните зеркало к куполу',
  root: 'Полуденник. Поливать в полдень. Любить всегда',
} as const;

/** §12 the line under «ОЙ-ОЙ-ОЙ!» */
export const DEATH = ['Кто-то невидимый толкнул. Ещё раз!', 'Стекло — скользкое. Ещё раз!'] as const;

/** §7.2.2 Шёпот along the level (whispers «из воздуха» near a hero) */
export const WHISPERS = ['…ш-ш-ш… я здесь…', '…холодно… а вы тёплые…', '…не смотрите в зеркала…', '…я был красивый… наверное…', '…уходите… или останьтесь… навсегда…', '…сто лет никого… и вдруг вы…'] as const;

/** §7.2.3 grey flowers (пресняки), restored ones */
export const FLOWER_SLEEPY = ['Не цвету… не хочу…', 'Зачем цвести… если всё равно…'] as const;
export const FLOWER_THANKS = ['Я снова цвету!', 'Ой, у меня бутон!', 'Пахну! Я снова пахну!'] as const;
/** §7.2.3 glass spikes */
export const GLASS = 'Дзынь!';

/** §7.2.4 the four's barks (said by the matching hero when it happens to him) */
export const FOUR = {
  tosha: 'Следы на пыльце!',
  bublik: 'Я наступил на что-то невидимое. Оно пискнуло',
  noki: 'Аккорд — и смотрите',
  pastila: 'Не разбейте прабабушкины колбы!',
} as const;

/** §7.4 the fight: quiet italic whispers from around the dome */
export const BOSS = {
  idle: ['…сзади…', '…слева… нет, справа…', '…ш-ш-ш…', '…холодно…'],
  snuff: ['…зеркала… разобью…', '…ни полудня… ни солнца…'],
  seen: ['…не смотрите!..', '…я некрасивый!..', '…погасите свет!..'],
  hurt: ['…ой…', '…больно… по-настоящему…'],
} as const;
/** §7.4 solo help (the story NPC does the team move) */
export const HELP = {
  pastila: 'Маяк горит! Вон он!',
  noki: 'Аккорд! Смотрите!',
  bublik: 'Следы! Он у меня за хвостом!',
  tosha: 'Зеркало! Он в зеркале!',
} as const;
/** §12 the boss again after a restart */
export const RETRY = '…опять вы… тёплые…';

/** §10 the ingredient card */
export const CARD = { title: 'Корень полуденника', desc: 'Тёплый, как сковородка в полдень. Его вывела прапрабабушка Пастилы. Второй ингредиент.' } as const;

/** toasts: §7.1 / §7.2.1 / §7.3 + (доп.) ones of docs/script-fangs.md §7.8 */
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
  exit: 'Корень у Пастилы. Выход — за куполом, по лунной дорожке',
  sprinkler: 'Поливалка крутится — перепрыгивайте струю',
} as const;
