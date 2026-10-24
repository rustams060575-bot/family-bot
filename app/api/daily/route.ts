import { NextResponse } from "next/server";
import { authenticate, badRequest, requireAccess, serverError, unauthorized } from "@/lib/server/session";
import { logDetailedError } from "@/lib/groq.mjs";
import { aiChat } from "@/lib/openai.mjs";
import { parseJsonReply } from "@/lib/ai.mjs";
import { profileLine } from "@/lib/learnerProfile.mjs";
import { answerMicro, dailyLanguage, microPrompt, normalizeMicro, publicDaily, saveMicro } from "@/lib/daily.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// «Дневной трек»: главный урок по арту + микро-практика по языку на сегодня.
export async function GET(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;
  return NextResponse.json({ daily: publicDaily(account) });
}

export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  switch (String(body?.action ?? "")) {
    // Микро-практика генерируется один раз в день и не списывает дневной лимит занятий.
    case "micro": {
      if (publicDaily(account).lang.micro) return NextResponse.json({ daily: publicDaily(account) });
      const track = dailyLanguage(account);
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const reply = await aiChat(
            [
              { role: "system", content: microPrompt(account, profileLine(account)) },
              { role: "user", content: "Микро-практика на сегодня." },
            ],
            `daily micro ${account.id}`,
            { tier: "fast", maxTokens: 600, json: true },
          );
          saveMicro(account, normalizeMicro(parseJsonReply(reply), track));
          return NextResponse.json({ daily: publicDaily(account) });
        } catch (error) {
          logDetailedError(`Дневной трек: микро-практика, попытка ${attempt} (user ${account.id})`, error);
        }
      }
      return serverError("Мартина не успела подготовить микро-практику. Попробуйте ещё раз.");
    }

    case "answer": {
      const result = answerMicro(account, body?.answer);
      if (!result) return badRequest("Микро-практика ещё не готова.");
      return NextResponse.json({ result, daily: publicDaily(account) });
    }

    default:
      return badRequest("Неизвестное действие.");
  }
}
