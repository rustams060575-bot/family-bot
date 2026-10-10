import type { Transition, Variants } from "framer-motion";

// Единая физика движения на всё приложение. Пружины критически задемпфированы
// (damping = 2·√stiffness при mass = 1): мягкий разгон, никаких перелётов и «прыжков».
// Уход всегда быстрее появления — триптих «появление → удержание → уход».
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export const spring: Transition = { type: "spring", stiffness: 380, damping: 39, mass: 1 };
export const softSpring: Transition = { type: "spring", stiffness: 220, damping: 30, mass: 1 };

export const DURATION = { enter: 0.56, exit: 0.24, stagger: 0.06 } as const;

export const enter: Transition = { duration: DURATION.enter, ease: EASE_OUT_EXPO };
export const exit: Transition = { duration: DURATION.exit, ease: EASE_IN_OUT };

// Появление блока: подъём на 16 px из лёгкого размытия.
export const rise: Variants = {
  hidden: { opacity: 0, y: 16, filter: "blur(8px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: enter },
  leave: { opacity: 0, y: -8, filter: "blur(6px)", transition: exit },
};

export const stagger = (delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: DURATION.stagger, delayChildren } },
});

// Тактильный отклик нажатия — сжатие на 3 %, возврат той же пружиной.
export const press = { whileTap: { scale: 0.97 }, transition: spring } as const;
