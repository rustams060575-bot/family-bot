import type { Role, TrackId } from "./types";

// Витрина треков. id тем совпадают с ключами TOPICS в lib/prompts.mjs — сервер
// принимает только их. Детский режим сервер ведёт одним игровым сценарием на любую тему.
// opener — первая реплика Мартины: она всегда говорит первой и сразу предлагает варианты.
export type Opener = { text: string; choices: string[] };
// memoryKey — отдельная история диалога (например, практика конкретного урока дня).
export type Topic = { id: string; title: string; caption: string; opener: Opener; memoryKey?: string };

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
    tagline: "C1/C2 Perfecto: срез, subjuntivo, дебаты, разбор текстов",
    speechLang: "es-ES",
    topics: [
      {
        id: "grammar",
        title: "Gramática avanzada",
        caption: "Subjuntivo, condicional, correlación de tiempos",
        opener: {
          text: "Hoy subimos el listón. ¿Con qué estructura trabajamos: las condicionales irreales, la correlación de tiempos o las concesivas?",
          choices: ["Condicionales irreales", "Correlación de tiempos", "Concesivas"],
        },
      },
      {
        id: "intensive",
        title: "Debate",
        caption: "Тезис, аргументы, контраргументы",
        opener: {
          text: "Te propongo un debate. Tesis: «La universidad ya no es imprescindible para triunfar». ¿Qué tema prefieres?",
          choices: ["Universidad y éxito", "Tecnología y ética", "Cine y sociedad"],
        },
      },
      {
        id: "mistakes",
        title: "Разбор текста",
        caption: "Carta de motivación, эссе — правка до C1–C2",
        opener: {
          text: "Envíame un párrafo — tu carta de motivación, un ensayo o un correo — y lo llevamos al nivel C1–C2. ¿O prefieres que te dé yo un texto para corregir?",
          choices: ["Dame un texto", "Te envío el mío"],
        },
      },
    ],
  },
  {
    id: "english",
    name: "ATA English",
    monogram: "En",
    href: "/learn/english",
    tagline: "C1/C2 Perfecto: срез, inversion, дебаты, admissions",
    speechLang: "en-CA",
    topics: [
      {
        id: "conversation",
        title: "Debate",
        caption: "Тезис, аргументы, контраргументы",
        opener: {
          text: 'Let\'s raise the bar. Motion: "Ambition matters more than talent." Which topic shall we debate?',
          choices: ["Ambition vs talent", "Tech and privacy", "Sport and character"],
        },
      },
      {
        id: "adaptation",
        title: "Admissions",
        caption: "Personal statement и интервью",
        opener: {
          text: "I'll play an admissions officer. First question: why this degree, and why now? Or shall we work on your personal statement?",
          choices: ["Start the interview", "Personal statement"],
        },
      },
      {
        id: "idioms",
        title: "Advanced idioms",
        caption: "3 идиомы C1–C2 с регистром",
        opener: {
          text: "Three advanced idioms coming up. Which register do you need today?",
          choices: ["Academic", "Business", "Conversational"],
        },
      },
      {
        id: "context",
        title: "Style & register",
        caption: "Inversion, cleft sentences, hedging",
        opener: {
          text: "Give me a plain sentence of yours, and we'll rewrite it with inversion, a cleft or hedging. Or shall I start with one?",
          choices: ["You start", "I'll write one"],
        },
      },
    ],
  },
  {
    id: "german",
    name: "ATA Deutsch",
    monogram: "De",
    href: "/learn/german",
    tagline: "A2–B2: срез, урок дня, разговор и грамматика с Мартиной",
    speechLang: "de-DE",
    topics: [
      {
        id: "grammar",
        title: "Grammatik",
        caption: "Падежи, порядок слов, времена",
        opener: {
          text: "Heute üben wir Schritt für Schritt. Womit möchtest du anfangen: Artikel und Fälle, Wortstellung oder Perfekt?",
          choices: ["Artikel und Fälle", "Wortstellung", "Perfekt"],
        },
      },
      {
        id: "conversation",
        title: "Gespräch",
        caption: "Живой разговор на твоём уровне",
        opener: {
          text: "Lass uns ein bisschen plaudern. Worüber sprechen wir heute: Hobbys, Reisen oder Arbeit?",
          choices: ["Hobbys", "Reisen", "Arbeit"],
        },
      },
      {
        id: "vocabulary",
        title: "Wortschatz",
        caption: "2–3 слова с артиклем и примером",
        opener: {
          text: "Ich zeige dir heute ein paar nützliche Wörter. Welches Thema passt dir: Alltag, Essen oder Beruf?",
          choices: ["Alltag", "Essen", "Beruf"],
        },
      },
      {
        id: "writing",
        title: "Schreiben",
        caption: "Проверка твоих фраз и писем",
        opener: {
          text: "Schick mir ein paar Sätze oder eine kurze Nachricht auf Deutsch — ich helfe dir beim Verbessern. Oder soll ich dir eine kleine Aufgabe geben?",
          choices: ["Gib mir eine Aufgabe", "Ich schreibe selbst"],
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
