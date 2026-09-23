import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { Telegraf } from "telegraf";
import Groq from "groq-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Последний рубеж защиты: по умолчанию необработанный rejection/exception убивает весь
// процесс Node.js. Мы уже нашли один конкретный случай, где так и происходило (409 из
// bot.launch(), см. комментарий возле launchBotWithRetry), но лучше не полагаться на то,
// что мы предусмотрели вообще все такие места, — логируем и продолжаем работу, а не падаем.
process.on("unhandledRejection", (reason) => {
  logDetailedError("Необработанный отказ промиса (процесс продолжает работать)", reason);
});
process.on("uncaughtException", (error) => {
  logDetailedError("Необработанное исключение (процесс продолжает работать)", error);
});

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
// GROQ_API_KEY обязателен, GROQ_API_KEY_2 опционален. ВАЖНО: у Groq лимиты считаются
// на уровне организации/аккаунта, а не на ключ — второй ключ даёт реальный запас
// только если он от ДРУГОГО аккаунта Groq (другой email), а не просто второй ключ
// того же аккаунта (тот делил бы тот же лимит и ничего бы не добавил).
const GROQ_API_KEY_ENV_VARS = ["GROQ_API_KEY", "GROQ_API_KEY_2"];
const GROQ_API_KEYS = GROQ_API_KEY_ENV_VARS.map((name) => process.env[name]).filter(
  (value) => !!value,
);
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
// DATA_DIR указывает на каталог с постоянным хранилищем: локально — обычная папка ./data,
// на Railway — точка монтирования Volume (Settings → Volumes → Mount Path), например /data.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const STATS_FILE = path.join(DATA_DIR, "stats.json");
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
// каждая отсутствующая интеграция просто не активируется (см. bot = null / groqClients = []
// ниже), а health-check сервер в самом конце файла работает в любом случае.
if (!TELEGRAM_BOT_TOKEN) {
  console.warn(
    `Токен Telegram-бота не найден ни в одной из переменных окружения: ${TELEGRAM_TOKEN_ENV_VARS.join(", ")}. ` +
      "Telegram-бот не будет запущен, пока одна из них не будет задана.",
  );
} else if (telegramToken.name !== TELEGRAM_TOKEN_ENV_VARS[0]) {
  console.log(`Токен Telegram-бота взят из переменной ${telegramToken.name}.`);
}
if (GROQ_API_KEYS.length === 0) {
  console.warn(
    `Ни один ключ Groq не найден (проверены: ${GROQ_API_KEY_ENV_VARS.join(", ")}). ` +
      "Бот запустится, но на любой запрос будет отвечать сообщением об ошибке, пока хотя бы одна переменная не будет задана.",
  );
} else {
  console.log(
    `Groq API подключён (модель: ${GROQ_MODEL}, ключей: ${GROQ_API_KEYS.length}).`,
  );
}

const systemInstruction = fs.readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
const groqClients = GROQ_API_KEYS.map((apiKey) => new Groq({ apiKey }));
// Индекс ключа/клиента, который используется прямо сейчас — общий для всех чатов
// и переживает между запросами, чтобы не долбиться в уже исчерпанный ключ заново.
let currentGroqKeyIndex = 0;
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

// Простая статистика использования — сколько раз бот успешно ответил, по дням.
// Не хранит содержимое сообщений, только счётчики; количество уникальных чатов
// берётся напрямую из users при запросе /stats, отдельно не дублируется.
function loadStats() {
  if (!fs.existsSync(STATS_FILE)) return { total: 0, byDate: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(STATS_FILE, "utf-8"));
    return {
      total: typeof raw?.total === "number" ? raw.total : 0,
      byDate: raw?.byDate && typeof raw.byDate === "object" ? raw.byDate : {},
    };
  } catch (error) {
    console.error(`Не удалось прочитать ${STATS_FILE}, начинаем со счётчиков с нуля:`, error);
    return { total: 0, byDate: {} };
  }
}

const stats = loadStats();

function saveStats() {
  const tmpFile = `${STATS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(stats, null, 2), "utf-8");
  fs.renameSync(tmpFile, STATS_FILE);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function recordUsage() {
  stats.total += 1;
  const key = todayKey();
  stats.byDate[key] = (stats.byDate[key] ?? 0) + 1;
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

function isRetryableGroqError(error) {
  const status = error?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

// Пробует каждый настроенный ключ Groq по одному разу подряд, начиная с
// currentGroqKeyIndex, без задержки между ключами (при 429/5xx). currentGroqKeyIndex
// запоминается между вызовами, чтобы следующий запрос сразу начинал с рабочего ключа.
// Не-retryable ошибка (например, неверный ключ или неверная модель) бросается сразу —
// другой ключ её не исправит. Если отказали все настроенные ключи — бросает последнюю
// ошибку, дальше её подхватывает уже общий catch в respond() с вежливым ответом.
async function tryAllGroqKeysOnce(params, chatId) {
  const totalKeys = groqClients.length;
  let lastError;

  for (let keyAttempt = 0; keyAttempt < totalKeys; keyAttempt++) {
    const keyIndex = currentGroqKeyIndex;
    const client = groqClients[keyIndex];

    try {
      return await client.chat.completions.create(params);
    } catch (error) {
      lastError = error;
      logDetailedError(`Ошибка Groq API (chat ${chatId}, ключ #${keyIndex + 1}/${totalKeys})`, error);

      if (!isRetryableGroqError(error)) throw error;

      currentGroqKeyIndex = (keyIndex + 1) % totalKeys;
      if (keyAttempt < totalKeys - 1) {
        console.warn(
          `Ключ Groq #${keyIndex + 1}/${totalKeys} недоступен (429/5xx), переключаюсь на ключ ` +
            `#${currentGroqKeyIndex + 1}/${totalKeys}.`,
        );
      }
    }
  }

  throw lastError;
}

// Отправляет запрос модели вместе с историей чата в формате Groq/OpenAI (роли
// "system"/"user"/"assistant"). История пополняется только при успешном непустом
// ответе — если модель ничего не вернула или API упал, в файл ничего не пишется
// и предыдущая история не портится.
async function askTranslator(user, userText, chatId) {
  if (groqClients.length === 0) {
    throw new Error("Не задан ни один ключ Groq (GROQ_API_KEY / _2) — интеграция недоступна.");
  }

  const messages = [
    { role: "system", content: systemInstruction },
    ...user.history,
    { role: "user", content: userText },
  ];

  const response = await tryAllGroqKeysOnce(
    { model: GROQ_MODEL, messages, max_completion_tokens: 1024 },
    chatId,
  );

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

  recordUsage();

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
      saveStats();
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

  // Простой отчёт по использованию — сколько сообщений обработано всего, сегодня
  // и сколько разных чатов вообще писали боту. Доступен всем — тут только счётчики,
  // без содержимого переписки.
  bot.command("stats", async (ctx) => {
    const key = todayKey();
    const todayCount = stats.byDate[key] ?? 0;
    const totalChats = Object.keys(users).length;
    await ctx.reply(
      "📊 Статистика бота\n" +
        `Всего сообщений обработано: ${stats.total}\n` +
        `Сегодня (${key}): ${todayCount}\n` +
        `Уникальных чатов: ${totalChats}`,
    );
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

  // bot.launch() кидает исключение (например, 409 Conflict — другой инстанс уже
  // поллит этот же токен) прямо в свой промис, а bot.catch() выше на это НЕ подписан
  // (он ловит ошибки только из обработчиков обновлений, а не из самого цикла поллинга).
  // Без этой обёртки такая ошибка становится необработанным rejection'ом и убивает весь
  // процесс Node.js целиком — именно это и вызывало краш-луп при пересборках деплоя на
  // Railway. 409 почти всегда временный (старый инстанс ещё не отпустил соединение при
  // рестарте/редеплое) — поэтому пробуем несколько раз с паузой, а не падаем сразу.
  async function launchBotWithRetry(maxAttempts = 5, delayMs = 5000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await bot.launch();
        console.log("Family bot ishga tushdi.");
        return;
      } catch (error) {
        logDetailedError(`Не удалось запустить Telegram-поллинг (попытка ${attempt}/${maxAttempts})`, error);
        if (attempt === maxAttempts) {
          console.error(
            "Telegram-бот не запущен после нескольких попыток. Процесс продолжает работать " +
              "(health-check доступен), но сообщения обрабатываться не будут, пока проблема не исчезнет.",
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  launchBotWithRetry();
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
    if (groqClients.length === 0) {
      problems.push(`ни один ключ Groq не найден (${GROQ_API_KEY_ENV_VARS.join(", ")})`);
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(problems.length ? `family-bot: ${problems.join("; ")}` : "family-bot ishlayapti");
  })
  .listen(PORT, () => console.log(`Health-check server: port ${PORT}`));

process.once("SIGINT", () => bot?.stop("SIGINT"));
process.once("SIGTERM", () => bot?.stop("SIGTERM"));
