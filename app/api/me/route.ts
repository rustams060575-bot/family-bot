import { NextResponse } from "next/server";
import { authenticate, unauthorized } from "@/lib/server/session";
import { accessStatus, publicAccount, submitApplication } from "@/lib/store.mjs";
import { notifyNewApplication } from "@/lib/notify.mjs";
import { visionProvider } from "@/lib/ai.mjs";
import { premiumOffer } from "@/lib/server/premium";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();

  // Закрытая школа: при первом входе заявка подаётся сама и сразу уходит супер-админу
  // с кнопкой «Одобрить и выдать VIP-доступ». Повторно не отправляется.
  if (accessStatus(account) === "none" && submitApplication(account)) {
    await notifyNewApplication(account);
  }

  return NextResponse.json({
    account: publicAccount(account),
    features: { vision: !!visionProvider() },
    offer: premiumOffer(),
  });
}
