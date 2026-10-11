"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { primeSpeech, speakWithBrowser, speechLangFor, stopSpeech } from "@/lib/client/audio";

type Props = {
  text: string;
  // Язык для фраз не по-русски (изучаемый язык урока); русские озвучиваются ru-RU.
  foreignLang?: string;
  label?: boolean;
  className?: string;
};

// Кнопка-динамик 🔊 для любой реплики Мартины: озвучка бесплатным голосом устройства
// (window.speechSynthesis). Повторное нажатие останавливает речь.
export default function SpeakButton({ text, foreignLang, label = true, className = "" }: Props) {
  const [speaking, setSpeaking] = useState(false);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  function toggle(event: React.MouseEvent) {
    // Кнопка бывает внутри ссылки-карточки — нажатие не должно открывать экран.
    event.preventDefault();
    event.stopPropagation();
    if (speaking) {
      stopSpeech();
      setSpeaking(false);
      return;
    }
    primeSpeech();
    setSpeaking(true);
    speakWithBrowser(text, speechLangFor(text, foreignLang), () => {
      if (mounted.current) setSpeaking(false);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={speaking ? "Остановить озвучку" : "Прослушать"}
      className={`flex min-h-11 items-center gap-1.5 text-subhead font-medium text-champagne ${className}`}
    >
      <SpeakerIcon active={speaking} />
      {label && (speaking ? "Звучит" : "Прослушать")}
    </button>
  );
}

export function SpeakerIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
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
