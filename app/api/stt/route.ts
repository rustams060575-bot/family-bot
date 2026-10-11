import { NextResponse } from "next/server";
import { authenticate, badRequest, serverError, requireAccess, unauthorized } from "@/lib/server/session";
import { groqTranscribe, logDetailedError } from "@/lib/groq.mjs";
import { displayName, isKid } from "@/lib/store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
// Сегменты, где средняя лог-вероятность ниже порога, Whisper разобрал неуверенно —
// частый признак неточного произношения (или шума). Порог подобран консервативно.
const UNCERTAIN_LOGPROB = -0.7;
// Ниже этого вся запись — шум или шёпот: честнее переспросить, чем угадывать.
const UNCLEAR_LOGPROB = -1.1;
const NO_SPEECH_PROB = 0.6;

// Whisper на тишине и шуме «досочиняет» титры из обучающих видео — такие ответы
// считаем пустыми, а не репликой ученика.
const HALLUCINATIONS =
  /^(продолжение следует|субтитры (сделал|создавал|подготовил)|редактор субтитров|спасибо за просмотр|thank you( so much)? for watching|thanks for watching|subtitles by|please subscribe|you|\.+|…)[.!?…\s]*$/i;

// Языковой приоритет: русский — родной язык учеников, английский и испанский — изучаемые.
// Всё остальное (украинский, болгарский и т. п. на коротких фразах) — ошибка автоопределения.
const ALLOWED_LANGS: Record<string, string[]> = {
  english: ["ru", "en"],
  spanish: ["ru", "es", "en"],
};
const LANG_CODES: Record<string, string> = { russian: "ru", english: "en", spanish: "es" };

function langCode(value: unknown) {
  const raw = String(value ?? "").toLowerCase();
  return LANG_CODES[raw] ?? raw.slice(0, 2);
}

// Подсказка Whisper: имя наставника и ученика плюс фраза на каждом ожидаемом языке.
function vocabularyPrompt(track: string, name: string, kid: boolean) {
  const hello = name ? `Привет, Мартина! Я ${name}.` : "Привет, Мартина!";
  if (track === "art")
    return `${hello} Что мне нарисовать? Дай сложное задание. Хочу нарисовать дракона, замок, ракету. Краски, карандаши, фломастеры.`;
  if (kid) return `${hello} Космос, ракета, машинки, супергерои. Hello! Cat, dog, rocket, car.`;
  if (track === "spanish") return `${hello} Hola, ¿qué tal? Quiero practicar español.`;
  return `${hello} Hello, how are you? I'd like to practice my English.`;
}

// Контейнер записи определяем по сигнатуре байтов: iOS WebView нередко отдаёт Blob
// без MIME-типа, и запись mp4 под именем .webm Whisper отклоняет.
function sniffExtension(bytes: Buffer, mime: string) {
  const ascii = (from: number, to: number) => bytes.subarray(from, to).toString("latin1");
  if (ascii(4, 8) === "ftyp") return "m4a";
  if (ascii(0, 4) === "OggS") return "ogg";
  if (bytes.readUInt32BE(0) === 0x1a45dfa3) return "webm";
  if (ascii(0, 4) === "RIFF") return "wav";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "mp3";
  if (/mp4|m4a|aac/.test(mime)) return "m4a";
  if (/ogg/.test(mime)) return "ogg";
  return "webm";
}

type Segment = { text?: string; avg_logprob?: number; no_speech_prob?: number };

function isUnclear(text: string, segments: Segment[]) {
  if (!text || HALLUCINATIONS.test(text)) return true;
  if (!segments.length) return false;
  const silent = segments.every((segment) => (segment.no_speech_prob ?? 0) > NO_SPEECH_PROB);
  const meanLogprob = segments.reduce((sum, segment) => sum + (segment.avg_logprob ?? 0), 0) / segments.length;
  return silent || meanLogprob < UNCLEAR_LOGPROB;
}

// Распознавание не списывает лимит само по себе: голосовой ход оплачивается один раз,
// в /api/chat, куда клиент сразу отправляет расшифровку.
// Неразборчивая запись — не ошибка: ответ 200 с unclear: true, и Мартина ласково переспрашивает.
export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  const track = String(form?.get("track") ?? "english");
  if (!(audio instanceof Blob) || audio.size === 0) return badRequest("Нет записи.");
  if (audio.size > MAX_AUDIO_BYTES) return badRequest("Запись слишком длинная.");

  const buffer = Buffer.from(await audio.arrayBuffer());
  if (buffer.length < 16) return NextResponse.json({ text: "", uncertain: [], unclear: true });
  const filename = `speech.${sniffExtension(buffer, audio.type)}`;
  const kid = isKid(account);
  const allowed = ALLOWED_LANGS[track] ?? ALLOWED_LANGS.english;
  const prompt = vocabularyPrompt(track, displayName(account), kid);
  const label = `app stt ${account.id}`;

  try {
    let result: any = await groqTranscribe(buffer, filename, label, { prompt });
    // Автоопределение ошиблось языком — повторяем с жёстким приоритетом: русский.
    if (!allowed.includes(langCode(result?.language))) {
      result = await groqTranscribe(buffer, filename, `${label} ru`, { prompt, language: "ru" });
    }

    const text = String(result?.text ?? "").trim();
    const segments: Segment[] = Array.isArray(result?.segments) ? result.segments : [];
    if (isUnclear(text, segments)) return NextResponse.json({ text: "", uncertain: [], unclear: true });

    return NextResponse.json({
      text,
      language: langCode(result?.language),
      // Детям не подсвечиваем «неуверенные» слова: никаких разборов произношения.
      uncertain: kid
        ? []
        : segments
            .filter((segment) => typeof segment.avg_logprob === "number" && segment.avg_logprob < UNCERTAIN_LOGPROB)
            .map((segment) => String(segment.text).trim())
            .filter(Boolean),
    });
  } catch (error) {
    logDetailedError(`Mini App: распознавание речи не удалось (user ${account.id})`, error);
    return serverError("stt_failed");
  }
}
