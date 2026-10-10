import { NextResponse } from "next/server";
import { authenticate, serverError, unauthorized } from "@/lib/server/session";
import { telegramBotToken } from "@/lib/telegram-auth.mjs";
import { premiumOffer } from "@/lib/server/premium";
import { logDetailedError } from "@/lib/groq.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ссылка на счёт в Telegram Stars (валюта XTR, provider_token пустой). Клиент открывает
// её через WebApp.openInvoice; доступ к Premium выдаёт бот по successful_payment
// (см. bot/telegram-bot.mjs), а не этот роут — клиенту на слово не верим.
export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();

  const offer = premiumOffer();
  const token = telegramBotToken();
  if (!offer.priceStars || !token) {
    return NextResponse.json(
      { error: "payments_unavailable", message: "Оплата пока не настроена." },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "ATA Academy Premium",
        description: `Все треки без дневных лимитов, разборы рисунков и заморозка стрика — ${offer.days} дней.`,
        payload: `premium:${account.id}:${offer.days}`,
        provider_token: "",
        currency: "XTR",
        prices: [{ label: `Premium · ${offer.days} дней`, amount: offer.priceStars }],
      }),
    });
    const data = await response.json();
    if (!data.ok) throw Object.assign(new Error("createInvoiceLink"), { error: data });
    return NextResponse.json({ link: data.result });
  } catch (error) {
    logDetailedError(`Mini App: не удалось создать счёт (user ${account.id})`, error);
    return serverError("Не получилось открыть оплату. Попробуйте позже.");
  }
}
