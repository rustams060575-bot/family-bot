"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import { apiJson } from "@/lib/client/api";
import { ROLES, TRACKS } from "@/lib/client/tracks";
import type { Account, Role, TrackId } from "@/lib/client/types";
import { enter, exit, press, rise, spring, stagger } from "@/lib/motion";

const REMINDER_HOURS = [8, 13, 19, 21];
const STEPS = 3;

function Option({
  selected,
  title,
  caption,
  mark,
  onSelect,
}: {
  selected: boolean;
  title: string;
  caption: string;
  mark?: string;
  onSelect: () => void;
}) {
  return (
    <motion.button
      variants={rise}
      {...press}
      onClick={onSelect}
      className={`glass flex w-full items-center gap-4 p-4 text-left ${selected ? "glass-accent" : ""}`}
    >
      {mark && (
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-fill text-headline font-semibold text-champagne">
          {mark}
        </span>
      )}
      <span className="flex-1">
        <span className="block text-body font-medium text-paper">{title}</span>
        <span className="mt-1 block text-body text-mist">{caption}</span>
      </span>
      <span className="relative grid h-6 w-6 place-items-center rounded-full ring-1 ring-tint/20">
        {selected && <motion.span layoutId="option-dot" transition={spring} className="h-2 w-2 rounded-full bg-champagne" />}
      </span>
    </motion.button>
  );
}

export default function Onboarding() {
  const { account, setAccount, haptic, handleError } = useApp();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<Role | null>(null);
  const [track, setTrack] = useState<TrackId | null>(null);
  const [hour, setHour] = useState<number | null>(19);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // VIP и админам заявка не нужна — для них финальная кнопка просто «Начать».
  const needsApplication = account?.access !== "approved";
  const [error, setError] = useState<string | null>(null);

  const canContinue = (step === 0 && role) || (step === 1 && track) || step === 2;

  async function next() {
    haptic("light");
    if (step < STEPS - 1) {
      setStep(step + 1);
      return;
    }
    setSaving(true);
    try {
      const { account: updated } = await apiJson<{ account: Account }>("/api/profile", {
        role,
        track,
        remindersEnabled: hour !== null,
        ...(hour !== null ? { reminderHour: hour } : {}),
        tzOffsetMin: new Date().getTimezoneOffset(),
        ...(needsApplication ? { applicationNote: note } : {}),
      });
      haptic("success");
      setAccount(updated);
    } catch (err) {
      setError(handleError(err));
      setSaving(false);
    }
  }

  const titles = [
    <>
      Кто <span className="text-champagne">вы</span>?
    </>,
    <>
      С чего <span className="text-champagne">начнём</span>?
    </>,
    <>
      Когда <span className="text-champagne">напомнить</span>?
    </>,
  ];

  return (
    <div className="flex flex-1 flex-col">
      <motion.div variants={stagger()} initial="hidden" animate="show" className="pb-8 pt-16">
        <motion.p variants={rise} className="label">
          ATA Academy
        </motion.p>
        <motion.h1 variants={rise} className="mt-4 text-large-title font-bold">
          {account?.firstName ? `${account.firstName},` : "Добро"}
          <br />
          <span>{account?.firstName ? "добро пожаловать" : "пожаловать"}</span>
        </motion.h1>
      </motion.div>

      <div className="mb-6 flex gap-2">
        {Array.from({ length: STEPS }, (_, index) => (
          <div key={index} className="h-px flex-1 overflow-hidden bg-tint/10">
            <motion.div
              className="h-full bg-champagne"
              initial={false}
              animate={{ width: index <= step ? "100%" : "0%" }}
              transition={{ ...enter, duration: 0.8 }}
            />
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.section
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0, transition: enter }}
          exit={{ opacity: 0, x: -16, transition: exit }}
          className="flex-1"
        >
          <p className="label">
            Шаг {step + 1} из {STEPS}
          </p>
          <h2 className="mb-6 mt-2 text-title2 font-bold">{titles[step]}</h2>

          <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="space-y-2">
            {step === 0 &&
              ROLES.map((item) => (
                <Option
                  key={item.id}
                  selected={role === item.id}
                  title={item.title}
                  caption={item.caption}
                  onSelect={() => {
                    setRole(item.id);
                    haptic("selection");
                  }}
                />
              ))}
            {step === 1 &&
              TRACKS.map((item) => (
                <Option
                  key={item.id}
                  selected={track === item.id}
                  title={item.name}
                  caption={item.tagline}
                  mark={item.monogram}
                  onSelect={() => {
                    setTrack(item.id);
                    haptic("selection");
                  }}
                />
              ))}
            {step === 2 && (
              <>
                {REMINDER_HOURS.map((value) => (
                  <Option
                    key={value}
                    selected={hour === value}
                    title={`${String(value).padStart(2, "0")}:00`}
                    caption="Бот напишет, если вы ещё не занимались в этот день"
                    onSelect={() => {
                      setHour(value);
                      haptic("selection");
                    }}
                  />
                ))}
                <Option
                  selected={hour === null}
                  title="Без напоминаний"
                  caption="Можно включить позже в профиле"
                  onSelect={() => {
                    setHour(null);
                    haptic("selection");
                  }}
                />
                {needsApplication && (
                  <motion.div variants={rise} className="pt-4">
                    <p className="label mb-2">Пара слов для школы — необязательно</p>
                    <textarea
                      className="field resize-none"
                      rows={3}
                      maxLength={300}
                      placeholder="Кто вы и чему хотите научиться"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                    <p className="mt-2 text-body text-mist">
                      ATA Academy — закрытая школа: заявку рассмотрит администратор, ответ придёт в Telegram.
                    </p>
                  </motion.div>
                )}
              </>
            )}
          </motion.div>
        </motion.section>
      </AnimatePresence>

      {error && <p className="mt-4 text-center text-body text-danger">{error}</p>}

      <div className="sticky bottom-0 -mx-4 mt-8 flex gap-2 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pb-6 pt-8">
        {step > 0 && (
          <motion.button
            {...press}
            onClick={() => setStep(step - 1)}
            className="rounded-[0.875rem] bg-fill px-6 py-4 text-body font-semibold text-champagne"
          >
            Назад
          </motion.button>
        )}
        <motion.button
          {...press}
          disabled={!canContinue || saving}
          onClick={next}
          className="flex-1 rounded-[0.875rem] bg-paper px-6 py-4 text-headline font-semibold text-ink disabled:opacity-40"
        >
          {step < STEPS - 1 ? "Продолжить" : saving ? "Отправляем…" : needsApplication ? "Отправить заявку" : "Начать"}
        </motion.button>
      </div>
    </div>
  );
}
