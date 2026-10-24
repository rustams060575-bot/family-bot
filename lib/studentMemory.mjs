import { displayName, markDirty, localDateKey } from "./store.mjs";

// Долгосрочная память ученика (Long-Term Student Profile) для всех режимов ATA Academy:
// испанский, английский, Художник, шахматы, детский режим. Хранится в account.memory[track]:
//   { known_weaknesses: [{ skill, count, lastSeen, status }], last_session_summary,
//     lastSessionAt, sessions }
// Имя берётся из аккаунта, интересы и уровень — из профиля (learnerProfile.mjs / learning.mjs).
// Модуль только хранит и форматирует память; промпты подключают studentProfileBlock().

export const MEMORY_TRACKS = ["spanish", "english", "art", "chess", "translate"];
const MAX_WEAKNESSES = 20;
const MAX_SUMMARY_CHARS = 700;
const SHOWN_WEAKNESSES = 5;

const text = (value, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const weaknessKey = (skill) => skill.toLowerCase();

export function memoryOf(account, track) {
  account.memory ??= {};
  const memory = (account.memory[track] ??= {
    known_weaknesses: [],
    last_session_summary: "",
    lastSessionAt: null,
    sessions: 0,
  });
  // Однократный перенос пробелов из среза знаний (learning.gaps) — они становятся слабыми местами.
  if (!memory.seededFromGaps) {
    memory.seededFromGaps = true;
    const gaps = account.learning?.[track]?.gaps ?? [];
    for (const gap of gaps) addWeakness(memory, gap, { silent: true });
    if (gaps.length) markDirty();
  }
  return memory;
}

function addWeakness(memory, skill, { silent = false, date = null } = {}) {
  const clean = text(skill);
  if (!clean) return;
  const found = memory.known_weaknesses.find((item) => weaknessKey(item.skill) === weaknessKey(clean));
  if (found) {
    found.count += 1;
    found.status = "open";
    if (date) found.lastSeen = date;
  } else {
    memory.known_weaknesses.push({ skill: clean, count: 1, lastSeen: date, status: "open" });
  }
  if (!silent) markDirty();
}

// Слабые места: самые частые и свежие — первыми; закрытые вытесняются при переполнении.
function sortedWeaknesses(memory) {
  const rank = (item) => (item.status === "open" ? 1000 : 0) + item.count * 10;
  return [...memory.known_weaknesses].sort(
    (a, b) => rank(b) - rank(a) || String(b.lastSeen ?? "").localeCompare(String(a.lastSeen ?? "")),
  );
}

// Результат авто-суммаризации урока: новые слабые места, закрытые и краткий итог.
// weaknesses / resolved — массивы строк; summary — 2–4 предложения для старта следующего урока.
export function applySessionResult(account, track, { weaknesses = [], resolved = [], summary = "" } = {}) {
  const memory = memoryOf(account, track);
  const today = localDateKey(account.reminders?.tzOffsetMin ?? 0);
  for (const skill of Array.isArray(weaknesses) ? weaknesses : []) addWeakness(memory, skill, { date: today });
  for (const skill of Array.isArray(resolved) ? resolved : []) {
    const found = memory.known_weaknesses.find((item) => weaknessKey(item.skill) === weaknessKey(text(skill)));
    if (found) found.status = "resolved";
  }
  memory.known_weaknesses = sortedWeaknesses(memory).slice(0, MAX_WEAKNESSES);
  const clean = text(summary, MAX_SUMMARY_CHARS);
  if (clean) memory.last_session_summary = clean;
  memory.lastSessionAt = new Date().toISOString();
  memory.sessions += 1;
  markDirty();
  return memory;
}

export function openWeaknesses(account, track, limit = SHOWN_WEAKNESSES) {
  return sortedWeaknesses(memoryOf(account, track))
    .filter((item) => item.status === "open")
    .slice(0, limit)
    .map((item) => item.skill);
}

const TRACK_NAME = {
  spanish: "испанский",
  english: "английский",
  art: "рисование",
  chess: "шахматы",
  translate: "перевод",
};

// Блок для System Prompt, который подставляется перед КАЖДЫМ запросом к gpt-4o:
// имя, уровень, слабые места, интересы и итог прошлого урока.
export function studentProfileBlock(account, track) {
  if (!account) return "";
  const memory = memoryOf(account, track);
  const name = displayName(account);
  const level = account.learning?.[track]?.level ?? null;
  const interests = account.profile?.interests ?? [];
  const weaknesses = openWeaknesses(account, track);
  const lines = ["ПРОФИЛЬ УЧЕНИКА (память прошлых уроков):"];
  lines.push(`- Имя: ${name || "не указано"}${name ? " — обращайся к ученику только по имени." : ""}`);
  lines.push(`- Направление: ${TRACK_NAME[track] ?? track}${level ? `; уровень CEFR: ${level}` : ""}`);
  lines.push(`- Интересы: ${interests.length ? interests.join(", ").toLowerCase() : "пока неизвестны — выясни в разговоре"}`);
  lines.push(`- Слабые места (known_weaknesses): ${weaknesses.length ? weaknesses.join("; ") : "пока не выявлены"}`);
  if (memory.last_session_summary) {
    lines.push(`- Итог прошлого урока (last_session_summary): ${memory.last_session_summary}`);
  } else {
    lines.push("- Итог прошлого урока: это первый урок, повторять нечего.");
  }
  return lines.join("\n");
}
