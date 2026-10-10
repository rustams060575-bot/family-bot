"use client";

import { motion } from "framer-motion";
import { rise, stagger } from "@/lib/motion";

type Props = {
  eyebrow: string;
  title: React.ReactNode;
  caption?: string;
  aside?: React.ReactNode;
};

// Заголовок экрана: метка → антиква → подпись. Одинаковые отступы на всех экранах.
export default function ScreenHeader({ eyebrow, title, caption, aside }: Props) {
  return (
    <motion.header variants={stagger()} initial="hidden" animate="show" className="pb-8 pt-8">
      <motion.div variants={rise} className="flex items-center justify-between">
        <span className="label">{eyebrow}</span>
        {aside}
      </motion.div>
      <motion.h1 variants={rise} className="mt-4 font-serif text-h1 font-light">
        {title}
      </motion.h1>
      {caption && (
        <motion.p variants={rise} className="mt-4 max-w-[22rem] text-body text-mist">
          {caption}
        </motion.p>
      )}
    </motion.header>
  );
}
