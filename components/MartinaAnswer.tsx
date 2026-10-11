"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import MartinaNote from "@/components/MartinaNote";
import { ApiError, apiJson } from "@/lib/client/api";
import { AudioEngine, primeSpeech, speakWithBrowser, stopSpeech } from "@/lib/client/audio";
import type { Account } from "@/lib/client/types";
import { enter, exit, press, spring } from "@/lib/motion";

// Ответ ребёнка на «Вопрос от Мартины» после разбора рисунка: голосом или текстом.
// Мартина отвечает короткой вдохновляющей реакцией (текст + голос), после чего
// экран открывает «Новое задание».

const SAY_AGAIN = "Ой, я плохо услышала! Скажи ещё раз, пожалуйста, чуть громче!";
const RETRY = "Ой, связь на секунду пропала. Попробуй ответить ещё раз!";
const MIN_RECORDING_BYTES = 2000;
const MAX_RECORDING_SEC = 45;

type Props = {
  question: string;
  title: string;
  nextTask: string;
  onAnswered: () => void;
};

const MartinaAnswer = forwardRef<HTMLInputElement, Props>(function MartinaAnswer(
  { question, title, nextTask, onAnswered },
  inputRef,
) {
  const { setAccount, haptic, handleError } = useApp();
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing" | "thinking">("idle");
  const [seconds, setSeconds] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const [reaction, setReaction] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const engineRef = useRef<AudioEngine | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const engine = () => (engineRef.current ??= new AudioEngine());

  useEffect(() => {
    setVoiceSupported(AudioEngine.supported());
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      engineRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (phase === "recording" && seconds >= MAX_RECORDING_SEC) stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, seconds]);

  async function send(content: string) {
    const text = content.trim();
    if (!text || phase === "thinking") return;
    primeSpeech();
    setNote(null);
    setAnswer(text);
    setDraft("");
    setPhase("thinking");
    try {
      const data = await apiJson<{ reply: string; account: Account }>("/api/art/chat", {
        answerTo: { question, title, nextTask },
        messages: [
          { role: "assistant", content: question },
          { role: "user", content: text },
        ],
      });
      setReaction(data.reply);
      if (data.account) setAccount(data.account);
      haptic("success");
      speakWithBrowser(data.reply, "ru-RU");
      onAnswered();
    } catch (err) {
      // Не дошло — ответ возвращается в поле, можно отправить ещё раз.
      setAnswer(null);
      setDraft(text);
      if (handleError(err) !== null) setNote(RETRY);
    } finally {
      setPhase("idle");
    }
  }

  async function startRecording() {
    primeSpeech();
    stopSpeech();
    haptic("medium");
    setNote(null);
    try {
      await engine().startRecording();
      setPhase("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch {
      setNote("Мне пока не слышно микрофон. Разреши его в настройках Telegram — а пока можно написать!");
      haptic("warning");
    }
  }

  async function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    haptic("light");
    const blob = await engine().stopRecording();
    if (!blob || blob.size < MIN_RECORDING_BYTES) {
      setPhase("idle");
      setNote(SAY_AGAIN);
      return;
    }
    setPhase("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, "speech");
      form.append("track", "art");
      const { text, unclear } = await apiJson<{ text: string; unclear?: boolean }>("/api/stt", form);
      if (unclear || !text) {
        setPhase("idle");
        setNote(SAY_AGAIN);
        return;
      }
      await send(text);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) handleError(err);
      setNote(SAY_AGAIN);
      setPhase("idle");
    }
  }

  const busy = phase === "thinking" || phase === "transcribing";

  // Ответ отправлен: реплика ребёнка и реакция Мартины.
  if (answer) {
    return (
      <div className="space-y-3" aria-live="polite">
        <motion.p
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: spring }}
          className="ml-auto w-fit max-w-[80%] rounded-[1.25rem] rounded-br-md bg-paper px-4 py-2 text-body text-ink"
        >
          {answer}
        </motion.p>
        <AnimatePresence mode="wait">
          {reaction ? (
            <motion.div key="reaction" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: enter }}>
              <MartinaNote text={reaction} />
            </motion.div>
          ) : (
            <motion.p
              key="thinking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: enter }}
              exit={{ opacity: 0, transition: exit }}
              className="pl-10 text-subhead text-mist"
            >
              Мартина читает твой ответ…
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
        className="space-y-3"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-12 min-w-0 flex-1 items-center rounded-full bg-ink-raised pl-4 pr-4 shadow-[var(--card-shadow)]">
            {phase === "recording" ? (
              <span className="flex flex-1 items-center gap-2 text-body text-mist">
                <motion.span
                  className="h-2 w-2 rounded-full bg-danger"
                  animate={{ opacity: [1, 0.35, 1] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                />
                Слушаю… <span className="tabular-nums">0:{String(seconds).padStart(2, "0")}</span>
              </span>
            ) : (
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={phase === "transcribing" ? "Мартина слушает…" : "Напиши ответ Мартине…"}
                disabled={busy}
                enterKeyHint="send"
                aria-label="Ответ Мартине"
                className="min-w-0 flex-1 bg-transparent text-body text-paper outline-none placeholder:text-dim"
              />
            )}
          </div>
          {voiceSupported && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              transition={spring}
              disabled={busy}
              onClick={() => (phase === "recording" ? stopRecording() : startRecording())}
              aria-label={phase === "recording" ? "Остановить запись" : "Ответить голосом"}
              className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full disabled:opacity-40"
            >
              <span className="absolute inset-0 rounded-full ring-[3px] ring-inset ring-paper/25" />
              <motion.span
                className="grid place-items-center bg-danger text-white"
                initial={false}
                animate={
                  phase === "recording"
                    ? { width: 18, height: 18, borderRadius: 5 }
                    : { width: 38, height: 38, borderRadius: 19 }
                }
                transition={spring}
              >
                {phase !== "recording" && (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" strokeLinecap="round" />
                  </svg>
                )}
              </motion.span>
            </motion.button>
          )}
        </div>
        <motion.button
          type="submit"
          {...press}
          disabled={!draft.trim() || busy || phase === "recording"}
          className="min-h-[3.125rem] w-full rounded-[0.875rem] bg-paper px-5 text-headline font-semibold text-ink disabled:opacity-50"
        >
          💬 Ответить Мартине
        </motion.button>
      </form>
      {note && <MartinaNote text={note} />}
    </div>
  );
});

export default MartinaAnswer;
