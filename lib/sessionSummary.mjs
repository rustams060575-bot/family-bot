import { aiChat } from "./openai.mjs";
import { displayName, listAccounts, markDirty } from "./store.mjs";
import { MEMORY_TRACKS, applySessionResult, memoryOf, openWeaknesses } from "./studentMemory.mjs";
import { INTERESTS, setInterests } from "./learnerProfile.mjs";

// Авто-суммаризация урока. Сервер сам копит расшифровку сессии в account.sessions[track]
// (recordTurn вызывается из всех чатов). Когда сессия завершена — урок засчитан, ученик
// нажал «закончить» или молчит дольше IDLE_MS — gpt-4o-mini делает выжимку, обновляет
// known_weaknesses и сохраняет last_session_summary в профиль ученика.

const IDLE_MS = (Number(process.env.SESSION_IDLE_MINUTES) || 30) * 60_000;
const SWEEP_MS = 5 * 60_000;
const MAX_TURNS = 40;
const MAX_TURN_CHARS = 600;
const MIN_USER_TURNS = 2;
const MAX_ATTEMPTS = 3;

// Идущие суммаризации — только в памяти процесса (не в accounts.json, чтобы флаг не «залип» после рестарта).
const RUNNING_KEY = Symbol.for("ata.summaryRunning");
const running = () => (globalThis[RUNNING_KEY] ??= new Set());
const runKey = (account, track) => `${account.id}:${track}`;

const clip = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TURN_CHARS);

function sessionOf(account, track) {
  account.sessions ??= {};
  return (account.sessions[track] ??= { turns: [], startedAt: null, lastAt: null, attempts: 0 });
}

// Запоминает обмен репликами для будущей суммаризации. Дёшево: только запись в память.
export function recordTurn(account, track, userText, assistantText) {
  if (!account || !MEMORY_TRACKS.includes(track)) return;
  const session = sessionOf(account, track);
  const now = new Date().toISOString();
  session.startedAt ??= now;
  session.lastAt = now;
  session.attempts = 0;
  session.turns.push({ role: "user", content: clip(userText) }, { role: "assistant", content: clip(assistantText) });
  if (session.turns.length > MAX_TURNS) session.turns = session.turns.slice(-MAX_TURNS);
  markDirty();
}

const SUMMARY_SYSTEM = `Ты — методист ATA Academy. Тебе дают расшифровку урока ученика с учителем Мартиной. Составь выжимку для памяти учителя.
Ответь строго JSON-объектом:
{"summary": "2–4 предложения по-русски: что прошли, как справился ученик, что получилось хорошо и с чего начать следующий урок",
 "weaknesses": ["0–4 новых или повторившихся слабых места: короткие формулировки навыка по-русски, например «Past Simple: неправильные глаголы»"],
 "resolved": ["слабые места из списка известных, которые на этом уроке ученик явно отработал без ошибок; формулируй ТОЧНО как в списке"],
 "interests": ["интересы ученика, которые прозвучали на уроке, строго из списка допустимых"]}
Опирайся только на расшифровку, ничего не выдумывай. Если ошибок не было, weaknesses — пустой массив. Для детей слабые места формулируй нейтрально, без слов «ошибка» и «плохо».`;

function transcriptText(turns) {
  return turns.map((turn) => `${turn.role === "user" ? "Ученик" : "Мартина"}: ${turn.content}`).join("\n");
}

// Завершает сессию: выжимка → профиль. Возвращает true, если память обновлена.
// reason — для логов ("lesson", "idle", "manual"). Безопасно вызывать повторно и фоном.
export async function summarizeSession(account, track, reason = "manual") {
  if (!account || !MEMORY_TRACKS.includes(track)) return false;
  const session = account.sessions?.[track];
  if (!session?.turns?.length || running().has(runKey(account, track))) return false;

  const userTurns = session.turns.filter((turn) => turn.role === "user").length;
  if (userTurns < MIN_USER_TURNS) {
    // Слишком короткий обмен — выжимка не нужна, просто закрываем сессию.
    session.turns = [];
    session.startedAt = null;
    markDirty();
    return false;
  }

  running().add(runKey(account, track));
  const snapshotLength = session.turns.length;
  const snapshot = session.turns.slice();
  try {
    const memory = memoryOf(account, track);
    const level = account.learning?.[track]?.level;
    const known = openWeaknesses(account, track, 10);
    const payload = [
      `Ученик: ${displayName(account) || "без имени"}; направление: ${track}${level ? `; уровень CEFR ${level}` : ""}.`,
      `Известные слабые места: ${known.length ? known.join("; ") : "нет"}.`,
      `Допустимые интересы: ${INTERESTS.join(", ")}.`,
      memory.last_session_summary ? `Итог прошлого урока: ${memory.last_session_summary}` : "",
      "",
      "Расшифровка урока:",
      transcriptText(snapshot),
    ]
      .filter((line) => line !== null)
      .join("\n");
    const answer = await aiChat(
      [
        { role: "system", content: SUMMARY_SYSTEM },
        { role: "user", content: payload },
      ],
      `summary ${track} ${account.id} (${reason})`,
      { tier: "fast", json: true, maxTokens: 700, temperature: 0.2 },
    );
    const parsed = JSON.parse(answer);
    applySessionResult(account, track, {
      weaknesses: parsed.weaknesses,
      resolved: parsed.resolved,
      summary: parsed.summary,
    });
    const interests = (Array.isArray(parsed.interests) ? parsed.interests : [])
      .map((item) => String(item).trim())
      .filter((item) => INTERESTS.includes(item));
    if (interests.length) setInterests(account, [...(account.profile?.interests ?? []), ...interests]);
    // Реплики, пришедшие во время суммаризации, остаются для следующей сессии.
    session.turns = session.turns.slice(snapshotLength);
    session.startedAt = session.turns.length ? session.startedAt : null;
    session.attempts = 0;
    markDirty();
    console.log(`Суммаризация урока готова (${track}, user ${account.id}, ${reason}).`);
    return true;
  } catch (error) {
    session.attempts = (session.attempts ?? 0) + 1;
    console.error(`Суммаризация урока не удалась (${track}, user ${account.id}): ${error?.message ?? error}`);
    return false;
  } finally {
    running().delete(runKey(account, track));
  }
}

// Фоновый запуск: ответ ученику не ждёт суммаризации.
export function summarizeInBackground(account, track, reason) {
  summarizeSession(account, track, reason).catch(() => {});
}

// Сессия считается завершённой, если ученик молчит дольше IDLE_MS.
export async function sweepIdleSessions(now = Date.now()) {
  for (const account of listAccounts()) {
    for (const [track, session] of Object.entries(account.sessions ?? {})) {
      if (!session?.turns?.length || running().has(runKey(account, track))) continue;
      if ((session.attempts ?? 0) >= MAX_ATTEMPTS) {
        // Повторные сбои — сессию закрываем без выжимки, чтобы не копить мусор.
        session.turns = [];
        session.attempts = 0;
        markDirty();
        continue;
      }
      if (now - Date.parse(session.lastAt ?? 0) >= IDLE_MS) await summarizeSession(account, track, "idle");
    }
  }
}

const TIMER_KEY = Symbol.for("ata.sessionSweep");

// Запускается один раз из server.mjs; повторный вызов ничего не делает.
export function startSessionSweeper() {
  if (globalThis[TIMER_KEY]) return;
  globalThis[TIMER_KEY] = setInterval(() => {
    sweepIdleSessions().catch((error) => console.error(`Проверка сессий не удалась: ${error?.message ?? error}`));
  }, SWEEP_MS);
  globalThis[TIMER_KEY].unref?.();
}
