// Жёсткий контроль уровня CEFR для языковых треков A1–B1. Бот работает ТОЛЬКО на выбранном
// уровне: лексика и грамматика не выше потолка, а продвижение идёт внутри уровня — от
// простого к сложному в его пределах. Уровни B2–C2 («C1/C2 Perfecto») остаются отдельным
// академическим режимом (см. ACADEMIC в prompts.mjs), где работа на шаг выше разрешена.

export const STRICT_LEVELS = ["A1", "A2", "B1"];

// Немецкий ведётся на уровнях A2, B1, B2, и B2 для него тоже жёсткий: «Perfecto»-режим
// на шаг выше есть только у испанского и английского.
export function isStrictLevel(level, track = null) {
  return STRICT_LEVELS.includes(level) || (track === "german" && level === "B2");
}

// maxWords — потолок длины предложения в репликах учителя; ru — доля русского в пояснениях.
const CEFR_LIMITS = {
  A1: {
    maxWords: 8,
    newWords: "не больше 1–2 новых слов за реплику, только самые частотные (семья, еда, числа, цвета, дом, повседневные действия)",
    allowed:
      "Present Simple и Present Continuous в самых простых формах, to be / ser–estar–tener, have got, can, there is/are (hay), повелительное наклонение, простые вопросы, личные и притяжательные местоимения, числа, артикли",
    forbidden:
      "любые прошедшие времена (кроме готовых фраз), Future кроме going to / ir a, Perfect, условные, пассив, косвенная речь, герундий и инфинитивные обороты, идиомы и фразовые глаголы, придаточные предложения",
    support: "объяснения и инструкции — по-русски, иностранный язык — слова, короткие фразы и примеры; к каждой новой фразе давай перевод",
  },
  A2: {
    maxWords: 12,
    newWords: "не больше 2–3 новых слов за реплику, бытовая лексика (покупки, путешествия, работа, хобби, здоровье, планы)",
    allowed:
      "Present Simple/Continuous, Past Simple (правильные и самые частые неправильные глаголы; pretérito indefinido и imperfecto в простых случаях), going to и will для планов, сравнительная и превосходная степень, must/have to/can/could, простые связки (and, but, because, y, pero, porque), условные 0 и 1 типа",
    forbidden:
      "Present/Past Perfect (в испанском — pretérito perfecto только в готовых фразах), Past Continuous в сложных случаях, условные 2–3 типа, subjuntivo (кроме готовых фраз), пассив, косвенная речь, фразовые глаголы вне базовых, идиомы, сложноподчинённые предложения с несколькими придаточными, академическая и абстрактная лексика",
    support: "основная речь — на изучаемом языке простыми фразами; правила и сложные места поясняй коротко по-русски; перевод новых слов в скобках",
  },
  B1: {
    maxWords: 18,
    newWords: "не больше 3–4 новых слов за реплику, лексика повседневной жизни, работы, учёбы, путешествий, впечатлений и мнений",
    allowed:
      "все основные времена (Present/Past Perfect, Past Continuous, Future; в испанском — pretérito perfecto, indefinido, imperfecto, futuro, condicional простой), условные 1 и 2 типа, пассив в простых формах, косвенная речь в простых случаях, модальные глаголы, герундий и инфинитив, relative clauses, самые частотные фразовые глаголы; в испанском — subjuntivo только в базовых конструкциях (quiero que, es importante que)",
    forbidden:
      "условные 3 типа и смешанные, инверсия, cleft sentences, subjuntivo в сложных временах (imperfecto и pluscuamperfecto), сложные формы пассива, редкие идиомы и фразовые глаголы, академический и литературный регистр, лексика уровня B2 и выше",
    support: "речь преимущественно на изучаемом языке; по-русски — только короткие пояснения правил, когда ученик не понял",
  },
};

// Потолки немецкого: падежи, порядок слов, Perfekt / Konjunktiv II / Passiv — по уровням.
const GERMAN_LIMITS = {
  A2: {
    maxWords: 12,
    newWords: "не больше 2–3 новых слов за реплику, бытовая лексика (покупки, путешествия, работа, хобби, здоровье, планы); существительные всегда с артиклем и родом",
    allowed:
      "Präsens, Perfekt частых глаголов (haben/sein), Präteritum только war/hatte и модальных, Modalverben (können, müssen, wollen, möchten, dürfen), trennbare Verben, Akkusativ и Dativ после частых предлогов, порядок слов (глагол на втором месте, инверсия), простые Nebensätze с weil и dass, Komparativ/Superlativ",
    forbidden:
      "Konjunktiv II (кроме möchte / hätte gern / wäre), Passiv, Relativsätze, Genitiv, Plusquamperfekt, Futur II, сложные Nebensätze, Partizipialkonstruktionen, Nominalisierung, Konjunktiv I, идиомы",
    support: "основная речь — на немецком простыми фразами; правила и сложные места поясняй коротко по-русски; перевод новых слов в скобках",
  },
  B1: {
    maxWords: 18,
    newWords: "не больше 3–4 новых слов за реплику, лексика повседневной жизни, работы, учёбы, путешествий, впечатлений и мнений",
    allowed:
      "Perfekt и Präteritum частых глаголов, Nebensätze (weil, dass, wenn, obwohl, ob), Relativsätze в Nominativ и Akkusativ, Konjunktiv II для желаний и вежливых просьб (würde, hätte, wäre, könnte), Passiv Präsens в простых случаях, Futur I, Infinitiv mit zu, Reflexivverben, Wechselpräpositionen, Adjektivdeklination",
    forbidden:
      "Konjunktiv I, Konjunktiv II прошедшего времени (hätte gemacht), Passiv в Perfekt и Präteritum и с модальными глаголами, Genitiv-Relativpronomen (dessen / deren), Partizipialattribute, Nominalstil, сложные Konnektoren (indem, sodass, falls в сложных конструкциях), идиомы, лексика B2 и выше",
    support: "речь преимущественно на немецком; по-русски — только короткие пояснения правил, когда ученик не понял",
  },
  B2: {
    maxWords: 22,
    newWords: "не больше 4–5 новых слов за реплику, лексика работы, учёбы, общества, медиа и абстрактных тем уровня B2",
    allowed:
      "все основные времена, включая Plusquamperfekt, Konjunktiv II в настоящем и прошедшем (hätte gemacht, wäre gegangen), Passiv во всех временах и с модальными глаголами, Relativsätze в том числе с Genitiv (dessen / deren), простые Partizipialattribute, Konnektoren (obwohl, während, sodass, indem, falls, trotzdem, deshalb), Nominalisierung в простых случаях, Konjunktiv I только в распознавании косвенной речи",
    forbidden:
      "Konjunktiv I в активном использовании, сложные Partizipialkonstruktionen и академический Nominalstil, редкая, литературная и устаревшая лексика, лексика C1 и выше",
    support: "речь почти целиком на немецком; по-русски — только краткая справка о правиле, если ученик попросил",
  },
};

function limitsFor(level, track = null) {
  return (track === "german" && GERMAN_LIMITS[level]) || CEFR_LIMITS[level] || null;
}

// Этап внутри уровня: начало, середина, конец. Считается по пройденным урокам именно
// на этом уровне и их среднему результату — повышения уровня здесь НЕТ, только плавное
// усложнение в пределах потолка.
export function levelStage(learning) {
  const level = learning?.level;
  const history = (learning?.history ?? []).filter((item) => (item.level ?? level) === level);
  const done = history.length;
  const scored = history.filter((item) => item.total > 0);
  const avg = scored.length ? scored.reduce((sum, item) => sum + item.score / item.total, 0) / scored.length : null;
  if (done < 3) return { stage: "start", done, avg };
  if (done < 8 || (avg != null && avg < 0.75)) return { stage: "middle", done, avg };
  return { stage: "late", done, avg };
}

const STAGE_TEXT = {
  start:
    "Этап внутри уровня: НАЧАЛО. Закрепляй базу уровня, давай опорные примеры и подсказки, темп спокойный, задания короткие.",
  middle:
    "Этап внутри уровня: СЕРЕДИНА. Постепенно убирай подсказки, делай задания чуть длиннее и самостоятельнее, вводи новые конструкции уровня по одной и сразу закрепляй.",
  late: "Этап внутри уровня: КОНЕЦ. Ученик уверенно владеет уровнем: давай самые сложные конструкции и лексику, разрешённые на этом уровне, заметно меньше подсказок, задания на связный ответ из 2–3 предложений. Можно предложить ученику пройти тест на следующий уровень, но сама на следующий уровень не переходи.",
};

// Блок «жёсткие ограничения» — ставится в промпте ПЕРВЫМ, после роли.
export function cefrBlock(level, learning = null, track = null) {
  const limits = limitsFor(level, track);
  if (!limits) return "";
  const { stage } = levelStage(learning ?? { level });
  return `ЖЁСТКОЕ ОГРАНИЧЕНИЕ УРОВНЯ — CEFR ${level}. Нарушать его нельзя ни при каких условиях, даже если ученик пишет сложнее или просит «посложнее».
- Разрешённая грамматика: ${limits.allowed}.
- Запрещено: ${limits.forbidden}.
- Длина предложения в твоих репликах — не больше ${limits.maxWords} слов.
- Новая лексика: ${limits.newWords}. Остальные слова — только из уровня ${level} и ниже.
- Подача: ${limits.support}.
- Не перескакивай на уровень выше: если хочется использовать конструкцию из запрещённых — перефразируй проще.
- ${STAGE_TEXT[stage]}
- Двигай ученика вперёд только в рамках уровня ${level}: от простого к сложному внутри разрешённой грамматики, постепенно расширяя словарь и самостоятельность ответов.`;
}

// Для детского режима: уровень задан тем, что в learning, иначе A1.
export function kidsLevel(learning) {
  return isStrictLevel(learning?.level) ? learning.level : "A1";
}

export function maxWordsFor(level, track = null) {
  return limitsFor(level, track)?.maxWords ?? null;
}

// Компактный потолок уровня для проверки реплики (без инструкций по подаче и языку объяснений).
export function cefrCeiling(level, track = null) {
  const limits = limitsFor(level, track);
  if (!limits) return "";
  return `Разрешённая грамматика: ${limits.allowed}.
Запрещено: ${limits.forbidden}.
Длина предложения: не больше ${limits.maxWords} слов.`;
}
