import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Markup } from "telegraf";
import { accessStatus, displayName, publicAccount } from "../lib/store.mjs";

// «Вход» в ATA Academy: приветственная карточка с баннером, инлайн-кнопки запуска,
// «О нашей Академии» и постоянное нижнее меню. Тексты — в HTML-разметке Telegram.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WELCOME_IMAGE = path.join(__dirname, "assets", "welcome.jpg");

export const MENU_OPEN = "🎓 Открыть Академию";
export const MENU_PROFILE = "👤 Мой Профиль";
export const ABOUT_ACTION = "about";

const ROLE_TITLE = { student: "Ученик", tutor: "Репетитор", parent: "Родитель" };
const TRACK_TITLE = {
  spanish: "ATA Spanish",
  english: "ATA English",
  german: "ATA Deutsch",
  art: "ATA Kids Art",
  translate: "ATA Translate",
};
const ACCESS_TITLE = {
  approved: "открыт",
  pending: "заявка на рассмотрении",
  rejected: "заявка не одобрена",
  none: "нужна заявка в приложении",
};

const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Баннер: WELCOME_IMAGE_URL (если задан) или файл bot/assets/welcome.jpg.
function welcomePhoto() {
  const url = process.env.WELCOME_IMAGE_URL?.trim();
  if (url) return url;
  return fs.existsSync(WELCOME_IMAGE) ? { source: fs.createReadStream(WELCOME_IMAGE) } : null;
}

export function welcomeCaption(account, appPublished) {
  const name = displayName(account);
  const approved = accessStatus(account) === "approved";
  const lines = [
    "🏛 <b>Добро пожаловать в ATA Academy</b>",
    "",
    `${name ? `Привет, ${escapeHtml(name)}! ` : "Привет! "}Я Мартина — ваш личный наставник. Занимаемся легко, по 10–15 минут в день.`,
    "",
    "<b>Что вас ждёт</b>",
    "🇪🇸 Испанский и 🇬🇧 английский — живые занятия голосом",
    "🎨 Kids Art — Мартина разберёт рисунок по фото",
    "♟️ Шахматы с Лео — задачка дня, уроки и логика",
    "🌐 Переводчик — узбекский, русский, испанский, английский",
    "",
    "<b>Как начать</b>",
    "1. Нажмите «🚀 Запустить ATA Academy»",
    approved
      ? "2. Выберите занятие — я запомню, где вы остановились"
      : "2. Ваша заявка уже отправлена — ожидайте подтверждения R Design Space",
    approved
      ? "3. Возвращайтесь каждый день — серия занятий растёт"
      : "3. Как только доступ одобрят, сообщение придёт сюда",
  ];
  if (!appPublished) lines.push("", "<i>Приложение ещё не опубликовано — администратор скоро это исправит.</i>");
  return lines.join("\n");
}

export function aboutText() {
  return [
    "ℹ️ <b>О нашей Академии</b>",
    "",
    "ATA Academy — закрытая семейная онлайн-школа в Telegram. Каждое занятие ведёт Мартина — ИИ-наставник с мягким, бережным подходом.",
    "",
    "<b>Направления</b>",
    "• <b>ATA Spanish</b> — срез знаний, грамматика, интенсивы",
    "• <b>ATA English</b> — разговор, адаптация, идиомы",
    "• <b>ATA Deutsch</b> — немецкий A2–B2: срез знаний, уроки дня, разговор с Мартиной",
    "• <b>ATA Kids Art</b> — разбор детских рисунков и новые задания",
    "• <b>Шахматы & Логика с Лео</b> — наставник Лео: суперсилы фигур, тактика, маты в 1–2 хода",
    "• <b>ATA Translate</b> — перевод с учётом тона",
    "",
    "<b>Как мы учим</b>",
    "Коротко, каждый день и с похвалой за каждый шаг. Детям — только игра, без исправлений и правил.",
  ].join("\n");
}

export function welcomeKeyboard(appUrl) {
  const rows = [];
  if (appUrl) {
    rows.push([Markup.button.webApp("🚀 Запустить ATA Academy", appUrl)]);
    rows.push([Markup.button.webApp("🎨 Разбор рисунка Мартиной", `${appUrl}/art`)]);
    rows.push([Markup.button.webApp("♟️ Шахматы с Лео", `${appUrl}/chess`)]);
  }
  rows.push([Markup.button.callback("ℹ️ О нашей Академии", ABOUT_ACTION)]);
  return Markup.inlineKeyboard(rows);
}

// Постоянное нижнее меню. Кнопки текстовые, а не web_app: Mini App, открытый с кнопки
// клавиатуры, не получает initData, и вход по Telegram-подписи не сработал бы.
export const MAIN_MENU = {
  reply_markup: {
    keyboard: [[{ text: MENU_OPEN }, { text: MENU_PROFILE }]],
    resize_keyboard: true,
    is_persistent: true,
  },
};

export async function sendWelcome(ctx, account, appUrl) {
  const caption = welcomeCaption(account, !!appUrl);
  const extra = { caption, parse_mode: "HTML", ...welcomeKeyboard(appUrl) };
  const photo = welcomePhoto();
  try {
    if (photo) await ctx.replyWithPhoto(photo, extra);
    else await ctx.reply(caption, { parse_mode: "HTML", ...welcomeKeyboard(appUrl) });
  } catch (error) {
    // Баннер не отправился (нет файла, неверный URL) — карточка уходит текстом.
    console.error(`Не удалось отправить баннер приветствия: ${error?.message ?? error}`);
    await ctx.reply(caption, { parse_mode: "HTML", ...welcomeKeyboard(appUrl) });
  }
  await ctx.reply("Меню всегда под рукой — внизу 👇", MAIN_MENU);
}

export function profileText(account) {
  const info = publicAccount(account);
  const lines = [
    "👤 <b>Мой профиль</b>",
    "",
    `Имя: ${escapeHtml(info.firstName || "—")}`,
    `Роль: ${ROLE_TITLE[info.role] ?? "не выбрана"}`,
    `Направление: ${TRACK_TITLE[info.track] ?? "не выбрано"}`,
    `Тариф: ${info.vip ? "Premium · VIP" : info.plan === "premium" ? "Premium" : "Free"}`,
    `Доступ: ${ACCESS_TITLE[info.access] ?? info.access}`,
    `Серия занятий: ${info.streak.count} ${info.streak.activeToday ? "🔥" : ""}`.trim(),
    `Напоминания: ${info.reminders.enabled ? `каждый день в ${info.reminders.hour}:00` : "выключены"}`,
  ];
  return lines.join("\n");
}

export function profileKeyboard(appUrl) {
  return appUrl
    ? Markup.inlineKeyboard([[Markup.button.webApp("⚙️ Открыть профиль", `${appUrl}/premium`)]])
    : undefined;
}

export function openKeyboard(appUrl) {
  return appUrl
    ? Markup.inlineKeyboard([
        [Markup.button.webApp("🚀 Запустить ATA Academy", appUrl)],
        [Markup.button.webApp("🎨 Разбор рисунка Мартиной", `${appUrl}/art`)],
      ])
    : undefined;
}
