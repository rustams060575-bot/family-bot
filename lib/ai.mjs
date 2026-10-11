import OpenAI from "openai";

// Анализ рисунков: Gemini Vision (основной) и GPT-4o Vision (запасной). Озвучки здесь нет:
// голос Мартины — бесплатный системный синтез речи браузера (window.speechSynthesis).
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o";
// Gemini 2.5 с осени 2026 отдаётся только проектам, которые пользовались им раньше, —
// новые ключи получают 404. Основная модель — gemini-3.8-flash; при 404 перебираем запасные,
// а если не подошла ни одна — спрашиваем у API список доступных моделей (ListModels).
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-3.8-flash";
const GEMINI_FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// Vision: Gemini — всегда основной (быстрый и дешёвый), OpenAI — только запасной.
// Старая переменная VISION_PROVIDER больше не влияет на порядок.
const VISION_TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS) || 30000;

function visionProviders() {
  return [GEMINI_API_KEY ? "gemini" : null, openai ? "openai" : null].filter(Boolean);
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
// что чинить: ключ, баланс, лимит или сеть.
function describeVisionError(error) {
  const status = typeof error?.status === "number" ? error.status : null;
  const name = error?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError" || /timed? ?out/i.test(String(error?.message))) {
    return { status, retryable: true, reason: `Timeout: провайдер не ответил за ${VISION_TIMEOUT_MS / 1000} с` };
  }
  const body = typeof error?.error === "string" ? error.error : JSON.stringify(error?.error ?? "");
  // Gemini на неверный ключ отвечает 400 с API_KEY_INVALID, а не 401.
  if (status === 401 || /API_KEY_INVALID|API key not valid|invalid_api_key/i.test(body)) {
    return { status, retryable: false, reason: `${status ?? ""} Неверный или отозванный API-ключ`.trim() };
  }
  if (status === 403)
    return {
      status,
      retryable: false,
      reason: "403 Forbidden: у ключа нет доступа к модели или API не включён в проекте",
    };
  if (status === 402) return { status, retryable: false, reason: "402 Payment Required: закончился баланс" };
  if (status === 429) {
    const quota = /insufficient_quota|quota|billing|RESOURCE_EXHAUSTED/i.test(body);
    return {
      status,
      retryable: false,
      reason: quota ? "429: исчерпана квота или баланс аккаунта" : "429 Too Many Requests: превышен лимит запросов",
    };
  }
  if (status === 400)
    return {
      status,
      retryable: false,
      reason: "400 Bad Request: модель отклонила запрос (формат картинки, имя модели, параметры)",
    };
  if (status === 404)
    return {
      status,
      retryable: false,
      reason: "404: модель не найдена — проверьте GEMINI_VISION_MODEL / OPENAI_VISION_MODEL",
    };
  if (status && status >= 500) return { status, retryable: true, reason: `${status}: сбой на стороне провайдера` };
  if (error instanceof SyntaxError || /JSON|неполный|пуст/i.test(String(error?.message))) {
    return { status, retryable: true, reason: `Некорректный ответ модели: ${error.message}` };
  }
  return { status, retryable: true, reason: `Сетевая или неизвестная ошибка: ${error?.message ?? error}` };
}

function logVisionError({ provider, model, attempt, imageBytes, startedAt, error }) {
  const { status, reason } = describeVisionError(error);
  console.error(
    `[Vision] ОШИБКА ${provider} (${model}), попытка ${attempt}: ${reason}
` +
      `  HTTP-статус: ${status ?? "нет"} · время: ${Date.now() - startedAt} мс · размер фото: ${Math.round(imageBytes / 1024)} КБ
` +
      `  Сообщение: ${error?.message ?? error}`,
  );
  if (error?.error) {
    const body = typeof error.error === "string" ? error.error : JSON.stringify(error.error);
    console.error(`  Тело ответа API: ${body.replace(/\s+/g, " ").slice(0, 1500)}`);
  }
  if (error?.cause) console.error(`  Причина: ${error.cause?.code ?? ""} ${error.cause?.message ?? error.cause}`);
}

// Gemini — основной провайдер: до двух попыток на временные сбои (таймаут, 5xx, битый JSON).
// Ошибки ключа, баланса и лимитов повторять бессмысленно — сразу переходим к OpenAI.
// Возвращает уже разобранный JSON. accept(parsed) решает, годится ли ответ.
/** @param {(parsed: any) => boolean} [accept] */
export async function analyzeImageJson(systemPrompt, imageBuffer, mimeType, accept = (_parsed) => true) {
  const providers = visionProviders();
  if (!providers.length) {
    throw new Error("Не задан ни GEMINI_API_KEY, ни OPENAI_API_KEY — анализ изображений недоступен.");
  }
  let lastError;
  // Краткая причина по каждому провайдеру — уходит клиенту, чтобы сбой был виден и в консоли Mini App.
  const reasons = [];
  for (const provider of providers) {
    // HEIC понимает только Gemini — OpenAI с ним не вызываем.
    if (provider === "openai" && mimeType === "image/heic") continue;
    const call = provider === "gemini" ? analyzeWithGemini : analyzeWithOpenAI;
    const model = provider === "gemini" ? (geminiModelInUse ?? GEMINI_VISION_MODEL) : OPENAI_VISION_MODEL;
    const tries = provider === providers[0] ? 2 : 1;
    for (let attempt = 1; attempt <= tries; attempt++) {
      const startedAt = Date.now();
      try {
        const parsed = parseJsonReply(await call(systemPrompt, imageBuffer, mimeType));
        if (!accept(parsed)) throw new Error("Vision вернул неполный ответ (нет похвалы или вопроса)");
        if (provider !== providers[0] || attempt > 1) {
          console.warn(`[Vision] успех через ${provider}, попытка ${attempt} (${Date.now() - startedAt} мс)`);
        }
        return parsed;
      } catch (error) {
        lastError = error;
        logVisionError({ provider, model, attempt, imageBytes: imageBuffer.length, startedAt, error });
        const { reason, retryable } = describeVisionError(error);
        if (!retryable || attempt === tries) reasons.push(`${provider}: ${reason}`);
        if (!retryable) break;
      }
    }
  }
  if (!lastError) lastError = new Error(`Нет провайдера Vision для формата ${mimeType} (HEIC понимает только Gemini)`);
  if (typeof lastError === "object") lastError.visionReasons = reasons;
  throw lastError;
}

async function analyzeWithOpenAI(systemPrompt, imageBuffer, mimeType) {
  const response = await openai.chat.completions.create(
    {
      model: OPENAI_VISION_MODEL,
      response_format: { type: "json_object" },
      max_tokens: 1200,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Вот рисунок." },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBuffer.toString("base64")}` },
            },
          ],
        },
      ],
    },
    { timeout: VISION_TIMEOUT_MS, maxRetries: 0 },
  );
  return response.choices?.[0]?.message?.content ?? "";
}

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
    .filter((name) => /^gemini-[\d.]+-flash/.test(name) && !/tts|image|audio|live|embedding|preview-tts/.test(name))
    .sort((a, b) => version(b) - version(a) || a.length - b.length);
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
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7,
          // thinkingBudget: 0 понимает только 2.5 Flash; у моделей 3.x свой режим размышлений
          // (минимальный уровень у них — ошибка), поэтому для них параметр не передаём.
          ...(/^gemini-2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
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

// 404 «модель не найдена» не считается сбоем: пробуем следующую модель из цепочки.
async function analyzeWithGemini(systemPrompt, imageBuffer, mimeType) {
  const tried = new Set();
  let candidates = [...new Set([geminiModelInUse, GEMINI_VISION_MODEL, ...GEMINI_FALLBACK_MODELS].filter(Boolean))];
  let discovered = false;
  let lastNotFound;
  while (true) {
    for (const model of candidates) {
      if (tried.has(model)) continue;
      tried.add(model);
      try {
        const text = await requestGemini(model, systemPrompt, imageBuffer, mimeType);
        if (geminiModelInUse !== model) console.warn(`[Vision] Gemini отвечает на модели ${model}`);
        geminiModelInUse = model;
        return text;
      } catch (error) {
        if (error?.status !== 404) throw error;
        lastNotFound = error;
        console.error(`[Vision] Gemini: модель ${model} недоступна этому ключу (404), пробую следующую`);
        if (geminiModelInUse === model) geminiModelInUse = null;
      }
    }
    if (discovered) break;
    discovered = true;
    candidates = await discoverGeminiModels();
    console.warn(`[Vision] ListModels: доступные flash-модели — ${candidates.join(", ") || "нет"}`);
  }
  throw lastNotFound;
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
