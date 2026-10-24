import { NextResponse } from "next/server";
import {
  authenticate,
  badRequest,
  consumeOrReject,
  requireAccess,
  serverError,
  unauthorized,
} from "@/lib/server/session";
import { recordActivity, refund } from "@/lib/store.mjs";
import { profileLine } from "@/lib/learnerProfile.mjs";
import { logDetailedError } from "@/lib/groq.mjs";
import { aiChat } from "@/lib/openai.mjs";
import { studentProfileBlock } from "@/lib/studentMemory.mjs";
import { recordTurn, summarizeInBackground } from "@/lib/sessionSummary.mjs";
import { parseJsonReply } from "@/lib/ai.mjs";
import {
  LANGUAGE_TRACKS,
  completeLesson,
  learningOf,
  lessonPrompt,
  normalizeLesson,
  placementQuestions,
  publicLearning,
  publicLesson,
  saveLesson,
  scorePlacement,
  setLessonStep,
  setLevel,
  todayKey,
} from "@/lib/learning.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Адаптивное обучение: состояние трека (уровень, урок дня, прогресс) и действия с ним.
export async function GET(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const track = params.get("track") ?? "";
  if (!LANGUAGE_TRACKS.includes(track)) return badRequest("Неизвестный трек.");
  const learning = publicLearning(account, track);
  // Вопросы теста — если уровень ещё не известен или ученик решил пройти тест заново.
  const wantsTest = !learning.level || params.get("retake") === "1";
  return NextResponse.json({ learning, placement: wantsTest ? placementQuestions(track) : null });
}

// Генерация урока дня: до двух попыток — модель изредка присылает неполный JSON.
async function generateLesson(
  track: string,
  level: string,
  topics: string[],
  label: string,
  profile: string,
  gaps: string[],
  memory: string,
  learning: any,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const reply = await aiChat(
        [
          { role: "system", content: lessonPrompt(track, level, topics, profile, gaps, memory, learning) },
          { role: "user", content: "Составь урок на сегодня." },
        ],
        label,
        {
          tier: "dialog",
          maxTokens: 2000,
          json: true,
        },
      );
      return normalizeLesson(parseJsonReply(reply));
    } catch (error) {
      lastError = error;
      logDetailedError(`Урок дня: попытка ${attempt} не удалась (${label})`, error);
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
  const track = String(body?.track ?? "");
  const action = String(body?.action ?? "");
  if (!LANGUAGE_TRACKS.includes(track)) return badRequest("Неизвестный трек.");
  const learning = learningOf(account, track);

  switch (action) {
    // Срез знаний: сервер сверяет ответы с ключами, сохраняет уровень и точечные пробелы.
    case "placement": {
      const result = scorePlacement(track, body?.answers);
      setLevel(account, track, result.level, "test", result.gaps);
      return NextResponse.json({ result, learning: publicLearning(account, track) });
    }

    // Уровень вручную — для тех, кто знает свой уровень и не хочет проходить тест.
    case "level": {
      if (!setLevel(account, track, String(body?.level ?? ""), "manual")) return badRequest("Неизвестный уровень.");
      return NextResponse.json({ learning: publicLearning(account, track) });
    }

    // Урок дня: сегодняшний (или незавершённый) возвращается как есть; новый — после завершения.
    case "lesson": {
      if (!learning.level) return badRequest("Сначала определим уровень.");
      const current = learning.lesson;
      const reusable = current && (!current.completedAt || (current.date === todayKey(account) && !body?.next));
      if (reusable) return NextResponse.json({ learning: publicLearning(account, track) });

      const rejected = consumeOrReject(account, "ai");
      if (rejected) return rejected;
      try {
        const lesson = await generateLesson(
          track,
          learning.level,
          learning.topics,
          `lesson ${track} ${account.id}`,
          profileLine(account),
          learning.gaps ?? [],
          studentProfileBlock(account, track),
          learning,
        );
        saveLesson(account, track, lesson);
        return NextResponse.json({ learning: publicLearning(account, track) });
      } catch (error) {
        refund(account, "ai");
        return serverError("Мартина не успела подготовить урок. Попробуйте ещё раз.");
      }
    }

    // Шаг урока запоминается — при следующем входе урок продолжится с того же места.
    case "step": {
      if (!setLessonStep(account, track, String(body?.step ?? ""))) return badRequest("Нет активного урока.");
      return NextResponse.json({ learning: publicLearning(account, track) });
    }

    // Экспресс-тест: проверка на сервере, урок засчитывается в прогресс и серию занятий.
    case "complete": {
      const result = completeLesson(account, track, body?.answers);
      if (!result) return badRequest("Нет активного урока.");
      recordActivity(account);
      // Урок завершён — выжимка и обновление слабых мест в профиле (в фоне).
      summarizeInBackground(account, track, "lesson");
      return NextResponse.json({
        result,
        lesson: publicLesson(learning.lesson, { revealAnswers: true }),
        learning: publicLearning(account, track),
      });
    }

    default:
      return badRequest("Неизвестное действие.");
  }
}
