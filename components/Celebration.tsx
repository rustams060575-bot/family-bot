"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import { apiJson } from "@/lib/client/api";
import type { Account } from "@/lib/client/types";
import { enter, exit, press, softSpring, spring } from "@/lib/motion";

// Праздничный поп-ап после одобрения заявки: карточка в духе Apple (материал с блюром,
// пружинное появление) и один сдержанный залп конфетти в фирменной палитре.
// Показывается один раз: после «Начать обучение» сервер запоминает celebratedAt.

// Шампань, светлое золото, слоновая кость и серебро — без кислотных цветов.
const CONFETTI_COLORS = ["#D9C29A", "#B89A6A", "#F4EBDD", "#FFFFFF", "#C7C7CC", "#8A6A3A"];
const PIECES = 140;
const DURATION_MS = 3600;
const FADE_MS = 900;
const GRAVITY = 0.07;
const TERMINAL_VY = 3.2; // предельная скорость падения — листочки парят, а не мелькают

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  width: number;
  height: number;
  color: string;
  wobble: number;
};

function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const context = canvas.getContext("2d")!;
    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    // Мягкий «снегопад» из-под верхнего края: листочки входят в кадр волной (разная
    // стартовая высота), парят и плавно расходятся в стороны.
    const pieces: Piece[] = Array.from({ length: PIECES }, () => {
      return {
        x: Math.random() * width,
        y: -20 - Math.random() * height * 0.5,
        vx: (Math.random() - 0.5) * 1.6,
        vy: 0.8 + Math.random() * 1.6,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        width: 6 + Math.random() * 6,
        height: 8 + Math.random() * 8,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        wobble: Math.random() * Math.PI * 2,
      };
    });

    const start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const elapsed = now - start;
      context.clearRect(0, 0, width, height);
      // Последние 0.9 с — мягкое затухание, без резкого исчезновения.
      const fade = Math.min(1, Math.max(0, (DURATION_MS - elapsed) / FADE_MS));
      for (const piece of pieces) {
        piece.vx *= 0.99; // сопротивление воздуха
        piece.vy = Math.min(TERMINAL_VY, piece.vy + GRAVITY);
        piece.wobble += 0.08;
        piece.x += piece.vx + Math.sin(piece.wobble) * 0.9;
        piece.y += piece.vy;
        piece.rotation += piece.spin;
        context.save();
        context.globalAlpha = fade;
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        // «Переворот» листочка в полёте — сжатие по одной оси.
        context.scale(1, Math.cos(piece.wobble));
        context.fillStyle = piece.color;
        context.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
        context.restore();
      }
      if (elapsed < DURATION_MS) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, width, height);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 h-full w-full" aria-hidden />;
}

export default function Celebration() {
  const { account, setAccount, haptic } = useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!account?.celebrate) return;
    setOpen(true);
    haptic("success");
    // haptic стабилен; показываем поп-ап, как только сервер сообщил об одобрении
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.celebrate]);

  async function start() {
    haptic("medium");
    setSaving(true);
    try {
      const { account: updated } = await apiJson<{ account: Account }>("/api/profile", { celebrated: true });
      setAccount(updated);
    } catch {
      // не запомнилось — поп-ап просто покажется ещё раз при следующем входе
    }
    setSaving(false);
    setOpen(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="celebration"
          className="fixed inset-0 z-[60] flex items-center justify-center px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="celebration-title"
        >
          <motion.div
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
          />
          <Confetti />
          <motion.div
            className="material relative w-full max-w-sm overflow-hidden rounded-[1.75rem] px-6 pb-6 pt-8 text-center shadow-[0_30px_80px_-20px_rgb(0_0_0/0.5)]"
            initial={{ opacity: 0, scale: 0.86, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: softSpring }}
            exit={{ opacity: 0, scale: 0.94, transition: exit }}
          >
            {/* Мягкое золотое свечение за значком */}
            <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-champagne/30 blur-3xl" />
            <motion.div
              className="relative mx-auto grid h-20 w-20 place-items-center rounded-full bg-champagne text-[2.5rem] shadow-[0_12px_30px_-10px_rgb(var(--champagne)/0.8)]"
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0, transition: { ...spring, delay: 0.15 } }}
              aria-hidden
            >
              🎓
            </motion.div>
            <p className="relative mt-4 text-footnote font-semibold uppercase text-champagne">ATA Academy · VIP</p>
            <h2 id="celebration-title" className="relative mt-2 text-title1 font-bold">
              🎉 Ура! Вы поступили в ATA Academy!
            </h2>
            <p className="relative mt-3 text-body text-mist">
              Ваша заявка одобрена R Design Space. Вам открыт полный VIP-доступ ко всем курсам, разбору рисунков с
              Мартиной и языковым программам.
            </p>
            <motion.button
              {...press}
              onClick={start}
              disabled={saving}
              className="relative mt-6 min-h-[3.25rem] w-full rounded-[0.875rem] bg-paper px-5 text-headline font-semibold text-ink disabled:opacity-60"
            >
              Начать обучение 🚀
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
