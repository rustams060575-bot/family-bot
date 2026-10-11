import OpenAI from "openai";

// Голос репетитора (OpenAI TTS) и анализ рисунков (Gemini Vision или GPT-4o Vision).
// Каждый провайдер необязателен: без ключа соответствующая функция сообщает, что
// недоступна, а клиент переключается на запасной вариант (системный голос браузера).
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
export const TTS_VOICES = ["nova", "shimmer", "alloy"];
export const TTS_DEFAULT_VOICE = TTS_VOICES.includes(process.env.OPENAI_TTS_VOICE)
  ? process.env.OPENAI_TTS_VOICE
  : "nova";
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o";
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

export function ttsAvailable() {
  return !!openai;
}

// Голос OpenAI — привилегия Premium/VIP. Free слышит системный голос устройства;
// TTS_FOR_FREE=true открывает голос OpenAI всем (дороже, но звучит лучше).
export function ttsAllowed(premium) {
  return ttsAvailable() && (premium || process.env.TTS_FOR_FREE === "true");
}

// Vision: Gemini — всегда основной (быстрый и дешёвый), OpenAI — только запасной.
// Старая переменная VISION_PROVIDER больше не влияет на порядок.
const VISION_TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS) || 30000;

function visionProviders() {
  return [GEMINI_API_KEY ? "gemini" : null, openai ? "openai" : null].filter(Boolean);
}

export function visionProvider() {
  return visionProviders()[0] ?? null;
}

const TTS_STYLE =
  "Спокойная, элегантная женщина-репетитор. Чистое естественное произношение, " +
  "умеренный темп, лёгкие паузы между фразами, тёплая интонация без наигранности.";

export async function synthesizeSpeech(text, voice = TTS_DEFAULT_VOICE) {
  if (!openai) throw new Error("OPENAI_API_KEY не задан — озвучка недоступна.");
  const response = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICES.includes(voice) ? voice : TTS_DEFAULT_VOICE,
    input: text,
    response_format: "mp3",
    // instructions понимают только модели семейства gpt-4o-*-tts; tts-1 их отклоняет.
    ...(TTS_MODEL.startsWith("gpt-4o") ? { instructions: TTS_STYLE } : {}),
  });
  return Buffer.from(await response.arrayBuffer());
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
  for (const provider of providers) {
    const call = provider === "gemini" ? analyzeWithGemini : analyzeWithOpenAI;
    const model = provider === "gemini" ? GEMINI_VISION_MODEL : OPENAI_VISION_MODEL;
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
        if (!describeVisionError(error).retryable) break;
      }
    }
  }
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

async function analyzeWithGemini(systemPrompt, imageBuffer, mimeType) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent` +
    `?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(url, {
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
            { inline_data: { mime_type: mimeType, data: imageBuffer.toString("base64") } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
        // Flash без «размышлений» отвечает быстрее и не обрезает JSON на лимите токенов.
        ...(GEMINI_VISION_MODEL.includes("flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    }),
  });
  if (!response.ok) {
    const error = new Error(`Gemini API: HTTP ${response.status}`);
    error.status = response.status;
    error.error = await response.text().catch(() => null);
    throw error;
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  if (!text) {
    // Пустой ответ: фильтр безопасности или обрыв генерации — причину кладём в ошибку для лога.
    const error = new Error("Gemini вернул пустой ответ");
    error.error = {
      finishReason: data.candidates?.[0]?.finishReason ?? null,
      blockReason: data.promptFeedback?.blockReason ?? null,
    };
    throw error;
  }
  return text;
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
