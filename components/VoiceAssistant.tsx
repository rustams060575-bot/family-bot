"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import Waveform from "@/components/Waveform";
import { ApiError, apiFetch, apiJson } from "@/lib/client/api";
import { AudioEngine, speakWithBrowser } from "@/lib/client/audio";
import type { Topic, Track } from "@/lib/client/tracks";
import { enter, exit, press, rise, spring } from "@/lib/motion";

type Correction = { heard: string; correct: string; note: string };
type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  translation?: string;
  corrections?: Correction[];
  pronunciation?: string;
  voice?: boolean;
};
type Phase = "idle" | "recording" | "transcribing" | "thinking" | "speaking";

type Props = { track: Track; topic: Topic };

const MAX_RECORDING_SEC = 60;
const STATUS: Record<Phase, string> = {
  idle: "",
  recording: "Слушаю",
  transcribing: "Распознаю речь",
  thinking: "Репетитор думает",
  speaking: "Репетитор говорит",
};

let nextId = 1;

export default function VoiceAssistant({ track, topic }: Props) {
  const { features, refresh, haptic, handleError } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    if (messages.length) window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }, [messages, phase]);

  const speak = useCallback(
    async (message: Message) => {
      setSpeakingId(message.id);
      setPhase("speaking");
      const done = () => {
        setSpeakingId(null);
        setPhase("idle");
      };
      const lang = message.voice ? track.speechLang ?? "en-US" : "ru-RU";
      if (!features.tts) return speakWithBrowser(message.content, lang, done);
      try {
        const response = await apiFetch("/api/tts", { method: "POST", body: JSON.stringify({ text: message.content }) });
        await engine().play(await response.arrayBuffer(), done);
      } catch {
        speakWithBrowser(message.content, lang, done);
      }
    },
    [features.tts, track.speechLang],
  );

  const send = useCallback(
    async (content: string, options: { voice?: boolean; uncertain?: string[] } = {}) => {
      const userMessage: Message = { id: nextId++, role: "user", content, voice: options.voice };
      const history = [...messages, userMessage];
      setMessages(history);
      setPhase("thinking");
      setError(null);

      try {
        const payload = {
          track: track.id,
          topic: topic.id,
          mode: options.voice ? "voice" : "text",
          uncertain: options.uncertain,
          messages: history.map(({ role, content: text }) => ({ role, content: text })),
        };
        const data = await apiJson<{
          reply: string;
          translation?: string;
          corrections?: Correction[];
          pronunciation?: string;
        }>("/api/chat", payload);

        const reply: Message = {
          id: nextId++,
          role: "assistant",
          content: data.reply,
          translation: data.translation,
          corrections: data.corrections,
          pronunciation: data.pronunciation,
          voice: options.voice,
        };
        setMessages((current) => [...current, reply]);
        haptic("light");
        refresh();
        if (options.voice) speak(reply);
        else setPhase("idle");
      } catch (err) {
        setMessages((current) => current.filter((message) => message.id !== userMessage.id));
        if (!options.voice) setDraft(content);
        setError(handleError(err));
        setPhase("idle");
      }
    },
    [messages, track.id, topic.id, haptic, refresh, speak, handleError],
  );

  async function startRecording() {
    haptic("medium");
    setError(null);
    try {
      await engine().startRecording();
      setPhase("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch {
      setError("Нет доступа к микрофону. Разрешите его в настройках Telegram.");
      haptic("error");
    }
  }

  async function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    haptic("light");
    const blob = await engine().stopRecording();
    if (!blob || blob.size < 2000) {
      setPhase("idle");
      setError("Запись слишком короткая — удерживайте мысль чуть дольше.");
      return;
    }

    setPhase("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, "speech");
      if (track.sttLang) form.append("language", track.sttLang);
      const { text, uncertain } = await apiJson<{ text: string; uncertain: string[] }>("/api/stt", form);
      if (!text) {
        setPhase("idle");
        setError("Не расслышал. Попробуйте ближе к микрофону.");
        return;
      }
      await send(text, { voice: true, uncertain });
    } catch (err) {
      setError(err instanceof ApiError ? handleError(err) : "Не получилось отправить запись.");
      setPhase("idle");
    }
  }

  function submitDraft(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || phase !== "idle") return;
    setDraft("");
    haptic("light");
    send(text);
  }

  const busy = phase === "transcribing" || phase === "thinking";
  const live = phase === "recording" || phase === "speaking";

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-4 pb-6">
        {messages.length === 0 && (
          <motion.div variants={rise} initial="hidden" animate="show" className="glass p-6">
            <p className="label">Голос или текст</p>
            <p className="mt-4 text-body text-mist">
              Отвечайте голосом — репетитор разберёт произношение и ошибки, или пишите текстом.
            </p>
            <motion.button
              {...press}
              onClick={() => send(topic.starter)}
              className="mt-6 w-full rounded-2xl bg-paper px-6 py-4 font-sans text-body font-medium text-ink"
            >
              Начать занятие
            </motion.button>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              layout="position"
              initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: enter }}
              exit={{ opacity: 0, transition: exit }}
              className={message.role === "user" ? "flex justify-end" : ""}
            >
              {message.role === "user" ? (
                <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-tint/[0.07] px-4 py-2 text-body text-paper">
                  {message.voice && <span className="label mr-2 text-champagne/80">голос</span>}
                  {message.content}
                </div>
              ) : (
                <AssistantBubble
                  message={message}
                  speaking={speakingId === message.id}
                  onSpeak={() => speak(message)}
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        <AnimatePresence>
          {busy && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: enter }}
              exit={{ opacity: 0, transition: exit }}
              className="label flex items-center gap-2"
            >
              <motion.span
                className="h-1 w-1 rounded-full bg-champagne"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              />
              {STATUS[phase]}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Док ввода — прилипает над таб-баром */}
      <div className="sticky bottom-28 z-20">
        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0, transition: enter }}
              exit={{ opacity: 0, transition: exit }}
              className="mb-2 rounded-2xl bg-ink/80 px-4 py-2 text-center text-body text-danger backdrop-blur-xl"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
        <div className="flex items-center gap-2">
      <div className="glass min-w-0 flex-1 p-2">
        <AnimatePresence mode="wait" initial={false}>
          {live ? (
            <motion.div
              key="wave"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: enter }}
              exit={{ opacity: 0, transition: exit }}
              className="flex items-center gap-4 px-4 py-2"
            >
              <div className="flex-1">
                <Waveform
                  read={(bands) => engine().readLevels(bands)}
                  active
                  tone={phase === "recording" ? "paper" : "champagne"}
                  height={40}
                />
              </div>
              <span className="w-16 text-right font-sans text-label lining-nums tabular-nums text-mist">
                {phase === "recording" ? `0:${String(seconds).padStart(2, "0")}` : STATUS.speaking}
              </span>
            </motion.div>
          ) : (
            <motion.form
              key="input"
              onSubmit={submitDraft}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: enter }}
              exit={{ opacity: 0, transition: exit }}
              className="flex items-center gap-2"
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={busy ? STATUS[phase] : "Сообщение репетитору"}
                disabled={busy}
                className="min-w-0 flex-1 bg-transparent px-4 py-2 text-body text-paper outline-none placeholder:text-dim"
                enterKeyHint="send"
              />
              {draft.trim() && (
                <motion.button
                  {...press}
                  type="submit"
                  className="rounded-2xl px-4 py-2 font-sans text-label font-medium uppercase text-champagne"
                >
                  Отправить
                </motion.button>
              )}
            </motion.form>
          )}
        </AnimatePresence>
      </div>

      {voiceSupported && (
          <MicButton
            recording={phase === "recording"}
            disabled={busy}
            onPress={() => {
              if (phase === "recording") stopRecording();
              else if (phase === "speaking") {
                engine().stopPlayback();
                window.speechSynthesis?.cancel();
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

function AssistantBubble({ message, speaking, onSpeak }: { message: Message; speaking: boolean; onSpeak: () => void }) {
  return (
    <div className="glass p-4">
      <p className="whitespace-pre-wrap text-body text-paper">{message.content}</p>
      {message.translation && <p className="mt-2 text-body text-mist">{message.translation}</p>}

      {!!message.corrections?.length && (
        <div className="mt-4 space-y-2">
          <div className="hairline" />
          <p className="label pt-2">Ошибки</p>
          {message.corrections.map((correction, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0, transition: { ...enter, delay: 0.2 + index * 0.08 } }}
              className="text-body"
            >
              <span className="text-dim line-through decoration-danger/60">{correction.heard}</span>
              <span className="mx-2 text-dim">→</span>
              <span className="text-paper">{correction.correct}</span>
              {correction.note && <p className="text-mist">{correction.note}</p>}
            </motion.div>
          ))}
        </div>
      )}

      {message.pronunciation && (
        <div className="mt-4 rounded-2xl bg-champagne/[0.07] p-4">
          <p className="label text-champagne/80">Фонетика</p>
          <p className="mt-2 text-body text-paper/90">{message.pronunciation}</p>
        </div>
      )}

      <motion.button
        {...press}
        onClick={onSpeak}
        className="mt-2 flex min-h-11 items-center gap-2 font-sans text-label font-medium uppercase text-mist"
        aria-label="Прослушать"
      >
        <SpeakerIcon active={speaking} />
        {speaking ? "Звучит" : "Прослушать"}
      </motion.button>
    </div>
  );
}

function MicButton({ recording, disabled, onPress }: { recording: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      transition={spring}
      onClick={onPress}
      disabled={disabled}
      aria-label={recording ? "Остановить запись" : "Говорить"}
      className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full disabled:opacity-40"
    >
      {/* Медленное «дыхание» кольца во время записи — не мигание */}
      <AnimatePresence>
        {recording && (
          <motion.span
            className="absolute inset-0 rounded-full ring-1 ring-danger/50"
            initial={{ scale: 1, opacity: 0 }}
            animate={{ scale: [1, 1.35], opacity: [0.6, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
      {/* Цвета — токенами темы; смена состояния — CSS-переходом с той же кривой ease-out-expo */}
      <span
        className={`absolute inset-0 rounded-full transition-colors duration-500 ease-out-expo ${
          recording ? "bg-danger/20" : "bg-paper"
        }`}
      />
      <span className={`relative transition-colors duration-500 ease-out-expo ${recording ? "text-danger" : "text-ink"}`}>
        {recording ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <rect x="4" y="4" width="12" height="12" rx="3" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" strokeLinecap="round" />
          </svg>
        )}
      </span>
    </motion.button>
  );
}

function SpeakerIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M2.5 6h2l3-2.5v9L4.5 10h-2z" strokeLinejoin="round" />
      <motion.path
        d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.3 6.3 0 0 1 0 9"
        strokeLinecap="round"
        animate={{ opacity: active ? [0.4, 1, 0.4] : 1 }}
        transition={active ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" } : undefined}
      />
    </svg>
  );
}
