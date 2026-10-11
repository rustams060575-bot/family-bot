import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { groqChat, logDetailedError } from "../lib/groq.mjs";
import {
  DATA_DIR,
  accessStatus,
  decideApplication,
  displayName,
  getAccount,
  grantPremium,
  isAdmin,
  isVip,
  submitApplication,
  upsertAccount,
} from "../lib/store.mjs";
import { personaLine } from "../lib/prompts.mjs";
import { applicationText, notifyDecision, notifyNewApplication } from "../lib/notify.mjs";
import { telegramBotToken } from "../lib/telegram-auth.mjs";
import { startReminders } from "./reminders.mjs";
import {
  ABOUT_ACTION,
  MAIN_MENU,
  MENU_OPEN,
  MENU_PROFILE,
  aboutText,
  openKeyboard,
  profileKeyboard,
  profileText,
  sendWelcome,
} from "./welcome.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Telegram-бот ATA Academy (наставник Мартина): точка входа в Mini App (кнопка на /start, кнопка
// меню и /app), заявки в закрытую школу, оплата Premium в Telegram Stars, ежедневные
// напоминания и ИИ-ассистент в чате для участников школы.
const USERS_FILE = path.join(DATA_DIR, "users.json");
const STATS_FILE = path.join(DATA_DIR, "stats.json");
const SYSTEM_PROMPT_FILE = path.join(__dirname, "system_prompt.md");
// Пара (запрос + ответ) — один "ход"; храним последние 15 ходов на чат.
const MAX_HISTORY_MESSAGES = 30;
const FALLBACK_ERROR_MESSAGE =
  "Извините, сейчас не получилось получить ответ — произошёл сбой при обращении к ИИ. Пожалуйста, попробуйте отправить запрос ещё раз через минуту.";
// Голосовые в чате бота не обрабатываются — голосовой репетитор живёт в Mini App.
const VOICE_STUB_MESSAGE =
  "В чате я принимаю только текст. Голосовые занятия с репетитором — в приложении ATA Academy: кнопка «Открыть» ниже.";

const systemInstruction = fs.readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
// Версия личности бота. Истории, накопленные под другой версией (например, старым
// «узбекским переводчиком»), сбрасываются — иначе модель продолжает их стиль.
const PERSONA_VERSION = "martina-1";

// URL Mini App: явно через WEBAPP_URL, иначе публичный домен Railway (появляется после
// Settings → Networking → Generate Domain). Telegram принимает в web_app только https —
// невалидный адрес ломал бы всё сообщение с кнопкой, поэтому адрес нормализуем.
export function webAppUrl() {
  const raw = (process.env.WEBAPP_URL || process.env.RAILWAY_PUBLIC_DOMAIN || "").trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = withScheme.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    console.warn(`WEBAPP_URL/RAILWAY_PUBLIC_DOMAIN не похож на адрес: ${JSON.stringify(raw)}`);
    return null;
  }
}

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

  // Нет версии или другая версия личности — история от прежнего бота, начинаем заново.
  if (raw?.personaVersion !== PERSONA_VERSION) return { history: [], personaVersion: PERSONA_VERSION };
  return { history, personaVersion: PERSONA_VERSION };
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
    users[chatId] = { history: [], personaVersion: PERSONA_VERSION };
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

// Отправляет запрос модели вместе с историей чата. История пополняется только при
// успешном непустом ответе — если модель ничего не вернула или API упал, в файл ничего
// не пишется и предыдущая история не портится.
async function askAssistant(user, userText, chatId, account) {
  // Имя из Telegram и, для VIP, подбадривающий тон — как в Mini App.
  const persona = personaLine({ name: displayName(account), vip: isVip(account) });
  const system = persona
    ? `${systemInstruction}

${persona}`
    : systemInstruction;
  const replyText = await groqChat(
    [{ role: "system", content: system }, ...user.history, { role: "user", content: userText }],
    `chat ${chatId}`,
  );

  user.history.push({ role: "user", content: userText });
  user.history.push({ role: "assistant", content: replyText });
  if (user.history.length > MAX_HISTORY_MESSAGES) {
    user.history = user.history.slice(-MAX_HISTORY_MESSAGES);
  }

  recordUsage();

  return replyText;
}

const APP_NOT_PUBLISHED = "Приложение ATA Academy ещё не опубликовано — администратор скоро это исправит.";

function joinText(account) {
  const status = accessStatus(account);
  if (status === "pending") return "Ваша заявка в ATA Academy на рассмотрении — ответ придёт сюда, в этот чат.";
  if (status === "rejected") return "Заявка пока не одобрена. Повторно её можно отправить в приложении через сутки.";
  return "ATA Academy — закрытая школа. Чтобы общаться с Мартиной, откройте приложение и отправьте заявку.";
}

function openAppKeyboard() {
  const url = webAppUrl();
  return url ? Markup.inlineKeyboard([Markup.button.webApp("Открыть ATA Academy", url)]) : undefined;
}

// Общий обработчик для текста: очередь на чат, индикатор набора текста (не критичен —
// его сбой не должен мешать получить сам ответ), вызов модели и сохранение истории.
// Любая ошибка логируется в консоль и превращается в одно понятное сообщение
// пользователю, без падения чата.
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
      const reply = await askAssistant(user, userText, chatId, getAccount(ctx.from.id));
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

// Запоминает chatId, чтобы напоминания приходили в личный чат с ботом.
function rememberAccount(ctx) {
  if (ctx.from && ctx.chat?.type === "private") upsertAccount(ctx.from, ctx.chat.id);
}

function registerHandlers(bot) {
  bot.use((ctx, next) => {
    rememberAccount(ctx);
    return next();
  });

  // /start — всегда с кнопкой запуска Mini App (web_app). Без URL кнопку отправить
  // нельзя: тогда честно говорим об этом, а причина видна в логе запуска.
  bot.start(async (ctx) => {
    const chatId = String(ctx.chat.id);
    users[chatId] = { history: [], personaVersion: PERSONA_VERSION };
    saveUsers();
    // Новый пользователь: заявка в школу подаётся сразу и уходит супер-админу.
    const account = getAccount(ctx.from.id);
    if (account && accessStatus(account) === "none" && submitApplication(account)) {
      await notifyNewApplication(account);
    }
    // Красивый вход: баннер, описание, инлайн-кнопки и постоянное нижнее меню.
    await sendWelcome(ctx, getAccount(ctx.from.id), webAppUrl());
  });

  bot.action(ABOUT_ACTION, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply(aboutText(), { parse_mode: "HTML", ...openKeyboard(webAppUrl()) });
  });

  // Нижнее меню. Регистрируется до общего обработчика текста, чтобы кнопки не уходили в ИИ.
  bot.hears(MENU_OPEN, (ctx) =>
    ctx.reply(webAppUrl() ? "Открываю ATA Academy — выберите, с чего начнём:" : APP_NOT_PUBLISHED, {
      ...openKeyboard(webAppUrl()),
    }),
  );
  bot.hears(MENU_PROFILE, (ctx) =>
    ctx.reply(profileText(getAccount(ctx.from.id)), { parse_mode: "HTML", ...profileKeyboard(webAppUrl()) }),
  );

  bot.command("app", (ctx) => ctx.reply(webAppUrl() ? "ATA Academy:" : APP_NOT_PUBLISHED, openKeyboard(webAppUrl())));
  bot.command("menu", (ctx) => ctx.reply("Меню — внизу 👇", MAIN_MENU));

  // Telegram ID нужен для VIP-списка (VIP_TELEGRAM_IDS) — его не видно в интерфейсе Telegram.
  bot.command("myid", (ctx) =>
    ctx.reply(
      `Ваш Telegram ID: ${ctx.from.id}${
        ctx.from.username
          ? `
Username: @${ctx.from.username}`
          : ""
      }`,
    ),
  );

  bot.command("reset", async (ctx) => {
    const chatId = String(ctx.chat.id);
    await enqueue(chatId, async () => {
      users[chatId] = { history: [], personaVersion: PERSONA_VERSION };
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

  // Оплата Premium в Telegram Stars. pre_checkout_query нужно подтвердить за 10 секунд;
  // доступ выдаётся только по successful_payment — это подтверждение от самого Telegram.
  bot.on("pre_checkout_query", async (ctx) => {
    const payload = ctx.preCheckoutQuery.invoice_payload ?? "";
    const valid = payload.startsWith(`premium:${ctx.from.id}:`);
    await ctx.answerPreCheckoutQuery(valid, valid ? undefined : "Счёт устарел — откройте оплату заново.");
  });

  bot.on(message("successful_payment"), async (ctx) => {
    const payment = ctx.message.successful_payment;
    const [, userId, days] = payment.invoice_payload.split(":");
    upsertAccount(ctx.from, ctx.chat.id);
    const account = grantPremium(userId, Number(days) || 30);
    console.log(
      `Оплата Premium: user ${userId}, ${payment.total_amount} ${payment.currency}, ` +
        `charge ${payment.telegram_payment_charge_id}, до ${account?.premiumUntil}.`,
    );
    const until = account?.premiumUntil ? new Date(account.premiumUntil).toLocaleDateString("ru-RU") : "";
    await ctx.reply(`Premium активен${until ? ` до ${until}` : ""}. Спасибо, что вы с ATA Academy.`, openAppKeyboard());
  });

  // Закрытая школа: решение по заявке кнопкой прямо из уведомления. Права проверяются
  // по нажавшему (username/ID из списка админов), а не по тому, кому пришло сообщение.
  bot.action(/^acc:(approved|rejected):(\d+)$/, async (ctx) => {
    const admin = upsertAccount(ctx.from);
    if (!isAdmin(admin)) {
      await ctx.answerCbQuery("Решать по заявкам может только администратор школы.", { show_alert: true });
      return;
    }
    const [, decision, userId] = ctx.match;
    const applicant = getAccount(userId);
    if (!applicant) {
      await ctx.answerCbQuery("Заявитель не найден.");
      return;
    }
    if (applicant.access?.status === decision) {
      await ctx.answerCbQuery("Это решение уже принято.");
      return;
    }
    const decided = decideApplication(userId, decision, admin);
    await notifyDecision(decided);
    await ctx.answerCbQuery(decision === "approved" ? "Одобрено, VIP-доступ выдан" : "Отклонено");
    try {
      await ctx.editMessageText(
        `${applicationText(decided)}\n\n${decision === "approved" ? "✅ Одобрено · VIP-доступ выдан" : "✕ Отклонено"} — ` +
          (admin.username ? `@${admin.username}` : admin.firstName),
      );
    } catch {
      // сообщение могли уже отредактировать с другого устройства
    }
  });

  // Закрытая школа: ИИ в чате — для участников (одобренная заявка, VIP, админы).
  // Остальным — приглашение подать заявку в приложении, без обращения к ИИ.
  bot.on(message("text"), (ctx) => {
    const account = getAccount(ctx.from.id);
    if (accessStatus(account) !== "approved") return ctx.reply(joinText(account), openAppKeyboard());
    return respond(ctx, ctx.message.text);
  });

  // Голосовые и аудиосообщения в чате не обрабатываются — заглушка отвечает сразу,
  // без обращения к API и без очереди/истории.
  bot.on([message("voice"), message("audio")], (ctx) => ctx.reply(VOICE_STUB_MESSAGE, openAppKeyboard()));

  // Подстраховка: логирует любые ошибки, которые могли ускользнуть из обработчиков выше
  // (например, сбой в самом Telegraf), чтобы процесс не падал молча.
  bot.catch((err, ctx) => {
    logDetailedError(`Необработанная ошибка Telegraf (chat ${ctx.chat?.id})`, err);
  });
}

// Кнопка меню чата открывает Mini App — главный вход для новых пользователей.
async function configureMenuButton(bot) {
  const url = webAppUrl();
  if (!url) {
    console.warn("WEBAPP_URL / RAILWAY_PUBLIC_DOMAIN не заданы — кнопка Mini App в меню бота не настроена.");
    return;
  }
  try {
    await bot.telegram.setChatMenuButton({ menuButton: { type: "web_app", text: "ATA Academy", web_app: { url } } });
    await bot.telegram.setMyCommands([
      { command: "start", description: "Главное меню ATA Academy" },
      { command: "app", description: "Открыть ATA Academy" },
      { command: "reset", description: "Очистить историю переводчика" },
      { command: "stats", description: "Статистика бота" },
      { command: "myid", description: "Мой Telegram ID" },
    ]);
  } catch (error) {
    logDetailedError("Не удалось настроить кнопку меню бота", error);
  }
}

// bot.launch() кидает исключение (например, 409 Conflict — другой инстанс уже
// поллит этот же токен) прямо в свой промис, а bot.catch() выше на это НЕ подписан
// (он ловит ошибки только из обработчиков обновлений, а не из самого цикла поллинга).
// Без этой обёртки такая ошибка становится необработанным rejection'ом и убивает весь
// процесс Node.js целиком — именно это и вызывало краш-луп при пересборках деплоя на
// Railway. 409 почти всегда временный (старый инстанс ещё не отпустил соединение при
// рестарте/редеплое) — поэтому пробуем несколько раз с паузой, а не падаем сразу.
async function launchBotWithRetry(bot, maxAttempts = 5, delayMs = 5000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // launch() резолвится только при остановке поллинга, поэтому не ждём его,
      // а ловим ошибку старта через onLaunch-колбэк Telegraf.
      await new Promise((resolve, reject) => {
        bot.launch({ allowedUpdates: ["message", "pre_checkout_query", "callback_query"] }, resolve).catch(reject);
      });
      console.log("ATA Academy bot ishga tushdi.");
      return true;
    } catch (error) {
      logDetailedError(`Не удалось запустить Telegram-поллинг (попытка ${attempt}/${maxAttempts})`, error);
      if (attempt === maxAttempts) {
        console.error(
          "Telegram-бот не запущен после нескольких попыток. Процесс продолжает работать " +
            "(health-check доступен), но сообщения обрабатываться не будут, пока проблема не исчезнет.",
        );
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

let botIdentity = null;

export function getBotIdentity() {
  return botIdentity;
}

// Бот со всеми обработчиками, но без запуска поллинга (удобно и для проверок).
export function createBot(token) {
  const bot = new Telegraf(token);
  registerHandlers(bot);
  return bot;
}

export function startBot() {
  const token = telegramBotToken();
  if (!token) return null;

  const bot = createBot(token);
  launchBotWithRetry(bot).then((launched) => {
    if (!launched) return;
    // Какой бот реально подключён этим токеном и куда ведёт кнопка — первое, что
    // стоит проверить в логах Railway, если бот ведёт себя «по-старому».
    botIdentity = bot.botInfo ? `@${bot.botInfo.username} (id ${bot.botInfo.id}, «${bot.botInfo.first_name}»)` : null;
    console.log(`Telegram-токен подключён к боту ${botIdentity ?? "(неизвестно)"}.`);
    console.log(
      `Mini App URL для кнопок: ${webAppUrl() ?? "НЕ ЗАДАН — задайте WEBAPP_URL или Generate Domain в Railway"}.`,
    );
    configureMenuButton(bot);
    startReminders(bot, openAppKeyboard);
  });
  return bot;
}
