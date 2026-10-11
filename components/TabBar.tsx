"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import { spring } from "@/lib/motion";

// Иконки в духе SF Symbols: штрих 1.6 px, скруглённые концы, сетка 24 px.
const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />,
  spanish: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="4" />
      <text x="12" y="15.6" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" stroke="none">
        Es
      </text>
    </>
  ),
  english: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="4" />
      <text x="12" y="15.6" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" stroke="none">
        En
      </text>
    </>
  ),
  art: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.4-2l-.4-1a1.6 1.6 0 0 1 1.5-2.2H17a3.5 3.5 0 0 0 3.5-3.5c0-4.6-3.8-8.3-8.5-8.3z" />
      <circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="7.3" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  translate: (
    <>
      <path d="M4 5.5h9M8.5 4v1.5c0 3.5-2 6.4-4.5 7.8M6.3 8.5c1.2 2.2 3 3.9 5.2 4.8" />
      <path d="m12.5 20 3.8-9 3.7 9M13.9 17h4.8" />
    </>
  ),
};

const TABS = [
  { href: "/", label: "Главная", icon: "home" },
  { href: "/learn/spanish", label: "Spanish", icon: "spanish" },
  { href: "/learn/english", label: "English", icon: "english" },
  { href: "/art", label: "Art", icon: "art" },
  { href: "/translate", label: "Перевод", icon: "translate" },
];

// Нижняя навигация iOS: панель из материала с блюром, волосяная линия сверху,
// иконка + подпись 10 px. Активная вкладка окрашена tint-цветом; смена — пружиной.
export default function TabBar() {
  const pathname = usePathname();
  const { account, haptic } = useApp();
  if (!account?.role || account.access !== "approved") return null;

  return (
    <nav className="material fixed inset-x-0 bottom-0 z-40 pb-safe">
      <div className="hairline absolute inset-x-0 top-0" />
      <div className="mx-auto grid max-w-md grid-cols-5 px-2">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => !active && haptic("selection")}
              aria-current={active ? "page" : undefined}
              className="relative flex min-h-[3.0625rem] flex-col items-center justify-center gap-0.5 pb-1 pt-1.5"
            >
              <motion.svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                animate={{ scale: active ? 1 : 0.94 }}
                transition={spring}
                className={`transition-colors duration-300 ease-out-expo ${active ? "text-champagne" : "text-dim"}`}
                aria-hidden
              >
                {ICONS[tab.icon]}
              </motion.svg>
              <span
                className={`text-[0.625rem] font-medium leading-3 transition-colors duration-300 ease-out-expo ${
                  active ? "text-champagne" : "text-dim"
                }`}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
