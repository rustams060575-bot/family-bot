"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import MartinaNote from "@/components/MartinaNote";
import SpeakButton from "@/components/SpeakButton";
import VoiceAssistant from "@/components/VoiceAssistant";
import { apiJson } from "@/lib/client/api";
import type { Track } from "@/lib/client/tracks";
import type { Level } from "@/lib/client/types";
import { enter, exit, press, rise, spring, stagger } from "@/lib/motion";

// Адаптивное обучение языку: тест уровня → урок дня (теория → практика → экспресс-тест).
// Состояние живёт на сервере (профиль в /data), здесь — только отображение и шаги.

type QuizItem = { question: string; options: string[]; answer?: number; explanation?: string };
type Lesson = {
  date: string;
  topic: string;
  title: string;
  intro: string;
  vocabulary: { word: string; translation: string; example: string }[];
  grammar: string;
  practice: { goal: string; opener: string; choices: string[] };
  quiz: QuizItem[];
  step: "theory" | "practice" | "quiz" | "done";
  completedAt: string | null;
  score: number | null;
};
type Learning = {
  level: Level | null;
  // Целевой уровень — на шаг выше текущего; пробелы — по срезу знаний.
  target: Level | null;
  checkDue?: boolean;
  gaps: string[];
  lessonsDone: number;
  recentTopics: string[];
  lesson: Lesson | null;
  todayDone: boolean;
};
type Question = { id: number; question: string; options: string[] };

const LEVELS: { id: Level; caption: string }[] = [
  { id: "A1", caption: "Только начинаю" },
  { id: "A2", caption: "Объясняюсь в простых ситуациях" },
  { id: "B1", caption: "Говорю на бытовые темы" },
  { id: "B2", caption: "Свободно, хочу шлифовать" },
  { id: "C1", caption: "Академический уровень: эссе, дебаты" },
  { id: "C2", caption: "Как образованный носитель — шлифую стиль" },
];

type Placed = { level: Level; correct: number; total: number; gaps: string[]; target: Level };

const STEPS = [
  { id: "theory", title: "Теория" },
  { id: "practice", title: "Практика" },
  { id: "quiz", title: "Тест" },
] as const;

const LANGUAGE_NAME: Record<string, string> = { spanish: "испанский", english: "английский", german: "немецкий" };

const primaryButton =
  "min-h-[3.125rem] w-full rounded-[0.875rem] bg-paper px-5 text-headline font-semibold text-ink disabled:opacity-50";
const secondaryButton =
  "min-h-[3.125rem] w-full rounded-[0.875rem] bg-fill px-5 text-headline font-semibold text-champagne disabled:opacity-50";

export default function LanguageCoach({ track }: { track: Track }) {
  const { refresh, haptic, handleError } = useApp();
  const [learning, setLearning] = useState<Learning | null>(null);
  const [placement, setPlacement] = useState<Question[] | null>(null);
  const [retake, setRetake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      const data = await apiJson<{ learning: Learning; placement: Question[] | null }>(`/api/learn?track=${track.id}`);
      setLearning(data.learning);
      setPlacement(data.placement);
    } catch (err) {
      setFailure(handleError(err) ?? "Не получилось загрузить урок.");
    }
  }, [track.id, handleError]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async <T,>(action: string, payload: Record<string, unknown> = {}) => {
      setBusy(true);
      setFailure(null);
      try {
        const data = await apiJson<T & { learning: Learning }>("/api/learn", { track: track.id, action, ...payload });
        setLearning(data.learning);
        return data;
      } catch (err) {
        const message = handleError(err);
        if (message !== null) setFailure("Мартина не успела ответить. Попробуй ещё раз.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [track.id, handleError],
  );

  // Урок дня готовится сам, как только известен уровень: Мартина держит инициативу.
  useEffect(() => {
    if (learning?.level && !learning.lesson && !learning.todayDone && !busy && !failure) {
      act("lesson");
    }
  }, [learning, busy, failure, act]);

  if (!learning) {
    return failure ? <Retry text={failure} onRetry={load} /> : <Loading text="Мартина открывает твою программу…" />;
  }

  if (!learning.level || retake) {
    return (
      <Placement
        track={track}
        questions={placement}
        onLoadQuestions={async () => {
          const data = await apiJson<{ placement: Question[] | null }>(`/api/learn?track=${track.id}&retake=1`).catch(
            () => null,
          );
          return data?.placement ?? null;
        }}
        onDone={async (payload) => {
          // Экран результата (уровень и пробелы) остаётся, пока ученик сам не нажмёт «Начать урок дня».
          if (payload.answers) setRetake(true);
          const data = await act<{ result?: Placed }>(payload.answers ? "placement" : "level", payload);
          if (data) {
            haptic("success");
            refresh();
          }
          return data?.result ?? null;
        }}
        onFinish={() => setRetake(false)}
        canCancel={!!learning.level}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <motion.div variants={rise} initial="hidden" animate="show" className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-champagne px-3 py-1 text-subhead font-bold text-ink">{learning.level}</span>
          {learning.target && learning.target !== learning.level && (
            <span className="text-subhead font-semibold text-champagne">→ {learning.target}</span>
          )}
          <span className="text-subhead text-mist">
            Уроков пройдено: <span className="tabular-nums text-paper">{learning.lessonsDone}</span>
          </span>
        </div>
        <button onClick={() => setRetake(true)} className="min-h-11 px-1 text-subhead font-medium text-champagne">
          Сменить уровень
        </button>
      </motion.div>

      {learning.checkDue && (
        <motion.div variants={rise} initial="hidden" animate="show" className="mb-4">
          <MartinaNote text="Ты уже немало позанимался — пора обновить срез знаний, чтобы уроки точно подходили твоему уровню. Нажми «Сменить уровень» и выбери «Пройти срез знаний»." />
        </motion.div>
      )}

      {failure && <Retry text={failure} onRetry={() => act("lesson")} />}

      {!learning.lesson && !failure && (
        <Loading text={`Мартина готовит урок уровня ${learning.target ?? learning.level}…`} />
      )}

      {learning.lesson && (
        <DailyLesson
          key={`${learning.lesson.date}-${learning.lesson.topic}`}
          track={track}
          lesson={learning.lesson}
          busy={busy}
          onStep={(step) => act("step", { step })}
          onComplete={async (answers) => {
            const data = await act<{ result: { score: number; total: number; results: boolean[] }; lesson: Lesson }>(
              "complete",
              { answers },
            );
            if (data) {
              haptic("success");
              refresh();
            }
            return data;
          }}
          onNext={() => act("lesson", { next: true })}
        />
      )}
    </div>
  );
}

// ── Тест уровня ──────────────────────────────────────────────────────────────

function Placement({
  track,
  questions: initial,
  onLoadQuestions,
  onDone,
  onFinish,
  canCancel,
}: {
  track: Track;
  questions: Question[] | null;
  onLoadQuestions: () => Promise<Question[] | null>;
  onDone: (payload: { answers?: number[]; level?: Level }) => Promise<Placed | null>;
  onFinish: () => void;
  canCancel: boolean;
}) {
  const { haptic } = useApp();
  const [questions, setQuestions] = useState<Question[] | null>(initial);
  const [stage, setStage] = useState<"intro" | "test" | "manual" | "result">("intro");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<Placed | null>(null);
  const [saving, setSaving] = useState(false);
  const language = LANGUAGE_NAME[track.id] ?? "язык";

  async function start() {
    haptic("light");
    const list = questions ?? (await onLoadQuestions());
    if (!list?.length) return;
    setQuestions(list);
    setAnswers([]);
    setIndex(0);
    setStage("test");
  }

  async function choose(option: number) {
    if (!questions || saving) return;
    haptic("selection");
    const next = [...answers, option];
    setAnswers(next);
    if (next.length < questions.length) {
      setIndex(next.length);
      return;
    }
    setSaving(true);
    const scored = await onDone({ answers: next });
    setSaving(false);
    if (scored) {
      setResult(scored);
      setStage("result");
    }
  }

  async function pickLevel(level: Level) {
    setSaving(true);
    await onDone({ level });
    setSaving(false);
    onFinish();
  }

  return (
    <AnimatePresence mode="wait">
      {stage === "intro" && (
        <motion.div key="intro" variants={stagger()} initial="hidden" animate="show" exit="leave" className="space-y-4">
          <motion.div variants={rise}>
            <MartinaNote
              text={
                track.id === "german"
                  ? "Начнём с короткого среза: 5 вопросов от A2 до B2. По ответам я определю твой уровень и найду точечные пробелы, а дальше мы будем заниматься понемногу каждый день — без перегруза."
                  : "Начнём с объективного среза: 5 ёмких вопросов на сложную грамматику и продвинутую лексику. По ответам я найду точечные пробелы и буду работать на шаг выше твоего уровня — к C1/C2."
              }
            />
          </motion.div>
          <motion.div variants={rise} className="space-y-2 pt-2">
            <motion.button {...press} onClick={start} className={primaryButton}>
              Пройти срез знаний
            </motion.button>
            <motion.button {...press} onClick={() => setStage("manual")} className={secondaryButton}>
              Я знаю свой уровень
            </motion.button>
            {canCancel && (
              <button onClick={onFinish} className="min-h-11 w-full text-subhead font-medium text-mist">
                Оставить текущий уровень
              </button>
            )}
          </motion.div>
        </motion.div>
      )}

      {stage === "manual" && (
        <motion.div key="manual" variants={rise} initial="hidden" animate="show" exit="leave">
          <p className="label px-4 pb-2">Мой {language}</p>
          <div className="glass overflow-hidden">
            {LEVELS.filter((level) => track.id !== "german" || ["A2", "B1", "B2"].includes(level.id)).map((level, position) => (
              <button
                key={level.id}
                disabled={saving}
                onClick={() => pickLevel(level.id)}
                className="block w-full text-left active:bg-tint/[0.06] disabled:opacity-50"
              >
                {position > 0 && <div className="hairline ml-[3.75rem]" />}
                <div className="flex min-h-[3.75rem] items-center gap-3 px-4 py-2">
                  <span className="grid h-[1.875rem] w-[1.875rem] shrink-0 place-items-center rounded-[0.4375rem] bg-champagne text-footnote font-bold text-ink">
                    {level.id}
                  </span>
                  <span className="text-body">{level.caption}</span>
                </div>
              </button>
            ))}
          </div>
          <button onClick={() => setStage("intro")} className="mt-2 min-h-11 w-full text-subhead font-medium text-mist">
            Назад
          </button>
        </motion.div>
      )}

      {stage === "test" && questions && (
        <motion.div key={`q-${index}`} variants={rise} initial="hidden" animate="show" exit="leave">
          <div className="mb-4 flex gap-1" aria-label={`Вопрос ${index + 1} из ${questions.length}`}>
            {questions.map((question, position) => (
              <span
                key={question.id}
                className={`h-1 flex-1 rounded-full transition-colors duration-500 ease-out-expo ${
                  position <= index ? "bg-champagne" : "bg-fill"
                }`}
              />
            ))}
          </div>
          <p className="text-footnote text-dim">
            Вопрос {index + 1} из {questions.length}
          </p>
          <div className="mt-1 flex items-start justify-between gap-3">
            <h2 className="text-title2 font-bold">{questions[index].question}</h2>
            <SpeakButton
              text={questions[index].question}
              foreignLang={track.speechLang}
              label={false}
              className="shrink-0"
            />
          </div>
          <div className="mt-4 space-y-2">
            {questions[index].options.map((option, position) => (
              <motion.button
                key={option}
                {...press}
                disabled={saving}
                onClick={() => choose(position)}
                className="glass flex min-h-[3.5rem] w-full items-center px-4 text-left text-body disabled:opacity-50"
              >
                {option}
              </motion.button>
            ))}
          </div>
          {saving && <p className="mt-4 text-center text-footnote text-dim">Мартина анализирует ответы…</p>}
        </motion.div>
      )}

      {stage === "result" && result && (
        <motion.div
          key="result"
          variants={stagger(0.1)}
          initial="hidden"
          animate="show"
          exit="leave"
          className="space-y-4"
        >
          <motion.div variants={rise} className="glass glass-accent flex flex-col items-center p-6 text-center">
            <p className="text-footnote font-semibold text-champagne">Твой уровень</p>
            <motion.p
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, transition: { ...spring, delay: 0.2 } }}
              className="mt-1 text-[3.5rem] font-bold leading-none"
            >
              {result.level}
            </motion.p>
            <p className="mt-2 text-subhead text-mist">
              Верных ответов: {result.correct} из {result.total}
            </p>
          </motion.div>
          {!!result.gaps.length && (
            <motion.div variants={rise}>
              <p className="label px-4 pb-2">Точечные пробелы</p>
              <div className="glass overflow-hidden">
                {result.gaps.map((gap, position) => (
                  <div key={gap}>
                    {position > 0 && <div className="hairline ml-4" />}
                    <p className="px-4 py-3 text-body">{gap}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
          <motion.div variants={rise}>
            <MartinaNote
              text={
                result.gaps.length
                  ? result.target === result.level
                    ? `Уровень — ${result.level}. Работаем строго на нём и растём внутри уровня: сначала закрываем пробелы из списка, дальше — урок дня с теорией, разговором и тестом.`
                    : `Уровень — ${result.level}. Работаем на шаг выше, на ${result.target}: сначала закрываем пробелы из списка, дальше — урок дня с продвинутой лексикой, дискуссией и тестом.`
                  : result.target === result.level
                    ? `Уровень — ${result.level}, все ответы верны. Закрепляем его и двигаемся вперёд внутри уровня — уроки дня будут постепенно усложняться.`
                    : `Уровень — ${result.level}, все ответы верны. Дальше — шлифовка до C2 Perfecto: стиль, регистр, риторика.`
              }
            />
          </motion.div>
          <motion.button variants={rise} {...press} onClick={onFinish} className={primaryButton}>
            Начать урок дня
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Урок дня ─────────────────────────────────────────────────────────────────

function DailyLesson({
  track,
  lesson,
  busy,
  onStep,
  onComplete,
  onNext,
}: {
  track: Track;
  lesson: Lesson;
  busy: boolean;
  onStep: (step: Lesson["step"]) => void;
  onComplete: (
    answers: number[],
  ) => Promise<{ result: { score: number; total: number; results: boolean[] }; lesson: Lesson } | null>;
  onNext: () => void;
}) {
  const { haptic } = useApp();
  const [step, setStep] = useState<Lesson["step"]>(lesson.step);
  const done = !!lesson.completedAt;

  function go(next: Lesson["step"]) {
    haptic("light");
    setStep(next);
    if (next !== "done") onStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const activeIndex = step === "done" ? 3 : STEPS.findIndex((item) => item.id === step);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-1 text-footnote font-semibold text-champagne">Урок дня · 15 минут</div>
      <h2 className="text-title2 font-bold">{lesson.title}</h2>

      {/* Шаги урока — сегменты; пройденные и текущий подсвечены */}
      <div className="mb-6 mt-4 grid grid-cols-3 gap-2">
        {STEPS.map((item, position) => (
          <button
            key={item.id}
            onClick={() => go(item.id)}
            className="text-left"
            aria-current={step === item.id ? "step" : undefined}
          >
            <span
              className={`block h-1 rounded-full transition-colors duration-500 ease-out-expo ${
                position <= activeIndex ? "bg-champagne" : "bg-fill"
              }`}
            />
            <span
              className={`mt-1.5 block text-footnote ${step === item.id ? "font-semibold text-paper" : "text-dim"}`}
            >
              {position + 1}. {item.title}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === "theory" && (
          <motion.div
            key="theory"
            variants={stagger()}
            initial="hidden"
            animate="show"
            exit="leave"
            className="space-y-6"
          >
            <motion.div variants={rise}>
              <MartinaNote text={lesson.intro || `Сегодня тема: ${lesson.topic}.`} />
            </motion.div>

            <motion.section variants={rise}>
              <h3 className="label px-4 pb-2">Слова урока</h3>
              <div className="glass overflow-hidden">
                {lesson.vocabulary.map((item, position) => (
                  <div key={item.word}>
                    {position > 0 && <div className="hairline ml-4" />}
                    <div className="flex items-start gap-2 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-headline font-semibold">
                          {item.word} <span className="font-normal text-mist">— {item.translation}</span>
                        </p>
                        {item.example && <p className="mt-0.5 text-subhead text-mist">{item.example}</p>}
                      </div>
                      <SpeakButton
                        text={item.example ? `${item.word}. ${item.example}` : item.word}
                        foreignLang={track.speechLang}
                        label={false}
                        className="-mr-1 shrink-0 justify-center px-1"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </motion.section>

            {lesson.grammar && (
              <motion.section variants={rise}>
                <h3 className="label px-4 pb-2">Правило</h3>
                <div className="glass px-4 pb-1 pt-3">
                  <p className="text-body">{lesson.grammar}</p>
                  <SpeakButton text={lesson.grammar} foreignLang={track.speechLang} className="-ml-1 px-1" />
                </div>
              </motion.section>
            )}

            <motion.button variants={rise} {...press} onClick={() => go("practice")} className={primaryButton}>
              К практике с Мартиной
            </motion.button>
          </motion.div>
        )}

        {step === "practice" && (
          <motion.div
            key="practice"
            variants={rise}
            initial="hidden"
            animate="show"
            exit="leave"
            className="flex flex-1 flex-col"
          >
            <div className="glass mb-4 flex items-center justify-between gap-3 p-4">
              <p className="text-subhead text-mist">
                <span className="font-semibold text-paper">Цель: </span>
                {lesson.practice.goal}
              </p>
              <motion.button
                {...press}
                onClick={() => go("quiz")}
                className="min-h-11 shrink-0 rounded-full bg-paper px-4 text-subhead font-semibold text-ink"
              >
                К тесту
              </motion.button>
            </div>
            <VoiceAssistant
              track={track}
              kid={false}
              topic={{
                id: "lesson",
                title: lesson.title,
                caption: lesson.practice.goal,
                opener: { text: lesson.practice.opener, choices: lesson.practice.choices },
                memoryKey: `lesson-${lesson.date}-${lesson.topic}`,
              }}
            />
          </motion.div>
        )}

        {(step === "quiz" || step === "done") && (
          <Quiz key="quiz" lesson={lesson} done={done} busy={busy} onComplete={onComplete} onNext={onNext} />
        )}
      </AnimatePresence>
    </div>
  );
}

function Quiz({
  lesson,
  done,
  busy,
  onComplete,
  onNext,
}: {
  lesson: Lesson;
  done: boolean;
  busy: boolean;
  onComplete: (
    answers: number[],
  ) => Promise<{ result: { score: number; total: number; results: boolean[] }; lesson: Lesson } | null>;
  onNext: () => void;
}) {
  const { haptic } = useApp();
  const [answers, setAnswers] = useState<(number | null)[]>(lesson.quiz.map(() => null));
  const [checked, setChecked] = useState<{ score: number; total: number; quiz: QuizItem[] } | null>(
    done && lesson.score !== null ? { score: lesson.score, total: lesson.quiz.length, quiz: lesson.quiz } : null,
  );
  const ready = answers.every((answer) => answer !== null);
  const quiz = checked?.quiz ?? lesson.quiz;

  async function check() {
    if (!ready) return;
    const data = await onComplete(answers as number[]);
    if (data) setChecked({ score: data.result.score, total: data.result.total, quiz: data.lesson.quiz });
  }

  const praise = checked
    ? checked.score === checked.total
      ? `${checked.score} из ${checked.total} — чисто. Урок дня закрыт, завтра поднимаем планку.`
      : checked.score > 0
        ? `${checked.score} из ${checked.total}. Разбери пояснения к ошибкам — завтра вернёмся к этому правилу.`
        : "0 из 3 — правило пока не усвоено. Внимательно разбери пояснения, завтра начнём с него."
    : null;

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show" exit="leave" className="space-y-4">
      <motion.p variants={rise} className="text-subhead text-mist">
        Экспресс-тест: 3 вопроса по уроку.
      </motion.p>
      {quiz.map((item, questionIndex) => (
        <motion.div key={questionIndex} variants={rise} className="glass p-4">
          <p className="text-headline font-semibold">
            {questionIndex + 1}. {item.question}
          </p>
          <div className="mt-3 space-y-2">
            {item.options.map((option, optionIndex) => {
              const picked = (checked ? null : answers[questionIndex]) === optionIndex;
              const isAnswer = checked && item.answer === optionIndex;
              const wrongPick = checked && answers[questionIndex] === optionIndex && item.answer !== optionIndex;
              return (
                <button
                  key={optionIndex}
                  disabled={!!checked}
                  onClick={() => {
                    haptic("selection");
                    setAnswers((current) => current.map((value, i) => (i === questionIndex ? optionIndex : value)));
                  }}
                  className={`flex min-h-11 w-full items-center rounded-xl px-3 text-left text-body transition-colors duration-300 ease-out-expo ${
                    isAnswer
                      ? "bg-champagne text-ink"
                      : wrongPick
                        ? "bg-danger/15 text-paper line-through decoration-danger/60"
                        : picked
                          ? "bg-paper text-ink"
                          : "bg-fill text-paper"
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
          {checked && item.explanation && <p className="mt-2 text-subhead text-mist">{item.explanation}</p>}
        </motion.div>
      ))}

      <AnimatePresence mode="wait" initial={false}>
        {checked ? (
          <motion.div
            key="praise"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
            className="space-y-4"
          >
            <MartinaNote text={praise!} />
            <motion.button {...press} disabled={busy} onClick={onNext} className={secondaryButton}>
              {busy ? "Мартина готовит урок…" : "Ещё один урок"}
            </motion.button>
            <p className="text-center text-footnote text-dim">Новый урок дня появится завтра — приходи!</p>
          </motion.div>
        ) : (
          <motion.button key="check" {...press} disabled={!ready || busy} onClick={check} className={primaryButton}>
            {busy ? "Проверяю…" : "Проверить ответы"}
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2 py-4" aria-live="polite">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-champagne text-headline font-semibold text-ink"
        aria-hidden
      >
        М
      </span>
      <div className="flex h-11 items-center gap-2 rounded-[1.25rem] rounded-bl-md bg-ink-raised px-4">
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
    <div className="space-y-3 py-2">
      <MartinaNote text={text} />
      <motion.button {...press} onClick={onRetry} className={secondaryButton}>
        Попробовать ещё раз
      </motion.button>
    </div>
  );
}
