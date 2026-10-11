import fs from "fs";
import { authenticate, unauthorized } from "@/lib/server/session";
import { artworkFile } from "@/lib/learnerProfile.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Файл рисунка — только владельцу аккаунта (проверка подписи Telegram в заголовке).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const found = artworkFile(account, params.id);
  if (!found) return new Response("Не найдено", { status: 404 });
  return new Response(fs.readFileSync(found.file), {
    headers: { "Content-Type": found.mimeType || "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
}
