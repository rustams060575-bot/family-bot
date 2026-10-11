"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import { apiJson } from "@/lib/client/api";
import { speakWithBrowser } from "@/lib/client/audio";
import { enter, exit, press, rise, spring, stagger } from "@/lib/motion";

type Lang = "uz" | "ru" | "es" | "en";
type Result = { detected: Lang | null; translation: string; alternatives: string[]; note: string };

const LANGS: { id: Lang; label: string; name: string; speech: string }[] = [
  { id: "uz", label: "UZ", name: "O‘zbek", speech: "uz-UZ" },
  { id: "ru", label: "RU", name: "Русский", speech: "ru-RU" },
  { id: "es", label: "ES", name: "Español", speech: "es-ES" },
  { id: "en", label: "EN", name: "English", speech: "en-US" },
];

function LangPicker({ value, onChange, includeAuto }: { value: string; onChange: (lang: any) => void; includeAuto?: boolean }) {
  const options = includeAuto ? [{ id: "auto", label: "Авто", name: "Определить язык" }, ...LANGS] : LANGS;
  return (
    <div>
      <div className={`grid gap-0.5 rounded-full bg-fill p-0.5 ${includeAuto ? "grid-cols-5" : "grid-cols-4"}`}>
        {options.map((option) => (
          <button key={option.id} onClick={() => onChange(option.id)} aria-label={option.name} className="relative min-h-11 rounded-full">
            {value === option.id && (
              <motion.span
                layoutId={includeAuto ? "lang-from" : "lang-to"}
                transition={spring}
                className="absolute inset-0 rounded-full segment-thumb"
              />
            )}
            <span className={`relative text-subhead font-medium ${value === option.id ? "text-paper" : "text-dim"}`}>
              {option.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Translator() {
  const { refresh, haptic, handleError } = useApp();
  const [from, setFrom] = useState<Lang | "auto">("auto");
  const [to, setTo] = useState<Lang>("uz");
  const [register, setRegister] = useState<"casual" | "business">("casual");
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function translate() {
    const source = text.trim();
    if (!source || loading) return;
    haptic("light");
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<Result>("/api/translate", { text: source, from, to, register });
      setResult(data);
      haptic("success");
      refresh();
    } catch (err) {
      setError(handleError(err));
    } finally {
      setLoading(false);
    }
  }

  function swap() {
    if (from === "auto" && !result?.detected) return;
    haptic("selection");
    const newFrom = to;
    setTo((from === "auto" ? result!.detected : from) as Lang);
    setFrom(newFrom);
    if (result?.translation) {
      setText(result.translation);
      setResult(null);
    }
  }

  async function listen() {
    if (!result) return;
    haptic("light");
    const lang = LANGS.find((item) => item.id === to)!.speech;
    speakWithBrowser(result.translation, lang);
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.translation);
      haptic("success");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // буфер обмена недоступен в этом окружении — не критично
    }
  }

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={rise} className="glass p-4">
        <LangPicker value={from} onChange={setFrom} includeAuto />
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Введите текст"
          rows={4}
          maxLength={3000}
          className="mt-2 w-full resize-none bg-transparent px-2 py-2 text-title3 text-paper outline-none placeholder:text-dim"
        />
      </motion.div>

      <motion.div variants={rise} className="flex items-center justify-between">
        <div className="relative grid grid-cols-2 rounded-full bg-fill p-1">
          {(["casual", "business"] as const).map((value) => (
            <button
              key={value}
              onClick={() => {
                setRegister(value);
                haptic("selection");
              }}
              className="relative min-h-11 px-4"
            >
              {register === value && <motion.span layoutId="register" transition={spring} className="absolute inset-0 rounded-full segment-thumb" />}
              <span className={`relative text-subhead font-medium ${register === value ? "text-paper" : "text-dim"}`}>
                {value === "casual" ? "Бытовой" : "Деловой"}
              </span>
            </button>
          ))}
        </div>
        <motion.button
          {...press}
          onClick={swap}
          aria-label="Поменять языки местами"
          className="grid h-11 w-11 place-items-center rounded-full bg-fill text-mist"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <path d="M5 3v12M5 15l-3-3M5 15l3-3M13 15V3M13 3l-3 3M13 3l3 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.button>
      </motion.div>

      <motion.div variants={rise} className="glass p-4">
        <LangPicker value={to} onChange={setTo} />
        <div className="min-h-[7rem] px-2 py-2">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.p
                key="loading"
                className="text-title3 font-semibold text-dim"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.35, 0.9, 0.35] }}
                exit={{ opacity: 0, transition: exit }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                Переводим…
              </motion.p>
            ) : result ? (
              <motion.div key={result.translation} variants={rise} initial="hidden" animate="show" exit="leave">
                <p className="whitespace-pre-wrap text-title3 font-semibold text-paper">{result.translation}</p>
                {result.alternatives.length > 0 && (
                  <div className="mt-4 space-y-1">
                    <p className="label">Ещё варианты</p>
                    {result.alternatives.map((alternative) => (
                      <p key={alternative} className="text-body text-mist">
                        {alternative}
                      </p>
                    ))}
                  </div>
                )}
                {result.note && (
                  <p className="mt-4 rounded-2xl bg-champagne/[0.07] px-4 py-2 text-body text-paper/90">{result.note}</p>
                )}
                <div className="mt-4 flex gap-2">
                  <motion.button {...press} onClick={listen} className="min-h-11 rounded-full bg-fill px-4 text-subhead font-semibold text-champagne">
                    Прослушать
                  </motion.button>
                  <motion.button {...press} onClick={copy} className="min-h-11 rounded-full bg-fill px-4 text-subhead font-semibold text-champagne">
                    {copied ? "Скопировано" : "Копировать"}
                  </motion.button>
                </div>
              </motion.div>
            ) : (
              <motion.p key="empty" className="text-title3 font-semibold text-dim" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: enter }}>
                Перевод появится здесь
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {error && <p className="text-center text-body text-danger">{error}</p>}

      <motion.button
        variants={rise}
        {...press}
        disabled={!text.trim() || loading}
        onClick={translate}
        className="w-full rounded-[0.875rem] bg-paper px-6 py-4 text-headline font-semibold text-ink disabled:opacity-40"
      >
        Перевести
      </motion.button>
    </motion.div>
  );
}
