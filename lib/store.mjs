import fs from "fs";
import path from "path";

// Аккаунты пользователей Mini App: роль, трек, тариф, дневные лимиты, стрик и
// настройки напоминаний. Один JSON-файл рядом с историей бота (DATA_DIR), читается
// с диска один раз и дальше живёт в памяти. Состояние лежит на globalThis — модуль
// грузят и server.mjs (бот, напоминания, оплата), и бандл Next.js (API), и без этого
// у них были бы две расходящиеся копии, затирающие друг друга при сохранении.
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

export const ROLES = ["student", "tutor", "parent"];
export const TRACKS = ["spanish", "english", "art", "translate"];

function readNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Тарифы ATA Academy. ai: null — без дневного лимита.
// Free: 15 занятий и 2 разбора рисунков в день.
// Premium: занятия без лимита, 5 разборов рисунков, заморозка стрика, голос OpenAI.
// PREMIUM_DAILY_AI можно задать как аварийный потолок от злоупотреблений — по умолчанию его нет.
export const PLAN_LIMITS = {
  free: {
    ai: readNumberEnv("FREE_DAILY_AI", 15),
    art: readNumberEnv("FREE_DAILY_ART", 2),
    streakFreezes: 0,
  },
  premium: {
    ai: readNumberEnv("PREMIUM_DAILY_AI", null),
    art: readNumberEnv("PREMIUM_DAILY_ART", 5),
    streakFreezes: 1,
  },
};

function readListEnv(name) {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

// Роли доступа. Встроенные списки действуют всегда; переменные окружения их ДОПОЛНЯЮТ.
// Только @username или Telegram ID: имя в профиле Telegram может поставить себе кто угодно.
const BUILT_IN = {
  superAdmins: ["r_design_space"], // главный супер-админ: все заявки и управление
  admins: [],
  vips: ["nosoksosok1337", "boloyoungg"], // Атахан, Рамазан
  kids: ["nosoksosok1337"], // Атахан, 8 лет — детский режим Мартины
};

// Каждая роль читает несколько имён переменных — и множественное, и единственное число,
// чтобы опечатка в названии на хостинге не отключала роль молча.
const ROLE_ENV = {
  superAdmins: { usernames: ["SUPER_ADMIN", "SUPER_ADMINS", "SUPER_ADMIN_USERNAMES"], ids: ["SUPER_ADMIN_IDS"] },
  admins: { usernames: ["ADMIN_USERNAMES", "ADMIN_USERNAME"], ids: ["ADMIN_TELEGRAM_IDS"] },
  vips: { usernames: ["VIP_USERNAMES", "VIP_USERNAME"], ids: ["VIP_TELEGRAM_IDS"] },
  kids: { usernames: ["KIDS_USERNAMES", "KIDS_USERNAME"], ids: ["KIDS_TELEGRAM_IDS"] },
};

export function roleList(role) {
  const env = ROLE_ENV[role];
  return {
    usernames: [...new Set([...BUILT_IN[role], ...env.usernames.flatMap(readListEnv)])],
    ids: [...new Set(env.ids.flatMap(readListEnv))],
  };
}

function hasRole(account, role) {
  if (!account) return false;
  const { usernames, ids } = roleList(role);
  if (ids.includes(String(account.id))) return true;
  return !!account.username && usernames.includes(account.username.toLowerCase());
}

// Главный супер-админ (@r_design_space): получает заявки в Telegram, управляет всем.
export function isSuperAdmin(account) {
  return hasRole(account, "superAdmins");
}

// Админы школы: панель /admin, решения по заявкам, ручной Premium. Супер-админ — тоже админ.
export function isAdmin(account) {
  return isSuperAdmin(account) || hasRole(account, "admins");
}

// VIP (Атахан, Рамазан): Premium без оплаты и срока — уроки без лимита,
// 5 разборов рисунков в день — плюс персональный подбадривающий тон ассистента.
export function isVip(account) {
  return hasRole(account, "vips");
}

// Детский профиль (Атахан): Мартина говорит игрой и похвалой — без исправлений и правил.
export function isKid(account) {
  return hasRole(account, "kids");
}

// ── Закрытая школа ───────────────────────────────────────────────────────────
// Новый пользователь после онбординга подаёт заявку; ИИ-функции открываются после
// одобрения. VIP и админы проходят без заявки.
const REAPPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function accessStatus(account) {
  if (isVip(account) || isAdmin(account)) return "approved";
  return account?.access?.status ?? "none";
}

export function hasAccess(account) {
  return accessStatus(account) === "approved";
}

// Возвращает true, если заявка создана сейчас (тогда нужно уведомить супер-админа).
export function submitApplication(account, note) {
  const status = accessStatus(account);
  if (status === "approved" || status === "pending") return false;
  if (status === "rejected" && Date.now() - Date.parse(account.access.decidedAt) < REAPPLY_COOLDOWN_MS) return false;
  account.access = {
    status: "pending",
    requestedAt: new Date().toISOString(),
    note: typeof note === "string" ? note.replace(/\s+/g, " ").trim().slice(0, 300) : "",
    decidedAt: null,
    decidedBy: null,
  };
  scheduleSave();
  flushAccounts();
  return true;
}

export function canReapplyAt(account) {
  if (accessStatus(account) !== "rejected") return null;
  return new Date(Date.parse(account.access.decidedAt) + REAPPLY_COOLDOWN_MS).toISOString();
}

// decision: "approved" | "rejected". Возвращает аккаунт заявителя или null.
export function decideApplication(userId, decision, admin) {
  const account = getAccount(userId);
  if (!account || !["approved", "rejected"].includes(decision)) return null;
  account.access = {
    ...(account.access ?? { requestedAt: null, note: "" }),
    status: decision,
    decidedAt: new Date().toISOString(),
    decidedBy: admin ? displayName(admin) || admin.id : null,
  };
  scheduleSave();
  flushAccounts();
  return account;
}

// Куда слать заявки: все известные боту супер-админы. В личном чате chat_id = user_id,
// поэтому достаточно, чтобы супер-админ хотя бы раз открыл бота или приложение.
export function superAdminChatIds() {
  return listAccounts()
    .filter(isSuperAdmin)
    .map((account) => account.chatId ?? account.id);
}

// Имя для приветствий: имя из Telegram, иначе @username, иначе пусто.
export function displayName(account) {
  return account?.firstName?.trim() || account?.username || "";
}

const STATE_KEY = Symbol.for("ata.accountStore");

function getState() {
  if (!globalThis[STATE_KEY]) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let accounts = {};
    if (fs.existsSync(ACCOUNTS_FILE)) {
      try {
        accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf-8")) ?? {};
      } catch (error) {
        console.error(`Не удалось прочитать ${ACCOUNTS_FILE}, начинаем с пустого списка:`, error);
      }
    }
    globalThis[STATE_KEY] = { accounts, saveTimer: null };
  }
  return globalThis[STATE_KEY];
}

function flush() {
  const state = getState();
  state.saveTimer = null;
  const tmpFile = `${ACCOUNTS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state.accounts, null, 2), "utf-8");
  fs.renameSync(tmpFile, ACCOUNTS_FILE);
}

// Пачка изменений за 300 мс пишется на диск одним атомарным rename.
function scheduleSave() {
  const state = getState();
  if (!state.saveTimer) state.saveTimer = setTimeout(flush, 300);
}

export function flushAccounts() {
  const state = getState();
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    flush();
  }
}

// Дата в часовом поясе пользователя. tzOffsetMin — значение Date#getTimezoneOffset()
// с клиента (UTC минус локальное время, в минутах).
export function localDateKey(tzOffsetMin = 0, now = Date.now()) {
  return new Date(now - tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

function daysBetween(fromKey, toKey) {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / 86_400_000);
}

export function getAccount(userId) {
  return getState().accounts[String(userId)] ?? null;
}

export function listAccounts() {
  return Object.values(getState().accounts);
}

export function upsertAccount(telegramUser, chatId) {
  const state = getState();
  const id = String(telegramUser.id);
  const existing = state.accounts[id];
  const account = existing ?? {
    id,
    role: null,
    track: null,
    createdAt: new Date().toISOString(),
    premiumUntil: null,
    usage: { date: null, ai: 0, art: 0 },
    streak: { count: 0, lastActiveDate: null, lastFreezeDate: null },
    reminders: { enabled: true, hour: 19, tzOffsetMin: 0, lastSentDate: null },
  };
  // Имя обновляется при каждом входе: если пользователь сменил его в Telegram,
  // новое сразу появится в приветствиях, CRM и напоминаниях.
  account.firstName = telegramUser.first_name ?? account.firstName ?? "";
  account.lastName = telegramUser.last_name ?? account.lastName ?? "";
  account.username = telegramUser.username ?? account.username ?? null;
  account.languageCode = telegramUser.language_code ?? account.languageCode ?? null;
  if (chatId) account.chatId = String(chatId);
  state.accounts[id] = account;
  scheduleSave();
  return account;
}

export function updateProfile(userId, patch) {
  const account = getAccount(userId);
  if (!account) return null;
  if (ROLES.includes(patch.role)) account.role = patch.role;
  if (TRACKS.includes(patch.track)) account.track = patch.track;
  if (typeof patch.remindersEnabled === "boolean") account.reminders.enabled = patch.remindersEnabled;
  if (Number.isInteger(patch.reminderHour) && patch.reminderHour >= 0 && patch.reminderHour <= 23) {
    account.reminders.hour = patch.reminderHour;
  }
  if (Number.isInteger(patch.tzOffsetMin) && Math.abs(patch.tzOffsetMin) <= 14 * 60) {
    account.reminders.tzOffsetMin = patch.tzOffsetMin;
  }
  scheduleSave();
  return account;
}

function hasPaidPremium(account) {
  return !!account?.premiumUntil && Date.parse(account.premiumUntil) > Date.now();
}

// Premium-возможности: VIP, супер-админ (владелец школы) и оплатившие.
export function isPremium(account) {
  return isVip(account) || isSuperAdmin(account) || hasPaidPremium(account);
}

export function planOf(account) {
  return isPremium(account) ? "premium" : "free";
}

function todaysUsage(account) {
  const today = localDateKey(account.reminders.tzOffsetMin);
  if (account.usage.date !== today) account.usage = { date: today, ai: 0, art: 0 };
  return account.usage;
}

// Списывает одно действие из дневного лимита (kind: "ai" | "art"). Возвращает
// { ok: false } без списания, если лимит уже исчерпан.
export function consume(account, kind) {
  const usage = todaysUsage(account);
  const limit = PLAN_LIMITS[planOf(account)][kind];
  if (limit !== null && usage[kind] >= limit) return { ok: false, used: usage[kind], limit };
  usage[kind] += 1;
  scheduleSave();
  return { ok: true, used: usage[kind], limit };
}

// Возвращает списанное действие, если сам ИИ-запрос не удался — пользователь
// не должен платить лимитом за наш сбой.
export function refund(account, kind) {
  const usage = todaysUsage(account);
  usage[kind] = Math.max(0, usage[kind] - 1);
  scheduleSave();
}

// Засчитывает день в стрик — вызывается только после успешного ответа ИИ,
// чтобы сбой или ошибка не продлевали серию.
export function recordActivity(account) {
  touchStreak(account);
  scheduleSave();
}

// Стрик растёт на 1 за каждый день с хотя бы одним занятием. Premium раз в 7 дней
// может «заморозить» один пропущенный день — стрик не сгорает.
function touchStreak(account) {
  const today = localDateKey(account.reminders.tzOffsetMin);
  const streak = account.streak;
  if (streak.lastActiveDate === today) return;

  const gap = streak.lastActiveDate ? daysBetween(streak.lastActiveDate, today) : Infinity;
  const canFreeze =
    PLAN_LIMITS[planOf(account)].streakFreezes > 0 &&
    (!streak.lastFreezeDate || daysBetween(streak.lastFreezeDate, today) >= 7);

  if (gap === 1) {
    streak.count += 1;
  } else if (gap === 2 && canFreeze) {
    streak.count += 1;
    streak.lastFreezeDate = today;
  } else {
    streak.count = 1;
  }
  streak.lastActiveDate = today;
}

export function grantPremium(userId, days) {
  const account = getAccount(userId);
  if (!account) return null;
  const base = hasPaidPremium(account) ? Date.parse(account.premiumUntil) : Date.now();
  account.premiumUntil = new Date(base + days * 86_400_000).toISOString();
  // Оплата — пишем на диск сразу, а не через отложенное сохранение.
  scheduleSave();
  flushAccounts();
  return account;
}

export function markReminderSent(account, dateKey) {
  account.reminders.lastSentDate = dateKey;
  scheduleSave();
}

// То, что видит клиент: без chatId и прочих служебных полей.
export function publicAccount(account) {
  const plan = planOf(account);
  const usage = todaysUsage(account);
  const today = localDateKey(account.reminders.tzOffsetMin);
  const streakAlive =
    account.streak.lastActiveDate &&
    daysBetween(account.streak.lastActiveDate, today) <= (plan === "premium" ? 2 : 1);
  return {
    firstName: displayName(account),
    role: account.role,
    track: account.track,
    plan,
    vip: isVip(account),
    kid: isKid(account),
    admin: isAdmin(account),
    superAdmin: isSuperAdmin(account),
    access: accessStatus(account),
    reapplyAt: canReapplyAt(account),
    premiumUntil: hasPaidPremium(account) ? account.premiumUntil : null,
    usage: { ai: usage.ai, art: usage.art },
    limits: { ai: PLAN_LIMITS[plan].ai, art: PLAN_LIMITS[plan].art },
    streak: {
      count: streakAlive ? account.streak.count : 0,
      activeToday: account.streak.lastActiveDate === today,
    },
    reminders: { enabled: account.reminders.enabled, hour: account.reminders.hour },
  };
}

// Для модулей, которые сами меняют вложенные данные аккаунта (CRM).
export function markDirty() {
  scheduleSave();
}

export function revokePremium(userId) {
  const account = getAccount(userId);
  if (!account) return null;
  account.premiumUntil = null;
  scheduleSave();
  flushAccounts();
  return account;
}

// Сводка для админа CRM: все пользователи без служебных полей (chatId не отдаём).
export function adminOverview() {
  const accounts = listAccounts();
  const rows = accounts
    .map((account) => {
      const usage = todaysUsage(account);
      const today = localDateKey(account.reminders.tzOffsetMin);
      return {
        id: account.id,
        name: displayName(account),
        lastName: account.lastName ?? "",
        username: account.username ?? null,
        role: account.role,
        track: account.track,
        plan: planOf(account),
        vip: isVip(account),
        admin: isAdmin(account),
        access: accessStatus(account),
        requestedAt: account.access?.requestedAt ?? null,
        note: account.access?.note ?? "",
        decidedBy: account.access?.decidedBy ?? null,
        premiumUntil: hasPaidPremium(account) ? account.premiumUntil : null,
        usage: { ai: usage.ai, art: usage.art },
        streak: account.streak.count,
        activeToday: account.streak.lastActiveDate === today,
        lastActiveDate: account.streak.lastActiveDate,
        students: account.crm?.students?.length ?? 0,
        createdAt: account.createdAt,
      };
    })
    .sort((a, b) => (b.lastActiveDate ?? "").localeCompare(a.lastActiveDate ?? "") || b.createdAt.localeCompare(a.createdAt));

  return {
    totals: {
      pending: rows.filter((row) => row.access === "pending").length,
      users: rows.length,
      activeToday: rows.filter((row) => row.activeToday).length,
      premium: rows.filter((row) => row.plan === "premium" && !row.vip && !row.admin).length,
      vip: rows.filter((row) => row.vip).length,
      lessonsToday: rows.reduce((sum, row) => sum + row.usage.ai, 0),
      artToday: rows.reduce((sum, row) => sum + row.usage.art, 0),
    },
    users: rows,
  };
}
