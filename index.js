import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { Telegraf } from "telegraf";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
const USERS_FILE = path.join(__dirname, "data", "users.json");
const SYSTEM_PROMPT_FILE = path.join(__dirname, "system_prompt.md");
const MAX_HISTORY_MESSAGES = 30;
const SAVE_NAME_TAG = /\[\[SAVE_NAME:\s*([^|]+)\|(ХОН|БЕК|ЖОН)\s*\]\]\s*$/u;

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN топилмади — .env файлини текширинг.");
}

const basePrompt = fs.readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
const anthropic = new Anthropic();
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

function getUser(users, chatId) {
  if (!users[chatId]) {
    users[chatId] = { name: null, suffix: null, history: [] };
  }
  return users[chatId];
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

async function askProfessor(user, userText) {
  const system = buildSystemPrompt(user);
  const messages = [
    ...user.history,
    { role: "user", content: userText },
  ];

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system,
    messages,
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const rawText = textBlock?.text ?? "";
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
  const users = loadUsers();
  const chatId = String(ctx.chat.id);
  const user = getUser(users, chatId);
  user.history = [];

  try {
    const reply = await askProfessor(user, "/start");
    await ctx.reply(reply);
  } finally {
    saveUsers(users);
  }
});

bot.command("reset", async (ctx) => {
  const users = loadUsers();
  const chatId = String(ctx.chat.id);
  users[chatId] = { name: null, suffix: null, history: [] };
  saveUsers(users);
  await ctx.reply("Хотирам тозаланди. Қайтадан танишайлик — Ассалому алайкум!");
});

bot.on("text", async (ctx) => {
  const users = loadUsers();
  const chatId = String(ctx.chat.id);
  const user = getUser(users, chatId);

  await ctx.sendChatAction("typing");

  try {
    const reply = await askProfessor(user, ctx.message.text);
    await ctx.reply(reply);
  } catch (error) {
    console.error("Claude API xatosi:", error);
    await ctx.reply(
      "Кечирасиз, фарзандим, ҳозир фикримни жамлай олмадим. Бир оздан сўнг қайта ёзинг.",
    );
  } finally {
    saveUsers(users);
  }
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
