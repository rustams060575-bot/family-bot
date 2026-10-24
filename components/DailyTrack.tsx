"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import SpeakButton from "@/components/SpeakButton";
import { apiJson } from "@/lib/client/api";
import { enter, exit, press, rise } from "@/lib/motion";

// «Дневной трек»: при входе — 1 главный урок по арту (из арт-школы Мартины)
// и 1 микро-практика по языку (3 слова + вопрос). Мартина готовит практику сама.
// Третий пункт — шахматный челлендж Лео: задачка дня на 2–3 минуты (решается на /chess).

type Micro = {
  track: "english" | "spanish" | "german";
  topic: string;
  intro: string;
  words: { word: string; translation: string; example: string }[];
  question: { prompt: string; options: string[]; answer?: number };
};
type Daily = {
  date: string;
  art: { needsAge: boolean; title: string | null; stage: number | null; nextTheme: string | null; done: boolean };
  lang: { track: "english" | "spanish" | "german"; micro: Micro | null; done: boolean; correct: boolean | null };
  chess: {
    needsSurvey: boolean;
    needsAge: boolean;
    title: string | null;
    theme?: string | null;
    done: boolean;
    correct: boolean | null;
  };
};

const LANG_LABEL = { english: "English", spanish: "Español", german: "Deutsch" };
const SPEECH = { english: "en-US", spanish: "es-ES", german: "de-DE" };

export default function DailyTrack() {
  const { haptic, refresh } = useApp();
  const [daily, setDaily] = useState<Daily | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setDaily((await apiJson<{ daily: Daily }>("/api/daily")).daily);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Микро-практика на сегодня готовится сама, без запроса ученика.
  useEffect(() => {
    if (!daily || daily.lang.micro || preparing || failed) return;
    setPreparing(true);
    apiJson<{ daily: Daily }>("/api/daily", { action: "micro" })
      .then((data) => setDaily(data.daily))
      .catch(() => setFailed(true))
      .finally(() => setPreparing(false));
  }, [daily, preparing, failed]);

  if (!daily) return null;
  const doneCount = Number(daily.art.done) + Number(daily.lang.done) + Number(daily.chess.done);
  const micro = daily.lang.micro;

  async function answer(option: number) {
    if (daily?.lang.done) return;
    haptic("selection");
    setPicked(option);
    try {
      const data = await apiJson<{ daily: Daily; result: { correct: boolean } }>("/api/daily", {
        action: "answer",
        answer: option,
      });
      setDaily(data.daily);
      haptic(data.result.correct ? "success" : "light");
      refresh();
    } catch {
      setPicked(null);
    }
  }

  const artCaption = daily.art.done
    ? "Сегодня пройден ✓"
    : daily.art.needsAge
      ? "Расскажи Мартине, сколько тебе лет"
      : daily.art.title
        ? `«${daily.art.title}» · этап ${(daily.art.stage ?? 0) + 1} из 3`
        : `Тема: «${daily.art.nextTheme ?? "…"}»`;

  const chessCaption = daily.chess.done
    ? daily.chess.correct
      ? "Задача решена ✓"
      : "Разобрали с Лео ✓"
    : daily.chess.needsAge || daily.chess.needsSurvey
      ? "Ответь Лео на два вопроса — и начнём"
      : `«${daily.chess.title ?? "…"}» · 2–3 минуты`;

  return (
    <motion.section variants={rise} className="mt-6" aria-label="Дневной трек">
      <div className="flex items-baseline justify-between px-4 pb-2">
        <h2 className="label">Дневной трек</h2>
        <span className="text-footnote tabular-nums text-dim">{doneCount} из 3</span>
      </div>
      <div className="glass overflow-hidden">
        {/* 1. Главный урок по арту */}
        <Link href="/art" onClick={() => haptic("light")} className="block active:bg-tint/[0.06]">
          <div className="flex min-h-[3.75rem] items-center gap-3 px-4 py-3">
            <Check done={daily.art.done} icon="🎨" />
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold">Главный урок по арту</p>
              <p className="truncate text-subhead text-mist">{artCaption}</p>
            </div>
            <Chevron />
          </div>
        </Link>
        <div className="hairline ml-[3.75rem]" />

        {/* 2. Шахматный челлендж Лео */}
        <Link href="/chess" onClick={() => haptic("light")} className="block active:bg-tint/[0.06]">
          <div className="flex min-h-[3.75rem] items-center gap-3 px-4 py-3">
            <Check done={daily.chess.done} icon={"♟︎"} />
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold">Шахматный челлендж от Лео</p>
              <p className="truncate text-subhead text-mist">{chessCaption}</p>
            </div>
            <Chevron />
          </div>
        </Link>
        <div className="hairline ml-[3.75rem]" />

        {/* 3. Микро-практика по языку */}
        <button
          onClick={() => {
            haptic("light");
            setOpen((value) => !value);
          }}
          className="block w-full text-left active:bg-tint/[0.06]"
          aria-expanded={open}
        >
          <div className="flex min-h-[3.75rem] items-center gap-3 px-4 py-3">
            <Check done={daily.lang.done} icon="🗣" />
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold">Микро-практика · {LANG_LABEL[daily.lang.track]}</p>
              <p className="truncate text-subhead text-mist">
                {daily.lang.done
                  ? daily.lang.correct
                    ? "Отлично, всё верно ✓"
                    : "Сделано ✓ Завтра закрепим"
                  : micro
                    ? `${micro.topic} · 3 слова и вопрос, 2 минуты`
                    : failed
                      ? "Не получилось подготовить — откройте позже"
                      : "Мартина готовит слова…"}
              </p>
            </div>
            <motion.span animate={{ rotate: open ? 90 : 0 }} className="text-dim/60">
              <Chevron />
            </motion.span>
          </div>
        </button>

        <AnimatePresence initial={false}>
          {open && micro && (
            <motion.div
              key="micro"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1, transition: enter }}
              exit={{ height: 0, opacity: 0, transition: exit }}
              className="overflow-hidden"
            >
              <div className="space-y-3 px-4 pb-4">
                {micro.intro && <p className="text-subhead text-mist">{micro.intro}</p>}
                <div className="space-y-1">
                  {micro.words.map((item) => (
                    <div key={item.word} className="flex items-center gap-2 rounded-xl bg-fill px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-headline font-semibold">
                          {item.word} <span className="font-normal text-mist">— {item.translation}</span>
                        </p>
                        {item.example && <p className="text-footnote text-mist">{item.example}</p>}
                      </div>
                      <SpeakButton
                        text={item.example ? `${item.word}. ${item.example}` : item.word}
                        foreignLang={SPEECH[micro.track]}
                        label={false}
                        className="shrink-0 justify-center px-1"
                      />
                    </div>
                  ))}
                </div>
                <p className="pt-1 text-headline font-semibold">{micro.question.prompt}</p>
                <div className="space-y-2">
                  {micro.question.options.map((option, index) => {
                    const revealed = daily.lang.done && micro.question.answer !== undefined;
                    const isAnswer = revealed && micro.question.answer === index;
                    const wrong = revealed && picked === index && !isAnswer;
                    return (
                      <motion.button
                        key={option}
                        {...press}
                        disabled={daily.lang.done}
                        onClick={() => answer(index)}
                        className={`flex min-h-11 w-full items-center rounded-xl px-3 text-left text-body transition-colors duration-300 ease-out-expo ${
                          isAnswer ? "bg-champagne text-ink" : wrong ? "bg-danger/15 line-through" : "bg-fill"
                        }`}
                      >
                        {option}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

function Check({ done, icon }: { done: boolean; icon: string }) {
  return (
    <span
      className={`grid h-[1.875rem] w-[1.875rem] shrink-0 place-items-center rounded-full text-subhead transition-colors duration-500 ease-out-expo ${
        done ? "bg-champagne text-ink" : "bg-fill"
      }`}
      aria-hidden
    >
      {done ? "✓" : icon}
    </span>
  );
}

function Chevron() {
  return (
    <svg
      width="8"
      height="14"
      viewBox="0 0 8 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="shrink-0 text-dim/60"
      aria-hidden
    >
      <path d="m1 1 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
