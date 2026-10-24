import { aiChat } from "./openai.mjs";
import { isStrictLevel, maxWordsFor } from "./cefr.mjs";

// Общие правила учителя для всех режимов (языки, детский режим, Художник, Telegram-бот):
// обращение по имени, повторение слабых мест в начале урока, примеры из интересов ученика
// и ровно один интерактив в конце каждой реплики.

// persona = { name, sessionStart, interests: string[], kid }.
export function teacherRules(persona = {}) {
  const lines = ["ПРАВИЛА УЧИТЕЛЯ (обязательны):"];
  lines.push(
    persona.name
      ? `1. Обращайся к ученику строго по имени — ${persona.name}. Не придумывай других обращений вместо имени и не угадывай пол по имени.`
      : "1. Имя ученика неизвестно — обращайся на «ты» и мягко узнай, как его зовут.",
  );
  lines.push(
    persona.sessionStart
      ? "2. Это начало урока: в первой же реплике коротко (1–2 фразы) повтори слабые места или итог прошлого урока из ПРОФИЛЯ УЧЕНИКА" +
          (persona.kid ? " — игрой, не называя их ошибками" : "") +
          ", затем переходи к новому. Если профиль пуст — просто тепло начни урок."
      : "2. Урок уже идёт: не повторяй приветствие и итог прошлого урока заново, только мягко вплетай слабые места в упражнения.",
  );
  lines.push(
    persona.interests?.length
      ? `3. Примеры, истории и упражнения строй на интересах ученика: ${persona.interests.join(", ").toLowerCase()}.`
      : "3. Интересы ученика пока неизвестны: узнай их одним вопросом и дальше строй примеры на них.",
  );
  lines.push(
    "4. Каждая твоя реплика заканчивается РОВНО ОДНИМ понятным интерактивом — одним вопросом или одним заданием. Не задавай два вопроса подряд и не соединяй вопрос с заданием; всё, что идёт до него, — короткая реакция или подача материала.",
  );
  return lines.join("\n");
}

// Считает вопросительные предложения в реплике (испанский «¿…?» считается один раз).
export function countQuestions(reply) {
  return (String(reply ?? "").match(/\?/g) ?? []).length;
}

function longestSentenceWords(reply) {
  return Math.max(
    0,
    ...String(reply ?? "")
      .split(/[.!?…\n]+/)
      .map((sentence) => sentence.trim().split(/\s+/).filter(Boolean).length),
  );
}

const GUARD_OFF = () => process.env.REPLY_GUARD === "off";

// Серверная проверка реплики учителя: ровно один интерактив и (для A1–B1) отсутствие
// лексики и грамматики выше уровня. Проверка дешёвая — gpt-4o-mini; при любом сбое
// возвращается исходная реплика, чтобы ученик не остался без ответа.
export async function guardReply(reply, { level = null, label = "guard", skipQuestion = false } = {}) {
  const text = String(reply ?? "").trim();
  if (!text || GUARD_OFF()) return text;
  const strict = isStrictLevel(level);
  const tooManyQuestions = !skipQuestion && countQuestions(text) > 1;
  const maxWords = strict ? maxWordsFor(level) : null;
  const tooLong = !!maxWords && longestSentenceWords(text) > Math.ceil(maxWords * 1.5);
  // Для A1–B1 лексику выше уровня видит только модель — проверяем каждую реплику.
  if (!strict && !tooManyQuestions) return text;
  if (strict && !tooManyQuestions && !tooLong && text.length < 20) return text;

  const task = [
    strict
      ? `Проверь реплику учителя на соответствие уровню CEFR ${level}: нет ли грамматики и лексики выше ${level} и предложений длиннее ${maxWords} слов.`
      : "",
    skipQuestion
      ? ""
      : "Проверь, что реплика заканчивается РОВНО ОДНИМ вопросом или заданием; лишние вопросы убери или преврати в утверждение.",
    "Если всё в порядке — верни исходный текст без изменений. Если нет — перепиши минимально: тот же язык, тон, смысл и обращение по имени, но уровень и один интерактив в конце.",
    'Ответь JSON: {"reply": "итоговая реплика"}',
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const answer = await aiChat(
      [
        { role: "system", content: task },
        { role: "user", content: text },
      ],
      `${label} guard`,
      { maxTokens: 600, json: true, tier: "fast", temperature: 0 },
    );
    const fixed = String(JSON.parse(answer).reply ?? "").trim();
    return fixed || text;
  } catch (error) {
    console.error(`Проверка реплики не удалась (${label}): ${error?.message ?? error}`);
    return text;
  }
}
