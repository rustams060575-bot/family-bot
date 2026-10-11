import { groqKeyCount, withGroqRotation } from "./groq.mjs";

// Анализ рисунков: Gemini Vision (основной) и Groq Vision (запасной, те же ключи Groq).
// OpenAI здесь больше не используется (429 из-за баланса). Озвучки тоже нет: голос
// Мартины — бесплатный системный синтез речи браузера (window.speechSynthesis).
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Один запрос к модели ждём не дольше 15 с; на весь перебор Gemini — не дольше 35 с,
// дальше сразу Groq. Так ребёнок не смотрит на «Мартина смотрит…» минутами.
const VISION_TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS) || 15000;
const GEMINI_BUDGET_MS = 35000;

// Основная модель — gemini-2.5-flash. Если ключу она недоступна (404) или не ответила
// за 15 с — следующая из цепочки; если 404 у всех — список доступных моделей (ListModels).
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";
const GEMINI_FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"];
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";

function visionProviders() {
  return [GEMINI_API_KEY ? "gemini" : null, groqKeyCount() > 0 ? "groq" : null].filter(Boolean);
}

export function visionProvider() {
  return visionProviders()[0] ?? null;
}

// Цепочка провайдеров для /healthz и логов: сразу видно, подключён ли Gemini.
export function visionChain() {
  const chain = visionProviders();
  return chain.length ? chain.join(" → ") : "нет ключей";
}

// Настоящий тип картинки — по сигнатуре байтов, а не по заявленному MIME: WebView
// иногда подписывает PNG или HEIC как image/jpeg, и Vision отклоняет такой запрос.
export function sniffImageType(buffer) {
  const ascii = (from, to) => buffer.subarray(from, to).toString("latin1");
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /hei[cx]|mif1|msf1/.test(ascii(8, 12))) return "image/heic";
  // Сигнатура не распознана — это не картинка, какой бы MIME ни заявил клиент.
  return null;
}

// Причина сбоя Vision человеческими словами — чтобы в логах Railway сразу было видно,
// что чинить: ключ, баланс, лимит, модель или сеть.
function describeVisionError(error) {
  const status = typeof error?.status === "number" ? error.status : null;
  const name = error?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError" || /timed? ?out/i.test(String(error?.message))) {
    return { status, retryable: true, reason: `Timeout: модель не ответила за ${VISION_TIMEOUT_MS / 1000} с` };
  }
  const body = typeof error?.error === "string" ? error.error : JSON.stringify(error?.error ?? "");
  // Gemini на неверный ключ отвечает 400 с API_KEY_INVALID, а не 401.
  if (status === 401 || /API_KEY_INVALID|API key not valid|invalid_api_key/i.test(body)) {
    return { status, retryable: false, reason: `${status ?? ""} Неверный или отозванный API-ключ`.trim() };
  }
  if (status === 403) {
    return { status, retryable: false, reason: "403 Forbidden: у ключа нет доступа к модели или API не включён" };
  }
  if (status === 402) return { status, retryable: false, reason: "402 Payment Required: закончился баланс" };
  if (status === 429) {
    const quota = /insufficient_quota|quota|billing|RESOURCE_EXHAUSTED/i.test(body);
    return {
      status,
      retryable: !quota,
      reason: quota ? "429: исчерпана квота или баланс аккаунта" : "429 Too Many Requests: превышен лимит запросов",
    };
  }
  if (status === 404) return { status, retryable: true, reason: "404: модель не найдена или недоступна ключу" };
  if (status === 400) {
    return { status, retryable: true, reason: "400 Bad Request: модель отклонила запрос (формат картинки, параметры)" };
  }
  if (status && status >= 500) return { status, retryable: true, reason: `${status}: сбой на стороне провайдера` };
  if (error instanceof SyntaxError || /JSON|неполный|пуст/i.test(String(error?.message))) {
    return { status, retryable: true, reason: `Некорректный ответ модели: ${error.message}` };
  }
  return { status, retryable: true, reason: `Сетевая или неизвестная ошибка: ${error?.message ?? error}` };
}

function logVisionError({ provider, model, imageBytes, startedAt, error }) {
  const { status, reason } = describeVisionError(error);
  console.error(
    [
      `[Vision] ОШИБКА ${provider} (${model}): ${reason}`,
      `  HTTP-статус: ${status ?? "нет"} · время: ${Date.now() - startedAt} мс · размер фото: ${Math.round(imageBytes / 1024)} КБ`,
      `  Сообщение: ${error?.message ?? error}`,
    ].join("\n"),
  );
  if (error?.error) {
    const body = typeof error.error === "string" ? error.error : JSON.stringify(error.error);
    console.error(`  Тело ответа API: ${body.replace(/\s+/g, " ").slice(0, 1500)}`);
  }
  if (error?.cause) console.error(`  Причина: ${error.cause?.code ?? ""} ${error.cause?.message ?? error.cause}`);
}

// Возвращает уже разобранный JSON. accept(parsed) решает, годится ли ответ.
// Сначала Gemini (перебор моделей), затем Groq Vision.
/** @param {(parsed: any) => boolean} [accept] */
export async function analyzeImageJson(systemPrompt, imageBuffer, mimeType, accept = (_parsed) => true) {
  const providers = visionProviders();
  if (!providers.length) {
    throw new Error("Не задан ни GEMINI_API_KEY, ни GROQ_API_KEY — анализ изображений недоступен.");
  }
  // Краткая причина по каждому провайдеру — уходит клиенту, чтобы сбой был виден в Mini App.
  const reasons = [];
  let lastError;
  for (const provider of providers) {
    // HEIC понимает только Gemini.
    if (provider === "groq" && mimeType === "image/heic") continue;
    try {
      return provider === "gemini"
        ? await analyzeWithGemini(systemPrompt, imageBuffer, mimeType, accept)
        : await analyzeWithGroq(systemPrompt, imageBuffer, mimeType, accept);
    } catch (error) {
      lastError = error;
      reasons.push(`${provider}: ${describeVisionError(error).reason}`);
    }
  }
  if (!lastError) lastError = new Error(`Нет провайдера Vision для формата ${mimeType} (HEIC понимает только Gemini)`);
  if (typeof lastError === "object") lastError.visionReasons = reasons;
  throw lastError;
}

function checkedParse(text, accept) {
  const parsed = parseJsonReply(text);
  if (!accept(parsed)) throw new Error("Vision вернул неполный ответ (нет похвалы или вопроса)");
  return parsed;
}

// ── Gemini ───────────────────────────────────────────────────────────────────

// Модель, на которой Gemini последний раз ответил, — следующие запросы идут сразу на неё.
let geminiModelInUse = null;

// Доступные этому ключу flash-модели с generateContent, новые — первыми.
async function discoverGeminiModels() {
  const response = await fetch(`${GEMINI_BASE}/models?pageSize=200&key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
  });
  if (!response.ok) {
    console.error(
      `[Vision] ListModels не удался: HTTP ${response.status} ${(await response.text().catch(() => "")).slice(0, 300)}`,
    );
    return [];
  }
  const { models = [] } = await response.json();
  const version = (name) => Number(name.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  return models
    .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
    .map((model) => String(model.name).replace(/^models\//, ""))
    .filter((name) => /^gemini-[\d.]+-flash/.test(name) && !/tts|image|audio|live|embedding/.test(name))
    .sort((a, b) => version(b) - version(a) || a.length - b.length);
}

// «Размышления» замедляют ответ на картинку в разы — выключаем или ставим минимально
// допустимый уровень: у 2.5 Flash — thinkingBudget 0, у 3.x — thinkingLevel low
// (minimal у них — ошибка), у 1.5 параметра нет вовсе.
function thinkingFor(model) {
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  if (/^gemini-[3-9]/.test(model)) return { thinkingConfig: { thinkingLevel: "low" } };
  return {};
}

async function requestGemini(model, systemPrompt, imageBuffer, mimeType) {
  const response = await fetch(
    `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [
          {
            role: "user",
            parts: [
              { text: "Вот рисунок." },
              // Формат из документации Gemini REST: inlineData { mimeType, data } — чистый Base64 без префикса data:.
              { inlineData: { mimeType, data: imageBuffer.toString("base64") } },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0.7, ...thinkingFor(model) },
      }),
    },
  );
  if (!response.ok) {
    const error = new Error(`Gemini API (${model}): HTTP ${response.status}`);
    error.status = response.status;
    error.error = await response.text().catch(() => null);
    throw error;
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  if (!text) {
    // Пустой ответ: фильтр безопасности или обрыв генерации — причину кладём в ошибку для лога.
    const error = new Error(`Gemini (${model}) вернул пустой ответ`);
    error.error = {
      finishReason: data.candidates?.[0]?.finishReason ?? null,
      blockReason: data.promptFeedback?.blockReason ?? null,
    };
    throw error;
  }
  return text;
}

// Перебор моделей: 404, таймаут, 5xx и битый ответ — пробуем следующую модель.
// Неверный ключ или исчерпанная квота — сразу к Groq: другая модель Gemini не поможет.
async function analyzeWithGemini(systemPrompt, imageBuffer, mimeType, accept) {
  const startedAll = Date.now();
  const tried = new Set();
  let candidates = [...new Set([geminiModelInUse, GEMINI_VISION_MODEL, ...GEMINI_FALLBACK_MODELS].filter(Boolean))];
  let onlyNotFound = true;
  let discovered = false;
  let lastError;
  while (true) {
    for (const model of candidates) {
      if (tried.has(model)) continue;
      if (Date.now() - startedAll > GEMINI_BUDGET_MS) {
        console.error(`[Vision] Gemini: исчерпан бюджет ${GEMINI_BUDGET_MS / 1000} с — переключаюсь на Groq`);
        throw lastError ?? new Error("Gemini не ответил вовремя");
      }
      tried.add(model);
      const startedAt = Date.now();
      try {
        const parsed = checkedParse(await requestGemini(model, systemPrompt, imageBuffer, mimeType), accept);
        if (geminiModelInUse !== model)
          console.warn(`[Vision] Gemini отвечает на модели ${model} (${Date.now() - startedAt} мс)`);
        geminiModelInUse = model;
        return parsed;
      } catch (error) {
        lastError = error;
        logVisionError({ provider: "gemini", model, imageBytes: imageBuffer.length, startedAt, error });
        if (geminiModelInUse === model) geminiModelInUse = null;
        if (!describeVisionError(error).retryable) throw error;
        if (error?.status !== 404) onlyNotFound = false;
      }
    }
    // Все известные модели недоступны ключу (404) — спрашиваем у Google, какие есть.
    if (discovered || !onlyNotFound) break;
    discovered = true;
    candidates = await discoverGeminiModels().catch(() => []);
    console.warn(`[Vision] ListModels: доступные flash-модели — ${candidates.join(", ") || "нет"}`);
  }
  throw lastError;
}

// ── Groq Vision ──────────────────────────────────────────────────────────────

async function analyzeWithGroq(systemPrompt, imageBuffer, mimeType, accept) {
  const startedAt = Date.now();
  try {
    const response = await withGroqRotation(
      (client) =>
        client.chat.completions.create(
          {
            model: GROQ_VISION_MODEL,
            max_completion_tokens: 1200,
            temperature: 0.7,
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: [
                  { type: "text", text: "Вот рисунок. Ответь строго JSON-объектом, как описано." },
                  {
                    type: "image_url",
                    image_url: { url: `data:${mimeType};base64,${imageBuffer.toString("base64")}` },
                  },
                ],
              },
            ],
          },
          { timeout: VISION_TIMEOUT_MS, maxRetries: 0 },
        ),
      "vision",
    );
    const parsed = checkedParse(response.choices?.[0]?.message?.content ?? "", accept);
    console.warn(`[Vision] ответил Groq (${GROQ_VISION_MODEL}, ${Date.now() - startedAt} мс)`);
    return parsed;
  } catch (error) {
    logVisionError({ provider: "groq", model: GROQ_VISION_MODEL, imageBytes: imageBuffer.length, startedAt, error });
    throw error;
  }
}

// Модели иногда оборачивают JSON в ```json … ``` или добавляют фразу до/после даже
// в JSON-режиме — берём текст от первой «{» до последней «}».
export function parseJsonReply(text) {
  const raw = String(text ?? "");
  const from = raw.indexOf("{");
  const to = raw.lastIndexOf("}");
  if (from === -1 || to <= from) throw new Error("В ответе модели нет JSON-объекта");
  return JSON.parse(raw.slice(from, to + 1));
}
