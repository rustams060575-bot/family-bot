import { NextResponse } from "next/server";
import { authenticate, badRequest, unauthorized } from "@/lib/server/session";
import { adminOverview, decideApplication, getAccount, grantPremium, isAdmin, revokePremium } from "@/lib/store.mjs";
import { notifyDecision } from "@/lib/notify.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function forbidden() {
  return NextResponse.json({ error: "forbidden", message: "Раздел доступен только администраторам." }, { status: 403 });
}

// Админ школы: заявки на вступление, обзор всех пользователей, ручное управление Premium.
export async function GET(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  if (!isAdmin(account)) return forbidden();
  return NextResponse.json(adminOverview());
}

export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  if (!isAdmin(account)) return forbidden();

  const body = await request.json().catch(() => null);
  const userId = String(body?.userId ?? "");
  if (!getAccount(userId)) return badRequest("Пользователь не найден.");

  if (body?.action === "approve" || body?.action === "reject") {
    const decided = decideApplication(userId, body.action === "approve" ? "approved" : "rejected", account);
    if (decided) await notifyDecision(decided);
    console.log(`Админ ${account.id}: заявка ${userId} — ${body.action}.`);
  } else if (body?.action === "grant") {
    const days = Number(body?.days);
    grantPremium(userId, Number.isInteger(days) && days > 0 && days <= 366 ? days : 30);
    console.log(`Админ ${account.id} выдал Premium пользователю ${userId}.`);
  } else if (body?.action === "revoke") {
    revokePremium(userId);
    console.log(`Админ ${account.id} снял Premium с пользователя ${userId}.`);
  } else {
    return badRequest("Неизвестное действие.");
  }
  return NextResponse.json(adminOverview());
}
