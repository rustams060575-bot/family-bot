import type { Role, TrackId } from "./types";

// Витрина треков. id тем совпадают с ключами TOPICS в lib/prompts.mjs — сервер
// принимает только их. Детский режим сервер ведёт одним игровым сценарием на любую тему.
// opener — первая реплика Мартины: она всегда говорит первой и сразу предлагает варианты.
export type Opener = { text: string; choices: string[] };
export type Topic = { id: string; title: string; caption: string; opener: Opener };

export type Track = {
  id: TrackId;
  name: string;
  monogram: string;
  href: string;
  tagline: string;
  topics?: Topic[];
  speechLang?: string;
};

export const TRACKS: Track[] = [
  {
    id: "spanish",
    name: "ATA Spanish",
    monogram: "Es",
    href: "/learn/spanish",
    tagline: "Срез знаний, грамматика, ежедневные интенсивы",
    speechLang: "es-ES",
    topics: [
      {
        id: "diagnostic",
        title: "Срез знаний",
        caption: "3 вопроса → твой трек → первое упражнение",
        opener: {
          text: "Давай за минуту поймём, с чего тебе лучше начать: всего три коротких вопроса. Первый — как ты сам оцениваешь свой испанский?",
          choices: ["Только начинаю", "Понимаю простое", "Уже говорю"],
        },
      },
      {
        id: "grammar",
        title: "Грамматика",
        caption: "Правило, примеры, практика",
        opener: {
          text: "Сегодня грамматика: правило в двух фразах, живые примеры и сразу практика. С какой темы начнём?",
          choices: ["Ser и estar", "Прошедшее время", "Выбери сама"],
        },
      },
      {
        id: "intensive",
        title: "Интенсив дня",
        caption: "10 минут, 5 слов, мини-диалог",
        opener: {
          text: "Интенсив дня — 10 минут: пять новых слов, мини-диалог и три задания. Какая тема сегодня?",
          choices: ["Еда и кафе", "Путешествия", "Работа"],
        },
      },
      {
        id: "mistakes",
        title: "Разбор ошибок",
        caption: "Пришли текст — разберём",
        opener: {
          text: "Пришли мне фразу или текст на испанском — найду ошибки и покажу, как сказать красиво. Или начнём с моей фразы?",
          choices: ["Дай свою фразу", "Сейчас пришлю текст"],
        },
      },
    ],
  },
  {
    id: "english",
    name: "ATA English",
    monogram: "En",
    href: "/learn/english",
    tagline: "Разговор, адаптация, идиомы, живой контекст",
    speechLang: "en-CA",
    topics: [
      {
        id: "diagnostic",
        title: "Срез знаний",
        caption: "3 вопроса → твой трек → первое упражнение",
        opener: {
          text: "Давай за минуту поймём, с чего тебе лучше начать: всего три коротких вопроса. Первый — как ты сам оцениваешь свой английский?",
          choices: ["Только начинаю", "Объясняюсь в быту", "Говорю свободно"],
        },
      },
      {
        id: "conversation",
        title: "Разговорный тренинг",
        caption: "Живой диалог голосом",
        opener: {
          text: "Поговорим по-английски — коротко и вживую, я подстроюсь под твой темп. О чём поболтаем?",
          choices: ["Мой день", "Работа", "Путешествия"],
        },
      },
      {
        id: "adaptation",
        title: "Адаптация",
        caption: "Врач, банк, аренда, работа",
        opener: {
          text: "Разыграем ситуацию из жизни в Канаде: я играю роль, ты отвечаешь. Где мы сегодня?",
          choices: ["У врача", "В банке", "Аренда жилья"],
        },
      },
      {
        id: "idioms",
        title: "Идиомы",
        caption: "3 выражения в день",
        opener: {
          text: "Я подготовлю три живые идиомы на сегодня. Из какой они будут сферы?",
          choices: ["Работа", "Эмоции", "Деньги"],
        },
      },
      {
        id: "context",
        title: "Живой контекст",
        caption: "Как говорят на самом деле",
        opener: {
          text: "Покажу, как английский звучит на самом деле: сокращения, фразовые глаголы, сленг. С чего начнём?",
          choices: ["Сокращения", "Фразовые глаголы", "Вежливость"],
        },
      },
    ],
  },
  {
    id: "art",
    name: "ATA Kids Art",
    monogram: "Art",
    href: "/art",
    tagline: "Фото рисунка с бумаги — разбор и новое задание",
  },
  {
    id: "translate",
    name: "ATA Translate",
    monogram: "Aa",
    href: "/translate",
    tagline: "Узбекский, русский, испанский, английский",
  },
];

// Детский режим (ATA Kids English / Spanish): одна игровая тема, без среза и правил.
export const KIDS_TOPIC: Topic = {
  id: "conversation",
  title: "Играем с Мартиной",
  caption: "Слова и фразы через игру",
  opener: {
    text: "Расскажи, что тебе больше нравится: космос, машинки или супергерои?",
    choices: ["🚀 Космос", "🏎️ Машинки", "🦸 Супергерои"],
  },
};

// ATA English → ATA Kids English; Kids Art уже детский.
export function kidsTrackName(track: Track) {
  return track.name.includes("Kids") ? track.name : track.name.replace("ATA ", "ATA Kids ");
}

// Мартина всегда сначала представляется.
export function martinaGreeting(name?: string) {
  return `${name ? `Привет, ${name}!` : "Привет!"} Я Мартина — твой личный наставник в ATA Academy.`;
}

export function trackById(id: string | null | undefined) {
  return TRACKS.find((track) => track.id === id) ?? null;
}

export const ROLES: { id: Role; title: string; caption: string }[] = [
  { id: "student", title: "Ученик", caption: "Учусь сам: занятия, практика, стрик" },
  { id: "tutor", title: "Репетитор", caption: "Готовлю уроки и упражнения для учеников" },
  { id: "parent", title: "Родитель", caption: "Занимаюсь с ребёнком дома" },
];
