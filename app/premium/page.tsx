"use client";

import { motion } from "framer-motion";
import AppGate from "@/components/AppGate";
import { useApp } from "@/components/AppProvider";
import ScreenHeader from "@/components/ScreenHeader";
import SubscriptionCard from "@/components/SubscriptionCard";
import { apiJson } from "@/lib/client/api";
import { ROLES, TRACKS } from "@/lib/client/tracks";
import type { Account } from "@/lib/client/types";
import { rise, spring, stagger } from "@/lib/motion";

const HOURS = [7, 8, 9, 12, 13, 17, 18, 19, 20, 21, 22];

function Segmented<T extends string | number>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <div className="-mx-2 flex flex-wrap gap-1">
        {options.map((option) => (
          <button key={String(option.value)} onClick={() => onChange(option.value)} className="relative min-h-11 rounded-full px-4">
            {value === option.value && <motion.span layoutId={id} transition={spring} className="absolute inset-0 rounded-full bg-tint/10" />}
            <span className={`relative font-sans text-label font-medium uppercase tracking-[0.12em] ${value === option.value ? "text-paper" : "text-dim"}`}>
              {option.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Profile() {
  const { account, setAccount, haptic, handleError, themePref, setThemePref, textSize, setTextSize } = useApp();
  if (!account) return null;

  async function save(patch: Record<string, unknown>) {
    haptic("selection");
    try {
      const { account: updated } = await apiJson<{ account: Account }>("/api/profile", {
        ...patch,
        tzOffsetMin: new Date().getTimezoneOffset(),
      });
      setAccount(updated);
    } catch (err) {
      handleError(err);
    }
  }

  return (
    <>
      <ScreenHeader
        eyebrow="Профиль"
        title={
          <>
            Ваш <em className="italic text-champagne">ритм</em>
          </>
        }
      />

      <motion.div variants={stagger()} initial="hidden" animate="show" className="space-y-4">
        <motion.div variants={rise} className="glass flex items-end justify-between p-6">
          <div>
            <p className="label">Стрик</p>
            <p className="mt-2 text-body text-mist">
              {account.streak.activeToday ? "Сегодня занятие засчитано" : "Одно занятие сегодня — и серия растёт"}
            </p>
          </div>
          <span className="font-serif text-display font-light lining-nums tabular-nums leading-none">{account.streak.count}</span>
        </motion.div>

        <motion.div variants={rise}>
          <SubscriptionCard />
        </motion.div>

        <motion.div variants={rise} className="glass space-y-6 p-6">
          <div>
            <p className="label mb-2">Тема</p>
            <Segmented
              id="theme"
              value={themePref}
              options={[
                { value: "system", label: "Как в Telegram" },
                { value: "light", label: "День" },
                { value: "dark", label: "Ночь" },
              ]}
              onChange={(pref) => {
                haptic("selection");
                setThemePref(pref);
              }}
            />
          </div>
          <div className="hairline" />
          <div>
            <p className="label mb-2">Размер текста</p>
            <Segmented
              id="text-size"
              value={textSize}
              options={[
                { value: "normal", label: "Обычный" },
                { value: "large", label: "Крупный" },
              ]}
              onChange={(size) => {
                haptic("selection");
                setTextSize(size);
              }}
            />
          </div>
        </motion.div>

        <motion.div variants={rise} className="glass space-y-6 p-6">
          <div>
            <p className="label mb-2">Роль</p>
            <Segmented
              id="role"
              value={account.role}
              options={ROLES.map((role) => ({ value: role.id, label: role.title }))}
              onChange={(role) => save({ role })}
            />
          </div>
          <div className="hairline" />
          <div>
            <p className="label mb-2">Основной трек</p>
            <Segmented
              id="track"
              value={account.track}
              options={TRACKS.map((track) => ({ value: track.id, label: track.name.replace("ATA ", "") }))}
              onChange={(track) => save({ track })}
            />
          </div>
          <div className="hairline" />
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="label">Напоминания в Telegram</p>
              <button
                role="switch"
                aria-checked={account.reminders.enabled}
                onClick={() => save({ remindersEnabled: !account.reminders.enabled })}
                className={`relative h-8 w-14 rounded-full transition-colors duration-300 ease-out-expo ${
                  account.reminders.enabled ? "bg-champagne/80" : "bg-tint/10"
                }`}
              >
                <motion.span
                  className="absolute top-1 h-6 w-6 rounded-full bg-white shadow-sm"
                  animate={{ left: account.reminders.enabled ? 28 : 4 }}
                  transition={spring}
                />
              </button>
            </div>
            {account.reminders.enabled && (
              <Segmented
                id="hour"
                value={account.reminders.hour}
                options={HOURS.map((hour) => ({ value: hour, label: `${String(hour).padStart(2, "0")}:00` }))}
                onChange={(reminderHour) => save({ reminderHour })}
              />
            )}
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}

export default function PremiumPage() {
  return (
    <AppGate>
      <Profile />
    </AppGate>
  );
}
