import { NextResponse } from "next/server";
import {
  authenticate,
  badRequest,
  consumeOrReject,
  serverError,
  unauthorized,
} from "@/lib/server/session";
import { recordActivity, refund } from "@/lib/store.mjs";
import { groqChat, logDetailedError } from "@/lib/groq.mjs";
import { TRANSLATE_LANG_CODES, translatePrompt } from "@/lib/prompts.mjs";
import { parseJsonReply } from "@/lib/ai.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 3000) : "";
  const from = body?.from === "auto" || TRANSLATE_LANG_CODES.includes(body?.from) ? body.from : null;
  const to = TRANSLATE_LANG_CODES.includes(body?.to) ? body.to : null;
  const register = body?.register === "business" ? "business" : "casual";
  if (!text || !from || !to) return badRequest("Нужны текст и пара языков.");

  const rejected = consumeOrReject(account, "ai");
  if (rejected) return rejected;

  try {
    const reply = await groqChat(
      [
        { role: "system", content: translatePrompt(from, to, register) },
        { role: "user", content: text },
      ],
      `app translate ${account.id}`,
      { maxTokens: 1500, json: true },
    );
    const parsed = parseJsonReply(reply);
    recordActivity(account);
    return NextResponse.json({
      detected: TRANSLATE_LANG_CODES.includes(parsed.detected) ? parsed.detected : null,
      translation: String(parsed.translation ?? ""),
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives.slice(0, 2).map(String) : [],
      note: String(parsed.note ?? ""),
    });
  } catch (error) {
    refund(account, "ai");
    logDetailedError(`Mini App: перевод не удался (user ${account.id})`, error);
    return serverError();
  }
}
