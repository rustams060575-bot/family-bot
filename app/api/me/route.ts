import { NextResponse } from "next/server";
import { authenticate, unauthorized } from "@/lib/server/session";
import { isPremium, publicAccount } from "@/lib/store.mjs";
import { ttsAllowed, visionProvider } from "@/lib/ai.mjs";
import { premiumOffer } from "@/lib/server/premium";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();

  return NextResponse.json({
    account: publicAccount(account),
    features: { tts: ttsAllowed(isPremium(account)), vision: !!visionProvider() },
    offer: premiumOffer(),
  });
}
