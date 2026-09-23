import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { Telegraf } from "telegraf";
import Groq from "groq-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Диагностика для отладки проблем с переменными окружения на хостинге (например,
// когда переменная задана в панели, но приложение её не видит — часто из-за невидимого
// пробела в имени переменной). Не печатает значения, только факт наличия ключей и их
// общее число — безопасно смотреть в публичных логах.
console.log(
  `[env-диагностика] всего переменных окружения в process.env: ${Object.keys(process.env).length}; ` +
    `есть ключ "GROQ_API_KEY": ${"GROQ_API_KEY" in process.env}; ` +
    `есть ключ "TELEGRAM_BOT_TOKEN": ${"TELEGRAM_BOT_TOKEN" in process.env}; ` +
    `есть ключ "PORT": ${"PORT" in process.env}; ` +
    `есть ключ "DEBUG_PING": ${"DEBUG_PING" in process.env}.`,
);
// Полный список имён переменных (без значений) — чтобы видеть 100% правду о том, что
// реально долетает до контейнера, а не гадать по регулярке, похоже ли имя на нужное.
console.log(
  `[env-диагностика] все имена ключей process.env (в кавычках, чтобы был виден лишний пробел): ` +
    Object.keys(process.env)
      .sort()
      .map((key) => JSON.stringify(key))
      .join(", "),
);
// Эти значения не секретны (Railway сам их проставляет: хеш коммита, ветка, сообщение
// коммита) — печатаем открыто, чтобы понять, какой именно код реально запущен, если
// поведение не совпадает с тем, что ожидается от последнего пуша в GitHub.
console.log(
  `[env-диагностика] Railway git: sha=${process.env.RAILWAY_GIT_COMMIT_SHA ?? "нет"}, ` +
    `branch=${process.env.RAILWAY_GIT_BRANCH ?? "нет"}, ` +
    `message=${JSON.stringify(process.env.RAILWAY_GIT_COMMIT_MESSAGE ?? null)}, ` +
    `deploymentId=${process.env.RAILWAY_DEPLOYMENT_ID ?? "нет"}.`,
);

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
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
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
// Голосовые/аудио сейчас не обрабатываются моделью — эта заглушка отвечает сразу,
// без обращения к API (ради стабильности и экономии лимита запросов).
const VOICE_STUB_MESSAGE =
  "Пока что для стабильной работы я принимаю только текстовые сообщения. " +
  "Пожалуйста, напишите текстом — с радостью переведу или отвечу!";

// Намеренно нигде ниже нет throw за отсутствующие ключи: жёсткий крах на старте означает
// краш-луп деплоя на Railway (контейнер рестартует снова и снова, а health-check никогда
// не поднимается). Вместо этого предупреждаем в консоль и позволяем процессу запуститься —
// каждая отсутствующая интеграция просто не активируется (см. bot = null / groq = null
// ниже), а health-check сервер в самом конце файла работает в любом случае.
if (!TELEGRAM_BOT_TOKEN) {
  console.warn(
    `Токен Telegram-бота не найден ни в одной из переменных окружения: ${TELEGRAM_TOKEN_ENV_VARS.join(", ")}. ` +
      "Telegram-бот не будет запущен, пока одна из них не будет задана.",
  );
} else if (telegramToken.name !== TELEGRAM_TOKEN_ENV_VARS[0]) {
  console.log(`Токен Telegram-бота взят из переменной ${telegramToken.name}.`);
}
if (!GROQ_API_KEY) {
  console.warn(
    "GROQ_API_KEY не найден. Бот запустится, но на любой запрос будет отвечать сообщением " +
      "об ошибке, пока переменная не будет задана.",
  );
} else {
  console.log(`Groq API подключён (модель: ${GROQ_MODEL}).`);
}

const systemInstruction = fs.readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
const bot = TELEGRAM_BOT_TOKEN ? new Telegraf(TELEGRAM_BOT_TOKEN) : null;

fs.mkdirSync(DATA_DIR, { recursive: true });

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Приводит запись пользователя к текущей схеме { history: Message[] }, где Message —
// это ровно тот формат, которого ждёт Groq (OpenAI-совместимый чат): { role: "user" |
// "assistant", content: "..." }. Понимает и более ранний формат записей, оставшийся от
// версии бота на Gemini ({ role: "user"/"model", parts: [{ text }] }), и обновляет их
// на лету; всё остальное — повреждённые или нераспознанные записи — тихо отбрасывает,
// а не роняет бота.
function normalizeUser(raw) {
  const rawHistory = Array.isArray(raw?.history) ? raw.history : [];
  const history = [];

  for (const turn of rawHistory) {
    if (isNonEmptyText(turn?.content) && (turn.role === "user" || turn.role === "assistant")) {
      history.push({ role: turn.role, content: turn.content });
      continue;
    }
    if (Array.isArray(turn?.parts) && isNonEmptyText(turn.parts[0]?.text)) {
      const role = turn.role === "model" ? "assistant" : "user";
      history.push({ role, content: turn.parts[0].text });
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
// пользователя перемешать историю диалога, пока оба ответа ждут Groq API.
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

// Единая точка подробного логирования сбоев — печатает message, stack, HTTP-статус
// и (если есть) сырое тело ответа API отдельными строками, чтобы в логах Railway
// была видна точная причина, а не просто "[object Object]" или обрезанная строка.
function logDetailedError(label, error) {
  console.error(`${label}: ${error?.message ?? error}`);
  if (typeof error?.status === "number") {
    console.error(`  HTTP-статус: ${error.status}`);
  }
  if (error?.error) {
    try {
      console.error(`  Тело ответа API: ${JSON.stringify(error.error)}`);
    } catch {
      // тело не сериализуется — не критично, стек ниже всё равно даст зацепку
    }
  }
  if (error?.stack) {
    console.error(error.stack);
  }
}

// Отправляет запрос модели вместе с историей чата в формате Groq/OpenAI (роли
// "system"/"user"/"assistant"). История пополняется только при успешном непустом
// ответе — если модель ничего не вернула или API упал, в файл ничего не пишется
// и предыдущая история не портится.
async function askTranslator(user, userText, chatId) {
  if (!groq) {
    throw new Error("GROQ_API_KEY не задан — интеграция с Groq недоступна.");
  }

  const messages = [
    { role: "system", content: systemInstruction },
    ...user.history,
    { role: "user", content: userText },
  ];

  let response;
  try {
    response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages,
      max_completion_tokens: 1024,
    });
  } catch (error) {
    logDetailedError(`Ошибка Groq API (chat ${chatId})`, error);
    throw error;
  }

  const replyText = response.choices?.[0]?.message?.content?.trim();
  if (!replyText) {
    const finishReason = response.choices?.[0]?.finish_reason;
    console.error(
      `Groq не вернул текст ответа (chat ${chatId}). finishReason: ${finishReason ?? "нет"}. ` +
        `Полный ответ: ${JSON.stringify(response)}`,
    );
    throw new Error("Groq не вернул текст ответа");
  }

  user.history.push({ role: "user", content: userText });
  user.history.push({ role: "assistant", content: replyText });
  if (user.history.length > MAX_HISTORY_MESSAGES) {
    user.history = user.history.slice(-MAX_HISTORY_MESSAGES);
  }

  return replyText;
}

// Общий обработчик для /start и текста: очередь на чат, индикатор набора текста
// (не критичен — его сбой не должен мешать получить сам ответ), вызов модели и
// сохранение истории. Любая ошибка логируется в консоль и превращается в одно
// понятное сообщение пользователю, без падения чата.
async function respond(ctx, userText, { resetHistory = false } = {}) {
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
      const reply = await askTranslator(user, userText, chatId);
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
    return respond(ctx, `/start${langHint}`, { resetHistory: true });
  });

  bot.command("reset", async (ctx) => {
    const chatId = String(ctx.chat.id);
    await enqueue(chatId, async () => {
      users[chatId] = { history: [] };
      saveUsers();
      await ctx.reply("Память очищена, начинаем с чистого листа. Чем помочь с переводом?");
    });
  });

  bot.on("text", (ctx) => respond(ctx, ctx.message.text));

  // Голосовые и аудиосообщения сейчас не обрабатываются моделью — заглушка отвечает
  // сразу, без обращения к API и без очереди/истории: это временное решение ради
  // стабильности, а не сбой, поэтому в лог не пишем.
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
    if (!groq) problems.push("GROQ_API_KEY не найден");

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(problems.length ? `family-bot: ${problems.join("; ")}` : "family-bot ishlayapti");
  })
  .listen(PORT, () => console.log(`Health-check server: port ${PORT}`));

process.once("SIGINT", () => bot?.stop("SIGINT"));
process.once("SIGTERM", () => bot?.stop("SIGTERM"));
