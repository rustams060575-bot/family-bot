"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import { apiJson } from "@/lib/client/api";
import { enter, press, rise, spring, stagger } from "@/lib/motion";

type Props = {
  variant?: "full" | "compact";
  onClose?: () => void;
};

// limit: null — без лимита: показываем счётчик и знак бесконечности, полоса не нужна.
function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  if (limit === null) {
    return (
      <div className="flex items-baseline justify-between gap-4">
        <span className="label">{label}</span>
        <span className="whitespace-nowrap font-sans text-label lining-nums tabular-nums text-mist">
          {used} · <span className="font-serif text-lead italic normal-case text-champagne">без лимита</span>
        </span>
      </div>
    );
  }
  const ratio = Math.min(1, limit ? used / limit : 0);
  const exhausted = used >= limit;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className={`font-sans text-label lining-nums tabular-nums ${exhausted ? "text-champagne" : "text-mist"}`}>
          {used} / {limit}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-tint/[0.06]">
        <motion.div
          className={`h-full rounded-full ${exhausted ? "bg-champagne" : "bg-paper/70"}`}
          initial={{ width: 0 }}
          animate={{ width: `${ratio * 100}%` }}
          transition={{ ...enter, duration: 0.9 }}
        />
      </div>
    </div>
  );
}

export default function SubscriptionCard({ variant = "full", onClose }: Props) {
  const { account, offer, webApp, refresh, haptic, handleError } = useApp();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!account || !offer) return null;
  const premium = account.plan === "premium";
  const until = account.premiumUntil
    ? new Date(account.premiumUntil).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
    : null;

  const premiumAi = offer.limits.premium.ai;
  const benefits = [
    premiumAi === null
      ? `Занятия с ИИ без лимита — вместо ${offer.limits.free.ai} в день`
      : `${premiumAi} занятий с ИИ в день вместо ${offer.limits.free.ai}`,
    `${offer.limits.premium.art} разборов рисунков в день вместо ${offer.limits.free.art}`,
    "Живой голос репетитора OpenAI вместо системного голоса телефона",
    "Заморозка стрика: один пропущенный день в неделю не обнуляет серию",
  ];

  async function upgrade() {
    if (!offer?.priceStars) return;
    haptic("medium");
    setError(null);
    setPaying(true);
    try {
      const { link } = await apiJson<{ link: string }>("/api/invoice", {});
      if (!webApp?.openInvoice) {
        window.open(link, "_blank");
        setPaying(false);
        return;
      }
      webApp.openInvoice(link, async (status) => {
        if (status !== "paid") {
          setPaying(false);
          return;
        }
        haptic("success");
        // Premium выдаёт бот по successful_payment — ждём, пока он обработает платёж.
        for (let attempt = 0; attempt < 6; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const fresh = await refresh();
          if (fresh?.plan === "premium") break;
        }
        setPaying(false);
        onClose?.();
      });
    } catch (err) {
      setError(handleError(err));
      setPaying(false);
    }
  }

  return (
    <motion.section
      variants={stagger()}
      initial="hidden"
      animate="show"
      className={`glass overflow-hidden p-6 ${premium ? "" : "glass-accent"}`}
    >
      {/* Сдержанное свечение акцента в углу карточки */}
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-champagne/10 blur-3xl" />

      <motion.div variants={rise} className="flex items-center justify-between">
        <span className="label">Тариф</span>
        <span
          className={`rounded-full px-4 py-1 font-sans text-label font-medium uppercase ${
            premium ? "bg-champagne/15 text-champagne" : "bg-tint/[0.06] text-mist"
          }`}
        >
          {account.vip ? "Premium · VIP" : premium ? "Premium" : "Free"}
        </span>
      </motion.div>

      <motion.h3 variants={rise} className="mt-4 font-serif text-h2 font-light">
        {premium ? (
          <>
            Premium <em className="italic text-champagne">активен</em>
          </>
        ) : (
          <>
            ATA <em className="italic text-champagne">Premium</em>
          </>
        )}
      </motion.h3>
      {account.vip ? (
        <motion.p variants={rise} className="mt-2 text-body text-mist">
          Персональный доступ ATA Academy — без оплаты и без срока.
        </motion.p>
      ) : (
        premium && until && <motion.p variants={rise} className="mt-2 text-body text-mist">до {until}</motion.p>
      )}

      <motion.div variants={rise} className="mt-6 space-y-4">
        <Meter label="Занятия сегодня" used={account.usage.ai} limit={account.limits.ai} />
        {variant === "full" && <Meter label="Разборы рисунков" used={account.usage.art} limit={account.limits.art} />}
      </motion.div>

      {!premium && (
        <>
          <motion.ul variants={rise} className="mt-6 space-y-2">
            {(variant === "full" ? benefits : benefits.slice(0, 1)).map((benefit) => (
              <li key={benefit} className="flex gap-4 text-body text-paper/90">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-champagne" />
                {benefit}
              </li>
            ))}
          </motion.ul>

          <motion.button
            variants={rise}
            {...press}
            disabled={!offer.priceStars || paying}
            onClick={upgrade}
            className="mt-6 flex w-full items-center justify-between rounded-2xl bg-paper px-6 py-4 text-ink disabled:opacity-50"
          >
            <span className="font-sans text-body font-medium">
              {paying ? "Открываем оплату…" : offer.priceStars ? "Оформить Premium" : "Оплата скоро"}
            </span>
            {offer.priceStars && (
              <span className="font-sans text-body lining-nums tabular-nums text-ink/70">
                {offer.priceStars} ⭐ · {offer.days} дн.
              </span>
            )}
          </motion.button>
          {error && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={spring} className="mt-4 text-body text-danger">
              {error}
            </motion.p>
          )}
        </>
      )}
    </motion.section>
  );
}
