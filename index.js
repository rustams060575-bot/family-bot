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
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
// DATA_DIR указывает на каталог с постоянным хранилищем: локально — обычная папка ./data,
// на Railway — точка монтирования Volume (Settings → Volumes → Mount Path), например /data.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SYSTEM_PROMPT_FILE = path.join(__dirname, "system_prompt.md");
const MAX_HISTORY_MESSAGES = 30;
const SAVE_NAME_TAG = /\[\[SAVE_NAME:\s*([^|]+)\|(ХОН|БЕК|ЖОН)\s*\]\]\s*$/u;

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN топилмади — .env файлини текширинг.");
}
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY топилмади — .env файлини текширинг.");
}

const basePrompt = fs.readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  } catch (error) {
    console.error(`${USERS_FILE} ўқилмади, бўш хотирадан бошланяпти:`, error);
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
    users[chatId] = { name: null, suffix: null, history: [] };
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

function buildSystemPrompt(user) {
  if (!user.name || !user.suffix) return basePrompt;
  return `${basePrompt}\n\n---\n\n# ИЗВЕСТНО О СОБЕСЕДНИКЕ\n\nИмя: ${user.name}\nСуффикс обращения: -${user.suffix.toLowerCase()}\n\nОбращайся к собеседнику как "${user.name}-${user.suffix.toLowerCase()}", знакомство уже состоялось — не спрашивай имя заново.`;
}

function extractSaveTag(text) {
  const match = text.match(SAVE_NAME_TAG);
  if (!match) return { cleanText: text, saved: null };
  const name = match[1].trim();
  const suffix = match[2].trim();
  const cleanText = text.slice(0, match.index).trimEnd();
  return { cleanText, saved: { name, suffix } };
}

// Gemini различает роли "user" и "model" (а не "assistant", как у Anthropic) —
// на диске история хранится в провайдеро-независимом виде и мапится сюда при вызове.
function toGeminiRole(role) {
  return role === "assistant" ? "model" : "user";
}

async function askProfessor(user, userText) {
  const system = buildSystemPrompt(user);
  const contents = [
    ...user.history.map((turn) => ({
      role: toGeminiRole(turn.role),
      parts: [{ text: turn.content }],
    })),
    { role: "user", parts: [{ text: userText }] },
  ];

  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    config: {
      systemInstruction: system,
      maxOutputTokens: 1024,
    },
    contents,
  });

  const rawText = response.text ?? "";
  const { cleanText, saved } = extractSaveTag(rawText);

  if (saved) {
    user.name = saved.name;
    user.suffix = saved.suffix;
  }

  user.history.push({ role: "user", content: userText });
  user.history.push({ role: "assistant", content: rawText });
  if (user.history.length > MAX_HISTORY_MESSAGES) {
    user.history = user.history.slice(-MAX_HISTORY_MESSAGES);
  }

  return cleanText;
}

bot.start(async (ctx) => {
  const chatId = String(ctx.chat.id);

  await enqueue(chatId, async () => {
    const user = getUser(chatId);
    user.history = [];

    try {
      const reply = await askProfessor(user, "/start");
      await ctx.reply(reply);
    } finally {
      saveUsers();
    }
  });
});

bot.command("reset", async (ctx) => {
  const chatId = String(ctx.chat.id);

  await enqueue(chatId, async () => {
    users[chatId] = { name: null, suffix: null, history: [] };
    saveUsers();
    await ctx.reply("Хотирам тозаланди. Қайтадан танишайлик — Ассалому алайкум!");
  });
});

bot.on("text", async (ctx) => {
  const chatId = String(ctx.chat.id);

  await enqueue(chatId, async () => {
    const user = getUser(chatId);
    await ctx.sendChatAction("typing");

    try {
      const reply = await askProfessor(user, ctx.message.text);
      await ctx.reply(reply);
    } catch (error) {
      console.error("Gemini API xatosi:", error);
      await ctx.reply(
        "Кечирасиз, фарзандим, ҳозир фикримни жамлай олмадим. Бир оздан сўнг қайта ёзинг.",
      );
    } finally {
      saveUsers();
    }
  });
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
