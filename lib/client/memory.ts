// Память Mini App на стороне пользователя. Сервер хранит профиль в файле, и если он
// потеряется (например, деплой без постоянного диска), онбординг не должен начинаться
// заново: профиль дублируется в localStorage и в Telegram CloudStorage (переживает
// переустановку Telegram и работает на всех устройствах пользователя).
// Здесь же — где пользователь остановился: последний экран, тема и история занятия.
import type { Account, Level, Role, TrackId } from "./types";

export type SavedProfile = {
  role: Role;
  track: TrackId | null;
  remindersEnabled: boolean;
  reminderHour?: number;
  tzOffsetMin: number;
  levels?: { spanish: Level | null; english: Level | null; german: Level | null };
};

const PROFILE_KEY = "ata_profile";
const LAST_PATH_KEY = "ata-last-path";
const RESUMED_KEY = "ata-resumed";
const MAX_CHAT_MESSAGES = 40;

type CloudStorage = {
  getItem: (key: string, callback: (error: unknown, value?: string) => void) => void;
  setItem: (key: string, value: string, callback?: (error: unknown, stored?: boolean) => void) => void;
};

function cloud(): CloudStorage | null {
  const app = (window as any).Telegram?.WebApp;
  try {
    return app?.CloudStorage && app.isVersionAtLeast?.("6.9") ? app.CloudStorage : null;
  } catch {
    return null;
  }
}

function readLocal(key: string, storage: Storage | undefined = globalThis.localStorage) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null, storage: Storage | undefined = globalThis.localStorage) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // приватный режим или запрет хранилища — просто не запомним
  }
}

function parseProfile(raw: string | null | undefined): SavedProfile | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value.role === "string" ? value : null;
  } catch {
    return null;
  }
}

export function profileFromAccount(account: Account): SavedProfile | null {
  if (!account.role) return null;
  return {
    role: account.role,
    track: account.track,
    remindersEnabled: account.reminders.enabled,
    reminderHour: account.reminders.hour,
    tzOffsetMin: new Date().getTimezoneOffset(),
    levels: account.levels,
  };
}

export function saveProfile(profile: SavedProfile) {
  const raw = JSON.stringify(profile);
  if (readLocal(PROFILE_KEY) === raw) return;
  writeLocal(PROFILE_KEY, raw);
  try {
    cloud()?.setItem(PROFILE_KEY, raw);
  } catch {
    // CloudStorage недоступен — хватит localStorage
  }
}

// Сначала мгновенный localStorage, иначе CloudStorage Telegram (не дольше 1.5 с).
export async function loadProfile(): Promise<SavedProfile | null> {
  const local = parseProfile(readLocal(PROFILE_KEY));
  if (local) return local;
  const storage = cloud();
  if (!storage) return null;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 1500);
    try {
      storage.getItem(PROFILE_KEY, (error, value) => {
        clearTimeout(timer);
        resolve(error ? null : parseProfile(value));
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

// ── Где пользователь остановился ─────────────────────────────────────────────
const RESUMABLE = /^\/(learn\/(spanish|english|german)|art|translate|crm)$/;

export function rememberPath(path: string) {
  if (RESUMABLE.test(path)) writeLocal(LAST_PATH_KEY, path);
  else if (path === "/") writeLocal(LAST_PATH_KEY, null);
}

// Один раз за запуск Mini App: куда вернуть пользователя вместо главного экрана.
export function takeResumePath(): string | null {
  if (readLocal(RESUMED_KEY, globalThis.sessionStorage)) return null;
  writeLocal(RESUMED_KEY, "1", globalThis.sessionStorage);
  const path = readLocal(LAST_PATH_KEY);
  return path && RESUMABLE.test(path) ? path : null;
}

export function loadTopic(track: string) {
  return readLocal(`ata-topic:${track}`);
}

export function saveTopic(track: string, topic: string) {
  writeLocal(`ata-topic:${track}`, topic);
}

// История занятия с Мартиной — чтобы урок продолжался с того же места.
export function loadChat<T>(key: string): T[] {
  try {
    const value = JSON.parse(readLocal(`ata-chat:${key}`) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveChat<T>(key: string, messages: T[]) {
  writeLocal(`ata-chat:${key}`, messages.length ? JSON.stringify(messages.slice(-MAX_CHAT_MESSAGES)) : null);
}
