import { localDateKey, markDirty } from "./store.mjs";

// Адаптивное обучение языкам: тест уровня (A1–B2), ежедневный 15-минутный урок
// (теория → практика с Мартиной → экспресс-тест) и прогресс в профиле аккаунта
// (account.learning, хранится в data/accounts.json вместе с остальным профилем).

export const LANGUAGE_TRACKS = ["spanish", "english"];
export const LEVELS = ["A1", "A2", "B1", "B2"];
const MAX_TOPICS_REMEMBERED = 60;
const MAX_HISTORY = 30;

// ── Тест уровня ──────────────────────────────────────────────────────────────
// Вопросы идут от простого к сложному; ключи ответов не уходят на клиент.
const PLACEMENT = {
  english: [
    { level: "A1", question: "I ___ a student.", options: ["am", "is", "are"], answer: 0 },
    { level: "A1", question: "Как по-английски «яблоко»?", options: ["bread", "apple", "orange"], answer: 1 },
    { level: "A2", question: "Yesterday I ___ to the cinema.", options: ["go", "have gone", "went"], answer: 2 },
    { level: "A2", question: "She is ___ than her brother.", options: ["taller", "more tall", "tallest"], answer: 0 },
    {
      level: "B1",
      question: "If it rains tomorrow, we ___ at home.",
      options: ["stay", "will stay", "would stay"],
      answer: 1,
    },
    { level: "B1", question: "I have lived here ___ 2019.", options: ["for", "from", "since"], answer: 2 },
    {
      level: "B2",
      question: "I wish I ___ more time yesterday.",
      options: ["had had", "had", "would have"],
      answer: 0,
    },
  ],
  spanish: [
    { level: "A1", question: "Yo ___ estudiante.", options: ["estoy", "soy", "es"], answer: 1 },
    { level: "A1", question: "Как по-испански «кот»?", options: ["el gato", "el perro", "el pájaro"], answer: 0 },
    { level: "A2", question: "Ayer yo ___ al cine.", options: ["voy", "iré", "fui"], answer: 2 },
    { level: "A2", question: "Mi hermana es ___ alta que yo.", options: ["más", "muy", "tan"], answer: 0 },
    { level: "B1", question: "Cuando era niño, ___ en Madrid.", options: ["viví", "vivía", "viviré"], answer: 1 },
    { level: "B1", question: "Espero que tú ___ bien.", options: ["estás", "estarás", "estés"], answer: 2 },
    {
      level: "B2",
      question: "Si hubiera tenido tiempo, ___ contigo.",
      options: ["habría ido", "iría", "fui"],
      answer: 0,
    },
  ],
};

export function placementQuestions(track) {
  return (PLACEMENT[track] ?? []).map(({ question, options }, index) => ({ id: index, question, options }));
}

// 0–2 верных — A1, 3–4 — A2, 5–6 — B1, все 7 — B2.
export function scorePlacement(track, answers) {
  const bank = PLACEMENT[track] ?? [];
  const correct = bank.filter((item, index) => Number(answers?.[index]) === item.answer).length;
  const level = correct >= 7 ? "B2" : correct >= 5 ? "B1" : correct >= 3 ? "A2" : "A1";
  return { level, correct, total: bank.length };
}

// ── Прогресс в профиле ───────────────────────────────────────────────────────

export function learningOf(account, track) {
  account.learning ??= {};
  account.learning[track] ??= { level: null, placedAt: null, topics: [], history: [], lesson: null };
  return account.learning[track];
}

export function setLevel(account, track, level, source = "test") {
  if (!LEVELS.includes(level)) return null;
  const learning = learningOf(account, track);
  learning.level = level;
  learning.placedAt = new Date().toISOString();
  learning.levelSource = source;
  markDirty();
  return learning;
}

export function todayKey(account) {
  return localDateKey(account.reminders?.tzOffsetMin ?? 0);
}

export function saveLesson(account, track, lesson) {
  const learning = learningOf(account, track);
  learning.lesson = { ...lesson, date: todayKey(account), step: "theory", completedAt: null, score: null };
  markDirty();
  return learning.lesson;
}

export function setLessonStep(account, track, step) {
  const learning = learningOf(account, track);
  if (!learning.lesson || !["theory", "practice", "quiz"].includes(step)) return null;
  learning.lesson.step = step;
  markDirty();
  return learning.lesson;
}

// Проверка экспресс-теста: ключи хранятся в профиле, клиент присылает только ответы.
export function completeLesson(account, track, answers) {
  const learning = learningOf(account, track);
  const lesson = learning.lesson;
  if (!lesson) return null;
  const results = lesson.quiz.map((item, index) => Number(answers?.[index]) === item.answer);
  const score = results.filter(Boolean).length;
  if (!lesson.completedAt) {
    lesson.completedAt = new Date().toISOString();
    lesson.score = score;
    lesson.step = "done";
    learning.topics = [...learning.topics.filter((topic) => topic !== lesson.topic), lesson.topic].slice(
      -MAX_TOPICS_REMEMBERED,
    );
    learning.history = [
      ...learning.history,
      { date: lesson.date, topic: lesson.topic, title: lesson.title, score, total: lesson.quiz.length },
    ].slice(-MAX_HISTORY);
  }
  markDirty();
  return { score, total: lesson.quiz.length, results };
}

// Что видит клиент: урок без ключей экспресс-теста (они раскрываются после проверки).
export function publicLesson(lesson, { revealAnswers = false } = {}) {
  if (!lesson) return null;
  return {
    ...lesson,
    quiz: lesson.quiz.map(({ answer, explanation, ...rest }) =>
      revealAnswers || lesson.completedAt ? { ...rest, answer, explanation } : rest,
    ),
  };
}

export function publicLearning(account, track) {
  const learning = learningOf(account, track);
  const lesson = learning.lesson;
  const today = todayKey(account);
  return {
    level: learning.level,
    placedAt: learning.placedAt,
    lessonsDone: learning.history.length,
    recentTopics: learning.history.slice(-5).map((item) => item.title),
    lesson: lesson && (lesson.date === today || !lesson.completedAt) ? publicLesson(lesson) : null,
    todayDone: !!lesson?.completedAt && lesson.date === today,
  };
}

// ── Память для Мартины ───────────────────────────────────────────────────────

const LEVEL_STYLE = {
  A1: "очень короткие простые фразы на изучаемом языке (3–6 слов), только настоящее время и базовая лексика; каждую фразу сопровождай переводом, объясняй по-русски, говори медленно и бережно",
  A2: "простые предложения, настоящее и прошедшее время, частотная лексика; переводи ключевые слова, объясняй по-русски",
  B1: "естественная речь средней сложности, разные времена, немного устойчивых выражений; переводи только трудные слова",
  B2: "живая беглая речь, сложные конструкции, идиомы и нюансы; говори преимущественно на изучаемом языке, по-русски — только если ученик затрудняется",
};

// Строка в системный промпт: уровень, пройденные темы и сегодняшний урок.
export function learnerLine(account, track) {
  if (!account || !LANGUAGE_TRACKS.includes(track)) return "";
  const learning = account.learning?.[track];
  if (!learning?.level) return "";
  const lines = [
    `Уровень ученика по CEFR: ${learning.level} (${learning.levelSource === "manual" ? "выбран учеником" : "по тесту"}). Подстрой сложность своей речи: ${LEVEL_STYLE[learning.level]}.`,
  ];
  const topics = learning.topics.slice(-12);
  if (topics.length) {
    lines.push(
      `Уже пройденные темы: ${topics.join("; ")}. Опирайся на них, повторяй в упражнениях, но не объясняй заново с нуля.`,
    );
  }
  const lesson = learning.lesson;
  if (lesson && lesson.date === todayKey(account)) {
    lines.push(
      `Сегодняшний урок: «${lesson.title}» (тема: ${lesson.topic}). Слова урока: ${lesson.vocabulary.map((item) => item.word).join(", ")}.`,
    );
  }
  return lines.join("\n");
}

// ── Генерация урока дня ──────────────────────────────────────────────────────

const LANG_NAME = { spanish: "испанский", english: "английский" };

// profile — карточка ученика (возраст, интересы) из lib/learnerProfile.mjs.
export function lessonPrompt(track, level, pastTopics, profile = "") {
  return `Ты — Мартина, тёплый и бережный педагог ATA Academy. Составь ежедневный урок (15 минут) по языку: ${LANG_NAME[track]}, уровень ${level} по CEFR.
${
  profile
    ? `${profile}
`
    : ""
}Выбери ОДНУ новую практичную тему, подходящую уровню ${level} и интересам ученика.${pastTopics.length ? ` Уже пройдены (не повторяй): ${pastTopics.slice(-20).join("; ")}.` : ""}
Структура: а) теория и словарь, б) живая практика с Мартиной голосом, в) экспресс-тест из 3 вопросов по материалу урока.
Объяснения — по-русски, мягко и просто. Примеры — на изучаемом языке, сложность строго под ${level}.
Ответь строго JSON-объектом:
{"topic": "короткое название темы по-русски, 2–4 слова",
 "title": "название урока, как его видит ученик",
 "intro": "1–2 предложения от Мартины: что сегодня изучаем и зачем",
 "vocabulary": [{"word": "слово или фраза на изучаемом языке", "translation": "перевод", "example": "короткий пример на изучаемом языке"}],
 "grammar": "правило урока в 2–3 предложениях по-русски с одним примером",
 "practice": {"goal": "что ученик потренирует в разговоре, одной фразой по-русски", "opener": "первая реплика Мартины для разговорной практики: коротко, по уровню, с вопросом ученику", "choices": ["2–3 коротких варианта ответа ученика на изучаемом языке"]},
 "quiz": [{"question": "вопрос по материалу урока", "options": ["3 варианта"], "answer": 0, "explanation": "почему так, одной строкой по-русски"}]}
vocabulary — 6 слов; quiz — ровно 3 вопроса, answer — индекс верного варианта (0–2), верные ответы в разных позициях.`;
}

// Проверяет и нормализует урок из ответа модели; бросает ошибку, если он неполный.
export function normalizeLesson(raw) {
  const text = (value) => String(value ?? "").trim();
  const vocabulary = (Array.isArray(raw?.vocabulary) ? raw.vocabulary : [])
    .map((item) => ({ word: text(item?.word), translation: text(item?.translation), example: text(item?.example) }))
    .filter((item) => item.word && item.translation)
    .slice(0, 8);
  const quiz = (Array.isArray(raw?.quiz) ? raw.quiz : [])
    .map((item) => {
      const options = (Array.isArray(item?.options) ? item.options : []).map(text).filter(Boolean).slice(0, 4);
      return {
        question: text(item?.question),
        options,
        answer: Number(item?.answer),
        explanation: text(item?.explanation),
      };
    })
    .filter(
      (item) => item.question && item.options.length >= 2 && item.answer >= 0 && item.answer < item.options.length,
    )
    .slice(0, 3);
  const practice = raw?.practice ?? {};
  const lesson = {
    topic: text(raw?.topic),
    title: text(raw?.title) || text(raw?.topic),
    intro: text(raw?.intro),
    vocabulary,
    grammar: text(raw?.grammar),
    practice: {
      goal: text(practice.goal),
      opener: text(practice.opener),
      choices: (Array.isArray(practice.choices) ? practice.choices : []).map(text).filter(Boolean).slice(0, 3),
    },
    quiz,
  };
  if (!lesson.topic || vocabulary.length < 3 || quiz.length < 3 || !lesson.practice.opener) {
    throw new Error("Урок от модели неполный");
  }
  return lesson;
}

// Системный промпт разговорной практики урока: тема и слова дня — опора разговора.
export function lessonPracticeLine(lesson) {
  if (!lesson) return "";
  return `Сейчас этап «Практика» урока «${lesson.title}». Цель: ${lesson.practice.goal}
Веди живой разговор по теме урока, используй слова дня (${lesson.vocabulary.map((item) => item.word).join(", ")}) и правило: ${lesson.grammar}
Каждая реплика — короткая, с вопросом ученику. Мягко отмечай одну главную ошибку, если она есть. После 4–5 обменов похвали и предложи перейти к экспресс-тесту.`;
}
