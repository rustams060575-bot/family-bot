"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import MartinaNote from "@/components/MartinaNote";
import { ApiError, apiJson } from "@/lib/client/api";
import { AudioEngine, primeSpeech, speakWithBrowser, stopSpeech } from "@/lib/client/audio";
import { loadChat, saveChat } from "@/lib/client/memory";
import type { Account, ArtTask } from "@/lib/client/types";
import { enter, exit, press, spring } from "@/lib/motion";

// Чат Kids Art: ребёнок пишет или говорит Мартине («Что мне нарисовать?»), она отвечает
// голосом и выдаёт творческие задания. Последнее задание хранится в профиле — разбор
// следующего рисунка учитывает его.

type Message = { id: number; role: "user" | "assistant"; content: string; choices?: string[]; local?: boolean };
type Reply = { reply: string; task: ArtTask | null; choices: string[]; account: Account };

const STARTERS = ["🎨 Что мне нарисовать?", "🔥 Дай сложное задание", "🐉 Хочу нарисовать дракона"];
const SAY_AGAIN = "Ой, я плохо услышала! Повтори ещё раз, пожалуйста, чуть громче!";
const RETRY = "Ой, связь на секунду пропала. Напиши или скажи это ещё раз, пожалуйста!";
const MIN_RECORDING_BYTES = 2000;
const MAX_RECORDING_SEC = 45;

let nextId = 1;

export default function ArtChat({ onPhoto, onCanvas }: { onPhoto: () => void; onCanvas: () => void }) {
  const { account, setAccount, haptic, handleError } = useApp();
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = loadChat<Message>("art:chat").filter((message) => message?.role && message.content);
    if (saved.length) nextId = Math.max(nextId, ...saved.map((message) => message.id + 1));
    return saved;
  });
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing" | "thinking">("idle");
  const [seconds, setSeconds] = useState(0);
  const engineRef = useRef<AudioEngine | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const engine = () => (engineRef.current ??= new AudioEngine());
  const task = account?.artTask ?? null;

  useEffect(() => {
    setVoiceSupported(AudioEngine.supported());
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      engineRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    saveChat("art:chat", messages);
  }, [messages]);

  useEffect(() => {
    if (phase === "recording" && seconds >= MAX_RECORDING_SEC) stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, seconds]);

  function say(content: string) {
    setMessages((current) => [...current, { id: nextId++, role: "assistant", content, local: true }]);
  }

  async function send(content: string) {
    const text = content.trim();
    if (!text) return;
    primeSpeech();
    const userMessage: Message = { id: nextId++, role: "user", content: text };
    const history = [...messages, userMessage];
    setMessages(history);
    setPhase("thinking");
    try {
      const data = await apiJson<Reply>("/api/art/chat", {
        messages: history
          .filter((message) => !message.local)
          .map(({ role, content: body }) => ({ role, content: body })),
      });
      setMessages((current) => [
        ...current,
        { id: nextId++, role: "assistant", content: data.reply, choices: data.choices },
      ]);
      setAccount(data.account);
      haptic(data.task ? "success" : "light");
      // Мартина отвечает голосом сразу.
      speakWithBrowser(data.reply, "ru-RU");
    } catch (err) {
      if (handleError(err) !== null) say(RETRY);
    } finally {
      setPhase("idle");
    }
  }

  async function startRecording() {
    primeSpeech();
    stopSpeech();
    haptic("medium");
    try {
      await engine().startRecording();
      setPhase("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch {
      say("Мне пока не слышно микрофон. Разреши его в настройках Telegram — а пока можно написать!");
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
      say(SAY_AGAIN);
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
        say(SAY_AGAIN);
        return;
      }
      await send(text);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) handleError(err);
      say(SAY_AGAIN);
      setPhase("idle");
    }
  }

  const busy = phase === "thinking" || phase === "transcribing";
  const last = messages[messages.length - 1];
  const suggestions = !messages.length ? STARTERS : last?.role === "assistant" ? (last.choices ?? []) : [];

  return (
    <section className="space-y-3" aria-label="Чат с Мартиной">
      <AnimatePresence initial={false}>
        {messages.map((message) => (
          <motion.div
            key={message.id}
            layout="position"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: spring }}
            exit={{ opacity: 0, transition: exit }}
            className={message.role === "user" ? "flex justify-end" : ""}
          >
            {message.role === "user" ? (
              <p className="max-w-[80%] rounded-[1.25rem] rounded-br-md bg-paper px-4 py-2 text-body text-ink">
                {message.content}
              </p>
            ) : (
              <MartinaNote text={message.content} />
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      {busy && (
        <p className="pl-10 text-subhead text-mist" aria-live="polite">
          {phase === "transcribing" ? "Мартина слушает…" : "Мартина думает…"}
        </p>
      )}

      {/* Текущее задание Мартины — сразу с кнопками «сфотографировать» и «нарисовать». */}
      <AnimatePresence>
        {task && (
          <motion.div
            key={task.givenAt}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
            className="glass glass-accent p-4"
          >
            <p className="text-footnote font-semibold text-champagne">Задание от Мартины</p>
            <p className="mt-1 text-title3 font-semibold">{task.title}</p>
            {task.idea && <p className="mt-1 text-subhead text-mist">{task.idea}</p>}
            {!!task.steps.length && (
              <ol className="mt-2 space-y-1">
                {task.steps.map((step, index) => (
                  <li key={index} className="flex gap-2 text-subhead">
                    <span className="font-semibold tabular-nums text-champagne">{index + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-3 space-y-2">
              <motion.button
                {...press}
                onClick={onPhoto}
                className="min-h-[3.125rem] w-full rounded-[0.875rem] bg-paper px-4 text-headline font-semibold text-ink"
              >
                📸 Сфотографировать рисунок
              </motion.button>
              <motion.button
                {...press}
                onClick={onCanvas}
                className="min-h-[3.125rem] w-full rounded-[0.875rem] bg-fill px-4 text-headline font-semibold text-champagne"
              >
                🎨 Нарисовать на холсте
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!!suggestions.length && phase === "idle" && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <motion.button
              key={suggestion}
              {...press}
              onClick={() => {
                haptic("selection");
                send(suggestion);
              }}
              className="min-h-11 rounded-full bg-champagne/[0.14] px-4 text-subhead font-medium text-champagne"
            >
              {suggestion}
            </motion.button>
          ))}
        </div>
      )}

      {/* Поле ввода: текст + микрофон */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (phase !== "idle") return;
          const text = draft;
          setDraft("");
          send(text);
        }}
        className="flex items-center gap-2"
      >
        <div className="flex h-12 min-w-0 flex-1 items-center gap-1 rounded-full bg-ink-raised pl-4 pr-1 shadow-[var(--card-shadow)]">
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
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={busy ? "Мартина отвечает…" : "Напиши или скажи Мартине…"}
              disabled={busy}
              enterKeyHint="send"
              className="min-w-0 flex-1 bg-transparent text-body text-paper outline-none placeholder:text-dim"
            />
          )}
          {draft.trim() && phase === "idle" && (
            <button
              type="submit"
              aria-label="Отправить"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-champagne text-ink"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                aria-hidden
              >
                <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
        {voiceSupported && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={spring}
            disabled={busy}
            onClick={() => (phase === "recording" ? stopRecording() : startRecording())}
            aria-label={phase === "recording" ? "Остановить запись" : "Сказать Мартине"}
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
      </form>
    </section>
  );
}
