"use client";

import { useEffect, useRef } from "react";
import { useApp } from "@/components/AppProvider";

type Props = {
  // Источник уровней 0..1 по полосам; null — волна «дышит» в покое.
  read: ((bands: number) => number[]) | null;
  active: boolean;
  tone?: "paper" | "champagne" | "danger";
  height?: number;
};

const BANDS = 28;
const TONES = { paper: "--paper", champagne: "--champagne", danger: "--danger" };

// Зеркальная волна из скруглённых столбиков. Высоты сглаживаются экспоненциально
// (как пружина с сильным демпфированием), чтобы волна текла, а не дёргалась.
export default function Waveform({ read, active, tone = "paper", height = 64 }: Props) {
  const { theme } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smoothed = useRef<number[]>(new Array(BANDS).fill(0));
  const readRef = useRef(read);
  const activeRef = useRef(active);
  readRef.current = read;
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d")!;
    const color = getComputedStyle(document.documentElement).getPropertyValue(TONES[tone]).trim().split(/\s+/).join(",");
    let frame = 0;
    const start = performance.now();

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (now: number) => {
      const width = canvas.clientWidth;
      const h = canvas.clientHeight;
      const t = (now - start) / 1000;
      const live = activeRef.current && readRef.current ? readRef.current(BANDS) : null;

      context.clearRect(0, 0, width, h);
      const gap = 4;
      const barWidth = (width - gap * (BANDS - 1)) / BANDS;

      for (let i = 0; i < BANDS; i++) {
        // Колокол по центру: края волны тише, как у голоса.
        const bell = Math.sin((Math.PI * (i + 0.5)) / BANDS);
        const idle = 0.06 + 0.04 * Math.sin(t * 1.6 + i * 0.45);
        const target = live ? Math.max(idle, Math.min(1, live[i] * 1.6) * (0.35 + 0.65 * bell)) : idle;
        smoothed.current[i] += (target - smoothed.current[i]) * 0.22;

        const barHeight = Math.max(barWidth, smoothed.current[i] * h);
        const x = i * (barWidth + gap);
        const y = (h - barHeight) / 2;
        const alpha = live ? 0.35 + 0.65 * smoothed.current[i] : 0.28;
        context.fillStyle = `rgba(${color}, ${alpha})`;
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        context.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // Цвет берётся из CSS-токена — перечитываем его при смене темы.
  }, [tone, theme]);

  return <canvas ref={canvasRef} className="w-full" style={{ height }} aria-hidden />;
}
