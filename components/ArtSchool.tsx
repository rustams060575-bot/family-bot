"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import MartinaNote from "@/components/MartinaNote";
import SpeakButton from "@/components/SpeakButton";
import { apiJson } from "@/lib/client/api";
import { martinaGreeting } from "@/lib/client/tracks";
import { enter, exit, press, rise, stagger } from "@/lib/motion";

// Арт-школа Мартины: возраст ученика → урок по программе его группы → три этапа
// (форма → цвет и тени → детализация и разбор по фото). Мартина сама предлагает урок.

type Stage = { title: string; task: string; steps: string[]; tip: string };
type Lesson = {
  theme: string;
  title: string;
  intro: string;
  concept: string;
  materials: string;
  stages: Stage[];
  stage: number;
  completedAt: string | null;
};
type ArtState = {
  age: number | null;
  band: { label: string; focus: string } | null;
  lesson: Lesson | null;
  lessonsDone: number;
  nextTheme: string | null;
};

const AGES = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const STAGE_NAMES = ["Форма", "Цвет и тени", "Детализация"];

const primaryButton =
  "min-h-[3.125rem] w-full rounded-[0.875rem] bg-paper px-5 text-headline font-semibold text-ink disabled:opacity-50";
const secondaryButton =
  "min-h-[3.125rem] w-full rounded-[0.875rem] bg-fill px-5 text-headline font-semibold text-champagne disabled:opacity-50";

export default function ArtSchool({ onPhoto, onCanvas }: { onPhoto: () => void; onCanvas: () => void }) {
  const { account, haptic, handleError, refresh } = useApp();
  const [art, setArt] = useState<ArtState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [editingAge, setEditingAge] = useState(false);

  const load = useCallback(async () => {
    try {
      setArt((await apiJson<{ art: ArtState }>("/api/art/school")).art);
    } catch (err) {
      setFailure(handleError(err) ?? "Не получилось открыть арт-школу.");
    }
  }, [handleError]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      setBusy(true);
      setFailure(null);
      try {
        const data = await apiJson<{ art: ArtState }>("/api/art/school", { action, ...payload });
        setArt(data.art);
        return data.art;
      } catch (err) {
        if (handleError(err) !== null) setFailure("Ой, Мартина не успела подготовить урок. Попробуем ещё раз?");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [handleError],
  );

  // Мартина ведёт сама: как только известен возраст, урок по программе готовится без запроса.
  useEffect(() => {
    if (art?.age && !art.lesson && !busy && !failure) act("lesson");
  }, [art, busy, failure, act]);

  if (!art) {
    return failure ? <Retry text={failure} onRetry={load} /> : <Thinking text="Мартина открывает арт-школу…" />;
  }

  // ── «Сколько лет юному художнику?» ─────────────────────────────────────────
  if (!art.age || editingAge) {
    return (
      <motion.div variants={stagger()} initial="hidden" animate="show" className="space-y-4">
        <motion.div variants={rise}>
          <MartinaNote
            text={
              art.age
                ? "Сколько лет юному художнику сейчас? Я подберу уроки по возрасту."
                : `${martinaGreeting(account?.firstName)} Добро пожаловать в мою арт-школу! Сколько лет юному художнику?`
            }
          />
        </motion.div>
        <motion.div variants={rise} className="grid grid-cols-4 gap-2">
          {AGES.map((age) => (
            <motion.button
              key={age}
              {...press}
              disabled={busy}
              onClick={async () => {
                haptic("selection");
                const updated = await act("age", { age });
                if (updated) {
                  setEditingAge(false);
                  refresh();
                }
              }}
              className={`glass flex aspect-square flex-col items-center justify-center disabled:opacity-50 ${
                art.age === age ? "glass-accent" : ""
              }`}
            >
              <span className="text-title2 font-bold tabular-nums">{age === 15 ? "15+" : age}</span>
              <span className="text-caption text-mist">{age === 15 ? "лет" : ageWord(age)}</span>
            </motion.button>
          ))}
        </motion.div>
        {art.age && (
          <button onClick={() => setEditingAge(false)} className="min-h-11 w-full text-subhead font-medium text-mist">
            Оставить {art.age} {ageWord(art.age)}
          </button>
        )}
      </motion.div>
    );
  }

  const header = (
    <div className="mb-3 flex items-center justify-between">
      <div>
        <p className="text-footnote font-semibold text-champagne">Арт-школа · {art.band?.label}</p>
        <p className="text-footnote text-dim">
          Уроков пройдено: <span className="tabular-nums text-paper">{art.lessonsDone}</span>
        </p>
      </div>
      <button onClick={() => setEditingAge(true)} className="min-h-11 px-1 text-subhead font-medium text-champagne">
        {art.age} {ageWord(art.age)} · изменить
      </button>
    </div>
  );

  if (failure) {
    return (
      <div>
        {header}
        <Retry text={failure} onRetry={() => act("lesson")} />
      </div>
    );
  }

  if (!art.lesson) {
    return (
      <div>
        {header}
        <Thinking text={`Мартина готовит урок «${art.nextTheme ?? "…"}»…`} />
      </div>
    );
  }

  // ── Урок пройден — Мартина предлагает следующий по программе ────────────────
  if (art.lesson.completedAt) {
    return (
      <div className="space-y-3">
        {header}
        <div className="glass glass-accent p-4">
          <p className="text-footnote font-semibold text-champagne">Урок пройден ✓</p>
          <p className="mt-1 text-title3 font-semibold">{art.lesson.title}</p>
        </div>
        <MartinaNote
          text={`Умница! Следующая тема в нашей арт-школе — «${art.nextTheme}». ${
            account?.gender === "girl"
              ? "Начнём, когда будешь готова!"
              : account?.gender === "boy"
                ? "Начнём, когда будешь готов!"
                : "Начнём, как только захочешь!"
          }`}
        />
        <motion.button {...press} disabled={busy} onClick={() => act("lesson")} className={primaryButton}>
          {busy ? "Мартина готовит урок…" : "Следующий урок"}
        </motion.button>
      </div>
    );
  }

  return (
    <div>
      {header}
      <LessonView
        lesson={art.lesson}
        busy={busy}
        onStage={(stage) => {
          haptic("light");
          act("stage", { stage });
        }}
        onPhoto={onPhoto}
        onCanvas={onCanvas}
      />
    </div>
  );
}

function LessonView({
  lesson,
  busy,
  onStage,
  onPhoto,
  onCanvas,
}: {
  lesson: Lesson;
  busy: boolean;
  onStage: (stage: number) => void;
  onPhoto: () => void;
  onCanvas: () => void;
}) {
  const stage = lesson.stages[lesson.stage];
  const last = lesson.stage === lesson.stages.length - 1;
  const stageText = [
    `Этап ${lesson.stage + 1}: ${stage.title}.`,
    stage.task,
    ...stage.steps,
    stage.tip ? `Секрет художника: ${stage.tip}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-4">
      <MartinaNote text={lesson.intro} />

      <div className="glass px-4 pb-3 pt-4">
        <p className="text-footnote font-semibold text-champagne">Урок · {lesson.theme}</p>
        <h3 className="mt-1 text-title2 font-bold">{lesson.title}</h3>
        {lesson.concept && <p className="mt-2 text-body text-mist">{lesson.concept}</p>}
        {lesson.materials && (
          <p className="mt-2 text-subhead text-mist">
            <span className="font-semibold text-paper">Понадобится: </span>
            {lesson.materials}
          </p>
        )}

        {/* Три этапа урока: пройденные и текущий подсвечены */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {STAGE_NAMES.map((name, index) => (
            <button
              key={name}
              disabled={busy || index === lesson.stage}
              onClick={() => onStage(index)}
              className="text-left"
              aria-current={index === lesson.stage ? "step" : undefined}
            >
              <span
                className={`block h-1 rounded-full transition-colors duration-500 ease-out-expo ${
                  index <= lesson.stage ? "bg-champagne" : "bg-fill"
                }`}
              />
              <span
                className={`mt-1.5 block text-footnote ${index === lesson.stage ? "font-semibold text-paper" : "text-dim"}`}
              >
                {index + 1}. {name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={lesson.stage}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: enter }}
          exit={{ opacity: 0, transition: exit }}
          className="glass px-4 pb-4 pt-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-footnote font-semibold text-champagne">
                Этап {lesson.stage + 1} из 3 · {stage.title}
              </p>
              <p className="mt-1 text-headline font-semibold">{stage.task}</p>
            </div>
            <SpeakButton text={stageText} label={false} className="-mr-2 -mt-2 shrink-0 justify-center px-2" />
          </div>
          <ol className="mt-3 space-y-2">
            {stage.steps.map((step, index) => (
              <li key={index} className="flex gap-3 text-body">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-fill text-footnote font-semibold tabular-nums">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          {stage.tip && (
            <div className="mt-3 rounded-xl bg-champagne/[0.1] px-3 py-2">
              <p className="text-footnote font-semibold text-champagne">Секрет художника</p>
              <p className="mt-0.5 text-subhead">{stage.tip}</p>
            </div>
          )}

          <div className="mt-4 space-y-2">
            {last ? (
              <>
                <p className="text-subhead text-mist">Готово? Покажи рисунок — я разберу его, и урок будет пройден.</p>
                <motion.button {...press} onClick={onPhoto} className={primaryButton}>
                  📸 Сфотографировать рисунок
                </motion.button>
                <motion.button {...press} onClick={onCanvas} className={secondaryButton}>
                  🎨 Нарисовать на холсте
                </motion.button>
              </>
            ) : (
              <motion.button
                {...press}
                disabled={busy}
                onClick={() => onStage(lesson.stage + 1)}
                className={primaryButton}
              >
                Готово, дальше: {STAGE_NAMES[lesson.stage + 1]}
              </motion.button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ageWord(age: number) {
  const mod10 = age % 10;
  const mod100 = age % 100;
  if (mod10 === 1 && mod100 !== 11) return "год";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "года";
  return "лет";
}

function Thinking({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2 py-2" aria-live="polite">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-champagne text-headline font-semibold text-ink"
        aria-hidden
      >
        М
      </span>
      <div className="flex min-h-11 items-center gap-2 rounded-[1.25rem] rounded-bl-md bg-ink-raised px-4">
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            className="h-2 w-2 rounded-full bg-mist"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: index * 0.18 }}
          />
        ))}
        <span className="ml-1 text-subhead text-mist">{text}</span>
      </div>
    </div>
  );
}

function Retry({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="space-y-3">
      <MartinaNote text={text} />
      <motion.button {...press} onClick={onRetry} className={secondaryButton}>
        Попробовать ещё раз
      </motion.button>
    </div>
  );
}
