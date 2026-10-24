import { NextResponse } from "next/server";
import { authenticate, requireAccess, unauthorized } from "@/lib/server/session";
import { isKid } from "@/lib/store.mjs";
import { synthesize } from "@/lib/tts.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Озвучка реплики голосом OpenAI (tts-1-hd). Любая ошибка — не 5xx на весь экран, а
// понятный статус: клиент в этом случае сам включает запасной голос браузера.
export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const result = await synthesize(account, body?.text, { male: body?.voice === "male", slow: isKid(account) });
  if (!result.buffer) {
    const status = result.error === "disabled" ? 501 : result.error === "limit" ? 429 : result.error === "empty" ? 400 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return new Response(new Uint8Array(result.buffer), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" },
  });
}
