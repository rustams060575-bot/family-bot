"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import AppGate from "@/components/AppGate";
import { useApp } from "@/components/AppProvider";
import MartinaNote from "@/components/MartinaNote";
import ScreenHeader from "@/components/ScreenHeader";
import { apiFetch, apiJson } from "@/lib/client/api";
import type { Account } from "@/lib/client/types";
import { enter, exit, press, rise, softSpring, stagger } from "@/lib/motion";

// «Прогресс ученика» (Parent Analytics): карточка ученика, динамика занятий,
// сохранённые рисунки с комментариями Мартины, шахматы с Лео и пройденные языковые темы.

type Card = {
  age: number | null;
  interests: string[];
  art_level: string;
  lang_level: { spanish: string | null; english: string | null; german: string | null };
  created_art_count: number;
  chess_level: "novice" | "amateur" | "strategist" | null;
  chess_solved: number;
};
type ChessProgress = {
  level: string | null;
  levelLabel: string | null;
  band: string | null;
  solved: number;
  lessonsDone: number;
  topics: { topic: string; title: string; date: string; correct: boolean }[];
  nextTopic: string | null;
  games: { played: number; won: number; drawn: number; lost: number };
};
type Artwork = {
  id: string;
  date: string;
  stored: boolean;
  title: string;
  praise: string;
  question: string;
  taskNote: string;
  task: string | null;
  lesson: string | null;
};
type LangProgress = {
  level: string | null;
  lessonsDone: number;
  history: { date: string; title: string; score: number; total: number }[];
};
type Progress = {
  card: Card;
  streak: number;
  activity: { date: string; count: number }[];
  art: {
    band: string | null;
    lessonsDone: number;
    history: { title: string; date: string }[];
    nextTheme: string | null;
  };
  languages: { english: LangProgress; spanish: LangProgress; german: LangProgress };
  chess: ChessProgress;
  artworks: Artwork[];
};

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

function ProgressScreen() {
  const { account, setAccount, haptic, handleError } = useApp();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [opened, setOpened] = useState<Artwork | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiJson<{ progress: Progress; interests: string[] }>("/api/progress");
      setProgress(data.progress);
      setInterests(data.interests);
    } catch (err) {
      setFailure(handleError(err) ?? "Не получилось загрузить прогресс.");
    }
  }, [handleError]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleInterest(item: string) {
    if (!progress) return;
    haptic("selection");
    const current = progress.card.interests;
    const next = current.includes(item) ? current.filter((value) => value !== item) : [...current, item].slice(0, 6);
    setProgress({ ...progress, card: { ...progress.card, interests: next } });
    try {
      setProgress((await apiJson<{ progress: Progress }>("/api/progress", { interests: next })).progress);
    } catch {
      load();
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader
        eyebrow="AURA · ATA Academy"
        title="Прогресс ученика"
        caption={
          account?.firstName ? `${account.firstName}: успехи, работы и темы` : "Успехи, работы и пройденные темы"
        }
      />

      {failure && <MartinaNote text={failure} />}
      {!progress && !failure && <p className="text-subhead text-mist">Мартина собирает отчёт…</p>}

      {progress && (
        <motion.div variants={stagger()} initial="hidden" animate="show" className="space-y-8">
          {/* Главные цифры */}
          <motion.div variants={rise} className="grid grid-cols-3 gap-2">
            <Stat value={progress.streak} label="дней подряд" />
            <Stat value={progress.art.lessonsDone} label="уроков арта" />
            <Stat value={progress.card.created_art_count} label="работ создано" />
          </motion.div>

          <motion.section variants={rise}>
            <h2 className="label px-4 pb-2">Занятия за 2 недели</h2>
            <ActivityChart days={progress.activity} />
          </motion.section>

          {/* Карточка ученика */}
          <motion.section variants={rise}>
            <h2 className="label px-4 pb-2">Карточка ученика</h2>
            <div className="glass overflow-hidden">
              {[
                ["Возраст", progress.card.age ? `${progress.card.age}` : "не указан"],
                ["Уровень в арте", `${progress.card.art_level}${progress.art.band ? ` · ${progress.art.band}` : ""}`],
                ["Уровень в шахматах", progress.chess.levelLabel ?? "опрос Лео не пройден"],
                ["English", progress.card.lang_level.english ?? "тест не пройден"],
                ["Español", progress.card.lang_level.spanish ?? "тест не пройден"],
                ["Deutsch", progress.card.lang_level.german ?? "тест не пройден"],
              ].map(([label, value], index) => (
                <div key={label}>
                  {index > 0 && <div className="hairline ml-4" />}
                  <div className="flex min-h-11 items-center justify-between px-4 py-3">
                    <span className="text-body">{label}</span>
                    <span className="text-body text-mist">{value}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="px-4 pb-2 pt-4 text-footnote text-dim">Обращение — Мартина говорит с ребёнком в его роде:</p>
            <div className="flex gap-2">
              {(
                [
                  ["boy", "Мальчик"],
                  ["girl", "Девочка"],
                ] as const
              ).map(([gender, label]) => {
                const active = account?.gender === gender;
                return (
                  <motion.button
                    key={gender}
                    {...press}
                    onClick={async () => {
                      haptic("selection");
                      try {
                        setAccount((await apiJson<{ account: Account }>("/api/profile", { gender })).account);
                      } catch {
                        // Не сохранилось — выбор остаётся прежним.
                      }
                    }}
                    aria-pressed={active}
                    className={`min-h-9 rounded-full px-4 text-subhead font-medium transition-colors duration-300 ease-out-expo ${
                      active ? "bg-champagne text-ink" : "bg-fill text-paper"
                    }`}
                  >
                    {label}
                  </motion.button>
                );
              })}
            </div>
            <p className="px-4 pb-2 pt-4 text-footnote text-dim">
              Интересы — Мартина строит задания вокруг них (до 6):
            </p>
            <div className="flex flex-wrap gap-2">
              {interests.map((item) => {
                const active = progress.card.interests.includes(item);
                return (
                  <motion.button
                    key={item}
                    {...press}
                    onClick={() => toggleInterest(item)}
                    aria-pressed={active}
                    className={`min-h-9 rounded-full px-4 text-subhead font-medium transition-colors duration-300 ease-out-expo ${
                      active ? "bg-champagne text-ink" : "bg-fill text-paper"
                    }`}
                  >
                    {item}
                  </motion.button>
                );
              })}
            </div>
          </motion.section>

          {/* Работы с комментариями Мартины */}
          <motion.section variants={rise}>
            <h2 className="label px-4 pb-2">Рисунки · {progress.artworks.length}</h2>
            {progress.artworks.length ? (
              <div className="grid grid-cols-2 gap-2">
                {progress.artworks.map((artwork) => (
                  <motion.button
                    key={artwork.id}
                    {...press}
                    onClick={() => {
                      haptic("light");
                      setOpened(artwork);
                    }}
                    className="glass overflow-hidden text-left"
                  >
                    <ArtworkImage artwork={artwork} className="aspect-square w-full object-cover" />
                    <div className="px-3 py-2">
                      <p className="truncate text-subhead font-semibold">{artwork.title || "Рисунок"}</p>
                      <p className="text-footnote text-dim">{shortDate(artwork.date)}</p>
                    </div>
                  </motion.button>
                ))}
              </div>
            ) : (
              <div className="glass p-4 text-subhead text-mist">
                Здесь появятся рисунки с отзывами Мартины — после первого разбора в Kids Art.
              </div>
            )}
          </motion.section>

          {/* Шахматы с Лео: уровень, решённые задачи, пройденные темы */}
          <motion.section variants={rise}>
            <h2 className="label px-4 pb-2">Шахматы с Лео</h2>
            <div className="glass overflow-hidden">
              <div className="grid grid-cols-3">
                {[
                  [progress.chess.levelLabel ?? "—", "уровень"],
                  [progress.chess.solved, "задач решено"],
                  [progress.chess.lessonsDone, "тем пройдено"],
                ].map(([value, label], index) => (
                  <div
                    key={label}
                    className={`flex flex-col items-center px-2 py-4 text-center ${
                      index > 0 ? "border-l border-[var(--separator)]" : ""
                    }`}
                  >
                    <span
                      className={`font-bold tabular-nums ${typeof value === "number" ? "text-title1" : "text-title3 leading-[2.125rem]"}`}
                    >
                      {value}
                    </span>
                    <span className="mt-0.5 text-footnote text-mist">{label}</span>
                  </div>
                ))}
              </div>
              {!!progress.chess.games.played && (
                <>
                  <div className="hairline ml-4" />
                  <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
                    <span className="text-body">Партии с Лео</span>
                    <span className="text-body tabular-nums text-mist">
                      {progress.chess.games.played} · побед {progress.chess.games.won} · ничьих{" "}
                      {progress.chess.games.drawn}
                    </span>
                  </div>
                </>
              )}
              {progress.chess.topics.map((item) => (
                <div key={`${item.date}-${item.title}`}>
                  <div className="hairline ml-4" />
                  <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-body">{item.title}</p>
                      <p className="truncate text-footnote text-dim">
                        {item.topic} · {shortDate(item.date)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-footnote font-semibold ${
                        item.correct ? "bg-champagne text-ink" : "bg-fill text-mist"
                      }`}
                    >
                      {item.correct ? "верно" : "разобрано"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p className="px-4 pt-2 text-footnote text-dim">
              {progress.chess.level
                ? `${progress.chess.band ? `Программа ${progress.chess.band}. ` : ""}Следующая тема: «${progress.chess.nextTopic ?? "…"}»`
                : "Лео определит уровень после двух вопросов в разделе «Шахматы с Лео»."}
            </p>
          </motion.section>

          {/* Языковые темы */}
          {(["english", "spanish", "german"] as const).map((track) => {
            const lang = progress.languages[track];
            if (!lang.level && !lang.lessonsDone) return null;
            return (
              <motion.section key={track} variants={rise}>
                <h2 className="label px-4 pb-2">
                  {{ english: "English", spanish: "Español", german: "Deutsch" }[track]} · {lang.level ?? "—"} · уроков: {lang.lessonsDone}
                </h2>
                <div className="glass overflow-hidden">
                  {lang.history.length ? (
                    lang.history.map((item, index) => (
                      <div key={`${item.date}-${item.title}`}>
                        {index > 0 && <div className="hairline ml-4" />}
                        <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-body">{item.title}</p>
                            <p className="text-footnote text-dim">{shortDate(item.date)}</p>
                          </div>
                          <span className="shrink-0 rounded-full bg-fill px-2.5 py-0.5 text-footnote font-semibold tabular-nums">
                            {item.score}/{item.total}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="px-4 py-3 text-subhead text-mist">Уровень определён — первый урок дня впереди.</p>
                  )}
                </div>
              </motion.section>
            );
          })}

          {!!progress.art.history.length && (
            <motion.section variants={rise}>
              <h2 className="label px-4 pb-2">Арт-школа · пройденные уроки</h2>
              <div className="glass overflow-hidden">
                {progress.art.history.map((item, index) => (
                  <div key={`${item.date}-${item.title}`}>
                    {index > 0 && <div className="hairline ml-4" />}
                    <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
                      <p className="min-w-0 truncate text-body">{item.title}</p>
                      <span className="shrink-0 text-footnote text-dim">{shortDate(item.date)}</span>
                    </div>
                  </div>
                ))}
              </div>
              {progress.art.nextTheme && (
                <p className="px-4 pt-2 text-footnote text-dim">Следующая тема: «{progress.art.nextTheme}»</p>
              )}
            </motion.section>
          )}
        </motion.div>
      )}

      <AnimatePresence>{opened && <ArtworkSheet artwork={opened} onClose={() => setOpened(null)} />}</AnimatePresence>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="glass flex flex-col items-center px-2 py-4 text-center">
      <span className="text-title1 font-bold tabular-nums">{value}</span>
      <span className="mt-0.5 text-footnote text-mist">{label}</span>
    </div>
  );
}

// Столбики активности: одна серия (цвет --chart, проверен валидатором для обеих тем),
// скругление 4 px у вершины, зазор 2 px, подписи — только у краёв и у сегодня.
// Касание столбика показывает значение; для экранного диктора — скрытая таблица.
function ActivityChart({ days }: { days: { date: string; count: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((day) => day.count));
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const shown = active ?? days.length - 1;

  return (
    <div className="glass px-4 pb-3 pt-4">
      <div className="flex items-baseline justify-between">
        <p className="text-title3 font-semibold tabular-nums">
          {days[shown].count}{" "}
          <span className="text-subhead font-normal text-mist">занят. · {shortDate(days[shown].date)}</span>
        </p>
        <p className="text-footnote text-dim">всего {total}</p>
      </div>
      <div className="mt-4 flex h-28 items-end gap-[2px] border-b border-[var(--separator)]" aria-hidden>
        {days.map((day, index) => (
          <button
            key={day.date}
            type="button"
            onClick={() => setActive(index === active ? null : index)}
            onPointerEnter={() => setActive(index)}
            className="flex h-full flex-1 items-end justify-center"
            tabIndex={-1}
          >
            <motion.span
              className={`block w-full max-w-[1.25rem] rounded-t-[4px] ${day.count ? "bg-chart" : "bg-fill"} ${
                shown === index ? "" : "opacity-70"
              }`}
              initial={{ height: 0 }}
              animate={{
                height: day.count ? `${Math.max(8, (day.count / max) * 100)}%` : "4px",
                transition: softSpring,
              }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-caption text-dim">
        <span>{shortDate(days[0].date)}</span>
        <span>сегодня</span>
      </div>
      <table className="sr-only">
        <caption>Занятия по дням за две недели</caption>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{shortDate(day.date)}</th>
              <td>{day.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Файл рисунка приходит только с подписью Telegram — грузим через apiFetch в blob-URL.
function ArtworkImage({ artwork, className }: { artwork: Artwork; className: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!artwork.stored) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    apiFetch(`/api/artworks/${artwork.id}`)
      .then((response) => response.blob())
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artwork.id, artwork.stored]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={artwork.title || "Рисунок"} className={className} />
  ) : (
    <div className={`${className} grid place-items-center bg-fill text-title1`} aria-hidden>
      🎨
    </div>
  );
}

function ArtworkSheet({ artwork, onClose }: { artwork: Artwork; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end"
      role="dialog"
      aria-modal="true"
      aria-label={artwork.title}
    >
      <motion.button
        aria-label="Закрыть"
        className="absolute inset-0 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: enter }}
        exit={{ opacity: 0, transition: exit }}
        onClick={onClose}
      />
      <motion.div
        className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[1.25rem] bg-ink px-4 pb-safe pt-2"
        initial={{ y: "100%" }}
        animate={{ y: 0, transition: softSpring }}
        exit={{ y: "100%", transition: exit }}
      >
        <div className="mx-auto mb-4 h-[0.3125rem] w-9 rounded-full bg-tint/20" />
        <div className="mx-auto max-w-md space-y-4 pb-6">
          <ArtworkImage artwork={artwork} className="max-h-[50dvh] w-full rounded-[1.25rem] object-contain" />
          <div>
            <p className="text-footnote text-dim">{shortDate(artwork.date)}</p>
            <h3 className="text-title2 font-bold">{artwork.title || "Рисунок"}</h3>
            {artwork.lesson && <p className="text-subhead text-champagne">Урок арт-школы: {artwork.lesson}</p>}
          </div>
          {artwork.praise && <MartinaNote text={artwork.praise} />}
          {artwork.taskNote && (
            <div className="glass p-4">
              <p className="text-footnote font-semibold text-champagne">Задание «{artwork.task}»</p>
              <p className="mt-1 text-body">{artwork.taskNote}</p>
            </div>
          )}
          {artwork.question && (
            <div className="glass glass-accent p-4">
              <p className="text-footnote font-semibold text-champagne">Вопрос от Мартины</p>
              <p className="mt-1 text-body">{artwork.question}</p>
            </div>
          )}
          <motion.button
            {...press}
            onClick={onClose}
            className="min-h-[3.125rem] w-full rounded-[0.875rem] bg-fill text-headline font-semibold text-champagne"
          >
            Закрыть
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function ProgressPage() {
  return (
    <AppGate>
      <ProgressScreen />
    </AppGate>
  );
}
