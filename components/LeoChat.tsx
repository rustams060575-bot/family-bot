"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import MartinaNote from "@/components/MartinaNote";
import { apiJson } from "@/lib/client/api";
import { primeSpeech, speakWithBrowser } from "@/lib/client/audio";
import { loadChat, saveChat } from "@/lib/client/memory";
import type { Account } from "@/lib/client/types";
import { exit, press, spring } from "@/lib/motion";

// Чат с Лео: вопросы о шахматах («Что такое вилка?»), словесные задачки и разбор
// детских видеоуроков. Лео отвечает голосом; история хранится на устройстве.

type Message = { id: number; role: "user" | "assistant"; content: string; choices?: string[]; local?: boolean };
type Reply = { reply: string; choices: string[]; account: Account };

const STARTERS = ["♞ Как ходит конь?", "🍴 Что такое вилка?", "🧩 Дай задачку"];
const RETRY = "Ой, связь на секунду пропала. Напиши ещё раз, пожалуйста!";

let nextId = 1;

export default function LeoChat() {
  const { setAccount, haptic, handleError } = useApp();
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = loadChat<Message>("chess:chat").filter((message) => message?.role && message.content);
    if (saved.length) nextId = Math.max(nextId, ...saved.map((message) => message.id + 1));
    return saved;
  });
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);

  useEffect(() => {
    saveChat("chess:chat", messages);
  }, [messages]);

  async function send(content: string) {
    const text = content.trim();
    if (!text || thinking) return;
    primeSpeech();
    const history = [...messages, { id: nextId++, role: "user" as const, content: text }];
    setMessages(history);
    setThinking(true);
    try {
      const data = await apiJson<Reply>("/api/chess/chat", {
        messages: history
          .filter((message) => !message.local)
          .map(({ role, content: body }) => ({ role, content: body })),
      });
      setMessages((current) => [
        ...current,
        { id: nextId++, role: "assistant", content: data.reply, choices: data.choices },
      ]);
      setAccount(data.account);
      haptic("light");
      speakWithBrowser(data.reply, "ru-RU", undefined, { voice: "male" });
    } catch (err) {
      if (handleError(err) !== null) {
        setMessages((current) => [...current, { id: nextId++, role: "assistant", content: RETRY, local: true }]);
      }
    } finally {
      setThinking(false);
    }
  }

  const last = messages[messages.length - 1];
  const suggestions = !messages.length ? STARTERS : last?.role === "assistant" ? (last.choices ?? []) : [];

  return (
    <section className="space-y-3" aria-label="Чат с Лео">
      {!messages.length && (
        <MartinaNote monogram="Л" text="Спрашивай меня о чём угодно в шахматах — объясню на понятных примерах!" />
      )}
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
              <MartinaNote monogram="Л" text={message.content} />
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      {thinking && (
        <p className="pl-10 text-subhead text-mist" aria-live="polite">
          Лео думает…
        </p>
      )}

      {!!suggestions.length && !thinking && (
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

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft;
          setDraft("");
          send(text);
        }}
        className="flex h-12 items-center gap-1 rounded-full bg-ink-raised pl-4 pr-1 shadow-[var(--card-shadow)]"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={thinking ? "Лео отвечает…" : "Спроси Лео…"}
          disabled={thinking}
          enterKeyHint="send"
          className="min-w-0 flex-1 bg-transparent text-body text-paper outline-none placeholder:text-dim"
        />
        {draft.trim() && !thinking && (
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
      </form>
    </section>
  );
}
