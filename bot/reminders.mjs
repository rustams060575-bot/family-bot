import { displayName, hasAccess, listAccounts, localDateKey, markReminderSent } from "../lib/store.mjs";
import { logDetailedError } from "../lib/groq.mjs";

// Ежедневный контроль: раз в несколько минут проверяем, у кого в его часовом поясе
// наступил выбранный час напоминания, и пишем тем, кто сегодня ещё не занимался.
// Не больше одного напоминания в день; заблокировавшим бота (403) — отключаем.
const CHECK_INTERVAL_MS = 5 * 60_000;

const TRACK_LINE = {
  spanish: "испанский ждёт вас — 10 минут интенсива дня",
  english: "пара реплик на английском — и день засчитан",
  art: "новое задание для рисования уже готово",
  translate: "загляните в переводчик и занятия",
};

function reminderText(account) {
  const line = TRACK_LINE[account.track] ?? TRACK_LINE.translate;
  const streak = account.streak.count;
  const streakLine =
    streak > 1 && account.streak.lastActiveDate === localDateKey(account.reminders.tzOffsetMin, Date.now() - 86_400_000)
      ? `\n\nСтрик ${streak} дней — сегодня его можно продлить.`
      : "";
  const name = displayName(account);
  return `${name ? `${name}, ` : ""}${line}.${streakLine}`;
}

async function tick(bot, keyboard) {
  const now = Date.now();
  for (const account of listAccounts()) {
    const { reminders } = account;
    // Закрытая школа: напоминаем только участникам с одобренной заявкой.
    if (!account.chatId || !reminders.enabled || !account.role || !hasAccess(account)) continue;

    const today = localDateKey(reminders.tzOffsetMin, now);
    if (reminders.lastSentDate === today || account.streak.lastActiveDate === today) continue;

    const localHour = new Date(now - reminders.tzOffsetMin * 60_000).getUTCHours();
    if (localHour !== reminders.hour) continue;

    markReminderSent(account, today);
    try {
      await bot.telegram.sendMessage(account.chatId, reminderText(account), keyboard());
    } catch (error) {
      if (error?.response?.error_code === 403) {
        reminders.enabled = false;
        continue;
      }
      logDetailedError(`Не удалось отправить напоминание (user ${account.id})`, error);
    }
  }
}

export function startReminders(bot, keyboard) {
  const run = () => tick(bot, keyboard).catch((error) => logDetailedError("Сбой цикла напоминаний", error));
  run();
  return setInterval(run, CHECK_INTERVAL_MS);
}
