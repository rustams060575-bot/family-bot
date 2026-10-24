import { displayName, superAdminChatIds } from "./store.mjs";
import { telegramBotToken } from "./telegram-auth.mjs";
import { logDetailedError } from "./groq.mjs";

// Уведомления через Bot API напрямую (fetch), а не через экземпляр Telegraf: так их
// одинаково может отправить и бот, и API-роут Next.js.
const ROLE_TITLE = { student: "Ученик", tutor: "Репетитор", parent: "Родитель" };
const TRACK_TITLE = { spanish: "ATA Spanish", english: "ATA English", german: "ATA Deutsch", art: "ATA Kids Art", translate: "ATA Translate" };

async function sendTelegram(chatId, text, replyMarkup) {
  const token = telegramBotToken();
  if (!token) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    });
    const data = await response.json();
    if (!data.ok) throw Object.assign(new Error(`sendMessage: ${data.description}`), { error: data });
    return true;
  } catch (error) {
    logDetailedError(`Не удалось отправить уведомление (chat ${chatId})`, error);
    return false;
  }
}

export function applicationText(account) {
  const lines = [
    "📥 Новая заявка в ATA Academy!",
    "",
    `Имя: ${displayName(account) || "Без имени"}${account.lastName ? ` ${account.lastName}` : ""}`,
    `Username: ${account.username ? `@${account.username}` : "нет"}`,
    `Telegram ID: ${account.id}`,
  ];
  if (account.role) lines.push(`Роль: ${ROLE_TITLE[account.role] ?? "—"} · Трек: ${TRACK_TITLE[account.track] ?? "—"}`);
  if (account.access?.note) lines.push("", `«${account.access.note}»`);
  return lines.join("\n");
}

export function decisionKeyboard(userId) {
  return {
    inline_keyboard: [
      [{ text: "✅ Одобрить и выдать VIP-доступ", callback_data: `acc:approved:${userId}` }],
      [{ text: "Отклонить", callback_data: `acc:rejected:${userId}` }],
    ],
  };
}

// Заявка — всем известным супер-админам. Возвращает число доставленных уведомлений.
export async function notifyNewApplication(account) {
  const chatIds = superAdminChatIds();
  if (chatIds.length === 0) {
    console.warn(
      `Заявка от ${account.id} сохранена, но ни один супер-админ ещё не открывал бота — ` +
        "уведомление не отправлено (заявка видна в /admin).",
    );
    return 0;
  }
  const results = await Promise.all(
    chatIds.map((chatId) => sendTelegram(chatId, applicationText(account), decisionKeyboard(account.id))),
  );
  return results.filter(Boolean).length;
}

// Ответ заявителю. В личном чате chat_id = user_id; если человек ни разу не писал
// боту, Telegram вернёт 403 — тогда он увидит решение при следующем входе в приложение.
export function notifyDecision(account) {
  const approved = account.access?.status === "approved";
  const text = approved
    ? "Доступ одобрен! Добро пожаловать в ATA Academy 🎓\n\nВам открыт полный VIP-доступ — без лимитов."
    : "Заявка в ATA Academy пока не одобрена. Повторно её можно отправить через сутки.";
  const url =
    process.env.WEBAPP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
  const keyboard =
    approved && url ? { inline_keyboard: [[{ text: "🚀 Запустить ATA Academy", web_app: { url } }]] } : undefined;
  return sendTelegram(account.chatId ?? account.id, text, keyboard);
}
