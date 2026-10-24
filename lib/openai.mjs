import OpenAI from "openai";
import { groqChat, groqKeyCount, logDetailedError } from "./groq.mjs";

// Единая точка входа в LLM для всех режимов ATA Academy (языки, дети, Художник, шахматы,
// переводчик, суммаризация). Основной провайдер — OpenAI; Groq остаётся резервным и
// включается при сбое OpenAI или если ключа OpenAI нет. Модуль грузят и server.mjs, и
// бандл Next.js, поэтому клиент живёт на globalThis (как пул Groq в groq.mjs).

// dialog — живое общение с учеником, уроки и голос (gpt-4o);
// fast — суммаризация, простые генерации и служебные проверки (gpt-4o-mini).
export const OPENAI_DIALOG_MODEL = process.env.OPENAI_DIALOG_MODEL || "gpt-4o";
export const OPENAI_FAST_MODEL = process.env.OPENAI_FAST_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS) || 45000;

const CLIENT_KEY = Symbol.for("ata.openaiClient");

function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!globalThis[CLIENT_KEY]) {
    globalThis[CLIENT_KEY] = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: OPENAI_TIMEOUT_MS,
      maxRetries: 2,
    });
  }
  return globalThis[CLIENT_KEY];
}

export function openaiConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

// Основной провайдер: LLM_PROVIDER=groq принудительно отключает OpenAI (аварийный рубильник).
export function llmProvider() {
  if (process.env.LLM_PROVIDER === "groq") return groqKeyCount() > 0 ? "groq" : null;
  if (openaiConfigured()) return "openai";
  return groqKeyCount() > 0 ? "groq" : null;
}

// Цепочка для /healthz и логов, например «openai → groq».
export function llmChain() {
  const chain = [];
  if (process.env.LLM_PROVIDER !== "groq" && openaiConfigured()) chain.push("openai");
  if (groqKeyCount() > 0) chain.push("groq");
  return chain.length ? chain.join(" → ") : "нет ключей";
}

export function modelFor(tier) {
  return tier === "fast" ? OPENAI_FAST_MODEL : OPENAI_DIALOG_MODEL;
}

async function openaiChat(messages, label, { maxTokens, json, tier, temperature }) {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: modelFor(tier),
    messages,
    max_completion_tokens: maxTokens,
    ...(temperature != null ? { temperature } : {}),
    ...(json ? { response_format: { type: "json_object" } } : {}),
  });
  const choice = response.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) {
    console.error(`OpenAI не вернул текст ответа (${label}). finishReason: ${choice?.finish_reason ?? "нет"}.`);
    throw new Error("OpenAI не вернул текст ответа");
  }
  if (choice.finish_reason === "length") {
    console.warn(`OpenAI (${label}): ответ обрезан по max_completion_tokens=${maxTokens}.`);
  }
  return text;
}

// Тот же контракт, что у groqChat: возвращает текст ответа (при json — строку с JSON).
// tier: "dialog" (gpt-4o) | "fast" (gpt-4o-mini). При сбое OpenAI — резервный Groq.
export async function aiChat(messages, label, { maxTokens = 1024, json = false, tier = "dialog", temperature } = {}) {
  const useOpenAI = process.env.LLM_PROVIDER !== "groq" && openaiConfigured();
  if (useOpenAI) {
    try {
      return await openaiChat(messages, label, { maxTokens, json, tier, temperature });
    } catch (error) {
      logDetailedError(`Ошибка OpenAI API (${label}, модель ${modelFor(tier)})`, error);
      if (groqKeyCount() === 0) throw error;
      console.warn(`OpenAI недоступен (${label}) — переключаюсь на резервный Groq.`);
    }
  }
  return groqChat(messages, label, { maxTokens, json });
}
