"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import AppGate from "@/components/AppGate";
import { useApp } from "@/components/AppProvider";
import SubscriptionCard from "@/components/SubscriptionCard";
import ThemeToggle from "@/components/ThemeToggle";
import SpeakButton from "@/components/SpeakButton";
import DailyTrack from "@/components/DailyTrack";
import { CRM_COPY } from "@/components/CrmPanel";
import { ROLES, TRACKS, kidsTrackName, trackById, type Track } from "@/lib/client/tracks";
import { press, rise, stagger } from "@/lib/motion";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

// Проактивная подсказка Мартины: она сама предлагает, чем заняться сегодня.
function martinaSuggestion(primary: Track, kid: boolean, name: string) {
  if (kid) return `${name || "Привет"}, поиграем сегодня в английский или нарисуем что-нибудь? Я уже жду!`;
  if (primary.id === "art")
    return "Покажите мне новый рисунок — я отмечу, что получилось, и придумаю следующее задание.";
  if (primary.id === "translate") return "Нужно что-то перевести? Пишите или говорите — переведу с учётом тона.";
  return `Продолжим ${primary.name}? У меня готово короткое занятие на 10 минут.`;
}

function Chevron() {
  return (
    <svg
      width="8"
      height="14"
      viewBox="0 0 8 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="shrink-0 text-dim/60"
      aria-hidden
    >
      <path d="m1 1 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Ячейка Grouped List: иконка-плитка 30 px, заголовок, подпись, шеврон.
function Row({
  href,
  icon,
  title,
  caption,
  first,
}: {
  href: string;
  icon: string;
  title: string;
  caption?: string;
  first: boolean;
}) {
  const { haptic } = useApp();
  return (
    <Link href={href} onClick={() => haptic("light")} className="block active:bg-tint/[0.06]">
      {!first && <div className="hairline ml-[3.75rem]" />}
      <div className="flex min-h-[3.75rem] items-center gap-3 px-4 py-2">
        <span className="grid h-[1.875rem] w-[1.875rem] shrink-0 place-items-center rounded-[0.4375rem] bg-champagne text-footnote font-bold text-ink">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body">{title}</p>
          {caption && <p className="truncate text-subhead text-mist">{caption}</p>}
        </div>
        <Chevron />
      </div>
    </Link>
  );
}

function Dashboard() {
  const { account, haptic } = useApp();
  if (!account) return null;
  const kid = account.kid;
  const primary = trackById(account.track) ?? TRACKS[0];
  const role = ROLES.find((item) => item.id === account.role);
  const tracks = kid ? TRACKS.filter((track) => track.id !== "translate") : TRACKS;
  const tools = [
    // Дашборд родителя: успехи, работы с отзывами Мартины, языковые темы.
    { href: "/progress", icon: "↗", title: "Прогресс ученика" },
    ...(!kid
      ? [
          {
            href: "/crm",
            icon: "✓",
            title: `ATA CRM · ${CRM_COPY[account.role ?? "tutor"].title} ${CRM_COPY[account.role ?? "tutor"].accent}`,
          },
        ]
      : []),
    ...(account.admin
      ? [{ href: "/admin", icon: "A", title: `${account.superAdmin ? "Супер-админ" : "Администратор"} · заявки` }]
      : []),
  ];

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show" className={kid ? "font-rounded" : ""}>
      <motion.header variants={rise} className="flex items-center justify-between pt-4">
        <span className="text-subhead font-semibold text-champagne">
          {kid ? "ATA Kids" : (role?.title ?? "ATA Academy")}
          {account.vip && " · VIP"}
        </span>
        <div className="flex items-center gap-2">
          <Link href="/premium" onClick={() => haptic("selection")} aria-label="Профиль, тариф и стрик">
            <motion.span
              {...press}
              className="flex h-10 items-center gap-1.5 rounded-full bg-fill px-3 text-subhead font-semibold tabular-nums"
            >
              <svg
                width="14"
                height="16"
                viewBox="0 0 14 16"
                fill="currentColor"
                className={account.streak.activeToday ? "text-champagne" : "text-dim"}
                aria-hidden
              >
                <path d="M7 0c.5 2.6 2.4 4 3.8 5.8A6.2 6.2 0 0 1 7 16a6 6 0 0 1-6-6c0-2.3 1.3-3.6 2.4-4.8.3 1.5 1 2.4 2 2.8C5 5.4 5.6 2.4 7 0z" />
              </svg>
              {account.streak.count}
            </motion.span>
          </Link>
          <ThemeToggle />
        </div>
      </motion.header>

      <motion.h1 variants={rise} className="mt-2 text-large-title font-bold">
        {greeting()},<br />
        {account.firstName || "друг"}
      </motion.h1>

      {/* Мартина держит инициативу: первая карточка — её предложение на сегодня */}
      <motion.div variants={rise} className="mt-6">
        <Link href={primary.href} onClick={() => haptic("light")}>
          <motion.div {...press} className="glass flex gap-3 p-4">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-champagne text-headline font-semibold text-ink"
              aria-hidden
            >
              М
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-headline font-semibold">Мартина</p>
              <p className="mt-0.5 text-body text-mist">{martinaSuggestion(primary, kid, account.firstName)}</p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-body font-semibold text-champagne">{kid ? "Поехали!" : "Начать"}</p>
                <SpeakButton
                  text={martinaSuggestion(primary, kid, account.firstName)}
                  label={false}
                  className="justify-center px-2"
                />
              </div>
            </div>
          </motion.div>
        </Link>
      </motion.div>

      {/* Дневной трек: главный урок по арту + микро-практика по языку */}
      <DailyTrack />

      <motion.section variants={rise} className="mt-8">
        <h2 className="label px-4 pb-2">Обучение</h2>
        <div className="glass overflow-hidden">
          {tracks.map((track, index) => (
            <Row
              key={track.id}
              href={track.href}
              icon={track.monogram}
              title={kid ? kidsTrackName(track) : track.name}
              caption={kid ? (track.id === "art" ? "Покажи рисунок Мартине" : "Играем с Мартиной") : track.tagline}
              first={index === 0}
            />
          ))}
        </div>
      </motion.section>

      {!!tools.length && (
        <motion.section variants={rise} className="mt-8">
          <h2 className="label px-4 pb-2">Инструменты</h2>
          <div className="glass overflow-hidden">
            {tools.map((tool, index) => (
              <Row key={tool.href} {...tool} first={index === 0} />
            ))}
          </div>
        </motion.section>
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
