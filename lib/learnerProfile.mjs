import fs from "fs";
import path from "path";
import { DATA_DIR, localDateKey, markDirty } from "./store.mjs";
import { artOf, publicArt } from "./artSchool.mjs";

// Карточка ученика экосистемы AURA: единый профиль, на который опираются Мартина и
// языковые наставники. Хранится в account.profile (data/accounts.json):
// { age, interests, art_level, lang_level: { spanish, english }, created_art_count }.
// Возраст и уровни ведут свои модули (арт-школа, языки) — карточка их сводит воедино.

export const INTERESTS = [
  "Космос",
  "Машинки",
  "Супергерои",
  "Животные",
  "Динозавры",
  "Природа",
  "Спорт",
  "Музыка",
  "Сказки",
  "Техника",
  "Путешествия",
  "Игры",
  "Мода",
  "Кулинария",
];
const MAX_INTERESTS = 6;
const MAX_ARTWORKS = 60;
const MAX_ARTWORK_BYTES = 600 * 1024;

const ART_LEVELS = [
  [16, "Мастер"],
  [8, "Художник"],
  [3, "Юный художник"],
  [0, "Начинающий"],
];

function profileOf(account) {
  account.profile ??= { interests: [], created_art_count: 0 };
  account.profile.interests ??= [];
  account.profile.created_art_count ??= 0;
  return account.profile;
}

// Уровень в арте — по пройденным урокам арт-школы и созданным работам.
function artLevel(account) {
  const profile = profileOf(account);
  const lessons = artOf(account).history.length;
  const score = lessons * 2 + Math.floor(profile.created_art_count / 2);
  return ART_LEVELS.find(([min]) => score >= min)[1];
}

// Сводит карточку и сохраняет её в профиль, если что-то изменилось.
export function learnerCard(account) {
  const profile = profileOf(account);
  const card = {
    age: artOf(account).age ?? null,
    interests: profile.interests,
    art_level: artLevel(account),
    lang_level: {
      spanish: account.learning?.spanish?.level ?? null,
      english: account.learning?.english?.level ?? null,
    },
    created_art_count: profile.created_art_count,
  };
  const next = { ...profile, ...card };
  if (JSON.stringify(next) !== JSON.stringify(profile)) {
    account.profile = next;
    markDirty();
  }
  return card;
}

export function setInterests(account, list) {
  const clean = [...new Set((Array.isArray(list) ? list : []).map((item) => String(item).trim()).filter(Boolean))]
    .filter((item) => INTERESTS.includes(item))
    .slice(0, MAX_INTERESTS);
  profileOf(account).interests = clean;
  markDirty();
  return learnerCard(account);
}

// Строка для системных промптов: на что опираться при выборе тем и примеров.
export function profileLine(account) {
  const card = learnerCard(account);
  const parts = [];
  if (card.age) parts.push(`возраст ${card.age}`);
  if (card.interests.length) parts.push(`интересы: ${card.interests.join(", ").toLowerCase()}`);
  parts.push(`уровень в арте: ${card.art_level} (работ создано: ${card.created_art_count})`);
  const langs = Object.entries(card.lang_level)
    .filter(([, level]) => level)
    .map(([track, level]) => `${track === "spanish" ? "испанский" : "английский"} ${level}`);
  if (langs.length) parts.push(`языки: ${langs.join(", ")}`);
  return `Карточка ученика — ${parts.join("; ")}. Подбирай темы, примеры и задания под его возраст и интересы.`;
}

// ── Работы ученика: файл рисунка + комментарий Мартины ───────────────────────

function artworksDir(account) {
  return path.join(DATA_DIR, "artworks", String(account.id));
}

export function saveArtwork(account, buffer, mimeType, review) {
  const profile = profileOf(account);
  profile.created_art_count += 1;
  account.artworks ??= [];
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let stored = false;
  // Клиент присылает уже сжатое фото (1024 px, JPEG 0.8) — сохраняем его как есть.
  if (buffer.length <= MAX_ARTWORK_BYTES) {
    try {
      fs.mkdirSync(artworksDir(account), { recursive: true });
      fs.writeFileSync(path.join(artworksDir(account), `${id}.img`), buffer);
      stored = true;
    } catch (error) {
      console.error(`Не удалось сохранить рисунок ${id}: ${error?.message ?? error}`);
    }
  }
  account.artworks.push({
    id,
    date: localDateKey(account.reminders?.tzOffsetMin ?? 0),
    createdAt: new Date().toISOString(),
    mimeType,
    stored,
    title: review.title,
    praise: review.praise,
    question: review.question,
    taskNote: review.taskNote || "",
    task: review.task || null,
    lesson: review.lesson || null,
  });
  // Старые работы — за пределами лимита — удаляем вместе с файлами.
  for (const old of account.artworks.splice(0, Math.max(0, account.artworks.length - MAX_ARTWORKS))) {
    fs.rmSync(path.join(artworksDir(account), `${old.id}.img`), { force: true });
  }
  markDirty();
  learnerCard(account);
  return id;
}

export function artworkFile(account, id) {
  const artwork = account.artworks?.find((item) => item.id === id && item.stored);
  if (!artwork || !/^[a-z0-9]+$/.test(id)) return null;
  const file = path.join(artworksDir(account), `${id}.img`);
  return fs.existsSync(file) ? { file, mimeType: artwork.mimeType } : null;
}

// ── Сводка для «Прогресса ученика» ───────────────────────────────────────────

export function progressReport(account) {
  const tz = account.reminders?.tzOffsetMin ?? 0;
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = localDateKey(tz, Date.now() - (13 - index) * 86_400_000);
    return { date, count: account.activity?.[date] ?? 0 };
  });
  const art = publicArt(account);
  const language = (track) => {
    const learning = account.learning?.[track];
    return {
      level: learning?.level ?? null,
      lessonsDone: learning?.history?.length ?? 0,
      history: (learning?.history ?? []).slice(-12).reverse(),
    };
  };
  return {
    card: learnerCard(account),
    streak: account.streak?.count ?? 0,
    activity: days,
    art: {
      band: art.band?.label ?? null,
      lessonsDone: art.lessonsDone,
      history: artOf(account).history.slice(-12).reverse(),
      nextTheme: art.nextTheme,
    },
    languages: { english: language("english"), spanish: language("spanish") },
    artworks: (account.artworks ?? []).slice().reverse(),
  };
}
