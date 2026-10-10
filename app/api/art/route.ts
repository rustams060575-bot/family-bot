import { NextResponse } from "next/server";
import {
  authenticate,
  badRequest,
  consumeOrReject,
  serverError,
  unauthorized,
} from "@/lib/server/session";
import { displayName, isVip, recordActivity, refund } from "@/lib/store.mjs";
import { artPrompt } from "@/lib/prompts.mjs";
import { analyzeImageJson, parseJsonReply, visionProvider } from "@/lib/ai.mjs";
import { logDetailedError } from "@/lib/groq.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
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
  if (!IMAGE_TYPES.includes(image.type)) return badRequest("Нужен JPEG, PNG или WebP.");

  const rejected = consumeOrReject(account, "art");
  if (rejected) return rejected;

  try {
    const raw = await analyzeImageJson(
      artPrompt({ name: displayName(account), vip: isVip(account) }),
      Buffer.from(await image.arrayBuffer()),
      image.type,
    );
    const parsed = parseJsonReply(raw);

    if (parsed.error) {
      refund(account, "art");
      return NextResponse.json({ error: "not_a_drawing", message: String(parsed.error) }, { status: 422 });
    }

    const strengths = Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 2) : [];
    if (strengths.length < 2 || !parsed.tip || !parsed.nextTask) throw new Error("Неполный ответ Vision");
    recordActivity(account);

    return NextResponse.json({
      title: String(parsed.title ?? ""),
      strengths: strengths.map((item: any) => ({ title: String(item.title ?? ""), text: String(item.text ?? "") })),
      tip: { title: String(parsed.tip.title ?? ""), text: String(parsed.tip.text ?? "") },
      nextTask: {
        title: String(parsed.nextTask.title ?? ""),
        steps: Array.isArray(parsed.nextTask.steps) ? parsed.nextTask.steps.slice(0, 4).map(String) : [],
        materials: String(parsed.nextTask.materials ?? ""),
      },
    });
  } catch (error) {
    refund(account, "art");
    logDetailedError(`Mini App: анализ рисунка не удался (user ${account.id})`, error);
    return serverError("Не получилось разобрать рисунок. Попробуйте ещё раз.");
  }
}
