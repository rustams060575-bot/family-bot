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
import { logDetailedError } from "@/lib/groq.mjs";
import { aiChat } from "@/lib/openai.mjs";
import { studentProfileBlock } from "@/lib/studentMemory.mjs";
import { guardReply } from "@/lib/teacherRules.mjs";
import { recordTurn, summarizeInBackground } from "@/lib/sessionSummary.mjs";
import { parseJsonReply } from "@/lib/ai.mjs";
import { artAnswerPrompt, artChatPrompt } from "@/lib/prompts.mjs";
import { profileLine } from "@/lib/learnerProfile.mjs";
import { artLessonLine, artMethodLine } from "@/lib/artSchool.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TURNS = Math.min(15, Math.max(10, Number(process.env.SHORT_MEMORY_TURNS) || 14));
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

  // Возраст, программа группы и текущий урок — Мартина говорит на уровне ученика.
  const persona = {
    name: isKid(account) ? displayName(account) : "",
    method: artMethodLine(account),
    profile: profileLine(account),
    memory: studentProfileBlock(account, "art"),
    interests: account.profile?.interests ?? [],
    sessionStart: messages.length <= 2,
    lesson: artLessonLine(account),
  };
  // Ответ на «Вопрос от Мартины» после разбора рисунка — короткая реакция без нового задания.
  const answerTo = body?.answerTo && text(body.answerTo.question) ? body.answerTo : null;
  const system = answerTo
    ? artAnswerPrompt(persona, {
        title: text(answerTo.title).slice(0, 120),
        question: text(answerTo.question).slice(0, 400),
        nextTask: text(answerTo.nextTask).slice(0, 120),
      })
    : artChatPrompt(persona, account.artTask ?? null);
  try {
    const reply = await aiChat(
      [{ role: "system", content: system }, ...messages],
      `art chat ${account.id}`,
      { tier: "dialog", maxTokens: 700, json: true },
    );
    let parsed: any;
    try {
      parsed = parseJsonReply(reply);
    } catch {
      parsed = { reply };
    }
    const task = !answerTo && parsed.task && text(parsed.task.title) ? setArtTask(account, parsed.task) : null;
    recordActivity(account);
    // «Ответ на вопрос Мартины» — короткая реакция без нового вопроса; в остальных репликах ровно один интерактив.
    const guarded = await guardReply(text(parsed.reply) || reply, {
      label: `art chat ${account.id}`,
      skipQuestion: !!answerTo,
    });
    if (!answerTo) {
      if (persona.sessionStart) summarizeInBackground(account, "art", "new-session");
      recordTurn(account, "art", messages.at(-1)!.content, guarded);
    }
    return NextResponse.json({
      reply: guarded,
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
