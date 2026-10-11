import Groq, { toFile } from "groq-sdk";

// Общий пул ключей Groq для Telegram-бота и для API Mini App. Модуль может быть загружен
// дважды (сам server.mjs и отдельный бандл Next.js), поэтому состояние пула — индекс
// текущего ключа — живёт на globalThis: оба экземпляра модуля видят один и тот же ключ.
//
// GROQ_API_KEY обязателен, GROQ_API_KEY_2 опционален. ВАЖНО: у Groq лимиты считаются
// на уровне организации/аккаунта, а не на ключ — второй ключ даёт реальный запас
// только если он от ДРУГОГО аккаунта Groq (другой email).
export const GROQ_API_KEY_ENV_VARS = ["GROQ_API_KEY", "GROQ_API_KEY_2"];
export const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
// Полная whisper-large-v3, а не turbo: заметно точнее на детской речи и смеси русского с английским.
export const GROQ_STT_MODEL = process.env.GROQ_STT_MODEL || "whisper-large-v3";

const POOL_KEY = Symbol.for("ata.groqPool");

function getPool() {
  if (!globalThis[POOL_KEY]) {
    const keys = GROQ_API_KEY_ENV_VARS.map((name) => process.env[name]).filter(Boolean);
    globalThis[POOL_KEY] = {
      clients: keys.map((apiKey) => new Groq({ apiKey })),
      currentIndex: 0,
    };
  }
  return globalThis[POOL_KEY];
}

export function groqKeyCount() {
  return getPool().clients.length;
}

// Единая точка подробного логирования сбоев — печатает message, stack, HTTP-статус
// и (если есть) сырое тело ответа API отдельными строками, чтобы в логах Railway
// была видна точная причина, а не просто "[object Object]" или обрезанная строка.
export function logDetailedError(label, error) {
  console.error(`${label}: ${error?.message ?? error}`);
  if (typeof error?.status === "number") {
    console.error(`  HTTP-статус: ${error.status}`);
  }
  if (error?.error) {
    try {
      console.error(`  Тело ответа API: ${JSON.stringify(error.error)}`);
    } catch {
      // тело не сериализуется — не критично, стек ниже всё равно даст зацепку
    }
  }
  if (error?.stack) {
    console.error(error.stack);
  }
}

function isRetryableGroqError(error) {
  const status = error?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

// Пробует каждый настроенный ключ Groq по одному разу подряд, начиная с текущего,
// без задержки между ключами (при 429/5xx). Текущий индекс запоминается между вызовами,
// чтобы следующий запрос сразу начинал с рабочего ключа. Не-retryable ошибка (неверный
// ключ, неверная модель) бросается сразу — другой ключ её не исправит.
export async function withGroqRotation(call, label) {
  const pool = getPool();
  const totalKeys = pool.clients.length;
  if (totalKeys === 0) {
    throw new Error("Не задан ни один ключ Groq (GROQ_API_KEY / _2) — интеграция недоступна.");
  }

  let lastError;
  for (let keyAttempt = 0; keyAttempt < totalKeys; keyAttempt++) {
    const keyIndex = pool.currentIndex;
    try {
      return await call(pool.clients[keyIndex]);
    } catch (error) {
      lastError = error;
      logDetailedError(`Ошибка Groq API (${label}, ключ #${keyIndex + 1}/${totalKeys})`, error);

      if (!isRetryableGroqError(error)) throw error;

      pool.currentIndex = (keyIndex + 1) % totalKeys;
      if (keyAttempt < totalKeys - 1) {
        console.warn(
          `Ключ Groq #${keyIndex + 1}/${totalKeys} недоступен (429/5xx), переключаюсь на ключ ` +
            `#${pool.currentIndex + 1}/${totalKeys}.`,
        );
      }
    }
  }
  throw lastError;
}

export async function groqChat(messages, label, { maxTokens = 1024, json = false } = {}) {
  const response = await withGroqRotation(
    (client) =>
      client.chat.completions.create({
        model: GROQ_MODEL,
        messages,
        max_completion_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    label,
  );

  const replyText = response.choices?.[0]?.message?.content?.trim();
  if (!replyText) {
    console.error(
      `Groq не вернул текст ответа (${label}). finishReason: ${response.choices?.[0]?.finish_reason ?? "нет"}.`,
    );
    throw new Error("Groq не вернул текст ответа");
  }
  return replyText;
}

// Распознавание речи через Whisper на Groq. verbose_json даёт язык и сегменты —
// по средней уверенности сегментов (avg_logprob) клиент подсвечивает неразборчивые места,
// а по no_speech_prob сервер отсеивает тишину. prompt — словарная подсказка: смещает
// распознавание к нужным языкам и именам, не навязывая язык жёстко.
export async function groqTranscribe(buffer, filename, label, { language, prompt } = {}) {
  return withGroqRotation(
    async (client) =>
      client.audio.transcriptions.create({
        file: await toFile(buffer, filename),
        model: GROQ_STT_MODEL,
        response_format: "verbose_json",
        temperature: 0,
        ...(language ? { language } : {}),
        ...(prompt ? { prompt } : {}),
      }),
    label,
  );
}
