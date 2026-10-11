"use client";

import SpeakButton from "@/components/SpeakButton";

// Реплика наставника вне чата: монограмма + пузырь с кнопкой-динамиком.
// По умолчанию — Мартина («М»); шахматный наставник Лео передаёт monogram="Л".
export default function MartinaNote({
  text,
  foreignLang,
  monogram = "М",
}: {
  text: string;
  foreignLang?: string;
  monogram?: string;
}) {
  return (
    <div className="flex items-end gap-2">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-champagne text-headline font-semibold text-ink"
        aria-hidden
      >
        {monogram}
      </span>
      <div className="rounded-[1.25rem] rounded-bl-md bg-ink-raised px-4 pb-1 pt-3 shadow-[var(--card-shadow)]">
        <p className="whitespace-pre-wrap text-body text-paper">{text}</p>
        <SpeakButton text={text} foreignLang={foreignLang} className="-ml-1 px-1" />
      </div>
    </div>
  );
}
