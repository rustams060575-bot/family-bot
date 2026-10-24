import crypto from "crypto";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { DATA_DIR, localDateKey, markDirty } from "./store.mjs";

// Озвучка Мартины и Лео через OpenAI TTS (tts-1-hd). Готовые озвучки кэшируются на диске
// (DATA_DIR/tts-cache), поэтому повторные фразы не оплачиваются второй раз.

export const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "tts-1-hd";
export const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "nova"; // nova — женский (Мартина), echo — мужской
export const TTS_MALE_VOICE = process.env.OPENAI_TTS_VOICE_MALE || "echo"; // Лео
export const TTS_MAX_CHARS = 1500;
// Аварийный суточный потолок на ученика (символов) — защита от злоупотреблений и счёта.
const DAILY_CHARS = Number(process.env.TTS_DAILY_CHARS) || 30000;
const CACHE_DIR = path.join(DATA_DIR, "tts-cache");
const CACHE_MAX_FILES = 2000;

const CLIENT_KEY = Symbol.for("ata.openaiTtsClient");
function client() {
  if (!process.env.OPENAI_API_KEY) return null;
  return (globalThis[CLIENT_KEY] ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 1 }));
}

export function ttsAvailable() {
  return !!process.env.OPENAI_API_KEY;
}

// Текст для озвучки: без markdown-значков и эмодзи, которые модель произносит вслух.
export function cleanForSpeech(text) {
  return String(text ?? "")
    .replace(/[*_`#>~]+/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TTS_MAX_CHARS);
}

function spendChars(account, chars) {
  const today = localDateKey(account.reminders?.tzOffsetMin ?? 0);
  account.ttsUsage = account.ttsUsage?.date === today ? account.ttsUsage : { date: today, chars: 0 };
  if (account.ttsUsage.chars + chars > DAILY_CHARS) return false;
  account.ttsUsage.chars += chars;
  markDirty();
  return true;
}

function trimCache() {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    if (files.length <= CACHE_MAX_FILES) return;
    const old = files
      .map((name) => ({ name, time: fs.statSync(path.join(CACHE_DIR, name)).mtimeMs }))
      .sort((a, b) => a.time - b.time)
      .slice(0, files.length - CACHE_MAX_FILES);
    for (const { name } of old) fs.rmSync(path.join(CACHE_DIR, name), { force: true });
  } catch {
    // кэш — оптимизация, его сбой не должен ломать озвучку
  }
}

// Возвращает { buffer } или { error: "disabled" | "limit" | "failed" }.
export async function synthesize(account, rawText, { male = false, slow = false } = {}) {
  const text = cleanForSpeech(rawText);
  if (!text) return { error: "empty" };
  const api = client();
  if (!api) return { error: "disabled" };

  const voice = male ? TTS_MALE_VOICE : TTS_VOICE;
  const speed = slow ? 0.9 : 1;
  const hash = crypto.createHash("sha1").update(`${TTS_MODEL}|${voice}|${speed}|${text}`).digest("hex");
  const file = path.join(CACHE_DIR, `${hash}.mp3`);
  try {
    if (fs.existsSync(file)) return { buffer: fs.readFileSync(file) };
  } catch {
    // читаем заново с API
  }
  if (!spendChars(account, text.length)) return { error: "limit" };
  try {
    const response = await api.audio.speech.create({ model: TTS_MODEL, voice, input: text, speed, response_format: "mp3" });
    const buffer = Buffer.from(await response.arrayBuffer());
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, buffer);
      trimCache();
    } catch {
      // не удалось закэшировать — отдаём как есть
    }
    return { buffer };
  } catch (error) {
    console.error(`OpenAI TTS не ответил: ${error?.message ?? error}`);
    return { error: "failed" };
  }
}
