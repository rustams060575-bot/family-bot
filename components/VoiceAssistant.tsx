"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import Waveform from "@/components/Waveform";
import { ApiError, apiJson } from "@/lib/client/api";
import { AudioEngine, primeSpeech, speakWithBrowser, speechLangFor, stopSpeech } from "@/lib/client/audio";
import SpeakButton, { SpeakerIcon } from "@/components/SpeakButton";
import { martinaGreeting, type Topic, type Track } from "@/lib/client/tracks";
import { loadChat, saveChat } from "@/lib/client/memory";
import { enter, exit, press, spring } from "@/lib/motion";

type Correction = { heard: string; correct: string; note: string };
type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  translation?: string;
  corrections?: Correction[];
  pronunciation?: string;
  choices?: string[];
  voice?: boolean;
  // Реплика клиента (переспрос, подсказка) — показывается, но не уходит в историю для ИИ.
  local?: boolean;
};
type Reply = {
  reply: string;
  translation?: string;
  corrections?: Correction[];
  pronunciation?: string;
  choices?: string[];
};
type Phase = "idle" | "recording" | "transcribing" | "thinking" | "speaking";

type Props = { track: Track; topic: Topic; kid: boolean };

const MAX_RECORDING_SEC = 60;
const MIN_RECORDING_BYTES = 2000;

// Мягкие переспросы Мартины вместо системных ошибок.
const SAY_AGAIN = "Ой, я плохо услышала! Повтори ещё раз, пожалуйста, чуть громче!";
const NO_MIC =
  "Мне пока не слышно микрофон. Разреши его в настройках Telegram — и поговорим голосом! А пока можно написать.";
const RETRY = "Ой, связь на секунду пропала. Напиши или скажи это ещё раз, пожалуйста!";

let nextId = 1;

export default function VoiceAssistant({ track, topic, kid }: Props) {
  const { account, refresh, haptic, handleError } = useApp();
  // Занятие продолжается с того же места: история хранится на устройстве по треку и теме.
  const chatKey = `${track.id}:${topic.memoryKey ?? topic.id}:${kid ? "kid" : "adult"}`;
  const greeting = (): Message => ({
    id: nextId++,
    role: "assistant",
    content: `${martinaGreeting(account?.firstName)} ${topic.opener.text}`,
    choices: topic.opener.choices,
  });
  // Мартина говорит первой: приветствие и варианты ответа готовы сразу, без запроса к ИИ.
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = loadChat<Message>(chatKey).filter((message) => message?.role && message.content);
    if (!saved.length) return [greeting()];
    nextId = Math.max(nextId, ...saved.map((message) => message.id + 1));
    return saved;
  });
  const resumed = messages.length > 1;

  useEffect(() => {
    saveChat(chatKey, messages);
  }, [chatKey, messages]);

  function restart() {
    haptic("light");
    stopSpeech();
    setPhase("idle");
    setDraft("");
    setMessages([greeting()]);
  }
  const [phase, setPhase] = useState<Phase>("idle");
  const [draft, setDraft] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);

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

  useEffect(() => {
    if (messages.length > 1) window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }, [messages, phase]);

  const say = useCallback((content: string, choices?: string[]) => {
    setMessages((current) => [...current, { id: nextId++, role: "assistant", content, choices, local: true }]);
  }, []);

  const speak = useCallback(
    async (message: Message) => {
      setSpeakingId(message.id);
      setPhase("speaking");
      const done = () => {
        setSpeakingId(null);
        setPhase("idle");
      };
      // Только бесплатный голос устройства — никаких платных TTS-сервисов.
      speakWithBrowser(message.content, speechLangFor(message.content, track.speechLang), done);
    },
    [track],
  );

  const send = useCallback(
    async (content: string, options: { voice?: boolean; uncertain?: string[]; choice?: boolean } = {}) => {
      const userMessage: Message = { id: nextId++, role: "user", content, voice: options.voice };
      const history = [...messages, userMessage];
      setMessages(history);
      setPhase("thinking");

      try {
        const data = await apiJson<Reply>("/api/chat", {
          track: track.id,
          topic: topic.id,
          mode: options.voice ? "voice" : "text",
          uncertain: options.uncertain,
          messages: history
            .filter((message) => !message.local)
            .map(({ role, content: text }) => ({ role, content: text })),
        });

        const reply: Message = {
          id: nextId++,
          role: "assistant",
          content: data.reply,
          translation: data.translation,
          corrections: data.corrections,
          pronunciation: data.pronunciation,
          choices: data.choices,
          voice: options.voice,
        };
        setMessages((current) => [...current, reply]);
        haptic("light");
        refresh();
        // Ребёнку Мартина отвечает голосом всегда, взрослому — когда он сам говорил голосом.
        if (options.voice || kid) speak(reply);
        else setPhase("idle");
      } catch (err) {
        // Лимит открывает плашку Premium; любой другой сбой — мягкая реплика Мартины.
        const message = handleError(err);
        setMessages((current) => current.filter((item) => item.id !== userMessage.id));
        // Набранный текст возвращаем в поле; варианты ответа остаются кнопками под репликой.
        if (!options.voice && !options.choice) setDraft(content);
        if (message !== null) say(RETRY, messages[messages.length - 1]?.choices);
        setPhase("idle");
      }
    },
    [messages, track.id, topic.id, kid, haptic, refresh, speak, handleError, say],
  );

  async function startRecording() {
    primeSpeech();
    haptic("medium");
    try {
      await engine().startRecording();
      setPhase("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch {
      say(NO_MIC);
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
      form.append("track", track.id);
      const { text, uncertain, unclear } = await apiJson<{ text: string; uncertain: string[]; unclear?: boolean }>(
        "/api/stt",
        form,
      );
      if (unclear || !text) {
        setPhase("idle");
        say(SAY_AGAIN);
        haptic("warning");
        return;
      }
      await send(text, { voice: true, uncertain });
    } catch (err) {
      // Доступ и лимиты обрабатывает приложение; сбой распознавания — просто переспрос.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) handleError(err);
      say(SAY_AGAIN);
      setPhase("idle");
    }
  }

  function submitDraft(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || phase !== "idle") return;
    primeSpeech();
    setDraft("");
    haptic("light");
    send(text);
  }

  function choose(choice: string) {
    if (phase !== "idle") return;
    primeSpeech();
    haptic("selection");
    send(choice, { choice: true });
  }

  const busy = phase === "transcribing" || phase === "thinking";
  const live = phase === "recording" || phase === "speaking";
  const last = messages[messages.length - 1];

  return (
    <div className="flex flex-1 flex-col">
      {resumed && (
        <div className="-mt-2 mb-3 flex items-center justify-between">
          <span className="text-footnote text-dim">Продолжаем с того места, где остановились</span>
          <button onClick={restart} className="min-h-11 px-1 text-subhead font-medium text-champagne">
            Начать заново
          </button>
        </div>
      )}
      <div className="flex-1 space-y-2 pb-6">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              layout="position"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { ...spring } }}
              exit={{ opacity: 0, transition: exit }}
              className={message.role === "user" ? "flex justify-end" : ""}
            >
              {message.role === "user" ? (
                <div className="max-w-[80%] rounded-[1.25rem] rounded-br-md bg-paper px-4 py-2 text-body text-ink">
                  {message.voice && <MicGlyph />}
                  {message.content}
                </div>
              ) : (
                <AssistantBubble
                  message={message}
                  kid={kid}
                  speaking={speakingId === message.id}
                  onSpeak={() => {
                    primeSpeech();
                    speak(message);
                  }}
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Варианты ответа под последней репликой Мартины: выбрать проще, чем придумать. */}
        <AnimatePresence>
          {last.role === "assistant" && !!last.choices?.length && phase === "idle" && (
            <motion.div
              key={`choices-${last.id}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { ...enter, delay: 0.15 } }}
              exit={{ opacity: 0, transition: exit }}
              className="flex flex-wrap gap-2 pl-10 pt-2"
            >
              {last.choices.map((choice) => (
                <motion.button
                  key={choice}
                  {...press}
                  onClick={() => choose(choice)}
                  className={`min-h-11 rounded-full bg-champagne/[0.14] px-4 font-medium text-champagne ${
                    kid ? "text-headline" : "text-subhead"
                  }`}
                >
                  {choice}
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>{busy && <TypingBubble key="typing" listening={phase === "transcribing"} />}</AnimatePresence>
      </div>

      {/* Док ввода — материал с блюром, закреплён над таб-баром (место под него — нижний отступ страницы) */}
      <div
        className="fixed inset-x-0 z-20 mx-auto max-w-md px-4 pb-2"
        style={{ bottom: "calc(3.0625rem + var(--safe-bottom))" }}
      >
        <div className="flex items-center gap-2">
          <div className="material min-w-0 flex-1 rounded-full">
            <AnimatePresence mode="wait" initial={false}>
              {live ? (
                <motion.div
                  key="wave"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: enter }}
                  exit={{ opacity: 0, transition: exit }}
                  className="flex h-12 items-center gap-3 pl-4 pr-4"
                >
                  {phase === "recording" && (
                    <motion.span
                      className="h-2 w-2 shrink-0 rounded-full bg-danger"
                      animate={{ opacity: [1, 0.35, 1] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <Waveform
                      read={(bands) => engine().readLevels(bands)}
                      active
                      tone={phase === "recording" ? "danger" : "champagne"}
                      height={28}
                    />
                  </div>
                  <span className="shrink-0 text-subhead tabular-nums text-mist">
                    {phase === "recording" ? `0:${String(seconds).padStart(2, "0")}` : "Мартина"}
                  </span>
                </motion.div>
              ) : (
                <motion.form
                  key="input"
                  onSubmit={submitDraft}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: enter }}
                  exit={{ opacity: 0, transition: exit }}
                  className="flex h-12 items-center gap-1 pl-4 pr-1"
                >
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={
                      busy ? (phase === "transcribing" ? "Мартина слушает…" : "Мартина печатает…") : "Сообщение Мартине"
                    }
                    disabled={busy}
                    className="min-w-0 flex-1 bg-transparent text-body text-paper outline-none placeholder:text-dim"
                    enterKeyHint="send"
                  />
                  <AnimatePresence>
                    {draft.trim() && (
                      <motion.button
                        key="send"
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1, transition: spring }}
                        exit={{ scale: 0.6, opacity: 0, transition: exit }}
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
                      </motion.button>
                    )}
                  </AnimatePresence>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          {voiceSupported && (
            <MicButton
              recording={phase === "recording"}
              speaking={phase === "speaking"}
              disabled={busy}
              onPress={() => {
                if (phase === "recording") stopRecording();
                else if (phase === "speaking") {
                  stopSpeech();
                  setPhase("idle");
                  setSpeakingId(null);
                } else startRecording();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Аватар Мартины — монограмма, а не сгенерированное «фото».
function Avatar({ kid }: { kid: boolean }) {
  return (
    <span
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-champagne font-semibold text-ink ${
        kid ? "font-rounded text-headline" : "text-subhead"
      }`}
      aria-hidden
    >
      М
    </span>
  );
}

function AssistantBubble({
  message,
  kid,
  speaking,
  onSpeak,
}: {
  message: Message;
  kid: boolean;
  speaking: boolean;
  onSpeak: () => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <Avatar kid={kid} />
      <div className="max-w-[86%] rounded-[1.25rem] rounded-bl-md bg-ink-raised px-4 pb-1 pt-2 shadow-[var(--card-shadow)]">
        <p className={`whitespace-pre-wrap text-paper ${kid ? "text-title3" : "text-body"}`}>{message.content}</p>
        {message.translation && <p className="mt-1 text-subhead text-mist">{message.translation}</p>}

        {!!message.corrections?.length && (
          <div className="mt-3 space-y-2">
            <div className="hairline" />
            <p className="label pt-1">Поправим</p>
            {message.corrections.map((correction, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0, transition: { ...enter, delay: 0.2 + index * 0.08 } }}
                className="text-subhead"
              >
                <span className="text-dim line-through decoration-danger/60">{correction.heard}</span>
                <span className="mx-2 text-dim">→</span>
                <span className="font-semibold text-paper">{correction.correct}</span>
                {correction.note && <p className="text-mist">{correction.note}</p>}
              </motion.div>
            ))}
          </div>
        )}

        {message.pronunciation && (
          <div className="mt-3 rounded-xl bg-champagne/[0.1] px-3 py-2">
            <p className="text-footnote font-semibold text-champagne">Произношение</p>
            <p className="mt-1 text-subhead text-paper">{message.pronunciation}</p>
          </div>
        )}

        {!message.local && (
          <button
            onClick={onSpeak}
            className="-ml-1 flex min-h-11 items-center gap-1.5 px-1 text-subhead font-medium text-champagne"
            aria-label="Прослушать"
          >
            <SpeakerIcon active={speaking} />
            {speaking ? "Звучит" : "Прослушать"}
          </button>
        )}
        {/* Переспросы и подсказки Мартины тоже можно прослушать. */}
        {message.local && <SpeakButton text={message.content} className="-ml-1 px-1" />}
      </div>
    </div>
  );
}

// Индикатор «Мартина печатает» как в iMessage: три точки, волна прозрачности — без прыжков.
function TypingBubble({ listening }: { listening: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: enter }}
      exit={{ opacity: 0, transition: exit }}
      className="flex items-end gap-2"
      aria-live="polite"
    >
      <span className="h-8 w-8 shrink-0" />
      <div className="flex h-9 items-center gap-1 rounded-[1.25rem] rounded-bl-md bg-ink-raised px-4">
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            className="h-2 w-2 rounded-full bg-mist"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: index * 0.18 }}
          />
        ))}
        <span className="sr-only">{listening ? "Мартина слушает" : "Мартина печатает"}</span>
      </div>
    </motion.div>
  );
}

// Кнопка записи в стиле «Диктофона» iOS: кольцо и красный круг, который на записи
// пружиной превращается в скруглённый квадрат «стоп».
function MicButton({
  recording,
  speaking,
  disabled,
  onPress,
}: {
  recording: boolean;
  speaking: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      transition={spring}
      onClick={onPress}
      disabled={disabled}
      aria-label={recording ? "Остановить запись" : speaking ? "Остановить голос" : "Говорить"}
      className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full disabled:opacity-40"
    >
      <span className="absolute inset-0 rounded-full ring-[3px] ring-inset ring-paper/25" />
      {speaking ? (
        <span className="h-4 w-4 rounded-[0.25rem] bg-paper" />
      ) : (
        <motion.span
          className="grid place-items-center bg-danger text-white"
          initial={false}
          animate={recording ? { width: 18, height: 18, borderRadius: 5 } : { width: 38, height: 38, borderRadius: 19 }}
          transition={spring}
        >
          {!recording && (
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
      )}
    </motion.button>
  );
}

function MicGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      className="mr-1.5 inline -translate-y-px opacity-60"
      aria-label="голосом"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" strokeLinecap="round" />
    </svg>
  );
}
