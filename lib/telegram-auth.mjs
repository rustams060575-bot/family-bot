import crypto from "crypto";

// Проверка подписи initData из Telegram WebApp (core.telegram.org/bots/webapps
// #validating-data-received-via-the-mini-app): без неё любой мог бы вызвать API
// от имени чужого пользователя и тратить его лимиты или «получить» Premium.
const MAX_AUTH_AGE_SEC = 24 * 60 * 60;

export function telegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || null;
}

export function verifyInitData(initData, botToken = telegramBotToken()) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (
    expected.length !== hash.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))
  ) {
    return null;
  }

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SEC) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "null");
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

// Локальная разработка в обычном браузере (вне Telegram): initData нет, поэтому
// подставляется тестовый пользователь. В production эта лазейка закрыта.
export const DEV_USER = { id: 1, first_name: "Dev", language_code: "ru" };

export function allowDevUser() {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_USER !== "false";
}
