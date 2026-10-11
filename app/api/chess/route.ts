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
import { profileLine } from "@/lib/learnerProfile.mjs";
import { groqChat, logDetailedError } from "@/lib/groq.mjs";
import { parseJsonReply } from "@/lib/ai.mjs";
import { setArtAge } from "@/lib/artSchool.mjs";
import {
  answerChessLesson,
  answerPuzzle,
  applySurvey,
  chessLessonPrompt,
  chessOf,
  nextChessTopic,
  nextPractice,
  normalizeChessLesson,
  publicChess,
  recordGame,
  saveChessLesson,
} from "@/lib/chessSchool.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// «Шахматы & Логика с Лео»: опрос и уровень, урок по программе, задача дня и практика.
export async function GET(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;
  return NextResponse.json({ chess: publicChess(account) });
}

async function generateLesson(account: any, topic: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const reply = await groqChat(
        [
          { role: "system", content: chessLessonPrompt(account, topic, profileLine(account)) },
          { role: "user", content: "Составь урок." },
        ],
        `chess lesson ${account.id}`,
        { maxTokens: 1200, json: true },
      );
      return normalizeChessLesson(parseJsonReply(reply), topic);
    } catch (error) {
      lastError = error;
      logDetailedError(`Урок Лео: попытка ${attempt} не удалась (user ${account.id})`, error);
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
    // Возраст общий с арт-школой — Лео спрашивает его, только если он ещё не известен.
    case "age": {
      if (!setArtAge(account, body?.age)) return badRequest("Возраст — от 4 до 18 лет.");
      return NextResponse.json({ chess: publicChess(account) });
    }

    // Опрос Лео: два ответа «да / нет» → chess_level в профиле.
    case "survey": {
      applySurvey(account, { moves: body?.moves === true, mate: body?.mate === true });
      return NextResponse.json({ chess: publicChess(account) });
    }

    // Урок по программе: незавершённый возвращается как есть, новый — следующая тема.
    case "lesson": {
      const chess = chessOf(account);
      if (chess.lesson && !chess.lesson.completedAt) return NextResponse.json({ chess: publicChess(account) });
      const topic = nextChessTopic(account);
      if (!topic) return badRequest("Сначала ответьте на вопросы Лео.");

      const rejected = consumeOrReject(account, "ai");
      if (rejected) return rejected;
      try {
        saveChessLesson(account, await generateLesson(account, topic));
        return NextResponse.json({ chess: publicChess(account) });
      } catch {
        refund(account, "ai");
        return serverError("Лео не успел подготовить урок. Попробуйте ещё раз.");
      }
    }

    case "lesson-answer": {
      const result = answerChessLesson(account, body?.answer);
      if (!result) return badRequest("Нет активного урока.");
      return NextResponse.json({ result, chess: publicChess(account) });
    }

    // Ответ на задачу: slot — daily (задача дня) или practice (ещё задачи).
    case "puzzle": {
      const result = answerPuzzle(account, String(body?.slot ?? ""), body?.answer);
      if (!result) return badRequest("Задача уже закрыта.");
      return NextResponse.json({ result, chess: publicChess(account) });
    }

    // Итог партии с Лео: результат, цвет, число полуходов.
    case "game": {
      if (!recordGame(account, { result: body?.result, color: body?.color, plies: body?.plies, level: body?.level })) {
        return badRequest("Неизвестный итог партии.");
      }
      return NextResponse.json({ chess: publicChess(account) });
    }

    case "next-practice": {
      nextPractice(account);
      return NextResponse.json({ chess: publicChess(account) });
    }

    default:
      return badRequest("Неизвестное действие.");
  }
}
