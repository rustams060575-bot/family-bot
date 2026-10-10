// Клиент API Mini App. initData Telegram уходит в каждом запросе — сервер проверяет
// его подпись и по нему понимает, кто пользователь.
let initData = "";

export function setInitData(value: string) {
  initData = value;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public data: { error?: string; message?: string; kind?: "ai" | "art" } = {},
  ) {
    super(data.message ?? `HTTP ${status}`);
  }
  get isLimit() {
    return this.status === 402;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (initData) headers.set("x-telegram-init-data", initData);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data);
  }
  return response;
}

export async function apiJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  return response.json();
}
