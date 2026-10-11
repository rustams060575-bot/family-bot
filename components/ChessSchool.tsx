"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import ChessBoard from "@/components/ChessBoard";
import LeoChat from "@/components/LeoChat";
import MartinaNote from "@/components/MartinaNote";
import SpeakButton from "@/components/SpeakButton";
import { apiJson } from "@/lib/client/api";
import { enter, exit, press, rise, spring, stagger } from "@/lib/motion";

// «Шахматы & Логика с Лео»: при первом входе Лео знакомится (возраст, если он ещё
// не известен, и два вопроса об уровне), дальше — задача дня, урок по программе,
// карта программы, практика и чат. Задачи — из банка, проверенного движком.

type Puzzle = {
  id: string;
  kind: "board" | "quiz";
  theme: string;
  title: string;
  prompt: string;
  fen: string | null;
  options: string[] | null;
  attempts: number;
  attemptsLeft: number;
  done: boolean;
  correct: boolean | null;
  solution: string | number | null;
  explain: string | null;
};
type Lesson = {
  topic: string;
  title: string;
  intro: string;
  concept: string;
  example: string;
  tip: string;
  quiz: { question: string; options: string[]; answer?: number; explain?: string };
  youtubeQuery: string;
  completedAt: string | null;
  picked: number | null;
  correct: boolean | null;
};
type ChessState = {
  age: number | null;
  level: "novice" | "amateur" | "strategist" | null;
  levelLabel: string | null;
  band: string | null;
  program: { topic: string; done: boolean }[];
  nextTopic: string | null;
  solved: number;
  lessonsDone: number;
  lesson: Lesson | null;
  daily: Puzzle | null;
  practice: Puzzle | null;
};
type PuzzleResult = { correct: boolean; done: boolean; attemptsLeft: number };

const AGES = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const LEO = "Л";

const primaryButton =
  "min-h-[3.125rem] w-full rounded-[0.875rem] bg-paper px-5 text-headline font-semibold text-ink disabled:opacity-50";
const secondaryButton =
  "min-h-[3.125rem] w-full rounded-[0.875rem] bg-fill px-5 text-headline font-semibold text-champagne disabled:opacity-50";

export default function ChessSchool() {
  const { account, haptic, handleError, refresh } = useApp();
  const [chess, setChess] = useState<ChessState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [resurvey, setResurvey] = useState(false);
  const [mode, setMode] = useState<"train" | "chat">("train");

  const load = useCallback(async () => {
    try {
      setChess((await apiJson<{ chess: ChessState }>("/api/chess")).chess);
    } catch (err) {
      setFailure(handleError(err) ?? "Не получилось открыть шахматы.");
    }
  }, [handleError]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async <T,>(action: string, payload: Record<string, unknown> = {}) => {
      setBusy(true);
      setFailure(null);
      try {
        const data = await apiJson<{ chess: ChessState } & T>("/api/chess", { action, ...payload });
        setChess(data.chess);
        return data;
      } catch (err) {
        if (handleError(err) !== null) setFailure("Ой, Лео не успел ответить. Попробуем ещё раз?");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [handleError],
  );

  if (!chess) {
    return failure ? <Retry text={failure} onRetry={load} /> : <Thinking text="Лео расставляет фигуры…" />;
  }

  // ── Знакомство: возраст (общий с арт-школой), если его ещё нет ─────────────
  if (!chess.age) {
    return (
      <motion.div variants={stagger()} initial="hidden" animate="show" className="space-y-4">
        <motion.div variants={rise}>
          <MartinaNote
            monogram={LEO}
            text={`${account?.firstName ? `Привет, ${account.firstName}!` : "Привет!"} Я Лео — твой шахматный наставник. Сколько тебе лет? Я подберу программу по возрасту.`}
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
                if (await act("age", { age })) refresh();
              }}
              className="glass flex aspect-square flex-col items-center justify-center disabled:opacity-50"
            >
              <span className="text-title2 font-bold tabular-nums">{age === 15 ? "15+" : age}</span>
              <span className="text-caption text-mist">{age === 15 ? "лет" : ageWord(age)}</span>
            </motion.button>
          ))}
        </motion.div>
      </motion.div>
    );
  }

  // ── Опрос Лео: два вопроса → уровень (chess_level) ────────────────────────
  if (!chess.level || resurvey) {
    return (
      <Survey
        busy={busy}
        name={account?.firstName ?? ""}
        again={!!chess.level}
        onCancel={chess.level ? () => setResurvey(false) : undefined}
        onDone={async (answers) => {
          const data = await act("survey", answers);
          if (data) {
            haptic("success");
            setResurvey(false);
            refresh();
          }
        }}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-footnote font-semibold text-champagne">
            {chess.levelLabel} · {chess.band}
          </p>
          <p className="text-footnote text-dim">
            Решено задач: <span className="tabular-nums text-paper">{chess.solved}</span> · уроков:{" "}
            <span className="tabular-nums text-paper">{chess.lessonsDone}</span>
          </p>
        </div>
        <button onClick={() => setResurvey(true)} className="min-h-11 px-1 text-subhead font-medium text-champagne">
          Уровень · изменить
        </button>
      </div>

      {/* Сегментированный контрол iOS: тренировка или разговор с Лео */}
      <div className="relative mb-6 grid grid-cols-2 rounded-[0.5625rem] bg-fill p-0.5">
        {(["train", "chat"] as const).map((value) => (
          <button
            key={value}
            onClick={() => {
              setMode(value);
              haptic("selection");
            }}
            className="relative z-10 min-h-9 px-2 text-subhead font-semibold"
            aria-pressed={mode === value}
          >
            {mode === value && (
              <motion.span
                layoutId="chess-mode"
                transition={spring}
                className="segment-thumb absolute inset-0 -z-10 rounded-[0.4375rem]"
              />
            )}
            <span className={mode === value ? "text-paper" : "text-mist"}>
              {value === "train" ? "♟︎ Тренировка" : "Спросить Лео"}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {mode === "chat" ? (
          <motion.div key="chat" variants={rise} initial="hidden" animate="show" exit="leave">
            <LeoChat />
          </motion.div>
        ) : (
          <motion.div
            key="train"
            variants={stagger()}
            initial="hidden"
            animate="show"
            exit="leave"
            className="space-y-8"
          >
            {failure && (
              <motion.div variants={rise}>
                <MartinaNote monogram={LEO} text={failure} />
              </motion.div>
            )}

            {chess.daily && (
              <motion.section variants={rise}>
                <h2 className="label px-4 pb-2">Задача дня от Лео · 2–3 минуты</h2>
                <PuzzleCard
                  puzzle={chess.daily}
                  onAnswer={(answer) => act<{ result: PuzzleResult }>("puzzle", { slot: "daily", answer })}
                  onSolved={refresh}
                />
              </motion.section>
            )}

            <motion.section variants={rise}>
              <h2 className="label px-4 pb-2">Урок Лео</h2>
              <LessonCard
                lesson={chess.lesson}
                nextTopic={chess.nextTopic}
                levelLabel={chess.levelLabel}
                busy={busy}
                onStart={() => {
                  haptic("light");
                  act("lesson");
                }}
                onAnswer={async (answer) => {
                  haptic("selection");
                  const data = await act<{ result: { correct: boolean; promoted: boolean } }>("lesson-answer", {
                    answer,
                  });
                  if (data) {
                    haptic(data.result.correct ? "success" : "light");
                    refresh();
                  }
                  return data?.result ?? null;
                }}
              />
            </motion.section>

            <motion.section variants={rise}>
              <h2 className="label px-4 pb-2">
                Программа · {chess.levelLabel} · {chess.program.filter((item) => item.done).length} из{" "}
                {chess.program.length}
              </h2>
              <div className="glass overflow-hidden">
                {chess.program.map((item, index) => {
                  const current = item.topic === chess.nextTopic && !item.done;
                  return (
                    <div key={item.topic}>
                      {index > 0 && <div className="hairline ml-[3.25rem]" />}
                      <div className="flex min-h-11 items-center gap-3 px-4 py-2.5">
                        <span
                          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-footnote font-semibold tabular-nums ${
                            item.done
                              ? "bg-champagne text-ink"
                              : current
                                ? "bg-champagne/[0.18] text-champagne"
                                : "bg-fill text-dim"
                          }`}
                          aria-hidden
                        >
                          {item.done ? "✓" : index + 1}
                        </span>
                        <span className={`min-w-0 flex-1 text-body ${item.done ? "text-mist" : ""}`}>{item.topic}</span>
                        {current && <span className="shrink-0 text-footnote font-semibold text-champagne">сейчас</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="px-4 pt-2 text-footnote text-dim">
                Пройдёшь все темы — Лео переведёт на следующий уровень.
              </p>
            </motion.section>

            {chess.practice && (
              <motion.section variants={rise}>
                <h2 className="label px-4 pb-2">Ещё задача</h2>
                <PuzzleCard
                  puzzle={chess.practice}
                  onAnswer={(answer) => act<{ result: PuzzleResult }>("puzzle", { slot: "practice", answer })}
                  onSolved={refresh}
                  onNext={() => {
                    haptic("light");
                    act("next-practice");
                  }}
                />
              </motion.section>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Опрос ────────────────────────────────────────────────────────────────────

function Survey({
  busy,
  name,
  again,
  onCancel,
  onDone,
}: {
  busy: boolean;
  name: string;
  again: boolean;
  onCancel?: () => void;
  onDone: (answers: { moves: boolean; mate: boolean }) => void;
}) {
  const { haptic } = useApp();
  const [moves, setMoves] = useState<boolean | null>(null);
  const step = moves === null ? 0 : 1;
  const questions = [
    `${again ? "Давай проверим ещё раз!" : `${name ? `Привет, ${name}!` : "Привет!"} Я Лео — твой шахматный наставник.`} Скажи честно: знаешь, как ходят фигуры?`,
    "Здорово! А знаешь, как поставить мат или сделать рокировку?",
  ];

  function answer(value: boolean) {
    haptic("selection");
    if (step === 0) {
      if (!value) return onDone({ moves: false, mate: false });
      setMoves(true);
      return;
    }
    onDone({ moves: true, mate: value });
  }

  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: enter }}
          exit={{ opacity: 0, transition: exit }}
        >
          <MartinaNote monogram={LEO} text={questions[step]} />
        </motion.div>
      </AnimatePresence>
      <div className="grid grid-cols-2 gap-2">
        <motion.button {...press} disabled={busy} onClick={() => answer(true)} className={primaryButton}>
          Да, знаю
        </motion.button>
        <motion.button {...press} disabled={busy} onClick={() => answer(false)} className={secondaryButton}>
          Пока нет
        </motion.button>
      </div>
      <p className="px-4 text-footnote text-dim">Вопрос {step + 1} из 2 · по ответам Лео подберёт уровень</p>
      {onCancel && (
        <button onClick={onCancel} className="min-h-11 w-full text-subhead font-medium text-mist">
          Оставить текущий уровень
        </button>
      )}
    </div>
  );
}

// ── Задача: ход на доске или вопрос с вариантами ─────────────────────────────

function PuzzleCard({
  puzzle,
  onAnswer,
  onSolved,
  onNext,
}: {
  puzzle: Puzzle;
  onAnswer: (answer: string | number) => Promise<{ result: PuzzleResult; chess: ChessState } | null>;
  onSolved: () => void;
  onNext?: () => void;
}) {
  const { haptic } = useApp();
  const [played, setPlayed] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Новая задача — чистое состояние.
  useEffect(() => {
    setPlayed(null);
    setWrong(null);
    setPicked(null);
    setHint(null);
  }, [puzzle.id]);

  async function submit(answer: string | number) {
    if (puzzle.done || sending) return;
    setSending(true);
    setWrong(null);
    if (typeof answer === "number") setPicked(answer);
    const data = await onAnswer(answer);
    setSending(false);
    if (!data) return;
    const { result } = data;
    if (result.correct) {
      if (typeof answer === "string") setPlayed(answer);
      haptic("success");
      onSolved();
    } else if (result.done) {
      haptic("warning");
      onSolved();
    } else {
      haptic("light");
      if (typeof answer === "string") {
        setWrong(answer.slice(2, 4));
        setTimeout(() => setWrong(null), 900);
      }
      setHint(
        `Почти! Попробуй ещё — ${result.attemptsLeft === 1 ? "осталась 1 попытка" : `осталось ${result.attemptsLeft} попытки`}.`,
      );
    }
  }

  const solution = typeof puzzle.solution === "string" ? puzzle.solution : null;
  const shownMove = puzzle.done ? (puzzle.correct ? (played ?? solution) : solution) : null;
  const marks = puzzle.done && solution ? [solution.slice(0, 2), solution.slice(2, 4)] : [];
  const leoText = puzzle.done
    ? `${puzzle.correct ? "Браво, верно!" : "Смотри, как надо."} ${puzzle.explain ?? ""}`
    : (hint ?? puzzle.prompt);

  return (
    <div className="glass px-4 pb-4 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-footnote font-semibold text-champagne">{puzzle.theme}</p>
          <h3 className="mt-0.5 text-title3 font-semibold">{puzzle.title}</h3>
        </div>
        {puzzle.done && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-footnote font-semibold ${
              puzzle.correct ? "bg-champagne text-ink" : "bg-fill text-mist"
            }`}
          >
            {puzzle.correct ? "Решено ✓" : "Разобрано"}
          </span>
        )}
      </div>
      <p className="mt-2 text-body">{puzzle.prompt}</p>

      {puzzle.kind === "board" && puzzle.fen && (
        <div className="mt-4">
          <ChessBoard
            fen={puzzle.fen}
            move={shownMove}
            marks={marks}
            wrong={wrong}
            disabled={puzzle.done || sending}
            onMove={(uci) => {
              haptic("selection");
              submit(uci);
            }}
          />
          {!puzzle.done && (
            <p className="mt-2 text-footnote text-dim">
              Нажми на свою фигуру, потом на клетку, куда она пойдёт. Ходят{" "}
              {puzzle.fen.split(" ")[1] === "b" ? "чёрные" : "белые"}.
            </p>
          )}
        </div>
      )}

      {puzzle.kind === "quiz" && puzzle.options && (
        <div className="mt-4 space-y-2">
          {puzzle.options.map((option, index) => {
            const isAnswer = puzzle.done && puzzle.solution === index;
            const isWrong = puzzle.done && picked === index && !isAnswer;
            return (
              <motion.button
                key={option}
                {...press}
                disabled={puzzle.done || sending}
                onClick={() => {
                  haptic("selection");
                  submit(index);
                }}
                className={`flex min-h-11 w-full items-center rounded-xl px-3 text-left text-body transition-colors duration-300 ease-out-expo ${
                  isAnswer ? "bg-champagne text-ink" : isWrong ? "bg-danger/15 line-through" : "bg-fill"
                }`}
              >
                {option}
              </motion.button>
            );
          })}
        </div>
      )}

      {/* Реплика Лео внутри карточки — тонированный блок, а не пузырь того же цвета, что карточка */}
      {(puzzle.done || hint) && (
        <div className="mt-4 rounded-xl bg-champagne/[0.1] px-3 pb-1 pt-2" aria-live="polite">
          <p className="text-footnote font-semibold text-champagne">Лео</p>
          <p className="mt-0.5 text-subhead">{leoText}</p>
          <SpeakButton text={leoText} className="-ml-1 px-1" />
        </div>
      )}

      {puzzle.done && onNext && (
        <motion.button {...press} onClick={onNext} className={`${secondaryButton} mt-4`}>
          Следующая задача
        </motion.button>
      )}
    </div>
  );
}

// ── Урок Лео ─────────────────────────────────────────────────────────────────

function LessonCard({
  lesson,
  nextTopic,
  levelLabel,
  busy,
  onStart,
  onAnswer,
}: {
  lesson: Lesson | null;
  nextTopic: string | null;
  levelLabel: string | null;
  busy: boolean;
  onStart: () => void;
  onAnswer: (answer: number) => Promise<{ correct: boolean; promoted: boolean } | null>;
}) {
  const { webApp } = useApp();
  const [promoted, setPromoted] = useState(false);

  function openVideo(query: string) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    if (webApp?.openLink) webApp.openLink(url);
    else window.open(url, "_blank", "noopener");
  }

  const active = lesson && !lesson.completedAt;

  if (!active) {
    return (
      <div className="space-y-3">
        {lesson?.completedAt && (
          <div className="glass glass-accent p-4">
            <p className="text-footnote font-semibold text-champagne">
              Урок пройден ✓ {lesson.correct ? "· ответ верный" : ""}
            </p>
            <p className="mt-1 text-title3 font-semibold">{lesson.title}</p>
            {lesson.quiz.explain && <p className="mt-2 text-subhead text-mist">{lesson.quiz.explain}</p>}
          </div>
        )}
        {promoted && (
          <MartinaNote monogram={LEO} text={`Ура! Ты прошёл всю программу — теперь твой уровень: ${levelLabel}!`} />
        )}
        <div className="glass p-4">
          <p className="text-footnote text-dim">Следующая тема</p>
          <p className="mt-0.5 text-headline font-semibold">«{nextTopic ?? "…"}»</p>
          <motion.button {...press} disabled={busy || !nextTopic} onClick={onStart} className={`${primaryButton} mt-3`}>
            {busy ? "Лео готовит урок…" : "Начать урок"}
          </motion.button>
        </div>
      </div>
    );
  }

  const speakText = [lesson.intro, lesson.concept, lesson.example, lesson.tip ? `Секрет Лео: ${lesson.tip}` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-4">
      <MartinaNote monogram={LEO} text={lesson.intro} />
      <div className="glass px-4 pb-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-footnote font-semibold text-champagne">Урок · {lesson.topic}</p>
            <h3 className="mt-1 text-title2 font-bold">{lesson.title}</h3>
          </div>
          <SpeakButton text={speakText} label={false} className="-mr-2 -mt-2 shrink-0 justify-center px-2" />
        </div>
        <p className="mt-2 text-body">{lesson.concept}</p>
        {lesson.example && (
          <p className="mt-3 text-subhead text-mist">
            <span className="font-semibold text-paper">Пример: </span>
            {lesson.example}
          </p>
        )}
        {lesson.tip && (
          <div className="mt-3 rounded-xl bg-champagne/[0.1] px-3 py-2">
            <p className="text-footnote font-semibold text-champagne">Секрет Лео</p>
            <p className="mt-0.5 text-subhead">{lesson.tip}</p>
          </div>
        )}
        {lesson.youtubeQuery && (
          <motion.button
            {...press}
            onClick={() => openVideo(lesson.youtubeQuery)}
            className={`${secondaryButton} mt-3`}
          >
            ▶ Найти видеоурок на YouTube
          </motion.button>
        )}

        <p className="mt-4 text-headline font-semibold">{lesson.quiz.question}</p>
        <div className="mt-2 space-y-2">
          {lesson.quiz.options.map((option, index) => (
            <motion.button
              key={option}
              {...press}
              disabled={busy}
              onClick={async () => {
                const result = await onAnswer(index);
                if (result?.promoted) setPromoted(true);
              }}
              className="flex min-h-11 w-full items-center rounded-xl bg-fill px-3 text-left text-body disabled:opacity-60"
            >
              {option}
            </motion.button>
          ))}
        </div>
      </div>
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
        {LEO}
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
      <MartinaNote monogram={LEO} text={text} />
      <motion.button {...press} onClick={onRetry} className={secondaryButton}>
        Попробовать ещё раз
      </motion.button>
    </div>
  );
}
