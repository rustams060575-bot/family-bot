import { isKid, markDirty, recordActivity } from "./store.mjs";
import { artOf, publicArt } from "./artSchool.mjs";
import { targetLevel, todayKey } from "./learning.mjs";
import { dailyChess } from "./chessSchool.mjs";

// «Дневной трек» (Daily Challenge): каждый день — 1 главный урок по арту (из арт-школы)
// и 1 короткая микро-практика по языку (3 слова + вопрос), плюс шахматный челлендж Лео —
// задачка дня из проверенного банка (lib/chessPuzzles.mjs). Состояние — account.daily и account.chess.

const LANG_NAME = { english: "английский", spanish: "испанский" };

// Язык микро-практики: выбранный трек, иначе тот, где уже есть уровень, иначе английский.
export function dailyLanguage(account) {
  if (account.track === "spanish" || account.track === "english") return account.track;
  if (account.learning?.spanish?.level && !account.learning?.english?.level) return "spanish";
  return "english";
}

function dailyOf(account) {
  const today = todayKey(account);
  if (account.daily?.date !== today) account.daily = { date: today, lang: null, langDone: false, langCorrect: null };
  return account.daily;
}

export function microPrompt(account, profile) {
  const track = dailyLanguage(account);
  const kid = isKid(account);
  const current = account.learning?.[track]?.level;
  // Взрослым и подросткам — на шаг выше текущего уровня (по умолчанию C1).
  const level = kid ? (current ?? "дети, первые слова") : current ? targetLevel(current) : "C1";
  return `Ты — Мартина, ${kid ? "тёплый педагог" : "академический преподаватель уровня носителя"} ATA Academy. Составь микро-практику на 2 минуты по языку: ${LANG_NAME[track]}, уровень ${level}.
${profile}
${
  kid
    ? `Выбери маленькую тему из интересов ученика. Дай 3 полезных слова или коротких фразы и 1 вопрос на проверку.
Ученик — ребёнок: самые простые слова, можно с эмодзи, игровой тон.`
    : `Тема — из сфер: поступление в университеты, адаптация в Испании, технологии, спорт, кино, философия, амбиции. Дай 3 продвинутых единицы (коллокация, идиома или конектор) уровня ${level} и 1 вопрос на тонкое различие в значении или регистре. Тон — ёмкий, взрослый, без сюсюканья.`
}
Ответь строго JSON-объектом:
{"topic": "тема по-русски, 2–3 слова",
 "intro": "одна фраза Мартины по-русски: что сегодня за слова",
 "words": [{"word": "слово на изучаемом языке", "translation": "перевод", "example": "очень короткий пример"}],
 "question": {"prompt": "вопрос по этим словам по-русски", "options": ["3 варианта"], "answer": 0}}
words — ровно 3; answer — индекс верного варианта (0–2).`;
}

export function normalizeMicro(raw, track) {
  const text = (value) => String(value ?? "").trim();
  const words = (Array.isArray(raw?.words) ? raw.words : [])
    .map((item) => ({ word: text(item?.word), translation: text(item?.translation), example: text(item?.example) }))
    .filter((item) => item.word && item.translation)
    .slice(0, 3);
  const options = (Array.isArray(raw?.question?.options) ? raw.question.options : [])
    .map(text)
    .filter(Boolean)
    .slice(0, 3);
  const answer = Number(raw?.question?.answer);
  if (
    words.length < 3 ||
    options.length < 2 ||
    !(answer >= 0 && answer < options.length) ||
    !text(raw?.question?.prompt)
  ) {
    throw new Error("Микро-практика от модели неполная");
  }
  return {
    track,
    topic: text(raw?.topic),
    intro: text(raw?.intro),
    words,
    question: { prompt: text(raw.question.prompt), options, answer },
  };
}

export function saveMicro(account, micro) {
  dailyOf(account).lang = micro;
  markDirty();
}

export function answerMicro(account, answer) {
  const daily = dailyOf(account);
  if (!daily.lang) return null;
  const correct = Number(answer) === daily.lang.question.answer;
  if (!daily.langDone) {
    daily.langDone = true;
    daily.langCorrect = correct;
    recordActivity(account);
  }
  markDirty();
  return { correct, answer: daily.lang.question.answer };
}

export function publicDaily(account) {
  const daily = dailyOf(account);
  const art = publicArt(account);
  const today = todayKey(account);
  const artDoneToday = artOf(account).history.some((item) => item.date === today);
  const micro = daily.lang;
  return {
    date: daily.date,
    art: {
      needsAge: !art.age,
      title: art.lesson && !art.lesson.completedAt ? art.lesson.title : null,
      stage: art.lesson && !art.lesson.completedAt ? art.lesson.stage : null,
      nextTheme: art.nextTheme,
      done: artDoneToday,
    },
    lang: {
      track: dailyLanguage(account),
      micro: micro
        ? {
            ...micro,
            // Ключ ответа — только после того, как ученик ответил.
            question: daily.langDone
              ? micro.question
              : { prompt: micro.question.prompt, options: micro.question.options },
          }
        : null,
      done: daily.langDone,
      correct: daily.langCorrect,
    },
    chess: dailyChess(account),
  };
}
