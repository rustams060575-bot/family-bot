import { NextResponse } from "next/server";
import { authenticate, badRequest, serverError, unauthorized } from "@/lib/server/session";
import { groqTranscribe, logDetailedError } from "@/lib/groq.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
// Сегменты, где средняя лог-вероятность ниже порога, Whisper разобрал неуверенно —
// частый признак неточного произношения (или шума). Порог подобран консервативно.
const UNCERTAIN_LOGPROB = -0.7;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

// Распознавание не списывает лимит само по себе: голосовой ход оплачивается один раз,
// в /api/chat, куда клиент сразу отправляет расшифровку.
export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  const language = form?.get("language");
  if (!(audio instanceof Blob) || audio.size === 0) return badRequest("Нет записи.");
  if (audio.size > MAX_AUDIO_BYTES) return badRequest("Запись слишком длинная.");

  const baseType = audio.type.split(";")[0];
  const filename = `speech.${EXTENSION_BY_TYPE[baseType] ?? "webm"}`;

  try {
    const result: any = await groqTranscribe(
      Buffer.from(await audio.arrayBuffer()),
      filename,
      `app stt ${account.id}`,
      typeof language === "string" && /^[a-z]{2}$/.test(language) ? language : undefined,
    );
    const segments: any[] = Array.isArray(result?.segments) ? result.segments : [];
    return NextResponse.json({
      text: String(result?.text ?? "").trim(),
      uncertain: segments
        .filter((segment) => typeof segment.avg_logprob === "number" && segment.avg_logprob < UNCERTAIN_LOGPROB)
        .map((segment) => String(segment.text).trim())
        .filter(Boolean),
    });
  } catch (error) {
    logDetailedError(`Mini App: распознавание речи не удалось (user ${account.id})`, error);
    return serverError("Не получилось распознать запись. Попробуйте ещё раз.");
  }
}
