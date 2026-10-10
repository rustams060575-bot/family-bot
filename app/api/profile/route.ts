import { NextResponse } from "next/server";
import { authenticate, badRequest, unauthorized } from "@/lib/server/session";
import { publicAccount, updateProfile } from "@/lib/store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();

  const patch = await request.json().catch(() => null);
  if (!patch || typeof patch !== "object") return badRequest("Пустой запрос.");

  const updated = updateProfile(account.id, patch);
  return NextResponse.json({ account: publicAccount(updated) });
}
