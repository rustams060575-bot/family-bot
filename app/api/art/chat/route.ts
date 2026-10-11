import { NextResponse } from "next/server";
import {
  authenticate,
  badRequest,
  consumeOrReject,
  requireAccess,
  serverError,
  unauthorized,
} from "@/lib/server/session";
import { displayName, isKid, publicAccount, recordActivity, refund, setArtTask } from "@/lib/store.mjs";
import { groqChat, logDetailedError } from "@/lib/groq.mjs";
import { parseJsonReply } from "@/lib/ai.mjs";
import { artChatPrompt } from "@/lib/prompts.mjs";

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

// Чат Kids Art: ребёнок пишет или говорит Мартине, она отвечает и выдаёт творческие
// задания. Выданное задание сохраняется в профиль — разбор рисунка учтёт его.
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

  const persona = { name: isKid(account) ? displayName(account) : "" };
  try {
    const reply = await groqChat(
      [{ role: "system", content: artChatPrompt(persona, account.artTask ?? null) }, ...messages],
      `art chat ${account.id}`,
      { maxTokens: 700, json: true },
    );
    let parsed: any;
    try {
      parsed = parseJsonReply(reply);
    } catch {
      parsed = { reply };
    }
    const task = parsed.task && text(parsed.task.title) ? setArtTask(account, parsed.task) : null;
    recordActivity(account);
    return NextResponse.json({
      reply: text(parsed.reply) || reply,
      task,
      choices: (Array.isArray(parsed.choices) ? parsed.choices : []).map(text).filter(Boolean).slice(0, 3),
      account: publicAccount(account),
    });
  } catch (error) {
    refund(account, "ai");
    logDetailedError(`Mini App: чат Kids Art не ответил (user ${account.id})`, error);
    return serverError();
  }
}
