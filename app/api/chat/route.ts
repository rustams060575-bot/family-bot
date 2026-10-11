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
import { groqChat, logDetailedError } from "@/lib/groq.mjs";
import { crmPrompt, kidsPrompt, textPrompt, voicePrompt } from "@/lib/prompts.mjs";
import { parseJsonReply } from "@/lib/ai.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TURNS = 20;
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
  const persona = { name: displayName(account), vip: isVip(account), kid };
  const language = track === "spanish" || track === "english";
  let system: string | null = null;
  if (track === "crm") {
    // План занятия для ученика из CRM владельца; чужой studentId просто не найдётся.
    const student = findStudent(account, String(body?.studentId ?? ""));
    if (student) system = crmPrompt({ ...student, recent: recentLessonsText(student) }, account.role, persona);
  } else if (language && kid) {
    // Детский режим: один игровой сценарий на любую тему, голосом и текстом.
    system = kidsPrompt(track, persona);
  } else if (language) {
    system = (mode === "voice" ? voicePrompt : textPrompt)(track, topic, account.role, persona);
  }
  if (!system) return badRequest("Неизвестный трек или тема.");

  // Слова, которые Whisper распознал неуверенно, — подсказка модели про произношение.
  if (mode === "voice" && !kid && Array.isArray(body?.uncertain) && body.uncertain.length) {
    const last = messages.at(-1)!;
    last.content += `\n\n(неуверенно распознанные фрагменты: ${body.uncertain
      .slice(0, 5)
      .map(String)
      .join("; ")})`;
  }

  const rejected = consumeOrReject(account, "ai");
  if (rejected) return rejected;

  try {
    const reply = await groqChat([{ role: "system", content: system }, ...messages], `app chat ${account.id}`, {
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
    return NextResponse.json({
      reply: String(parsed.reply ?? "").trim() || reply,
      translation: String(parsed.translation ?? ""),
      corrections: !kid && Array.isArray(parsed.corrections) ? parsed.corrections.slice(0, 3) : [],
      pronunciation: kid ? "" : String(parsed.pronunciation ?? ""),
      choices: Array.isArray(parsed.choices) ? parsed.choices.map(String).filter(Boolean).slice(0, 3) : [],
    });
  } catch (error) {
    refund(account, "ai");
    logDetailedError(`Mini App: чат не ответил (user ${account.id})`, error);
    return serverError();
  }
}
