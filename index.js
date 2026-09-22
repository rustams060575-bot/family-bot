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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
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
// Gemini периодически отвечает 503 (перегрузка) или 429 (лимит запросов) — это временные
// сбои, которые обычно проходят за пару секунд, так что имеет смысл тихо повторить запрос
// перед тем, как показывать пользователю сообщение об ошибке.
const MAX_API_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

if (!TELEGRAM_BOT_TOKEN) {
  // Намеренно не throw: жёсткий крах здесь означает краш-луп деплоя на Railway
  // (контейнер рестартует снова и снова, а health-check никогда не поднимается).
  // Вместо этого логируем понятную причину и просто не запускаем Telegram-часть —
  // остальной процесс (в т.ч. health-check сервер) продолжает работать, чтобы
  // проблему можно было спокойно увидеть в логах и поправить переменные окружения.
  console.error(
    `Токен Telegram-бота не найден ни в одной из переменных окружения: ${TELEGRAM_TOKEN_ENV_VARS.join(", ")}. ` +
      "Telegram-бот не будет запущен, пока одна из них не будет задана.",
  );
} else if (telegramToken.name !== TELEGRAM_TOKEN_ENV_VARS[0]) {
  console.log(`Токен Telegram-бота взят из переменной ${telegramToken.name}.`);
}
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY не найден — проверьте .env.");
}

const systemInstruction = fs.readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
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

function isRetryableApiError(error) {
  const status = error?.status;
  return status === 429 || status === 503 || (typeof status === "number" && status >= 500);
}

async function generateContentWithRetry(params, chatId) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await genAI.models.generateContent(params);
    } catch (error) {
      if (attempt >= MAX_API_RETRIES || !isRetryableApiError(error)) throw error;
      console.error(
        `Gemini временно недоступен (chat ${chatId}, попытка ${attempt + 1}/${MAX_API_RETRIES + 1}), повтор через ${RETRY_DELAY_MS} мс:`,
        error.message ?? error,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

// Отправляет запрос модели вместе с историей чата, строго чередующейся ролями
// user/model, как того требует Gemini API. requestParts — это части именно этого
// хода (текст или, для голосовых, inlineData с аудио); historyLabel — всегда
// текстовая метка, которая уходит в сохранённую историю вместо возможного аудио,
// чтобы будущие запросы не таскали за собой тяжёлые бинарные данные раз за разом.
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
    throw new Error(
      blockReason
        ? `Gemini не вернул текст ответа (blockReason: ${blockReason})`
        : "Gemini вернул пустой ответ",
    );
  }

  user.history.push({ role: "user", parts: [{ text: historyLabel }] });
  user.history.push({ role: "model", parts: [{ text: replyText }] });
  if (user.history.length > MAX_HISTORY_MESSAGES) {
    user.history = user.history.slice(-MAX_HISTORY_MESSAGES);
  }

  return replyText;
}

// Скачивает голосовое/аудиосообщение из Telegram и готовит из него части запроса
// для Gemini (inlineData с base64-содержимым). Возвращается как функция, а не
// заранее посчитанный результат, — чтобы ошибка скачивания тоже попадала
// в общий try/catch в respond(), а не падала до него.
function buildAudioRequest(ctx, media, defaultMimeType, historyLabel) {
  return async () => {
    const fileUrl = await ctx.telegram.getFileLink(media.file_id);
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      throw new Error(`Не удалось скачать файл из Telegram: HTTP ${fileResponse.status}`);
    }
    const audioBase64 = Buffer.from(await fileResponse.arrayBuffer()).toString("base64");
    const mimeType = media.mime_type || defaultMimeType;
    return {
      parts: [{ inlineData: { data: audioBase64, mimeType } }],
      historyLabel,
    };
  };
}

// Общий обработчик для /start, текста и голосовых/аудио: очередь на чат, индикатор
// набора текста (не критичен — его сбой не должен мешать получить сам ответ),
// подготовка запроса (buildRequest — текст сразу или скачивание аудио), вызов
// модели и сохранение истории. Любая ошибка на любом из этих шагов логируется
// в консоль и превращается в одно понятное сообщение пользователю — без заглушек
// на конкретном языке и без падения чата.
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
      console.error(`Ошибка при обработке запроса (chat ${chatId}):`, error);
      try {
        await ctx.reply(FALLBACK_ERROR_MESSAGE);
      } catch (replyError) {
        console.error(`Не удалось отправить сообщение об ошибке (chat ${chatId}):`, replyError);
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

  bot.on("voice", (ctx) =>
    respond(ctx, buildAudioRequest(ctx, ctx.message.voice, "audio/ogg", "[голосовое сообщение]")),
  );

  bot.on("audio", (ctx) =>
    respond(ctx, buildAudioRequest(ctx, ctx.message.audio, "audio/mpeg", "[аудиофайл]")),
  );

  // Подстраховка: логирует любые ошибки, которые могли ускользнуть из обработчиков выше
  // (например, сбой в самом Telegraf), чтобы процесс не падал молча.
  bot.catch((err, ctx) => {
    console.error(`Необработанная ошибка Telegraf (chat ${ctx.chat?.id}):`, err);
  });

  bot.launch();
  console.log("Family bot ishga tushdi.");
}

// Простой health-check эндпоинт — нужен облачным платформам (Railway, Render и т.п.),
// чтобы понимать, что процесс жив; сам бот работает через long polling, а не через HTTP.
// Держим его отдельно от статуса Telegram-токена специально: даже если бот не запустился
// из-за отсутствующей переменной окружения, порт остаётся открытым и деплой не падает.
const PORT = process.env.PORT || 3000;
http
  .createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(
      bot
        ? "family-bot ishlayapti"
        : `family-bot: Telegram-токен не найден (${TELEGRAM_TOKEN_ENV_VARS.join(", ")}), бот не запущен`,
    );
  })
  .listen(PORT, () => console.log(`Health-check server: port ${PORT}`));

process.once("SIGINT", () => bot?.stop("SIGINT"));
process.once("SIGTERM", () => bot?.stop("SIGTERM"));
