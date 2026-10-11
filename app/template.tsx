"use client";

import { motion } from "framer-motion";
import { enter } from "@/lib/motion";

// Мягкий переход между вкладками: новая страница проявляется из лёгкого размытия
// с подъёмом на 8 px. Уход не анимируется — App Router размонтирует страницу сразу,
// и короткое появление нового экрана читается как единое движение.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={enter}
      className="flex flex-1 flex-col px-4 pb-32 pt-safe"
    >
      {children}
    </motion.main>
  );
}
