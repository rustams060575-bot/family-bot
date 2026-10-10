"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import type { WebApp as WebAppType } from "@twa-dev/types";
import { ApiError, apiJson, setInitData } from "@/lib/client/api";
import type { Account, Features, MeResponse, Offer } from "@/lib/client/types";
import { enter, exit, softSpring } from "@/lib/motion";
import {
  THEME_INK,
  applyTextSize,
  applyTheme,
  readTextSize,
  readThemePref,
  saveTextSize,
  saveThemePref,
  type TextSize,
  type Theme,
  type ThemePref,
} from "@/lib/client/theme";
import SubscriptionCard from "@/components/SubscriptionCard";

type Haptic = "light" | "medium" | "selection" | "success" | "error";

type AppContextValue = {
  status: "loading" | "ready" | "error";
  account: Account | null;
  features: Features;
  offer: Offer | null;
  webApp: WebAppType | null;
  refresh: () => Promise<Account | null>;
  setAccount: (account: Account) => void;
  haptic: (kind?: Haptic) => void;
  openPaywall: (reason?: string) => void;
  // Общая обработка ошибок API: 402 — открыть Premium, иначе вернуть текст для показа.
  handleError: (error: unknown) => string | null;
  theme: Theme;
  themePref: ThemePref;
  setThemePref: (pref: ThemePref) => void;
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp вне AppProvider");
  return value;
}

export default function AppProvider({ children }: { children: React.ReactNode }) {
  const [webApp, setWebApp] = useState<WebAppType | null>(null);
  const [status, setStatus] = useState<AppContextValue["status"]>("loading");
  const [account, setAccount] = useState<Account | null>(null);
  const [features, setFeatures] = useState<Features>({ tts: false, vision: false });
  const [offer, setOffer] = useState<Offer | null>(null);
  const [paywall, setPaywall] = useState<string | null>(null);
  const webAppRef = useRef<WebAppType | null>(null);
  const [themePref, setThemePrefState] = useState<ThemePref>("system");
  const [theme, setTheme] = useState<Theme>("dark");
  const [textSize, setTextSizeState] = useState<TextSize>("normal");
  const themePrefRef = useRef<ThemePref>("system");

  // Красит шапку, фон и нижнюю панель Telegram в цвет текущей темы — без «шва» сверху.
  const paintTelegram = useCallback((next: Theme) => {
    const app = webAppRef.current;
    if (!app) return;
    try {
      if (app.isVersionAtLeast("6.1")) {
        app.setHeaderColor(THEME_INK[next]);
        app.setBackgroundColor(THEME_INK[next]);
      }
      if (app.isVersionAtLeast("7.10")) app.setBottomBarColor(THEME_INK[next]);
    } catch {
      // вне Telegram
    }
  }, []);

  const resolveTheme = useCallback((pref: ThemePref): Theme => {
    if (pref !== "system") return pref;
    const scheme = webAppRef.current?.colorScheme;
    if (scheme === "light" || scheme === "dark") return scheme;
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }, []);

  const updateTheme = useCallback(
    (pref: ThemePref, animate: boolean) => {
      const next = resolveTheme(pref);
      applyTheme(next, animate);
      setTheme(next);
      paintTelegram(next);
    },
    [resolveTheme, paintTelegram],
  );

  const setThemePref = useCallback(
    (pref: ThemePref) => {
      themePrefRef.current = pref;
      setThemePrefState(pref);
      saveThemePref(pref);
      updateTheme(pref, true);
    },
    [updateTheme],
  );

  const setTextSize = useCallback((size: TextSize) => {
    setTextSizeState(size);
    saveTextSize(size);
    applyTextSize(size);
  }, []);

  // Начальное состояние уже выставил скрипт в <head>; здесь синхронизируем React.
  useEffect(() => {
    const pref = readThemePref();
    themePrefRef.current = pref;
    setThemePrefState(pref);
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    setTextSizeState(readTextSize());
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await apiJson<MeResponse>("/api/me");
      setAccount(me.account);
      setFeatures(me.features);
      setOffer(me.offer);
      setStatus("ready");
      return me.account;
    } catch {
      setStatus("error");
      return null;
    }
  }, []);

  // SDK Telegram обращается к window при импорте — грузим его только в браузере.
  useEffect(() => {
    let cancelled = false;
    import("@twa-dev/sdk").then(({ default: WebApp }) => {
      if (cancelled) return;
      webAppRef.current = WebApp;
      setWebApp(WebApp);
      setInitData(WebApp.initData ?? "");
      try {
        WebApp.ready();
        WebApp.expand();
        if (WebApp.isVersionAtLeast("7.7")) WebApp.disableVerticalSwipes();
        // Полноэкранный режим (Bot API 8.0) — только на телефонах: на десктопе он
        // разворачивает окно на весь монитор. Отступы под кнопки Telegram берутся
        // из --tg-content-safe-area-inset-* (см. .pt-safe в globals.css).
        if (WebApp.isVersionAtLeast("8.0") && ["ios", "android"].includes(WebApp.platform) && !WebApp.isFullscreen) {
          WebApp.requestFullscreen();
        }
        WebApp.onEvent("themeChanged", () => {
          if (themePrefRef.current === "system") updateTheme("system", true);
        });
      } catch {
        // вне Telegram (локальная разработка в браузере) методы SDK недоступны
      }
      updateTheme(themePrefRef.current, false);
      refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, updateTheme]);

  const haptic = useCallback((kind: Haptic = "light") => {
    const feedback = webAppRef.current?.HapticFeedback;
    if (!feedback || !webAppRef.current?.isVersionAtLeast("6.1")) return;
    try {
      if (kind === "selection") feedback.selectionChanged();
      else if (kind === "success" || kind === "error") feedback.notificationOccurred(kind);
      else feedback.impactOccurred(kind);
    } catch {
      // хаптика — приятное дополнение, не критично
    }
  }, []);

  const openPaywall = useCallback(
    (reason?: string) => {
      haptic("medium");
      setPaywall(reason ?? "");
    },
    [haptic],
  );

  const handleError = useCallback(
    (error: unknown) => {
      // Доступ к школе изменился (например, отозван) — подтягиваем статус, AppGate покажет экран заявки.
      if (error instanceof ApiError && error.status === 403 && error.data.error === "access") {
        refresh();
        return error.message;
      }
      if (error instanceof ApiError && error.isLimit) {
        openPaywall(error.message);
        refresh();
        return null;
      }
      haptic("error");
      if (error instanceof ApiError) return error.message;
      return "Нет соединения. Проверьте интернет и попробуйте ещё раз.";
    },
    [haptic, openPaywall, refresh],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      status,
      account,
      features,
      offer,
      webApp,
      refresh,
      setAccount,
      haptic,
      openPaywall,
      handleError,
      theme,
      themePref,
      setThemePref,
      textSize,
      setTextSize,
    }),
    [status, account, features, offer, webApp, refresh, haptic, openPaywall, handleError, theme, themePref, setThemePref, textSize, setTextSize],
  );

  return (
    <AppContext.Provider value={value}>
      <MotionConfig reducedMotion="user">
        {children}
        <AnimatePresence>
          {paywall !== null && (
            <motion.div key="paywall" className="fixed inset-0 z-50 flex items-end">
              <motion.button
                aria-label="Закрыть"
                className="absolute inset-0 bg-black/60"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: enter }}
                exit={{ opacity: 0, transition: exit }}
                onClick={() => setPaywall(null)}
              />
              <motion.div
                role="dialog"
                aria-modal="true"
                className="relative w-full px-4 pb-safe"
                initial={{ y: "100%" }}
                animate={{ y: 0, transition: softSpring }}
                exit={{ y: "100%", transition: exit }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.4 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 96 || info.velocity.y > 600) setPaywall(null);
                }}
              >
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-tint/20" />
                {paywall && <p className="mb-4 px-2 text-center text-body text-mist">{paywall}</p>}
                <div className="pb-4">
                  <SubscriptionCard onClose={() => setPaywall(null)} />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </MotionConfig>
    </AppContext.Provider>
  );
}
