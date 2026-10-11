"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import ThemeToggle from "@/components/ThemeToggle";
import { apiJson } from "@/lib/client/api";
import type { Account } from "@/lib/client/types";
import { press, rise, spring, stagger } from "@/lib/motion";

// Ожидание статуса раз в 15 с: как только супер-админ нажмёт «Одобрить», приложение
// откроется само и покажет поздравление.
const POLL_MS = 15000;

// Закрытая школа: премиальный экран заявки в духе Apple (или отказа с возможностью
// подать заявку снова через сутки).
export default function PendingAccess() {
  const { account, refresh, setAccount, haptic, handleError } = useApp();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rejected = account?.access === "rejected";

  useEffect(() => {
    if (rejected) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [rejected, refresh]);

  if (!account) return null;
  const canReapply = rejected && (!account.reapplyAt || Date.parse(account.reapplyAt) <= Date.now());

  async function check() {
    haptic("light");
    setChecking(true);
    const fresh = await refresh();
    if (fresh?.access === "approved") haptic("success");
    setChecking(false);
  }

  async function reapply() {
    haptic("medium");
    try {
      const { account: updated } = await apiJson<{ account: Account }>("/api/profile", { apply: true });
      setAccount(updated);
    } catch (err) {
      setError(handleError(err));
    }
  }

  const rows = [
    { label: "Статус", value: rejected ? "Не одобрена" : "На рассмотрении", live: !rejected },
    { label: "Имя", value: account.firstName || "—" },
    { label: "Подтверждает", value: "R Design Space" },
  ];

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show" className="flex flex-1 flex-col pt-4">
      <motion.div variants={rise} className="flex min-h-11 items-center justify-between">
        <span className="text-subhead font-semibold text-champagne">ATA Academy</span>
        <ThemeToggle />
      </motion.div>

      {/* Значок: конверт с печатью — мягкое появление пружиной и тихое «дыхание» свечения */}
      <motion.div variants={rise} className="relative mx-auto mt-10 grid h-28 w-28 place-items-center">
        {!rejected && (
          <motion.span
            className="absolute inset-0 rounded-full bg-champagne/25 blur-2xl"
            animate={{ opacity: [0.5, 1, 0.5], scale: [0.95, 1.05, 0.95] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1, transition: { ...spring, delay: 0.1 } }}
          className="relative grid h-24 w-24 place-items-center rounded-[1.75rem] bg-ink-raised shadow-[0_20px_40px_-20px_rgb(0_0_0/0.45)]"
        >
          <svg width="46" height="46" viewBox="0 0 48 48" fill="none" aria-hidden>
            <rect x="6" y="11" width="36" height="26" rx="5" stroke="rgb(var(--paper))" strokeWidth="2.4" />
            <path d="m8 14 16 12 16-12" stroke="rgb(var(--paper))" strokeWidth="2.4" strokeLinejoin="round" />
            <circle cx="36" cy="34" r="8" fill="rgb(var(--champagne))" />
            {rejected ? (
              <path d="m33 31 6 6m0-6-6 6" stroke="rgb(var(--ink))" strokeWidth="2.2" strokeLinecap="round" />
            ) : (
              <path
                d="m32.5 34 2.5 2.5 4.5-5"
                stroke="rgb(var(--ink))"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </motion.span>
      </motion.div>

      <motion.h1 variants={rise} className="mt-8 text-center text-title1 font-bold">
        {rejected ? "Заявка не одобрена" : "Заявка отправлена"}
      </motion.h1>
      <motion.p variants={rise} className="mx-auto mt-3 max-w-[20rem] text-center text-body text-mist">
        {rejected
          ? canReapply
            ? "Можно отправить заявку ещё раз."
            : `Повторно отправить заявку можно ${new Date(account.reapplyAt!).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.`
          : "Заявка на поступление в ATA Academy отправлена. Ожидайте подтверждения R Design Space."}
      </motion.p>

      {/* Сводка заявки — Grouped List */}
      <motion.div variants={rise} className="glass mt-8 overflow-hidden">
        {rows.map((row, index) => (
          <div key={row.label}>
            {index > 0 && <div className="hairline ml-4" />}
            <div className="flex min-h-11 items-center justify-between px-4 py-3">
              <span className="text-body">{row.label}</span>
              <span className="flex items-center gap-2 text-body text-mist">
                {row.live && (
                  <motion.span
                    className="h-2 w-2 rounded-full bg-champagne"
                    animate={{ opacity: [0.35, 1, 0.35] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
                {row.value}
              </span>
            </div>
          </div>
        ))}
      </motion.div>

      {!rejected && (
        <motion.p variants={rise} className="mt-3 px-4 text-footnote text-dim">
          Как только доступ одобрят, приложение откроется само, а бот пришлёт сообщение.
        </motion.p>
      )}

      {error && <p className="mt-4 text-center text-body text-danger">{error}</p>}

      <motion.div variants={rise} className="mt-8">
        {canReapply ? (
          <motion.button
            {...press}
            onClick={reapply}
            className="min-h-[3.25rem] w-full rounded-[0.875rem] bg-paper px-6 text-headline font-semibold text-ink"
          >
            Отправить заявку снова
          </motion.button>
        ) : (
          <motion.button
            {...press}
            onClick={check}
            disabled={checking}
            className="min-h-[3.25rem] w-full rounded-[0.875rem] bg-fill px-6 text-headline font-semibold text-champagne disabled:opacity-50"
          >
            {checking ? "Проверяем…" : "Проверить статус"}
          </motion.button>
        )}
      </motion.div>
    </motion.div>
  );
}
