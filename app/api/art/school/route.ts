import { NextResponse } from "next/server";
import {
  authenticate,
  badRequest,
  consumeOrReject,
  requireAccess,
  serverError,
  unauthorized,
} from "@/lib/server/session";
import { refund } from "@/lib/store.mjs";
import { groqChat, logDetailedError } from "@/lib/groq.mjs";
import { parseJsonReply } from "@/lib/ai.mjs";
import {
  artLessonPrompt,
  artOf,
  nextTheme,
  normalizeArtLesson,
  publicArt,
  saveArtLesson,
  setArtAge,
  setArtStage,
} from "@/lib/artSchool.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Арт-школа Мартины: возраст ученика, урок по программе его возрастной группы и этапы.
export async function GET(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;
  return NextResponse.json({ art: publicArt(account) });
}

async function generateLesson(account: any, theme: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const reply = await groqChat(
        [
          { role: "system", content: artLessonPrompt(account, theme) },
          { role: "user", content: "Составь урок." },
        ],
        `art lesson ${account.id}`,
        { maxTokens: 1600, json: true },
      );
      return normalizeArtLesson(parseJsonReply(reply), theme);
    } catch (error) {
      lastError = error;
      logDetailedError(`Урок арт-школы: попытка ${attempt} не удалась (user ${account.id})`, error);
    }
  }
  throw lastError;
}

export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  switch (String(body?.action ?? "")) {
    // «Сколько лет юному художнику?» — возраст сохраняется в профиль.
    case "age": {
      if (!setArtAge(account, body?.age)) return badRequest("Возраст — от 4 до 18 лет.");
      return NextResponse.json({ art: publicArt(account) });
    }

    // Урок по программе: незавершённый возвращается как есть, новый — следующая тема.
    case "lesson": {
      const art = artOf(account);
      if (!art.age) return badRequest("Сначала укажите возраст.");
      if (art.lesson && !art.lesson.completedAt) return NextResponse.json({ art: publicArt(account) });
      const theme = nextTheme(account);
      if (!theme) return badRequest("Нет программы для этого возраста.");

      const rejected = consumeOrReject(account, "ai");
      if (rejected) return rejected;
      try {
        saveArtLesson(account, await generateLesson(account, theme));
        return NextResponse.json({ art: publicArt(account) });
      } catch {
        refund(account, "ai");
        return serverError("Мартина не успела подготовить урок. Попробуйте ещё раз.");
      }
    }

    // Переход между этапами урока запоминается — урок продолжится с того же места.
    case "stage": {
      if (!setArtStage(account, body?.stage)) return badRequest("Нет активного урока.");
      return NextResponse.json({ art: publicArt(account) });
    }

    default:
      return badRequest("Неизвестное действие.");
  }
}
