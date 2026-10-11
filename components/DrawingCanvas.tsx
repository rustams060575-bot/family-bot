"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { motion } from "framer-motion";
import { press, spring } from "@/lib/motion";

// Холст-черновик: основной формат Kids Art — рисунок на бумаге, а экран нужен,
// чтобы быстро набросать идею. Штрихи хранятся векторно (точки + нажим) — это даёт
// отмену и чёткую перерисовку на любом DPR.
type Point = { x: number; y: number; p: number };
type Stroke = { color: string; size: number; erase: boolean; points: Point[] };

export type DrawingCanvasHandle = { exportBlob: () => Promise<Blob | null>; isEmpty: () => boolean };

// Цвета инструментов — «пигменты» для ребёнка, а не UI-палитра: приглушённые,
// как у хорошей гуаши.
const PIGMENTS = ["#2B2A28", "#C4664A", "#D9A441", "#7E9A6B", "#3E64A8", "#7A4E7E"];
const SIZES = [4, 10, 22];
const SHEET = "#F4F1EA";

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke) {
  const { points } = stroke;
  if (!points.length) return;
  context.save();
  context.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x, points[0].y, (stroke.size * points[0].p) / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    // Сглаживание: квадратичные кривые через середины отрезков.
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1];
      const current = points[i];
      const middle = { x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2 };
      context.beginPath();
      context.lineWidth = stroke.size * (0.6 + 0.4 * current.p);
      context.moveTo(previous.x, previous.y);
      context.quadraticCurveTo(previous.x, previous.y, middle.x, middle.y);
      context.lineTo(current.x, current.y);
      context.stroke();
    }
  }
  context.restore();
}

const DrawingCanvas = forwardRef<DrawingCanvasHandle>(function DrawingCanvas(_, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const [color, setColor] = useState(PIGMENTS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [erase, setErase] = useState(false);
  const [count, setCount] = useState(0);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes.current) drawStroke(context, stroke);
    if (current.current) drawStroke(context, current.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
      canvas.getContext("2d")!.setTransform(ratio, 0, 0, ratio, 0, 0);
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redraw]);

  useImperativeHandle(ref, () => ({
    isEmpty: () => strokes.current.length === 0,
    exportBlob: () =>
      new Promise((resolve) => {
        const source = canvasRef.current!;
        const out = document.createElement("canvas");
        out.width = source.width;
        out.height = source.height;
        const context = out.getContext("2d")!;
        context.fillStyle = SHEET;
        context.fillRect(0, 0, out.width, out.height);
        context.drawImage(source, 0, 0);
        out.toBlob(resolve, "image/jpeg", 0.9);
      }),
  }));

  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    // У мыши и пальца pressure = 0.5 или 0 — подставляем ровный нажим.
    const p = event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.7;
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, p };
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-3xl" style={{ background: SHEET }}>
        <canvas
          ref={canvasRef}
          className="block aspect-[4/5] w-full touch-none"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            current.current = { color, size: erase ? size * 2 : size, erase, points: [point(event)] };
            redraw();
          }}
          onPointerMove={(event) => {
            if (!current.current) return;
            current.current.points.push(point(event));
            redraw();
          }}
          onPointerUp={() => {
            if (current.current) strokes.current.push(current.current);
            current.current = null;
            setCount(strokes.current.length);
          }}
          onPointerCancel={() => {
            current.current = null;
            redraw();
          }}
        />
        {count === 0 && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-title3 font-semibold text-black/25">
            Черновик идеи
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex gap-2">
          {PIGMENTS.map((pigment) => (
            <motion.button
              key={pigment}
              {...press}
              aria-label="Цвет"
              onClick={() => {
                setColor(pigment);
                setErase(false);
              }}
              className="relative h-9 w-9 rounded-full"
              style={{ background: pigment }}
            >
              {!erase && color === pigment && (
                <motion.span layoutId="pigment-ring" transition={spring} className="absolute -inset-1 rounded-full ring-1 ring-paper/70" />
              )}
            </motion.button>
          ))}
        </div>
        <motion.button
          {...press}
          onClick={() => setErase((value) => !value)}
          className={`min-h-11 rounded-full px-4 text-subhead font-medium ${
            erase ? "bg-paper text-ink" : "bg-fill text-champagne"
          }`}
        >
          Ластик
        </motion.button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {SIZES.map((value) => (
            <motion.button
              key={value}
              {...press}
              aria-label={`Толщина ${value}`}
              onClick={() => setSize(value)}
              className={`grid h-11 w-11 place-items-center rounded-full ${size === value ? "bg-tint/10" : ""}`}
            >
              <span className="rounded-full bg-paper" style={{ width: Math.max(4, value / 2), height: Math.max(4, value / 2) }} />
            </motion.button>
          ))}
        </div>
        <div className="flex gap-2">
          <motion.button
            {...press}
            disabled={count === 0}
            onClick={() => {
              strokes.current.pop();
              setCount(strokes.current.length);
              redraw();
            }}
            className="min-h-11 rounded-full bg-fill px-4 text-subhead font-semibold text-champagne disabled:opacity-40"
          >
            Отменить
          </motion.button>
          <motion.button
            {...press}
            disabled={count === 0}
            onClick={() => {
              strokes.current = [];
              setCount(0);
              redraw();
            }}
            className="min-h-11 rounded-full bg-fill px-4 text-subhead font-semibold text-champagne disabled:opacity-40"
          >
            Очистить
          </motion.button>
        </div>
      </div>
    </div>
  );
});

export default DrawingCanvas;
