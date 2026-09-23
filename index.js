import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { Telegraf } from "telegraf";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Имена переменных окружения, в которых может лежать токен Telegram-бота — проверяются
// по порядку, побеждает первая найденная непустая. Разные хостинги/шаблоны деплоя иногда
// называют её по-разному, так что поддерживаем оба распространённых варианта.
const TELEGRAM_TOKEN_ENV_VARS = ["TELEGRAM_BOT_TOKEN", "BOT_TOKEN"];

function readFirstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return { name, value };
  }
  return null;
}

const telegramToken = readFirstEnv(TELEGRAM_TOKEN_ENV_VARS);
const TELEGRAM_BOT_TOKEN = telegramToken?.value;
// До трёх ключей Gemini — GEMINI_API_KEY обязателен как основной, _2 и _3 опциональны.
// Используются как пул: при 429 (квота конкретного ключа исчерпана) бот переключается
// на следующий по кругу, вместо того чтобы сразу сдаваться.
const GEMINI_API_KEY_ENV_VARS = ["GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3"];
const GEMINI_API_KEYS = GEMINI_API_KEY_ENV_VARS.map((name) => process.env[name]).filter(
  (value) => !!value,
);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
// DATA_DIR указывает на каталог с постоянным хранилищем: локально — обычная папка ./data,
// на Railway — точка монтирования Volume (Settings → Volumes → Mount Path), например /data.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SYSTEM_PROMPT_FILE = path.join(__dirname, "system_prompt.md");
// Пара (запрос + ответ) — один "ход"; храним последние 15 ходов на чат.
const MAX_HISTORY_MESSAGES = 30;
const FALLBACK_ERROR_MESSAGE =
  "Извините, сейчас не получилось получить ответ — произошёл сбой при обращении к ИИ. Пожалуйста, попробуйте отправить запрос ещё раз через минуту.";
// Голосовые/аудио временно не обрабатываются моделью — эта заглушка отвечает сразу,
// не тратя запрос к Gemini API (ради стабильности и экономии квоты ключей).
const VOICE_STUB_MESSAGE =
  "Пока что для стабильной работы и экономии квоты я принимаю только текстовые сообщения. " +
  "Пожалуйста, напишите текстом — с радостью переведу или отвечу!";
// Gemini периодически отвечает 429 (RESOURCE_EXHAUSTED — исчерпан лимит запросов) или
// 503/UNAVAILABLE (временная перегрузка) — это восстановимые сбои. При них бот сразу
// (без пауз) перебирает все настроенные ключи по кругу — см. generateContentWithRetry —
// и только если В ОДНОМ КРУГЕ отказали абсолютно все ключи, ждёт перед следующим кругом;
// задержка растёт экспоненциально (1с, 2с, 4с, ...), чтобы не долбить впустую API,
// у которого прямо сейчас исчерпаны/перегружены все имеющиеся ключи одновременно.
const BACKOFF_MAX_ATTEMPTS = 3; // до 4 полных кругов по всем ключам, прежде чем сдаться
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 15000;

// Намеренно нигде ниже нет throw за отсутствующие ключи: жёсткий крах на старте означает
// краш-луп деплоя на Railway (контейнер рестартует снова и снова, а health-check никогда
// не поднимается). Вместо этого предупреждаем в консоль и позволяем процессу запуститься —
// каждая отсутствующая интеграция просто не активируется (см. bot = null / geminiClients = []
// ниже), а health-check сервер в самом конце файла работает в любом случае.
if (!TELEGRAM_BOT_TOKEN) {
  console.warn(
    `Токен Telegram-бота не найден ни в одной из переменных окружения: ${TELEGRAM_TOKEN_ENV_VARS.join(", ")}. ` +
      "Telegram-бот не будет запущен, пока одна из них не будет задана.",
  );
} else if (telegramToken.name !== TELEGRAM_TOKEN_ENV_VARS[0]) {
  console.log(`Токен Telegram-бота взят из переменной ${telegramToken.name}.`);
}
if (GEMINI_API_KEYS.length === 0) {
  console.warn(
    `Ни один ключ Gemini не найден (проверены: ${GEMINI_API_KEY_ENV_VARS.join(", ")}). ` +
      "Бот запустится, но на любой запрос будет отвечать сообщением об ошибке, пока хотя бы одна переменная не будет задана.",
  );
} else if (GEMINI_API_KEYS.length > 1) {
  console.log(`Настроено ключей Gemini: ${GEMINI_API_KEYS.length} (переключение при 429 включено).`);
}

const systemInstruction = fs.readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
const geminiClients = GEMINI_API_KEYS.map((apiKey) => new GoogleGenAI({ apiKey }));
// Индекс ключа/клиента, который используется прямо сейчас — общий для всех чатов
// и переживает между запросами, чтобы не долбиться в уже исчерпанный ключ заново.
let currentGeminiKeyIndex = 0;
const bot = TELEGRAM_BOT_TOKEN ? new Telegraf(TELEGRAM_BOT_TOKEN) : null;

fs.mkdirSync(DATA_DIR, { recursive: true });

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Приводит запись пользователя к текущей схеме { history: Content[] }, где Content —
// это ровно тот формат, которого ждёт Gemini: { role: "user" | "model", parts: [{ text }] }.
// Понимает и старый формат записей ({ role: "user"/"assistant", content: "..." }, оставшийся
// от прошлой версии бота на другом провайдере) и обновляет их на лету; всё остальное —
// повреждённые или нераспознанные записи — тихо отбрасывает, а не роняет бота.
function normalizeUser(raw) {
  const rawHistory = Array.isArray(raw?.history) ? raw.history : [];
  const history = [];

  for (const turn of rawHistory) {
    if (Array.isArray(turn?.parts) && isNonEmptyText(turn.parts[0]?.text)) {
      const role = turn.role === "model" ? "model" : "user";
      history.push({ role, parts: [{ text: turn.parts[0].text }] });
      continue;
    }
    if (isNonEmptyText(turn?.content)) {
      const role = turn.role === "assistant" ? "model" : "user";
      history.push({ role, parts: [{ text: turn.content }] });
    }
  }

  return { history };
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    const users = {};
    for (const [chatId, record] of Object.entries(raw)) {
      users[chatId] = normalizeUser(record);
    }
    return users;
  } catch (error) {
    console.error(`Не удалось прочитать ${USERS_FILE}, начинаем с пустой памяти:`, error);
    return {};
  }
}

// Хранилище читается с диска один раз при старте и дальше живёт в памяти —
// это исключает потерю параллельных изменений между разными чатами
// (загрузка-правка-сохранение всего файла на каждое сообщение могла их затирать).
const users = loadUsers();

function saveUsers() {
  const tmpFile = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(users, null, 2), "utf-8");
  fs.renameSync(tmpFile, USERS_FILE);
}

function getUser(chatId) {
  if (!users[chatId]) {
    users[chatId] = { history: [] };
  }
  return users[chatId];
}

// Последовательная очередь на чат: не даёт двум быстрым сообщениям одного и того же
// пользователя перемешать историю диалога, пока оба ответа ждут Gemini API.
const chatQueues = new Map();
function enqueue(chatId, task) {
  const previous = chatQueues.get(chatId) ?? Promise.resolve();
  const next = previous.then(task, task);
  chatQueues.set(
    chatId,
    next.catch(() => {}),
  );
  return next;
}

// Строковые gRPC-статусы Google, которые означают "временно недоступно, можно повторить":
// UNAVAILABLE — обычно код 503 (перегрузка на стороне Google),
// RESOURCE_EXHAUSTED — обычно код 429 (исчерпан лимит запросов/квота).
const RETRYABLE_STATUS_NAMES = new Set(["UNAVAILABLE", "RESOURCE_EXHAUSTED"]);

function isRetryableApiError(error) {
  const httpStatus = error?.status;
  if (httpStatus === 429 || httpStatus === 503 || (typeof httpStatus === "number" && httpStatus >= 500)) {
    return true;
  }
  // На случай, если числовой HTTP-статус почему-то не выставлен (другая версия SDK,
  // изменившийся формат ошибки) — подстраховка: тело ответа @google/genai ApiError
  // приходит как JSON-строка вида {"error":{"code":503,"status":"UNAVAILABLE"}},
  // так что пробуем распознать статус и по имени внутри message.
  if (typeof httpStatus === "string" && RETRYABLE_STATUS_NAMES.has(httpStatus)) {
    return true;
  }
  if (typeof error?.message === "string") {
    try {
      const parsed = JSON.parse(error.message);
      if (RETRYABLE_STATUS_NAMES.has(parsed?.error?.status)) return true;
    } catch {
      // message не JSON — это не наш формат ошибки, просто игнорируем.
    }
  }
  return false;
}

// Единая точка подробного логирования сбоев — печатает message, stack и (если есть)
// HTTP-статус отдельными строками, чтобы в логах Railway была видна точная причина,
// а не просто "[object Object]" или обрезанная строка. У ApiError из @google/genai
// поле message уже содержит сырое тело ответа API в виде JSON-строки — status выводим
// отдельно, чтобы его было легко найти глазами при просмотре логов.
function logDetailedError(label, error) {
  console.error(`${label}: ${error?.message ?? error}`);
  if (typeof error?.status === "number") {
    console.error(`  HTTP-статус: ${error.status}`);
  }
  if (error?.stack) {
    console.error(error.stack);
  }
}

// Задержка перед очередным повтором: удваивается с каждой попыткой (1с, 2с, 4с, 8с...),
// упирается в потолок BACKOFF_MAX_MS и получает небольшой случайный джиттер (±25%),
// чтобы параллельные запросы от разных чатов не синхронизировались и не били по API
// одной волной после общего сбоя.
function backoffDelayMs(attempt) {
  const exponential = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
  const jitter = exponential * 0.25 * Math.random();
  return Math.round(exponential + jitter);
}

// Один круг: пробует каждый настроенный ключ Gemini ровно один раз подряд, начиная
// с currentGeminiKeyIndex, БЕЗ задержки между ключами — у каждого своя независимая
// квота, так что мгновенно перейти к следующему дешевле и быстрее, чем ждать. При
// 429/503/UNAVAILABLE на текущем ключе сразу переключается на следующий; на любой
// другой ошибке (не связанной с перегрузкой/квотой) сдаётся немедленно — другой ключ
// её не исправит. currentGeminiKeyIndex запоминается между вызовами (и кругами), так
// что следующий запрос начинает сразу с того ключа, на котором остановились. Кидает
// последнюю ошибку, если отказали вообще все ключи в этом круге.
async function tryAllKeysOnce(params, chatId, totalKeys) {
  let lastError;

  for (let keyAttempt = 0; keyAttempt < totalKeys; keyAttempt++) {
    const keyIndex = currentGeminiKeyIndex;
    const client = geminiClients[keyIndex];

    try {
      return await client.models.generateContent(params);
    } catch (error) {
      lastError = error;
      logDetailedError(`Ошибка Gemini API (chat ${chatId}, ключ #${keyIndex + 1}/${totalKeys})`, error);

      if (!isRetryableApiError(error)) throw error;

      currentGeminiKeyIndex = (keyIndex + 1) % totalKeys;
      if (keyAttempt < totalKeys - 1) {
        console.warn(
          `Ключ Gemini #${keyIndex + 1}/${totalKeys} недоступен (429/503), переключаюсь на ключ ` +
            `#${currentGeminiKeyIndex + 1}/${totalKeys}.`,
        );
      }
    }
  }

  throw lastError;
}

// Основная точка входа для вызова Gemini. Сначала — один быстрый круг по всем ключам
// (tryAllKeysOnce, без пауз). Только если В ЭТОМ КРУГЕ отказали вообще ВСЕ ключи —
// значит, все квоты/лимиты сейчас исчерпаны одновременно, и мгновенный повтор ничего
// не даст — тогда включается экспоненциальный backoff (1с, 2с, 4с...) перед следующим
// полным кругом. Так бот использует пул ключей на максимум, прежде чем вообще ждать.
async function generateContentWithRetry(params, chatId) {
  if (geminiClients.length === 0) {
    throw new Error("Не задан ни один ключ Gemini (GEMINI_API_KEY / _2 / _3) — интеграция недоступна.");
  }

  const totalKeys = geminiClients.length;

  for (let round = 0; ; round++) {
    try {
      return await tryAllKeysOnce(params, chatId, totalKeys);
    } catch (error) {
      if (round >= BACKOFF_MAX_ATTEMPTS || !isRetryableApiError(error)) throw error;
      const delay = backoffDelayMs(round);
      console.warn(
        `Все ${totalKeys} ключ(а/ей) Gemini сейчас недоступны (429/503), жду ${delay} мс перед ` +
          `новым кругом (${round + 2}/${BACKOFF_MAX_ATTEMPTS + 1})...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Отправляет запрос модели вместе с историей чата, строго чередующейся ролями
// user/model, как того требует Gemini API. requestParts — части именно этого хода
// (сейчас это всегда текст: голосовые/аудио отсекаются заглушкой раньше и сюда не
// попадают); historyLabel — та же реплика, что уходит в сохранённую историю.
// История пополняется только при успешном непустом ответе — если модель ничего
// не вернула или API упал, в файл ничего не пишется и предыдущая история не портится.
async function askTranslator(user, requestParts, historyLabel, chatId) {
  const contents = [...user.history, { role: "user", parts: requestParts }];

  const response = await generateContentWithRetry(
    {
      model: GEMINI_MODEL,
      config: {
        systemInstruction,
        maxOutputTokens: 1024,
      },
      contents,
    },
    chatId,
  );

  const replyText = response.text?.trim();
  if (!replyText) {
    const blockReason = response.promptFeedback?.blockReason;
    const finishReason = response.candidates?.[0]?.finishReason;
    console.error(
      `Gemini не вернул текст ответа (chat ${chatId}). blockReason: ${blockReason ?? "нет"}, ` +
        `finishReason: ${finishReason ?? "нет"}. Полный ответ: ${JSON.stringify(response)}`,
    );
    throw new Error("Gemini не вернул текст ответа");
  }

  user.history.push({ role: "user", parts: [{ text: historyLabel }] });
  user.history.push({ role: "model", parts: [{ text: replyText }] });
  if (user.history.length > MAX_HISTORY_MESSAGES) {
    user.history = user.history.slice(-MAX_HISTORY_MESSAGES);
  }

  return replyText;
}

// Общий обработчик для /start и текста: очередь на чат, индикатор набора текста
// (не критичен — его сбой не должен мешать получить сам ответ), подготовка запроса
// через buildRequest, вызов модели и сохранение истории. Любая ошибка логируется
// в консоль и превращается в одно понятное сообщение пользователю, без падения чата.
async function respond(ctx, buildRequest, { resetHistory = false } = {}) {
  const chatId = String(ctx.chat.id);

  await enqueue(chatId, async () => {
    const user = getUser(chatId);
    if (resetHistory) user.history = [];

    try {
      await ctx.sendChatAction("typing");
    } catch (typingError) {
      console.error(`Не удалось показать индикатор "печатает" (chat ${chatId}):`, typingError);
    }

    try {
      const { parts, historyLabel } = await buildRequest();
      const reply = await askTranslator(user, parts, historyLabel, chatId);
      await ctx.reply(reply);
    } catch (error) {
      logDetailedError(`Не удалось обработать запрос (chat ${chatId})`, error);
      try {
        await ctx.reply(FALLBACK_ERROR_MESSAGE);
      } catch (replyError) {
        logDetailedError(`Не удалось отправить сообщение об ошибке (chat ${chatId})`, replyError);
      }
    } finally {
      saveUsers();
    }
  });
}

if (bot) {
  bot.start((ctx) => {
    const langHint = ctx.from?.language_code
      ? ` (интерфейс Telegram: ${ctx.from.language_code})`
      : "";
    const startText = `/start${langHint}`;
    return respond(ctx, async () => ({ parts: [{ text: startText }], historyLabel: startText }), {
      resetHistory: true,
    });
  });

  bot.command("reset", async (ctx) => {
    const chatId = String(ctx.chat.id);
    await enqueue(chatId, async () => {
      users[chatId] = { history: [] };
      saveUsers();
      await ctx.reply("Память очищена, начинаем с чистого листа. Чем помочь с переводом?");
    });
  });

  bot.on("text", (ctx) =>
    respond(ctx, async () => ({ parts: [{ text: ctx.message.text }], historyLabel: ctx.message.text })),
  );

  // Голосовые и аудиосообщения сейчас не обрабатываются моделью — заглушка отвечает
  // сразу, без обращения к Gemini API и без очереди/истории: это временное решение
  // ради стабильности и экономии квоты ключей, а не сбой, поэтому в лог не пишем.
  bot.on(["voice", "audio"], (ctx) => ctx.reply(VOICE_STUB_MESSAGE));

  // Подстраховка: логирует любые ошибки, которые могли ускользнуть из обработчиков выше
  // (например, сбой в самом Telegraf), чтобы процесс не падал молча.
  bot.catch((err, ctx) => {
    logDetailedError(`Необработанная ошибка Telegraf (chat ${ctx.chat?.id})`, err);
  });

  bot.launch();
  console.log("Family bot ishga tushdi.");
}

// Простой health-check эндпоинт — нужен облачным платформам (Railway, Render и т.п.),
// чтобы понимать, что процесс жив; сам бот работает через long polling, а не через HTTP.
// Держим его отдельно от статуса ключей специально: даже если чего-то не хватает,
// порт остаётся открытым и деплой не падает — сюда просто выводится, чего именно нет.
const PORT = process.env.PORT || 3000;
http
  .createServer((_req, res) => {
    const problems = [];
    if (!bot) problems.push(`Telegram-токен не найден (${TELEGRAM_TOKEN_ENV_VARS.join(", ")})`);
    if (geminiClients.length === 0) {
      problems.push(`ни один ключ Gemini не найден (${GEMINI_API_KEY_ENV_VARS.join(", ")})`);
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(problems.length ? `family-bot: ${problems.join("; ")}` : "family-bot ishlayapti");
  })
  .listen(PORT, () => console.log(`Health-check server: port ${PORT}`));

process.once("SIGINT", () => bot?.stop("SIGINT"));
process.once("SIGTERM", () => bot?.stop("SIGTERM"));
