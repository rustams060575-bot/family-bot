import { NextResponse } from "next/server";
import {
  authenticate,
  badRequest,
  consumeOrReject,
  requireAccess,
  serverError,
  unauthorized,
} from "@/lib/server/session";
import { displayName, isKid, publicAccount, recordActivity, refund } from "@/lib/store.mjs";
import { groqChat, logDetailedError } from "@/lib/groq.mjs";
import { parseJsonReply } from "@/lib/ai.mjs";
import { profileLine } from "@/lib/learnerProfile.mjs";
import { leoChatPrompt } from "@/lib/chessSchool.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TURNS = 16;
const MAX_CHARS = 1500;

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

const text = (value: unknown) => String(value ?? "").trim();

// Чат с Лео: вопросы о шахматах, словесные задачки и разбор видеоуроков.
// Лео знает возраст, уровень, карточку ученика и текущий урок.
export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const messages = sanitizeHistory(body?.messages);
  if (messages.at(-1)?.role !== "user") return badRequest("Нет реплики пользователя.");

  const rejected = consumeOrReject(account, "ai");
  if (rejected) return rejected;

  const persona = { name: isKid(account) ? displayName(account) : "", profile: profileLine(account) };
  try {
    const reply = await groqChat(
      [{ role: "system", content: leoChatPrompt(account, persona) }, ...messages],
      `chess chat ${account.id}`,
      { maxTokens: 600, json: true },
    );
    let parsed: any;
    try {
      parsed = parseJsonReply(reply);
    } catch {
      parsed = { reply };
    }
    recordActivity(account);
    return NextResponse.json({
      reply: text(parsed.reply) || reply,
      choices: (Array.isArray(parsed.choices) ? parsed.choices : []).map(text).filter(Boolean).slice(0, 3),
      account: publicAccount(account),
    });
  } catch (error) {
    refund(account, "ai");
    logDetailedError(`Mini App: чат Лео не ответил (user ${account.id})`, error);
    return serverError();
  }
}
