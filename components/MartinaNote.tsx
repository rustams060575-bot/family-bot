"use client";

import SpeakButton from "@/components/SpeakButton";

// Реплика Мартины вне чата: монограмма + пузырь с кнопкой-динамиком.
export default function MartinaNote({ text, foreignLang }: { text: string; foreignLang?: string }) {
  return (
    <div className="flex items-end gap-2">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-champagne text-headline font-semibold text-ink"
        aria-hidden
      >
        М
      </span>
      <div className="rounded-[1.25rem] rounded-bl-md bg-ink-raised px-4 pb-1 pt-3 shadow-[var(--card-shadow)]">
        <p className="whitespace-pre-wrap text-body text-paper">{text}</p>
        <SpeakButton text={text} foreignLang={foreignLang} className="-ml-1 px-1" />
      </div>
    </div>
  );
}
