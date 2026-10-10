import { NextResponse } from "next/server";
import { authenticate, badRequest, unauthorized } from "@/lib/server/session";
import { synthesizeSpeech, ttsAllowed } from "@/lib/ai.mjs";
import { isPremium } from "@/lib/store.mjs";
import { logDetailedError } from "@/lib/groq.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TTS_CHARS = 700;

// Озвучка реплики, которую уже оплатил запрос в /api/chat или /api/translate.
// 503 — сигнал клиенту без ошибки переключиться на системный голос устройства
// (нет OPENAI_API_KEY, тариф Free или сбой OpenAI).
export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  if (!ttsAllowed(isPremium(account))) {
    return NextResponse.json({ error: "tts_unavailable" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_TTS_CHARS) : "";
  if (!text) return badRequest("Нет текста для озвучки.");

  try {
    const audio = await synthesizeSpeech(text, body?.voice);
    return new NextResponse(new Uint8Array(audio), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    logDetailedError(`Mini App: озвучка не удалась (user ${account.id})`, error);
    return NextResponse.json({ error: "tts_failed" }, { status: 503 });
  }
}
