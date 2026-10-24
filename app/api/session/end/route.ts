import { NextResponse } from "next/server";
import { authenticate, badRequest, requireAccess, unauthorized } from "@/lib/server/session";
import { MEMORY_TRACKS } from "@/lib/studentMemory.mjs";
import { summarizeInBackground } from "@/lib/sessionSummary.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ученик закончил урок (кнопка «Завершить» или выход из занятия): суммаризация идёт в фоне.
export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const track = String(body?.track ?? "");
  if (!MEMORY_TRACKS.includes(track)) return badRequest("Неизвестное направление.");
  summarizeInBackground(account, track, "manual");
  return NextResponse.json({ ok: true });
}
