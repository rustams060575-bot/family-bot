import { markDirty } from "./store.mjs";

// Арт-школа Мартины: возраст ученика, академическая программа по возрастным группам
// и пошаговые уроки (форма → цвет и тени → детализация и разбор по фото).
// Состояние — в профиле аккаунта (account.art, data/accounts.json).

export const MIN_AGE = 4;
export const MAX_AGE = 18;
const MAX_HISTORY = 40;

// Программа: темы идут по порядку, от простого к сложному; после последней — по кругу.
const CURRICULUM = {
  early: {
    label: "4–6 лет",
    focus: "базовые формы, яркие цвета, развитие моторики, сказочные сюжеты",
    method:
      "дошкольник: очень короткие шаги, одно действие за раз, всё через сказку и игру, без терминов; хвали каждую линию",
    themes: [
      "Звери из кругов и овалов",
      "Яркие цвета радуги",
      "Линии-путешественницы: прямые, волнистые, зигзаги",
      "Сказочный домик из квадрата и треугольника",
      "Узоры из точек и пятен",
      "Подводное царство",
      "Весёлые человечки из фигур",
      "Волшебный лес",
    ],
  },
  middle: {
    label: "7–9 лет",
    focus: "пропорции, простые законы перспективы, смешивание оттенков, пошаговые челленджи от наброска до цвета",
    method:
      "младший школьник: термины вводи по одному и сразу объясняй на понятном примере («дорога уходит вдаль и становится уже — это перспектива»); шаги от наброска до цвета",
    themes: [
      "Пропорции: рисуем любимое животное",
      "Перспектива: дорога уходит вдаль",
      "Смешиваем оттенки: тёплые и холодные цвета",
      "Ближе — больше, дальше — меньше",
      "Свет и тень на шаре",
      "Пейзаж с линией горизонта",
      "Пропорции лица: портрет друга",
      "Объём и свет",
      "Город в перспективе",
      "Сказочный герой в движении",
    ],
  },
  senior: {
    label: "10–14+ лет",
    focus: "светотень, объём, композиция, основы анатомии, стилизация, разные материалы (акварель, маркеры, карандаш)",
    method:
      "подросток: можно говорить терминами (рефлекс, падающая тень, точка схода, правило третей), коротко объясняя каждый; уважай самостоятельность, предлагай выбор материалов",
    themes: [
      "Светотень: шар, куб и цилиндр",
      "Объём и рефлекс",
      "Композиция: правило третей",
      "Линейная перспектива с одной точкой схода",
      "Анатомия: пропорции фигуры человека",
      "Стилизация: от реализма к персонажу",
      "Акварель: заливка и техника по-мокрому",
      "Маркеры и штриховка",
      "Натюрморт из трёх предметов",
      "Воздушная перспектива в пейзаже",
    ],
  },
};

export function ageBand(age) {
  if (!Number.isFinite(age)) return null;
  if (age <= 6) return "early";
  if (age <= 9) return "middle";
  return "senior";
}

export function artOf(account) {
  account.art ??= { age: null, ageSetAt: null, lesson: null, history: [] };
  return account.art;
}

export function setArtAge(account, age) {
  const value = Math.round(Number(age));
  if (!Number.isFinite(value) || value < MIN_AGE || value > MAX_AGE) return null;
  const art = artOf(account);
  const bandChanged = ageBand(art.age) !== ageBand(value);
  art.age = value;
  art.ageSetAt = new Date().toISOString();
  // Сменилась возрастная группа — незавершённый урок другой программы больше не подходит.
  if (bandChanged && art.lesson && !art.lesson.completedAt) art.lesson = null;
  markDirty();
  return art;
}

// Следующая тема программы: по порядку для возрастной группы.
export function nextTheme(account) {
  const art = artOf(account);
  const band = CURRICULUM[ageBand(art.age)];
  if (!band) return null;
  const done = art.history.filter((item) => item.band === ageBand(art.age)).length;
  return band.themes[done % band.themes.length];
}

// Методическая строка для промптов Мартины: роль, возраст и программа группы.
export const ART_TEACHER =
  "Ты — добрый, но профессиональный преподаватель художественной школы. Объясняй сложные вещи (перспектива, блики, пропорции) простым и увлекательным детским языком с учётом возраста ученика.";

export function artMethodLine(account) {
  const art = account?.art;
  const band = CURRICULUM[ageBand(art?.age)];
  if (!band) return "";
  return `Ученику ${art.age} ${yearsWord(art.age)}. Программа группы ${band.label}: ${band.focus}. Подача: ${band.method}.`;
}

function yearsWord(age) {
  const mod10 = age % 10;
  const mod100 = age % 100;
  if (mod10 === 1 && mod100 !== 11) return "год";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "года";
  return "лет";
}

// Контекст текущего урока — для разбора рисунка и чата.
export function artLessonLine(account) {
  const lesson = account?.art?.lesson;
  if (!lesson || lesson.completedAt) return "";
  const stage = lesson.stages[lesson.stage] ?? lesson.stages.at(-1);
  return `Сейчас идёт урок арт-школы «${lesson.title}» (тема: ${lesson.theme}), этап ${lesson.stage + 1} из 3 — «${stage.title}»: ${stage.task}`;
}

// ── Урок ─────────────────────────────────────────────────────────────────────

export function artLessonPrompt(account, theme) {
  const art = artOf(account);
  const band = CURRICULUM[ageBand(art.age)];
  const past = art.history.slice(-10).map((item) => item.title);
  return `Ты — Мартина. ${ART_TEACHER}
${artMethodLine(account)}
Составь урок арт-школы на тему «${theme}» для рисования на бумаге (или на экранном холсте) тем, что есть дома.${past.length ? ` Недавние уроки (не повторяй): ${past.join("; ")}.` : ""}
Урок из трёх этапов:
1) «Понимание формы» — быстрый набросок простыми формами;
2) «Цвет и тени» — работа с цветом и светотенью по возрасту;
3) «Детализация» — финальные детали, после чего ребёнок фотографирует рисунок для разбора Мартиной.
Пиши по-русски, интонация доброго детского педагога, сложность строго по возрасту (${band.label}).
Ответь строго JSON-объектом:
{"title": "увлекательное название урока, что рисуем",
 "intro": "1–2 предложения от Мартины: «Сегодня в нашей арт-школе тема „${theme}“. Давай нарисуем …»",
 "concept": "одно-два предложения: главная идея темы простым детским языком, с образным примером",
 "materials": "что понадобится",
 "stages": [
   {"title": "Понимание формы", "task": "что сделать на этом этапе, одной фразой", "steps": ["3–4 коротких шага"], "tip": "одна подсказка-секрет художника"},
   {"title": "Цвет и тени", "task": "...", "steps": ["3–4 шага"], "tip": "..."},
   {"title": "Детализация", "task": "...", "steps": ["2–3 шага, последний — сфотографировать рисунок и показать Мартине"], "tip": "..."}
 ]}`;
}

export function normalizeArtLesson(raw, theme) {
  const text = (value) => String(value ?? "").trim();
  const stages = (Array.isArray(raw?.stages) ? raw.stages : []).slice(0, 3).map((stage, index) => ({
    title: text(stage?.title) || ["Понимание формы", "Цвет и тени", "Детализация"][index],
    task: text(stage?.task),
    steps: (Array.isArray(stage?.steps) ? stage.steps : []).map(text).filter(Boolean).slice(0, 5),
    tip: text(stage?.tip),
  }));
  const lesson = {
    theme,
    title: text(raw?.title) || theme,
    intro: text(raw?.intro),
    concept: text(raw?.concept),
    materials: text(raw?.materials),
    stages,
  };
  if (stages.length < 3 || stages.some((stage) => !stage.task || !stage.steps.length) || !lesson.intro) {
    throw new Error("Урок арт-школы от модели неполный");
  }
  return lesson;
}

export function saveArtLesson(account, lesson) {
  const art = artOf(account);
  art.lesson = {
    ...lesson,
    band: ageBand(art.age),
    stage: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  markDirty();
  return art.lesson;
}

export function setArtStage(account, stage) {
  const lesson = artOf(account).lesson;
  const value = Number(stage);
  if (!lesson || lesson.completedAt || !Number.isInteger(value) || value < 0 || value > 2) return null;
  lesson.stage = value;
  markDirty();
  return lesson;
}

// Урок завершается разбором рисунка на последнем этапе.
export function completeArtLesson(account) {
  const art = artOf(account);
  const lesson = art.lesson;
  if (!lesson || lesson.completedAt || lesson.stage < 2) return null;
  lesson.completedAt = new Date().toISOString();
  art.history = [
    ...art.history,
    { title: lesson.title, theme: lesson.theme, band: lesson.band, date: lesson.completedAt.slice(0, 10) },
  ].slice(-MAX_HISTORY);
  markDirty();
  return lesson;
}

export function publicArt(account) {
  const art = artOf(account);
  const band = CURRICULUM[ageBand(art.age)];
  return {
    age: art.age,
    band: band ? { label: band.label, focus: band.focus } : null,
    lesson: art.lesson,
    lessonsDone: art.history.length,
    nextTheme: nextTheme(account),
  };
}
