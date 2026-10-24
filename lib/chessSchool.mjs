import { markDirty, recordActivity } from "./store.mjs";
import { artOf } from "./artSchool.mjs";
import { todayKey } from "./learning.mjs";
import { PUZZLES, puzzleById } from "./chessPuzzles.mjs";
import { teacherRules } from "./teacherRules.mjs";

// «Шахматы & Логика с Лео»: опрос при первом входе → уровень (chess_level), программа
// по возрасту и уровню, уроки Лео, задача дня и практика. Состояние — account.chess
// (data/accounts.json); возраст общий с арт-школой (account.art.age).

export const CHESS_LEVELS = {
  novice: "Новичок",
  amateur: "Любитель",
  strategist: "Стратег",
};
const LEVEL_ORDER = ["novice", "amateur", "strategist"];
const MAX_ATTEMPTS = 3;
const MAX_HISTORY = 60;
const MAX_SEEN = 200;
export const VIDEO_TOPIC = "Разбор детского YouTube-урока";

// Системный промпт Лео — как задан для модуля.
export const LEO_ROLE =
  "Ты — Лео, мудрый и задорный шахматный наставник для детей. Объясняй шахматные ходы, вилки, связки и стратегии простым и увлекательным языком. Хвали за успехи, поддерживай и давай понятные примеры.";

// Программа: темы идут по порядку; пройдена вся программа уровня — Лео повышает уровень.
const PROGRAM = {
  young: {
    label: "4–7 лет",
    method:
      "дошкольник или первоклассник: всё через сказку — у каждой фигуры своя суперсила и характер; одно правило за раз, никаких обозначений клеток вроде e4, только «вверх», «наискосок», «рядом»; хвали каждый шаг",
    levels: {
      novice: [
        "Волшебная доска: белые и чёрные клетки",
        "Суперсила ладьи",
        "Суперсила слона",
        "Суперсила ферзя",
        "Суперсила коня: прыжок буквой Г",
        "Король — самый важный",
        "Пешка-храбрец и её превращение",
      ],
      amateur: [
        "Шах: королю грозит опасность",
        "Три способа спастись от шаха",
        "Мат — конец сказки",
        "Рокировка: король прячется в замок",
        "Кто сколько стоит: размен фигур",
        "Вилка коня",
      ],
      strategist: [
        "Мат в один ход",
        "Мат двумя ладьями: лесенка",
        "Связка: фигура не может уйти",
        "Захватываем центр доски",
        "Сказка о хитрой комбинации",
      ],
    },
  },
  older: {
    label: "8+ лет",
    method:
      "школьник: используй шахматную нотацию (e4, Кf3) и термины, коротко объясняя каждый; разбирай конкретные позиции и варианты, учи считать ходы вперёд",
    levels: {
      novice: [
        "Как ходят фигуры",
        "Ценность фигур",
        "Шах и три способа защиты",
        "Мат и пат",
        "Рокировка: короткая и длинная",
        "Взятие на проходе и превращение пешки",
        "Три правила дебюта",
      ],
      amateur: [
        "Мат в 1 ход",
        "Мат на последней горизонтали",
        "Линейный мат двумя ладьями",
        "Вилка",
        "Связка",
        "Двойной удар",
        "Дебют: центр и развитие",
        VIDEO_TOPIC,
      ],
      strategist: [
        "Мат в 2 хода",
        "Комбинации с жертвой",
        "Рентген и открытый шах",
        "Отвлечение и завлечение",
        "Эндшпиль: ладья против короля",
        "Пешечный эндшпиль: правило квадрата",
        "План в миттельшпиле",
        VIDEO_TOPIC,
      ],
    },
  },
};

export function chessBand(age) {
  if (!Number.isFinite(age)) return null;
  return age <= 7 ? "young" : "older";
}

export function chessOf(account) {
  account.chess ??= {
    level: null,
    levelSetAt: null,
    survey: null,
    solved: 0,
    seen: [],
    history: [],
    lesson: null,
    daily: null,
    practice: null,
  };
  return account.chess;
}

const levelLabel = (level) => CHESS_LEVELS[level] ?? null;

// ── Онбординг: «Знаешь, как ходят фигуры?» и «Знаешь, как поставить мат или сделать рокировку?» ──

export function applySurvey(account, answers) {
  const moves = answers?.moves === true;
  const mate = moves && answers?.mate === true;
  const chess = chessOf(account);
  const level = !moves ? "novice" : mate ? "strategist" : "amateur";
  // Уровень сменился — урок другой программы больше не подходит.
  if (chess.level !== level && chess.lesson && !chess.lesson.completedAt) chess.lesson = null;
  chess.level = level;
  chess.levelSetAt = new Date().toISOString();
  chess.survey = { moves, mate, at: chess.levelSetAt };
  // Задачи под новый уровень: сегодняшняя нерешённая и практика подбираются заново.
  if (chess.daily && !chess.daily.done) chess.daily = null;
  chess.practice = null;
  markDirty();
  return chess;
}

// ── Программа ────────────────────────────────────────────────────────────────

function programOf(account) {
  const band = chessBand(artOf(account).age);
  const level = chessOf(account).level;
  if (!band || !level) return null;
  return { band, level, group: PROGRAM[band], topics: PROGRAM[band].levels[level] };
}

function doneAtLevel(account, program) {
  return chessOf(account).history.filter((item) => item.band === program.band && item.level === program.level);
}

export function nextChessTopic(account) {
  const program = programOf(account);
  if (!program) return null;
  return program.topics[doneAtLevel(account, program).length % program.topics.length];
}

// Вся программа уровня пройдена — следующий уровень.
function maybePromote(account) {
  const chess = chessOf(account);
  const program = programOf(account);
  if (!program) return false;
  const index = LEVEL_ORDER.indexOf(chess.level);
  if (index >= LEVEL_ORDER.length - 1) return false;
  if (doneAtLevel(account, program).length < program.topics.length) return false;
  chess.level = LEVEL_ORDER[index + 1];
  chess.levelSetAt = new Date().toISOString();
  chess.practice = null;
  return true;
}

// Строка для промптов Лео: возраст, программа группы и уровень.
export function chessMethodLine(account) {
  const program = programOf(account);
  if (!program) return "";
  const age = artOf(account).age;
  return `Ученику ${age} ${yearsWord(age)}, уровень в шахматах — ${levelLabel(program.level)}. Программа группы ${program.group.label}. Подача: ${program.group.method}.`;
}

export function chessLessonLine(account) {
  const lesson = chessOf(account).lesson;
  if (!lesson || lesson.completedAt) return "";
  return `Сейчас идёт урок Лео «${lesson.title}» (тема: ${lesson.topic}): ${lesson.concept}`;
}

function yearsWord(age) {
  const mod10 = age % 10;
  const mod100 = age % 100;
  if (mod10 === 1 && mod100 !== 11) return "год";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "года";
  return "лет";
}

// ── Урок Лео ─────────────────────────────────────────────────────────────────

// profile — карточка ученика (интересы, уровни) из lib/learnerProfile.mjs.
export function chessLessonPrompt(account, topic, profile = "") {
  const program = programOf(account);
  const past = chessOf(account)
    .history.slice(-10)
    .map((item) => item.title);
  const video = topic === VIDEO_TOPIC;
  return `${LEO_ROLE}
Ты мужчина, говоришь о себе в мужском роде. Ты наставник ATA Academy.
${chessMethodLine(account)}
${profile ? `${profile} Примеры и истории строй вокруг его интересов.\n` : ""}Составь короткий урок (3–5 минут) на тему «${topic}».${past.length ? ` Недавние уроки (не повторяй): ${past.join("; ")}.` : ""}
${
  video
    ? "Это разбор детского видеоурока на YouTube: предложи поисковый запрос по-русски, по которому ученик найдёт короткий детский видеоурок по шахматам его уровня, и подготовь, на что обратить внимание при просмотре."
    : ""
}
Правила точности: пиши только шахматно верные факты; не придумывай позиции, которые нельзя проверить; ${
    program?.band === "young"
      ? "без нотации, только образы и направления"
      : "нотацию используй аккуратно и только для простых примеров"
  }.
Пиши по-русски, тон задорный и тёплый, сложность строго по возрасту и уровню.
Ответь строго JSON-объектом:
{"title": "увлекательное название урока",
 "intro": "1–2 предложения от Лео: «Сегодня у нас тема „${topic}“…»",
 "story": "${program?.band === "young" ? "сказочная история о фигурах, 3–5 предложений" : "объяснение идеи, 3–5 предложений"}",
 "example": "один понятный пример, 1–3 предложения",
 "tip": "секрет Лео — одна короткая подсказка",
 "quiz": {"question": "вопрос на проверку по теме урока", "options": ["3 варианта"], "answer": 0, "explain": "почему ответ верный, 1–2 предложения"},
 "youtubeQuery": "${video ? "поисковый запрос для YouTube" : ""}"}
answer — индекс верного варианта (0–2).`;
}

export function normalizeChessLesson(raw, topic) {
  const text = (value) => String(value ?? "").trim();
  const options = (Array.isArray(raw?.quiz?.options) ? raw.quiz.options : []).map(text).filter(Boolean).slice(0, 3);
  const answer = Number(raw?.quiz?.answer);
  const lesson = {
    topic,
    title: text(raw?.title) || topic,
    intro: text(raw?.intro),
    concept: text(raw?.story),
    example: text(raw?.example),
    tip: text(raw?.tip),
    quiz: { question: text(raw?.quiz?.question), options, answer, explain: text(raw?.quiz?.explain) },
    youtubeQuery: topic === VIDEO_TOPIC ? text(raw?.youtubeQuery) || "шахматы для детей урок" : "",
  };
  if (
    !lesson.intro ||
    !lesson.concept ||
    !lesson.quiz.question ||
    options.length < 2 ||
    !(answer >= 0 && answer < options.length)
  ) {
    throw new Error("Урок Лео от модели неполный");
  }
  return lesson;
}

export function saveChessLesson(account, lesson) {
  const chess = chessOf(account);
  const program = programOf(account);
  chess.lesson = {
    ...lesson,
    band: program.band,
    level: program.level,
    startedAt: new Date().toISOString(),
    completedAt: null,
    picked: null,
    correct: null,
  };
  markDirty();
  return chess.lesson;
}

// Ответ на вопрос урока завершает урок: тема пройдена, верный ответ — в счёт решённых задач.
export function answerChessLesson(account, option) {
  const chess = chessOf(account);
  const lesson = chess.lesson;
  const picked = Number(option);
  if (!lesson || lesson.completedAt || !(picked >= 0 && picked < lesson.quiz.options.length)) return null;
  lesson.picked = picked;
  lesson.correct = picked === lesson.quiz.answer;
  lesson.completedAt = new Date().toISOString();
  if (lesson.correct) chess.solved += 1;
  chess.history = [
    ...chess.history,
    {
      topic: lesson.topic,
      title: lesson.title,
      band: lesson.band,
      level: lesson.level,
      correct: lesson.correct,
      date: todayKey(account),
    },
  ].slice(-MAX_HISTORY);
  const promoted = maybePromote(account);
  recordActivity(account);
  markDirty();
  return { correct: lesson.correct, promoted };
}

// ── Чат с Лео ───────────────────────────────────────────────────────────────

export function leoChatPrompt(account, persona = {}) {
  return `${LEO_ROLE}
Ты мужчина, говоришь о себе в мужском роде. Ты наставник ATA Academy по шахматам и логике.
${persona.name ? `Ученика зовут ${persona.name}. Обращайся к нему по имени.` : "Обращайся к ученику на «ты»."}
${chessMethodLine(account) || "Возраст и уровень ученика пока неизвестны — говори как с младшим школьником."}
${persona.profile ?? ""}
${persona.memory ?? ""}
${chessLessonLine(account)}
Пиши по-русски. Твои реплики озвучивает голос — говори коротко: 1–4 предложения.

Что ты делаешь:
— Отвечаешь на вопросы о шахматах: как ходят фигуры, что такое вилка, связка, рокировка, как поставить мат, как разыграть дебют.
— Объясняешь через образы и понятные примеры по возрасту; малышам — сказкой о суперсилах фигур.
— Если ученик просит задачку — дай короткую словесную задачу по уровню (без сложных позиций) и дождись ответа.
— Если ученик рассказывает о видеоуроке или партии — похвали и разбери главную идею.
— Только шахматно верные факты. Если не уверен — честно скажи и предложи проверить на доске.
— Никакой критики: хвали за попытку, ошибки превращай в подсказки.

${teacherRules({ ...persona, kid: true })}

Ответь строго JSON-объектом:
{"reply": "твоя реплика ученику",
 "choices": ["2–3 коротких варианта ответа ученика, до 4 слов, можно с эмодзи"]}`;
}

// ── Задачи: задача дня и практика ───────────────────────────────────────────

// Задачи под возраст и уровень; для редких сочетаний (Стратег 4–7) — задачи уровня для всех.
function puzzlePool(account) {
  const program = programOf(account);
  if (!program) return [];
  const fits = (puzzle) => puzzle.levels.includes(program.level);
  const own = PUZZLES.filter((puzzle) => fits(puzzle) && (puzzle.band === program.band || puzzle.band === "any"));
  return own.length >= 3 ? own : PUZZLES.filter(fits);
}

function pickPuzzle(account, exclude = []) {
  const pool = puzzlePool(account);
  if (!pool.length) return null;
  const seen = new Set(chessOf(account).seen);
  const fresh = pool.filter((puzzle) => !seen.has(puzzle.id) && !exclude.includes(puzzle.id));
  if (fresh.length) return fresh[0];
  // Все задачи уровня решены — по кругу, начиная с давно решённых.
  const order = chessOf(account).seen;
  const rest = pool.filter((puzzle) => !exclude.includes(puzzle.id));
  return (rest.length ? rest : pool).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))[0];
}

function slotOf(account, slot) {
  const chess = chessOf(account);
  if (slot === "daily") {
    const today = todayKey(account);
    if (chess.daily?.date !== today || !puzzleById(chess.daily.id)) {
      const puzzle = pickPuzzle(account, chess.practice && !chess.practice.done ? [chess.practice.id] : []);
      chess.daily = puzzle ? { date: today, id: puzzle.id, attempts: 0, done: false, correct: null } : null;
      markDirty();
    }
    return chess.daily;
  }
  if (!chess.practice || !puzzleById(chess.practice.id)) {
    const puzzle = pickPuzzle(account, [chess.daily?.id].filter(Boolean));
    chess.practice = puzzle ? { id: puzzle.id, attempts: 0, done: false, correct: null } : null;
    markDirty();
  }
  return chess.practice;
}

// Следующая задача практики (после решённой).
export function nextPractice(account) {
  const chess = chessOf(account);
  if (chess.practice && !chess.practice.done) return chess.practice;
  chess.practice = null;
  return slotOf(account, "practice");
}

function isCorrect(puzzle, answer) {
  if (puzzle.kind === "quiz") return Number(answer) === puzzle.answer;
  // Превращение пешки засчитывается по клеткам «откуда-куда» (a7a8 = a7a8q).
  return puzzle.solutions.includes(
    String(answer ?? "")
      .toLowerCase()
      .slice(0, 4),
  );
}

// Три попытки: верный ответ — задача решена; после третьей ошибки Лео показывает решение.
export function answerPuzzle(account, slot, answer) {
  if (slot !== "daily" && slot !== "practice") return null;
  const state = slotOf(account, slot);
  const puzzle = state && puzzleById(state.id);
  if (!puzzle || state.done) return null;
  const correct = isCorrect(puzzle, answer);
  state.attempts += 1;
  if (correct || state.attempts >= MAX_ATTEMPTS || puzzle.kind === "quiz") {
    state.done = true;
    state.correct = correct;
    const chess = chessOf(account);
    chess.seen = [...chess.seen.filter((id) => id !== puzzle.id), puzzle.id].slice(-MAX_SEEN);
    if (correct) chess.solved += 1;
    recordActivity(account);
  }
  markDirty();
  return { correct, done: state.done, attemptsLeft: MAX_ATTEMPTS - state.attempts };
}

function publicPuzzle(state) {
  const puzzle = state && puzzleById(state.id);
  if (!puzzle) return null;
  return {
    id: puzzle.id,
    kind: puzzle.kind,
    theme: puzzle.theme,
    title: puzzle.title,
    prompt: puzzle.prompt,
    fen: puzzle.fen ?? null,
    options: puzzle.options ?? null,
    attempts: state.attempts,
    attemptsLeft: MAX_ATTEMPTS - state.attempts,
    done: state.done,
    correct: state.correct,
    // Решение и объяснение — только когда задача закрыта.
    solution: state.done ? (puzzle.kind === "quiz" ? puzzle.answer : puzzle.solutions[0]) : null,
    explain: state.done ? puzzle.explain : null,
  };
}

// ── Партии с Лео ────────────────────────────────────────────────────────────

const MAX_GAMES = 30;
const GAME_RESULTS = ["win", "loss", "draw"];

function gamesOf(account) {
  const chess = chessOf(account);
  chess.games ??= { played: 0, won: 0, drawn: 0, lost: 0, history: [] };
  return chess.games;
}

// Итог партии приходит с клиента (партия идёт на устройстве, движок — в браузере).
export function recordGame(account, { result, color, plies, level }) {
  if (!GAME_RESULTS.includes(result)) return null;
  const games = gamesOf(account);
  games.played += 1;
  if (result === "win") games.won += 1;
  else if (result === "loss") games.lost += 1;
  else games.drawn += 1;
  games.history = [
    ...games.history,
    {
      result,
      color: color === "b" ? "b" : "w",
      moves: Math.max(0, Math.round(Number(plies) / 2) || 0),
      level: CHESS_LEVELS[level] ? level : chessOf(account).level,
      date: todayKey(account),
    },
  ].slice(-MAX_GAMES);
  recordActivity(account);
  markDirty();
  return games;
}

function publicGames(account) {
  const { history, ...totals } = gamesOf(account);
  return { ...totals, recent: history.slice(-8).reverse() };
}

// ── То, что видит клиент ────────────────────────────────────────────────────

export function publicChess(account) {
  const chess = chessOf(account);
  const age = artOf(account).age ?? null;
  const program = programOf(account);
  const lesson = chess.lesson;
  const passed = new Set(program ? doneAtLevel(account, program).map((item) => item.topic) : []);
  return {
    age,
    level: chess.level,
    levelLabel: levelLabel(chess.level),
    band: program ? program.group.label : null,
    program: program ? program.topics.map((topic) => ({ topic, done: passed.has(topic) })) : [],
    nextTopic: nextChessTopic(account),
    solved: chess.solved,
    lessonsDone: chess.history.length,
    games: publicGames(account),
    lesson: lesson
      ? {
          ...lesson,
          // Ключ ответа — только после ответа ученика.
          quiz: lesson.completedAt ? lesson.quiz : { question: lesson.quiz.question, options: lesson.quiz.options },
        }
      : null,
    daily: program ? publicPuzzle(slotOf(account, "daily")) : null,
    practice: program ? publicPuzzle(slotOf(account, "practice")) : null,
  };
}

// Для «Дневного трека»: задачка дня от Лео.
export function dailyChess(account) {
  const chess = chessOf(account);
  const program = programOf(account);
  if (!program)
    return { needsSurvey: !chess.level, needsAge: !artOf(account).age, title: null, done: false, correct: null };
  const state = slotOf(account, "daily");
  const puzzle = state && puzzleById(state.id);
  return {
    needsSurvey: false,
    needsAge: false,
    title: puzzle?.title ?? null,
    theme: puzzle?.theme ?? null,
    done: !!state?.done,
    correct: state?.correct ?? null,
  };
}

// Для карточки ученика и «Прогресса»: уровень, решённые задачи, пройденные темы.
export function chessSummary(account) {
  const chess = chessOf(account);
  return {
    level: chess.level,
    levelLabel: levelLabel(chess.level),
    band: programOf(account)?.group.label ?? null,
    solved: chess.solved,
    lessonsDone: chess.history.length,
    topics: chess.history.slice(-12).reverse(),
    nextTopic: nextChessTopic(account),
    games: publicGames(account),
  };
}
