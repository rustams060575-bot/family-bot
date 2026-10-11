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

export function visionProvider() {
  const preferred = process.env.VISION_PROVIDER;
  if (preferred === "openai" && openai) return "openai";
  if (preferred === "gemini" && GEMINI_API_KEY) return "gemini";
  if (GEMINI_API_KEY) return "gemini";
  if (openai) return "openai";
  return null;
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

// Порядок попыток: основной провайдер дважды (вторая попытка снимает случайный сбой —
// пустой ответ, обрезанный JSON, 503), затем запасной, если для него есть ключ.
function visionAttempts() {
  const primary = visionProvider();
  if (!primary) return [];
  const backup = primary === "gemini" ? (openai ? "openai" : null) : GEMINI_API_KEY ? "gemini" : null;
  return [primary, primary, backup].filter(Boolean);
}

// Возвращает уже разобранный JSON. accept(parsed) решает, годится ли ответ:
// неполный ответ считается сбоем и уходит на следующую попытку.
/** @param {(parsed: any) => boolean} [accept] */
export async function analyzeImageJson(systemPrompt, imageBuffer, mimeType, accept = (_parsed) => true) {
  const attempts = visionAttempts();
  if (!attempts.length) {
    throw new Error("Не задан ни GEMINI_API_KEY, ни OPENAI_API_KEY — анализ изображений недоступен.");
  }
  let lastError;
  for (const [index, provider] of attempts.entries()) {
    try {
      const call = provider === "gemini" ? analyzeWithGemini : analyzeWithOpenAI;
      const parsed = parseJsonReply(await call(systemPrompt, imageBuffer, mimeType));
      if (accept(parsed)) return parsed;
      throw new Error("Vision вернул неполный ответ");
    } catch (error) {
      lastError = error;
      console.warn(`Vision: попытка ${index + 1}/${attempts.length} (${provider}) не удалась: ${error?.message ?? error}`);
    }
  }
  throw lastError;
}

async function analyzeWithOpenAI(systemPrompt, imageBuffer, mimeType) {
  const response = await openai.chat.completions.create({
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
  });
  return response.choices?.[0]?.message?.content ?? "";
}

async function analyzeWithGemini(systemPrompt, imageBuffer, mimeType) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent` +
    `?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
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
