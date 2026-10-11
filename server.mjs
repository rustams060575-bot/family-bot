import http from "http";
import "dotenv/config";
import next from "next";
import { getBotIdentity, startBot, webAppUrl } from "./bot/telegram-bot.mjs";
import { GROQ_API_KEY_ENV_VARS, GROQ_MODEL, groqKeyCount, logDetailedError } from "./lib/groq.mjs";
import { flushAccounts } from "./lib/store.mjs";
import { visionChain } from "./lib/ai.mjs";
import { telegramBotToken } from "./lib/telegram-auth.mjs";

// Один процесс — один сервис на Railway: Next.js (Mini App + API) и Telegram-бот
// (long polling, оплата, напоминания) делят хранилище в памяти и пул ключей Groq.

// Последний рубеж защиты: по умолчанию необработанный rejection/exception убивает весь
// процесс Node.js. Логируем и продолжаем работу, а не падаем.
process.on("unhandledRejection", (reason) => {
  logDetailedError("Необработанный отказ промиса (процесс продолжает работать)", reason);
});
process.on("uncaughtException", (error) => {
  logDetailedError("Необработанное исключение (процесс продолжает работать)", error);
});

// Эти значения не секретны (Railway сам их проставляет) — печатаем открыто, чтобы
// понять, какой именно код реально запущен.
console.log(
  `[env-диагностика] Railway git: sha=${process.env.RAILWAY_GIT_COMMIT_SHA ?? "нет"}, ` +
    `branch=${process.env.RAILWAY_GIT_BRANCH ?? "нет"}, ` +
    `message=${JSON.stringify(process.env.RAILWAY_GIT_COMMIT_MESSAGE ?? null)}.`,
);

const dev = process.env.NODE_ENV !== "production";
const PORT = Number(process.env.PORT) || 3000;

// Намеренно нигде нет throw за отсутствующие ключи: жёсткий крах на старте означает
// краш-луп деплоя. Каждая отсутствующая интеграция просто не активируется, а сервер
// и /healthz работают в любом случае.
function configurationProblems() {
  const problems = [];
  if (!telegramBotToken()) problems.push("Telegram-токен не найден (TELEGRAM_BOT_TOKEN, BOT_TOKEN)");
  if (groqKeyCount() === 0) problems.push(`ни один ключ Groq не найден (${GROQ_API_KEY_ENV_VARS.join(", ")})`);
  if (!webAppUrl()) problems.push("нет адреса Mini App (WEBAPP_URL или публичный домен Railway) — кнопка запуска не отправляется");
  // Без Volume диск контейнера очищается при каждом деплое: профили, заявки и стрики теряются
  // (Mini App восстановит роль и трек из памяти устройства, но одобрение заявки — нет).
  if (process.env.RAILWAY_ENVIRONMENT && !process.env.DATA_DIR) {
    problems.push("DATA_DIR не задан — без Railway Volume профили и заявки стираются при каждом деплое");
  }
  if (!process.env.GEMINI_API_KEY) problems.push("GEMINI_API_KEY не задан — разбор рисунков идёт только через Groq Vision");
  return problems;
}

for (const problem of configurationProblems()) console.warn(`[конфигурация] ${problem}`);
if (groqKeyCount() > 0) console.log(`Groq API подключён (модель: ${GROQ_MODEL}, ключей: ${groqKeyCount()}).`);

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

http
  .createServer((req, res) => {
    if (req.url === "/healthz") {
      const problems = configurationProblems();
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      // Не секреты: публичный @username бота и адрес приложения — для быстрой проверки,
      // что токен принадлежит нужному боту, а кнопка ведёт куда нужно.
      const info = [
        `бот: ${getBotIdentity() ?? (telegramBotToken() ? "запускается или токен не принят Telegram" : "нет токена")}`,
        `Mini App: ${webAppUrl() ?? "не задан"}`,
        `Vision: ${visionChain()}`,
      ];
      res.end([problems.length ? `ata-academy: ${problems.join("; ")}` : "ata-academy ishlayapti", ...info].join("\n"));
      return;
    }
    handle(req, res);
  })
  .listen(PORT, () => console.log(`ATA Academy: http://localhost:${PORT} (${dev ? "dev" : "production"})`));

const bot = startBot();

function shutdown(signal) {
  flushAccounts();
  try {
    bot?.stop(signal);
  } catch {
    // поллинг так и не запустился — останавливать нечего
  }
  process.exit(0);
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
