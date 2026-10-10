import type { Role, TrackId } from "./types";

// Витрина треков. id тем совпадают с ключами TOPICS в lib/prompts.mjs — сервер
// принимает только их.
export type Topic = { id: string; title: string; caption: string; starter: string };

export type Track = {
  id: TrackId;
  name: string;
  monogram: string;
  href: string;
  tagline: string;
  topics?: Topic[];
  speechLang?: string;
  sttLang?: string;
};

export const TRACKS: Track[] = [
  {
    id: "spanish",
    name: "ATA Spanish",
    monogram: "Es",
    href: "/learn/spanish",
    tagline: "Срез знаний, грамматика, ежедневные интенсивы",
    speechLang: "es-ES",
    sttLang: "es",
    topics: [
      { id: "diagnostic", title: "Срез знаний", caption: "8 вопросов — уровень по CEFR", starter: "Начнём срез знаний." },
      { id: "grammar", title: "Грамматика", caption: "Правило, примеры, практика", starter: "Хочу разобрать тему грамматики. Предложи, с чего начать на моём уровне." },
      { id: "intensive", title: "Интенсив дня", caption: "10 минут, 5 слов, мини-диалог", starter: "Запусти интенсив дня." },
      { id: "mistakes", title: "Разбор ошибок", caption: "Пришлите текст — разберём", starter: "Сейчас пришлю текст на испанском для разбора." },
    ],
  },
  {
    id: "english",
    name: "ATA English",
    monogram: "En",
    href: "/learn/english",
    tagline: "Разговор, адаптация, идиомы, живой контекст",
    speechLang: "en-CA",
    sttLang: "en",
    topics: [
      { id: "conversation", title: "Разговорный тренинг", caption: "Живой диалог голосом", starter: "Let's talk. Start a conversation with me." },
      { id: "adaptation", title: "Адаптация", caption: "Врач, банк, аренда, работа", starter: "Разыграй со мной бытовую ситуацию в Канаде." },
      { id: "idioms", title: "Идиомы", caption: "3 выражения в день", starter: "Дай 3 идиомы на сегодня." },
      { id: "context", title: "Живой контекст", caption: "Как говорят на самом деле", starter: "Покажи, как носители говорят в реальной жизни." },
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

export function trackById(id: string | null | undefined) {
  return TRACKS.find((track) => track.id === id) ?? null;
}

export const ROLES: { id: Role; title: string; caption: string }[] = [
  { id: "student", title: "Ученик", caption: "Учусь сам: занятия, практика, стрик" },
  { id: "tutor", title: "Репетитор", caption: "Готовлю уроки и упражнения для учеников" },
  { id: "parent", title: "Родитель", caption: "Занимаюсь с ребёнком дома" },
];
