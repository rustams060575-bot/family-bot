"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import ThemeToggle from "@/components/ThemeToggle";
import { apiJson } from "@/lib/client/api";
import type { Account } from "@/lib/client/types";
import { press, rise, stagger } from "@/lib/motion";

// Закрытая школа: экран ожидания решения по заявке (или отказа с возможностью
// подать заявку снова через сутки).
export default function PendingAccess() {
  const { account, refresh, setAccount, haptic, handleError } = useApp();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!account) return null;

  const rejected = account.access === "rejected";
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

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show" className="flex flex-1 flex-col pt-8">
      <motion.div variants={rise} className="flex items-center justify-between">
        <span className="label">ATA Academy · закрытая школа</span>
        <ThemeToggle />
      </motion.div>

      <motion.h1 variants={rise} className="mt-8 font-serif text-display font-light">
        {rejected ? (
          <>
            Заявка <em className="italic text-champagne">не одобрена</em>
          </>
        ) : (
          <>
            {account.firstName ? `${account.firstName}, ` : ""}
            <em className="italic text-champagne">заявка отправлена</em>
          </>
        )}
      </motion.h1>

      <motion.p variants={rise} className="mt-6 max-w-[22rem] text-lead text-mist">
        {rejected
          ? canReapply
            ? "Можно отправить заявку ещё раз."
            : `Повторно отправить заявку можно ${new Date(account.reapplyAt!).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.`
          : "Администратор школы рассмотрит её в ближайшее время. Ответ придёт сообщением от бота — и приложение откроется."}
      </motion.p>

      {!rejected && (
        <motion.div variants={rise} className="glass mt-8 flex items-center gap-4 p-6">
          <motion.span
            className="h-2 w-2 shrink-0 rounded-full bg-champagne"
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          />
          <p className="text-body text-paper">На рассмотрении</p>
        </motion.div>
      )}

      {error && <p className="mt-4 text-body text-danger">{error}</p>}

      <motion.div variants={rise} className="mt-8">
        {canReapply ? (
          <motion.button
            {...press}
            onClick={reapply}
            className="min-h-14 w-full rounded-2xl bg-paper px-6 font-sans text-body font-medium text-ink"
          >
            Отправить заявку снова
          </motion.button>
        ) : (
          <motion.button
            {...press}
            onClick={check}
            disabled={checking}
            className="min-h-14 w-full rounded-2xl bg-tint/[0.06] px-6 font-sans text-body text-paper disabled:opacity-50"
          >
            {checking ? "Проверяем…" : "Проверить статус"}
          </motion.button>
        )}
      </motion.div>
    </motion.div>
  );
}
