"use client";

import { motion } from "framer-motion";
import { rise, stagger } from "@/lib/motion";

type Props = {
  eyebrow: string;
  title: React.ReactNode;
  caption?: string;
  aside?: React.ReactNode;
};

// Шапка экрана iOS: подпись раздела → Large Title 34 px → вторичный текст.
// Одинаковые отступы на всех экранах.
export default function ScreenHeader({ eyebrow, title, caption, aside }: Props) {
  return (
    <motion.header variants={stagger()} initial="hidden" animate="show" className="pb-6 pt-4">
      <motion.div variants={rise} className="flex min-h-11 items-center justify-between">
        <span className="text-subhead font-semibold text-champagne">{eyebrow}</span>
        {aside}
      </motion.div>
      <motion.h1 variants={rise} className="text-large-title font-bold">
        {title}
      </motion.h1>
      {caption && (
        <motion.p variants={rise} className="mt-2 max-w-[22rem] text-body text-mist">
          {caption}
        </motion.p>
      )}
    </motion.header>
  );
}
