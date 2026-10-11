import { localDateKey, markDirty } from "./store.mjs";

// Академическое обучение языкам (Native / Academic, цель — C1/C2): объективный срез
// на сложную грамматику и продвинутую лексику, точечные пробелы, работа на шаг выше
// текущего уровня (зона ближайшего развития) и ежедневный урок (теория → практика →
// экспресс-тест). Прогресс — в профиле аккаунта (account.learning, data/accounts.json).

export const LANGUAGE_TRACKS = ["spanish", "english"];
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const MAX_TOPICS_REMEMBERED = 60;
const MAX_HISTORY = 30;

// ── Срез знаний ──────────────────────────────────────────────────────────────
// 5 ёмких вопросов уровня B2–C2; у каждого — навык, который он проверяет. Ошибка
// в вопросе = точечный пробел, с которого начинается работа. Ключи не уходят на клиент.
const PLACEMENT = {
  spanish: [
    {
      skill: "Condicionales irreales: si + imperfecto de subjuntivo",
      question: "Si yo ___ más tiempo, estudiaría Filosofía en Salamanca.",
      options: ["tendría", "tuviera", "tenía"],
      answer: 1,
    },
    {
      skill: "Subjuntivo tras negación de opinión (no creo que…)",
      question: "No creo que la universidad ___ la lista de admitidos antes de junio.",
      options: ["publica", "publicará", "publique"],
      answer: 2,
    },
    {
      skill: "Condicional compuesto y pluscuamperfecto de subjuntivo",
      question: "Si hubieras enviado la solicitud a tiempo, ___ admitido.",
      options: ["habrías sido", "serías", "fuiste"],
      answer: 0,
    },
    {
      skill: "Correlación de tiempos con el subjuntivo",
      question: "Mi tutor quería que ___ la carta de motivación en un registro más formal.",
      options: ["escribo", "escriba", "escribiera"],
      answer: 2,
    },
    {
      skill: "Conectores y registro académico",
      question: "¿Qué conector expresa consecuencia en un ensayo académico?",
      options: ["O sea", "Por ende", "Pues nada"],
      answer: 1,
    },
  ],
  english: [
    {
      skill: "Inversion after negative adverbials",
      question: "___ had I submitted my application than the portal crashed.",
      options: ["Hardly", "No sooner", "Barely"],
      answer: 1,
    },
    {
      skill: "Inverted conditionals",
      question: "___ I known about the scholarship, I would have applied.",
      options: ["Had", "If", "Should"],
      answer: 0,
    },
    {
      skill: "Mandative subjunctive",
      question: "The committee insisted that every applicant ___ a portfolio.",
      options: ["submits", "will submit", "submit"],
      answer: 2,
    },
    {
      skill: "Advanced idioms in context",
      question: "Her opening argument was so compelling that it ___ for the rest of the debate.",
      options: ["set the tone", "broke the ice", "hit the sack"],
      answer: 0,
    },
    {
      skill: "Academic collocations",
      question: "The study ___ light on the causes of student burnout.",
      options: ["gives", "sheds", "makes"],
      answer: 1,
    },
  ],
};

export function placementQuestions(track) {
  return (PLACEMENT[track] ?? []).map(({ question, options }, index) => ({ id: index, question, options }));
}

// Следующая ступень: на ней ИИ и работает (C2 — шлифовка до C2 Perfecto).
export function targetLevel(level) {
  const index = LEVELS.indexOf(level);
  if (index < 0) return "C1";
  return LEVELS[Math.min(index + 1, LEVELS.length - 1)];
}

// 0–1 верных — B1, 2–3 — B2, 4 — C1, 5 — C2. Пробелы — навыки неверных ответов.
export function scorePlacement(track, answers) {
  const bank = PLACEMENT[track] ?? [];
  const results = bank.map((item, index) => Number(answers?.[index]) === item.answer);
  const correct = results.filter(Boolean).length;
  const level = correct >= 5 ? "C2" : correct >= 4 ? "C1" : correct >= 2 ? "B2" : "B1";
  const gaps = bank.filter((_, index) => !results[index]).map((item) => item.skill);
  return { level, correct, total: bank.length, gaps, target: targetLevel(level) };
}

// ── Прогресс в профиле ───────────────────────────────────────────────────────

export function learningOf(account, track) {
  account.learning ??= {};
  account.learning[track] ??= { level: null, placedAt: null, topics: [], history: [], lesson: null };
  account.learning[track].gaps ??= [];
  return account.learning[track];
}

// gaps — точечные пробелы по срезу; при ручном выборе уровня прежние пробелы сохраняются.
export function setLevel(account, track, level, source = "test", gaps = null) {
  if (!LEVELS.includes(level)) return null;
  const learning = learningOf(account, track);
  learning.level = level;
  learning.placedAt = new Date().toISOString();
  learning.levelSource = source;
  if (gaps) learning.gaps = gaps;
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
    target: learning.level ? targetLevel(learning.level) : null,
    gaps: learning.gaps,
    placedAt: learning.placedAt,
    lessonsDone: learning.history.length,
    recentTopics: learning.history.slice(-5).map((item) => item.title),
    lesson: lesson && (lesson.date === today || !lesson.completedAt) ? publicLesson(lesson) : null,
    todayDone: !!lesson?.completedAt && lesson.date === today,
  };
}

// ── Память для Мартины ───────────────────────────────────────────────────────

// Как говорить на целевом уровне — всегда на ступень выше текущего.
const LEVEL_STYLE = {
  A2: "короткие точные фразы, базовые времена; правила — ёмко по-русски",
  B1: "естественная речь, все основные времена, первые устойчивые выражения",
  B2: "беглая речь, сложноподчинённые конструкции, идиомы; преимущественно на изучаемом языке",
  C1: "академическая речь носителя: subjuntivo / inversion, сложный синтаксис, точные коллокации, регистр эссе и интервью; почти целиком на изучаемом языке",
  C2: "уровень образованного носителя: тонкие оттенки значения, стилистика, риторика, идиоматика и игра регистров; только на изучаемом языке, по-русски — лишь краткая справка о правиле",
};

// Строка в системный промпт: уровень, цель на шаг выше, пробелы, темы и урок дня.
export function learnerLine(account, track) {
  if (!account || !LANGUAGE_TRACKS.includes(track)) return "";
  const learning = account.learning?.[track];
  if (!learning?.level) return "";
  const target = targetLevel(learning.level);
  const lines = [
    `Уровень ученика по CEFR: ${learning.level} (${learning.levelSource === "manual" ? "выбран учеником" : "по срезу"}). Работай на шаг выше — на уровне ${target}${learning.level === "C2" ? " Perfecto" : ""}: ${LEVEL_STYLE[target]}.`,
  ];
  if (learning.gaps?.length) {
    lines.push(
      `Точечные пробелы по срезу (закрывай их в первую очередь, встраивай в упражнения): ${learning.gaps.join("; ")}.`,
    );
  }
  const topics = learning.topics.slice(-12);
  if (topics.length) {
    lines.push(
      `Уже пройденные темы: ${topics.join("; ")}. Опирайся на них и повышай сложность, не объясняй заново с нуля.`,
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

export const ACADEMIC_THEMES =
  "поступление в университеты (в том числе в Испании: carta de motivación, entrevistas, selectividad / PCE), адаптация в Испании, технологии, спорт, кино, философия, амбиции";

// profile — карточка ученика (возраст, интересы) из lib/learnerProfile.mjs; gaps — пробелы по срезу.
export function lessonPrompt(track, level, pastTopics, profile = "", gaps = []) {
  const target = targetLevel(level);
  return `Ты — Мартина, эрудированный академический преподаватель уровня носителя в ATA Academy. Твоя цель — поднимать планку ученика: глубокая лексика, идеальная грамматика и стиль.
Составь ежедневный урок (15 минут) по языку: ${LANG_NAME[track]}. Текущий уровень ученика — ${level}, урок строй на шаг выше — на уровне ${target}${level === "C2" ? " Perfecto" : ""}.
${profile ? `${profile}\n` : ""}${gaps.length ? `Точечные пробелы по срезу (урок закрывает один из них): ${gaps.join("; ")}.\n` : ""}Тема — из сфер: ${ACADEMIC_THEMES}. Выбери сферу, близкую интересам ученика.${pastTopics.length ? ` Уже пройдены (не повторяй): ${pastTopics.slice(-20).join("; ")}.` : ""}
Стиль: на равных, взросло, ёмко, без сюсюканья и детских формулировок. Объяснения правил — ёмко по-русски с терминами на изучаемом языке; все примеры — на изучаемом языке уровня ${target}.
Структура: а) продвинутый словарь и правило, б) практика с Мартиной — дискуссия по теме, в) экспресс-тест из 3 вопросов уровня ${target}.
Ответь строго JSON-объектом:
{"topic": "короткое название темы по-русски, 2–4 слова",
 "title": "название урока на изучаемом языке",
 "intro": "1–2 ёмких предложения от Мартины: что сегодня берём и зачем это на уровне ${target}",
 "vocabulary": [{"word": "продвинутое слово, коллокация или идиома на изучаемом языке", "translation": "перевод и регистр (формальный / нейтральный)", "example": "пример на изучаемом языке уровня ${target}"}],
 "grammar": "правило урока в 2–3 предложениях по-русски с одним примером уровня ${target}",
 "practice": {"goal": "что ученик отработает в дискуссии, одной фразой по-русски", "opener": "первая реплика Мартины на изучаемом языке: тезис или вопрос для дискуссии по теме", "choices": ["2–3 варианта начала ответа ученика на изучаемом языке"]},
 "quiz": [{"question": "вопрос по материалу урока", "options": ["3 варианта"], "answer": 0, "explanation": "правило одной строкой по-русски"}]}
vocabulary — 6 единиц уровня ${target}; quiz — ровно 3 вопроса, answer — индекс верного варианта (0–2), верные ответы в разных позициях.`;
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
Каждая реплика — ёмкая, с вопросом или тезисом для ответа. Каждую ошибку правь академически (см. правила правки). После 4–5 обменов коротко подведи итог и предложи перейти к экспресс-тесту.`;
}
