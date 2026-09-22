import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { Telegraf } from "telegraf";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
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
  "Извините, сейчас не получилось получить ответ — произошёл сбой при обращении к ИИ. Пожалуйста, попробуйте написать ещё раз через минуту.";

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN не найден — проверьте .env.");
}
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY не найден — проверьте .env.");
}

const systemInstruction = fs.readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

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

// Отправляет сообщение модели вместе с историей чата, строго чередующейся ролями
// user/model, как того требует Gemini API. История пополняется только при успешном
// непустом ответе — если модель ничего не вернула или API упал, в файл ничего
// не пишется и предыдущая история не портится.
async function askTeacher(user, userText) {
  const contents = [...user.history, { role: "user", parts: [{ text: userText }] }];

  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    config: {
      systemInstruction,
      maxOutputTokens: 1024,
    },
    contents,
  });

  const replyText = response.text?.trim();
  if (!replyText) {
    const blockReason = response.promptFeedback?.blockReason;
    throw new Error(
      blockReason
        ? `Gemini не вернул текст ответа (blockReason: ${blockReason})`
        : "Gemini вернул пустой ответ",
    );
  }

  user.history.push({ role: "user", parts: [{ text: userText }] });
  user.history.push({ role: "model", parts: [{ text: replyText }] });
  if (user.history.length > MAX_HISTORY_MESSAGES) {
    user.history = user.history.slice(-MAX_HISTORY_MESSAGES);
  }

  return replyText;
}

// Общий обработчик для /start и обычных сообщений: очередь на чат, индикатор
// набора текста (не критичен — его сбой не должен мешать получить сам ответ),
// вызов модели и сохранение истории. Ошибки любого рода логируются в консоль
// и превращаются в одно понятное сообщение пользователю — без нишевых заглушек.
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
      const reply = await askTeacher(user, userText);
      await ctx.reply(reply);
    } catch (error) {
      console.error(`Ошибка при обращении к Gemini API (chat ${chatId}):`, error);
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
    await ctx.reply("Память очищена, начинаем с чистого листа. Чем помочь с языком?");
  });
});

bot.on("text", (ctx) => respond(ctx, ctx.message.text));

// Подстраховка: логирует любые ошибки, которые могли ускользнуть из обработчиков выше
// (например, сбой в самом Telegraf), чтобы процесс не падал молча.
bot.catch((err, ctx) => {
  console.error(`Необработанная ошибка Telegraf (chat ${ctx.chat?.id}):`, err);
});

bot.launch();
console.log("Family bot ishga tushdi.");

// Простой health-check эндпоинт — нужен облачным платформам (Railway, Render и т.п.),
// чтобы понимать, что процесс жив; сам бот работает через long polling, а не через HTTP.
const PORT = process.env.PORT || 3000;
http
  .createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("family-bot ishlayapti");
  })
  .listen(PORT, () => console.log(`Health-check server: port ${PORT}`));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
