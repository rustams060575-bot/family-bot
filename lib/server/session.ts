import { NextResponse } from "next/server";
import { DEV_USER, allowDevUser, verifyInitData } from "@/lib/telegram-auth.mjs";
import { accessStatus, consume, upsertAccount } from "@/lib/store.mjs";

export type Account = ReturnType<typeof upsertAccount>;

// Каждый запрос Mini App несёт Telegram.WebApp.initData в заголовке; подпись
// проверяется HMAC-ом от токена бота. Без валидной подписи — 401.
export function authenticate(request: Request): Account | null {
  const initData = request.headers.get("x-telegram-init-data") ?? "";
  let user = verifyInitData(initData);
  if (!user && !initData && allowDevUser()) user = DEV_USER;
  if (!user) return null;
  return upsertAccount(user);
}

// Закрытая школа: ИИ-функции, CRM и оплата — только после одобрения заявки.
export function requireAccess(account: Account) {
  const status = accessStatus(account);
  if (status === "approved") return null;
  return NextResponse.json(
    {
      error: "access",
      status,
      message: status === "pending" ? "Заявка на рассмотрении у администратора школы." : "Нужна одобренная заявка в школу.",
    },
    { status: 403 },
  );
}

export function unauthorized() {
  return NextResponse.json(
    { error: "unauthorized", message: "Откройте приложение из Telegram." },
    { status: 401 },
  );
}

// Списывает действие из дневного лимита; при исчерпании — 402 с данными для
// плашки Premium на клиенте.
export function consumeOrReject(account: Account, kind: "ai" | "art") {
  const result = consume(account, kind);
  if (result.ok) return null;
  return NextResponse.json(
    {
      error: "limit",
      kind,
      limit: result.limit,
      message:
        kind === "art"
          ? "Бесплатные разборы рисунков на сегодня закончились."
          : "Бесплатные занятия на сегодня закончились.",
    },
    { status: 402 },
  );
}

export function serverError(message = "Не получилось получить ответ. Попробуйте ещё раз через минуту.") {
  return NextResponse.json({ error: "server", message }, { status: 502 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: "bad_request", message }, { status: 400 });
}
