"use client";

import { motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import { spring } from "@/lib/motion";

// Капсула «день / ночь»: подложка перетекает пружиной, цвета всего интерфейса
// кросс-фейдятся за 0.5 с (см. .theme-transition в globals.css).
export default function ThemeToggle() {
  const { theme, setThemePref, haptic } = useApp();

  return (
    <div className="flex rounded-full bg-fill p-0.5" role="radiogroup" aria-label="Тема оформления">
      {(["light", "dark"] as const).map((value) => {
        const active = theme === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={value === "light" ? "Светлая тема" : "Тёмная тема"}
            onClick={() => {
              if (active) return;
              haptic("selection");
              setThemePref(value);
            }}
            className="relative grid h-10 w-11 place-items-center rounded-full"
          >
            {active && <motion.span layoutId="theme-thumb" transition={spring} className="absolute inset-0.5 rounded-full segment-thumb" />}
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              className={`relative ${active ? "text-champagne" : "text-dim"}`}
              aria-hidden
            >
              {value === "light" ? (
                <>
                  <circle cx="9" cy="9" r="3.4" />
                  <path d="M9 1.5v1.6M9 14.9v1.6M1.5 9h1.6M14.9 9h1.6M3.7 3.7l1.1 1.1M13.2 13.2l1.1 1.1M3.7 14.3l1.1-1.1M13.2 4.8l1.1-1.1" />
                </>
              ) : (
                <path d="M15 10.6A6.5 6.5 0 0 1 7.4 3a6.5 6.5 0 1 0 7.6 7.6z" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        );
      })}
    </div>
  );
}
