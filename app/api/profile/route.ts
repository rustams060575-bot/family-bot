import { NextResponse } from "next/server";
import { authenticate, badRequest, unauthorized } from "@/lib/server/session";
import { publicAccount, submitApplication, updateProfile } from "@/lib/store.mjs";
import { notifyNewApplication } from "@/lib/notify.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();

  const patch = await request.json().catch(() => null);
  if (!patch || typeof patch !== "object") return badRequest("Пустой запрос.");

  const updated = updateProfile(account.id, patch);

  // Закрытая школа: заявка подаётся сама при первом входе (/api/me); здесь — повторно после
  // отказа и паузы в сутки. VIP и админам заявка не нужна — submitApplication вернёт false.
  if ((patch.apply === true || patch.role) && submitApplication(updated, patch.applicationNote)) {
    await notifyNewApplication(updated);
  }

  return NextResponse.json({ account: publicAccount(updated) });
}
