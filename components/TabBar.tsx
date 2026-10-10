"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import { spring } from "@/lib/motion";

const TABS = [
  { href: "/", label: "Главная", mark: "A" },
  { href: "/learn/spanish", label: "Spanish", mark: "Es" },
  { href: "/learn/english", label: "English", mark: "En" },
  { href: "/art", label: "Art", mark: "Art" },
  { href: "/translate", label: "Перевод", mark: "Aa" },
];

// Нижняя навигация: стеклянная капсула, активная вкладка отмечена подложкой,
// которая «перетекает» между пунктами общей пружиной (layoutId).
export default function TabBar() {
  const pathname = usePathname();
  const { account, haptic } = useApp();
  if (!account?.role) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-4 pb-safe">
      <div className="glass mx-auto mb-4 grid max-w-md grid-cols-5 p-1">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => !active && haptic("selection")}
              className="relative flex flex-col items-center gap-1 py-2"
            >
              {active && (
                <motion.span layoutId="tab-active" transition={spring} className="absolute inset-0 rounded-[1.25rem] bg-tint/[0.07]" />
              )}
              <span className={`relative font-serif text-lead italic leading-none ${active ? "text-champagne" : "text-mist"}`}>
                {tab.mark}
              </span>
              <span className={`relative font-sans text-[0.64rem] font-medium uppercase tracking-[0.16em] ${active ? "text-paper" : "text-dim"}`}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
