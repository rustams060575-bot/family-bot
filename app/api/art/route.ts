import { NextResponse } from "next/server";
import { authenticate, badRequest, requireAccess, unauthorized } from "@/lib/server/session";
import { countArtAnalysis, displayName, isKid, recordActivity } from "@/lib/store.mjs";
import { artPrompt } from "@/lib/prompts.mjs";
import { analyzeImageJson, sniffImageType, visionChain, visionProvider } from "@/lib/ai.mjs";
import { logDetailedError } from "@/lib/groq.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const HEX = /^#[0-9a-f]{6}$/i;

const text = (value: unknown) => String(value ?? "").trim();

// Ответ годится, если в нём есть похвала и вопрос — остальное достраиваем мягко.
const usable = (parsed: any) =>
  !!parsed && (!!text(parsed.notDrawing) || (!!text(parsed.praise) && !!text(parsed.question)));

// Внешний try/catch: любое исключение (разбор формы, авторизация, хранилище) возвращается
// клиенту текстом со статусом 500, а не скрывается за общей фразой.
export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error: any) {
    console.error(`[Vision] необработанная ошибка /api/art: ${error?.name ?? ""} ${error?.message ?? error}`);
    if (error?.stack) console.error(error.stack);
    return NextResponse.json(
      { error: "internal", message: `${error?.name ?? "Error"}: ${error?.message ?? String(error)}` },
      { status: 500 },
    );
  }
}

async function handle(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;
  if (!visionProvider()) {
    console.error(`[Vision] отказ до запроса (user ${account.id}): нет ни GEMINI_API_KEY, ни OPENAI_API_KEY`);
    return NextResponse.json(
      { error: "vision_unavailable", message: "Анализ рисунков ещё не подключён." },
      { status: 503 },
    );
  }

  // Фото приходит как multipart/form-data (Blob), а не Base64 в JSON: лимитов body parser
  // у App Router нет, кодирование в Base64 — на сервере, прямо перед вызовом Vision.
  const reject = (reason: string, message: string) => {
    console.error(`[Vision] отказ до запроса (user ${account.id}): ${reason}`);
    return badRequest(message);
  };
  const form = await request.formData().catch((error) => {
    console.error(`[Vision] не разобран multipart (user ${account.id}): ${error?.message ?? error}`);
    return null;
  });
  const image = form?.get("image");
  if (!(image instanceof Blob)) return reject(`поле image отсутствует (${typeof image})`, "Нет изображения.");
  if (image.size === 0) return reject("пустой файл (0 байт)", "Нет изображения.");
  if (image.size > MAX_IMAGE_BYTES)
    return reject(`файл ${image.size} байт > ${MAX_IMAGE_BYTES}`, "Фото слишком большое.");

  const buffer = Buffer.from(await image.arrayBuffer());
  const mimeType = sniffImageType(buffer);
  if (!mimeType || !IMAGE_TYPES.includes(mimeType)) {
    return reject(
      `неизвестный формат: заявлен «${image.type}», первые байты ${buffer.subarray(0, 12).toString("hex")}`,
      "Нужно фото в JPEG, PNG или WebP.",
    );
  }

  // Разборы безлимитны: никакого списания и проверки дневной квоты — только статистика.
  countArtAnalysis(account);

  try {
    const parsed: any = await analyzeImageJson(
      artPrompt({ name: isKid(account) ? displayName(account) : "" }),
      buffer,
      mimeType,
      usable,
    );

    if (text(parsed.notDrawing)) {
      return NextResponse.json({ error: "not_a_drawing", message: text(parsed.notDrawing) }, { status: 422 });
    }
    recordActivity(account);

    const nextTask = parsed.nextTask ?? {};
    return NextResponse.json({
      title: text(parsed.title),
      praise: text(parsed.praise),
      colors: (Array.isArray(parsed.colors) ? parsed.colors : [])
        .map((color: any) => ({
          name: text(color?.name ?? color),
          hex: HEX.test(text(color?.hex)) ? text(color.hex) : null,
        }))
        .filter((color: { name: string }) => color.name)
        .slice(0, 4),
      details: (Array.isArray(parsed.details) ? parsed.details : [])
        .map((item: any) => ({ title: text(item?.title), text: text(item?.text) }))
        .filter((item: { text: string }) => item.text)
        .slice(0, 2),
      question: text(parsed.question),
      nextTask: {
        title: text(nextTask.title),
        steps: (Array.isArray(nextTask.steps) ? nextTask.steps : []).map(text).filter(Boolean).slice(0, 4),
        materials: text(nextTask.materials),
      },
    });
  } catch (error) {
    logDetailedError(`Mini App: анализ рисунка не удался (user ${account.id}, цепочка: ${visionChain()})`, error);
    // Причина (без ключей и тела ответа) — для консоли Mini App; ребёнок видит мягкую фразу Мартины.
    const reasons: string[] = (error as any)?.visionReasons ?? [];
    return NextResponse.json(
      {
        error: "server",
        message: "art_failed",
        reason: reasons.join("; ") || String((error as any)?.message ?? error),
      },
      { status: 502 },
    );
  }
}
