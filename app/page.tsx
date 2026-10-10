"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import AppGate from "@/components/AppGate";
import { useApp } from "@/components/AppProvider";
import SubscriptionCard from "@/components/SubscriptionCard";
import ThemeToggle from "@/components/ThemeToggle";
import { CRM_COPY } from "@/components/CrmPanel";
import { ROLES, TRACKS, trackById } from "@/lib/client/tracks";
import { press, rise, stagger } from "@/lib/motion";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

const ROLE_HINT = {
  student: "Одно занятие в день держит стрик.",
  tutor: "Репетитор подготовит упражнения и план урока для ваших учеников.",
  parent: "Короткие занятия по 10–15 минут — лучший формат для детей.",
} as const;

function Dashboard() {
  const { account, haptic } = useApp();
  if (!account) return null;
  const primary = trackById(account.track) ?? TRACKS[0];
  const others = TRACKS.filter((track) => track.id !== primary.id);
  const role = ROLES.find((item) => item.id === account.role);

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show">
      <motion.header variants={rise} className="flex items-start justify-between pb-8 pt-8">
        <div>
          <p className="label">
            {role?.title ?? "ATA Academy"}
            {account.vip && <span className="text-champagne"> · VIP</span>}
          </p>
          <h1 className="mt-4 font-serif text-h1 font-light">
            {greeting()},
            <br />
            <em className="italic">{account.firstName || "друг"}</em>
          </h1>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ThemeToggle />
          <Link href="/premium" onClick={() => haptic("selection")} aria-label="Профиль, тариф и стрик">
            <motion.div {...press} className="glass flex min-w-[5.75rem] flex-col items-center px-4 py-2">
              <span className="font-serif text-h3 font-light lining-nums tabular-nums">{account.streak.count}</span>
              <span className="label text-[0.64rem]">{account.streak.activeToday ? "стрик" : "сегодня?"}</span>
            </motion.div>
          </Link>
        </div>
      </motion.header>

      <motion.p variants={rise} className="mb-6 text-body text-mist">
        {account.role ? ROLE_HINT[account.role] : null}
      </motion.p>

      <motion.div variants={rise}>
        <Link href={primary.href} onClick={() => haptic("light")}>
          <motion.div {...press} className="glass glass-accent relative overflow-hidden p-6">
            <div className="pointer-events-none absolute -bottom-24 -right-16 h-56 w-56 rounded-full bg-champagne/10 blur-3xl" />
            <p className="label">Продолжить</p>
            <div className="mt-8 flex items-end justify-between">
              <div>
                <h2 className="font-serif text-h2 font-light">{primary.name}</h2>
                <p className="mt-2 max-w-[15rem] text-body text-mist">{primary.tagline}</p>
              </div>
              <span className="font-serif text-display font-light italic leading-none text-champagne/90">{primary.monogram}</span>
            </div>
          </motion.div>
        </Link>
      </motion.div>

      <motion.div variants={rise} className="mt-4 grid grid-cols-3 gap-2">
        {others.map((track) => (
          <Link key={track.id} href={track.href} onClick={() => haptic("light")}>
            <motion.div {...press} className="glass flex aspect-[4/5] flex-col justify-between p-4">
              <span className="font-serif text-h3 font-light italic text-mist">{track.monogram}</span>
              <span className="font-sans text-label font-medium uppercase tracking-[0.12em] text-paper/90">
                {track.name.replace("ATA ", "")}
              </span>
            </motion.div>
          </Link>
        ))}
      </motion.div>

      <motion.div variants={rise} className="mt-4">
        <Link href="/crm" onClick={() => haptic("light")}>
          <motion.div {...press} className="glass flex min-h-[4.5rem] items-center justify-between p-6">
            <div>
              <p className="label">ATA CRM</p>
              <p className="mt-2 font-serif text-h3 font-light">
                {CRM_COPY[account.role ?? "tutor"].title}{" "}
                <em className="italic text-champagne">{CRM_COPY[account.role ?? "tutor"].accent}</em>
              </p>
            </div>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-mist" aria-hidden>
              <path d="M7.5 4.5L13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.div>
        </Link>
      </motion.div>

      {account.admin && (
        <motion.div variants={rise} className="mt-2">
          <Link href="/admin" onClick={() => haptic("light")}>
            <motion.div {...press} className="glass glass-accent flex min-h-[4.5rem] items-center justify-between p-6">
              <div>
                <p className="label">{account.superAdmin ? "Супер-админ" : "Администратор"} · заявки</p>
                <p className="mt-2 font-serif text-h3 font-light">
                  Вся <em className="italic text-champagne">академия</em>
                </p>
              </div>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-mist" aria-hidden>
                <path d="M7.5 4.5L13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.div>
          </Link>
        </motion.div>
      )}

      {account.plan === "free" && (
        <motion.div variants={rise} className="mt-8">
          <SubscriptionCard variant="compact" />
        </motion.div>
      )}
    </motion.div>
  );
}

export default function HomePage() {
  return (
    <AppGate>
      <Dashboard />
    </AppGate>
  );
}
