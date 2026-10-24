import { NextResponse } from "next/server";
import {
  authenticate,
  badRequest,
  consumeOrReject,
  serverError,
  requireAccess,
  unauthorized,
} from "@/lib/server/session";
import { displayName, isKid, isVip, recordActivity, refund } from "@/lib/store.mjs";
import { findStudent, recentLessonsText } from "@/lib/crm.mjs";
import { logDetailedError } from "@/lib/groq.mjs";
import { aiChat } from "@/lib/openai.mjs";
import { studentProfileBlock } from "@/lib/studentMemory.mjs";
import { guardReply } from "@/lib/teacherRules.mjs";
import { kidsLevel } from "@/lib/cefr.mjs";
import { recordTurn, summarizeInBackground } from "@/lib/sessionSummary.mjs";
import { crmPrompt, kidsPrompt, textPrompt, voicePrompt } from "@/lib/prompts.mjs";
import { learnerLine, learningOf, lessonPracticeLine } from "@/lib/learning.mjs";
import { profileLine } from "@/lib/learnerProfile.mjs";
import { parseJsonReply } from "@/lib/ai.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Short-term memory: сколько последних реплик уходит в модель (10–15).
const MAX_TURNS = Math.min(15, Math.max(10, Number(process.env.SHORT_MEMORY_TURNS) || 14));
const MAX_CHARS = 4000;

type Turn = { role: "user" | "assistant"; content: string };

function sanitizeHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (turn): turn is Turn =>
        (turn?.role === "user" || turn?.role === "assistant") &&
        typeof turn?.content === "string" &&
        turn.content.trim().length > 0,
    )
    .slice(-MAX_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_CHARS) }));
}

const str = (value: unknown) => String(value ?? "").trim();

// Академическая правка: ошибка → верно → правило → продвинутые синонимы → стильная версия.
function academicCorrections(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      heard: str(item?.heard),
      correct: str(item?.correct),
      note: str(item?.note),
      synonyms: (Array.isArray(item?.synonyms) ? item.synonyms : []).map(str).filter(Boolean).slice(0, 3),
      stylish: str(item?.stylish),
    }))
    .filter((item) => item.heard && (item.correct || item.stylish))
    .slice(0, 3);
}

export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const track = body?.track;
  const topic = body?.topic;
  const mode = body?.mode === "voice" ? "voice" : "text";
  const messages = sanitizeHistory(body?.messages);
  if (messages.at(-1)?.role !== "user") return badRequest("Нет реплики пользователя.");

  const kid = isKid(account);
  const language = track === "spanish" || track === "english";
  // Long-term memory: имя, интересы, уровень и итог прошлого урока подставляются в каждый запрос.
  const learning = language ? learningOf(account, track) : null;
  const persona = {
    name: displayName(account),
    vip: isVip(account),
    kid,
    level: learning?.level ?? null,
    learning,
    interests: account.profile?.interests ?? [],
    sessionStart: messages.length <= 2,
    memory: language ? studentProfileBlock(account, track) : "",
  };
  let system: string | null = null;
  if (track === "crm") {
    // План занятия для ученика из CRM владельца; чужой studentId просто не найдётся.
    const student = findStudent(account, String(body?.studentId ?? ""));
    if (student) system = crmPrompt({ ...student, recent: recentLessonsText(student) }, account.role, persona);
  } else if (language && kid) {
    // Детский режим: один игровой сценарий на любую тему, голосом и текстом.
    system = kidsPrompt(track, { ...persona, profile: profileLine(account) });
  } else if (language) {
    // Память Мартины: карточка ученика, уровень, пройденные темы и урок дня.
    const lesson = topic === "lesson" ? learningOf(account, track).lesson : null;
    if (topic === "lesson" && !lesson) return badRequest("Урок дня ещё не создан.");
    const context = [persona.memory, profileLine(account), learnerLine(account, track), lessonPracticeLine(lesson)]
      .filter(Boolean)
      .join("\n\n");
    system = (mode === "voice" ? voicePrompt : textPrompt)(track, topic, account.role, persona, context);
  }
  if (!system) return badRequest("Неизвестный трек или тема.");

  // Слова, которые Whisper распознал неуверенно, — подсказка модели про произношение.
  if (mode === "voice" && !kid && Array.isArray(body?.uncertain) && body.uncertain.length) {
    const last = messages.at(-1)!;
    last.content += `\n\n(неуверенно распознанные фрагменты: ${body.uncertain.slice(0, 5).map(String).join("; ")})`;
  }

  const rejected = consumeOrReject(account, "ai");
  if (rejected) return rejected;

  try {
    const reply = await aiChat([{ role: "system", content: system }, ...messages], `app chat ${account.id}`, {
      tier: "dialog",
      maxTokens: mode === "voice" || kid ? 700 : 1200,
      json: language,
    });

    recordActivity(account);
    if (!language) return NextResponse.json({ reply });

    // Модель изредка ломает JSON — тогда показываем её текст как есть, а не ошибку.
    let parsed: any;
    try {
      parsed = parseJsonReply(reply);
    } catch {
      parsed = { reply };
    }
    // Серверная проверка: ровно один интерактив и (A1–B1) никаких конструкций выше уровня.
    const guarded = await guardReply(String(parsed.reply ?? "").trim() || reply, {
      level: kid ? kidsLevel(learning) : persona.level,
      label: `app chat ${account.id}`,
    });
    // Новый урок закрывает прошлую сессию (суммаризация в фоне), затем копим расшифровку этой.
    if (persona.sessionStart) summarizeInBackground(account, track, "new-session");
    recordTurn(account, track, messages.at(-1)!.content, guarded);
    return NextResponse.json({
      reply: guarded,
      translation: String(parsed.translation ?? ""),
      corrections: kid ? [] : academicCorrections(parsed.corrections),
      pronunciation: kid ? "" : String(parsed.pronunciation ?? ""),
      choices: Array.isArray(parsed.choices) ? parsed.choices.map(String).filter(Boolean).slice(0, 3) : [],
    });
  } catch (error) {
    refund(account, "ai");
    logDetailedError(`Mini App: чат не ответил (user ${account.id})`, error);
    return serverError();
  }
}
