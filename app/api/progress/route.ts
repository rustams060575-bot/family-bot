import { NextResponse } from "next/server";
import { authenticate, requireAccess, unauthorized } from "@/lib/server/session";
import { INTERESTS, progressReport, setInterests } from "@/lib/learnerProfile.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// «Прогресс ученика»: карточка ученика, динамика, работы с комментариями Мартины и темы языков.
export async function GET(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;
  return NextResponse.json({ progress: progressReport(account), interests: INTERESTS });
}

// Интересы ученика — родитель отмечает их в карточке; Мартина опирается на них в заданиях.
export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  setInterests(account, body?.interests);
  return NextResponse.json({ progress: progressReport(account), interests: INTERESTS });
}
