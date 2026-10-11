import { NextResponse } from "next/server";
import {
  authenticate,
  badRequest,
  consumeOrReject,
  serverError,
  requireAccess,
  unauthorized,
} from "@/lib/server/session";
import { displayName, isKid, recordActivity, refund } from "@/lib/store.mjs";
import { artPrompt } from "@/lib/prompts.mjs";
import { analyzeImageJson, visionProvider } from "@/lib/ai.mjs";
import { logDetailedError } from "@/lib/groq.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const HEX = /^#[0-9a-f]{6}$/i;

const text = (value: unknown) => String(value ?? "").trim();

// Ответ годится, если в нём есть похвала и вопрос — остальное достраиваем мягко.
const usable = (parsed: any) => !!parsed && (!!text(parsed.notDrawing) || (!!text(parsed.praise) && !!text(parsed.question)));

export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;
  if (!visionProvider()) {
    return NextResponse.json(
      { error: "vision_unavailable", message: "Анализ рисунков ещё не подключён." },
      { status: 503 },
    );
  }

  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  if (!(image instanceof Blob) || image.size === 0) return badRequest("Нет изображения.");
  if (image.size > MAX_IMAGE_BYTES) return badRequest("Фото слишком большое.");
  const mimeType = IMAGE_TYPES.includes(image.type) ? image.type : "image/jpeg";

  const rejected = consumeOrReject(account, "art");
  if (rejected) return rejected;

  try {
    const parsed: any = await analyzeImageJson(
      artPrompt({ name: isKid(account) ? displayName(account) : "" }),
      Buffer.from(await image.arrayBuffer()),
      mimeType,
      usable,
    );

    if (text(parsed.notDrawing)) {
      refund(account, "art");
      return NextResponse.json({ error: "not_a_drawing", message: text(parsed.notDrawing) }, { status: 422 });
    }
    recordActivity(account);

    const nextTask = parsed.nextTask ?? {};
    return NextResponse.json({
      title: text(parsed.title),
      praise: text(parsed.praise),
      colors: (Array.isArray(parsed.colors) ? parsed.colors : [])
        .map((color: any) => ({ name: text(color?.name ?? color), hex: HEX.test(text(color?.hex)) ? text(color.hex) : null }))
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
    refund(account, "art");
    logDetailedError(`Mini App: анализ рисунка не удался (user ${account.id})`, error);
    return serverError("art_failed");
  }
}
