import { PLAN_LIMITS } from "@/lib/store.mjs";

// Предложение Premium. Цена в Telegram Stars задаётся владельцем продукта через
// PREMIUM_PRICE_STARS — без неё кнопка оплаты на клиенте неактивна, а не показывает
// выдуманную цену.
export function premiumOffer() {
  const price = Number(process.env.PREMIUM_PRICE_STARS);
  const days = Number(process.env.PREMIUM_DAYS) || 30;
  return {
    priceStars: Number.isInteger(price) && price > 0 ? price : null,
    days,
    limits: {
      free: { ai: PLAN_LIMITS.free.ai, art: PLAN_LIMITS.free.art },
      premium: { ai: PLAN_LIMITS.premium.ai, art: PLAN_LIMITS.premium.art },
    },
  };
}
