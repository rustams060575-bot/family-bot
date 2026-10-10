"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import DrawingCanvas, { type DrawingCanvasHandle } from "@/components/DrawingCanvas";
import { ApiError, apiJson } from "@/lib/client/api";
import { EASE_IN_OUT, enter, exit, press, rise, spring, stagger } from "@/lib/motion";

type Analysis = {
  title: string;
  strengths: { title: string; text: string }[];
  tip: { title: string; text: string };
  nextTask: { title: string; steps: string[]; materials: string };
};

type Source = "photo" | "canvas";
const MAX_SIDE = 1600;

// Фото с телефона бывают по 12 Мп — уменьшаем до 1600 px по длинной стороне:
// для разбора композиции этого достаточно, а загрузка в разы быстрее.
async function downscale(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.86));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ArtAnalyzer() {
  const { account, features, refresh, haptic, handleError } = useApp();
  const [source, setSource] = useState<Source>("photo");
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "done">("idle");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<DrawingCanvasHandle>(null);

  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );

  async function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    const blob = await downscale(file).catch(() => file);
    setImage({ blob, url: URL.createObjectURL(blob) });
    setAnalysis(null);
    setStatus("idle");
    haptic("selection");
  }

  async function analyze(blob: Blob) {
    haptic("medium");
    setStatus("analyzing");
    setError(null);
    try {
      const form = new FormData();
      form.append("image", blob, "drawing.jpg");
      const result = await apiJson<Analysis>("/api/art", form);
      setAnalysis(result);
      setStatus("done");
      haptic("success");
      refresh();
    } catch (err) {
      setStatus("idle");
      setError(err instanceof ApiError && err.status === 422 ? err.message : handleError(err));
    }
  }

  async function analyzeCanvas() {
    if (canvasRef.current?.isEmpty()) {
      setError("Сначала нарисуйте что-нибудь.");
      return;
    }
    const blob = await canvasRef.current?.exportBlob();
    if (!blob) return;
    setImage({ blob, url: URL.createObjectURL(blob) });
    analyze(blob);
  }

  function startOver() {
    setImage(null);
    setAnalysis(null);
    setStatus("idle");
    setError(null);
  }

  if (!features.vision) {
    return (
      <div className="glass p-6">
        <p className="label">Скоро</p>
        <p className="mt-4 text-body text-mist">Разбор рисунков подключается. Загляните чуть позже.</p>
      </div>
    );
  }

  const left = account ? Math.max(0, account.limits.art - account.usage.art) : 0;

  return (
    <div>
      {status !== "done" && (
        <div className="relative mb-6 grid grid-cols-2 rounded-2xl bg-tint/[0.04] p-1">
          {(["photo", "canvas"] as Source[]).map((value) => (
            <button
              key={value}
              onClick={() => {
                setSource(value);
                haptic("selection");
              }}
              className="relative z-10 py-2 font-sans text-label font-medium uppercase"
            >
              {source === value && (
                <motion.span layoutId="art-source" transition={spring} className="absolute inset-0 -z-10 rounded-xl bg-tint/10" />
              )}
              <span className={source === value ? "text-paper" : "text-dim"}>
                {value === "photo" ? "Фото с бумаги" : "Черновик"}
              </span>
            </button>
          ))}
        </div>
      )}

      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={pickFile} />
      <input ref={galleryInput} type="file" accept="image/*" hidden onChange={pickFile} />

      <AnimatePresence mode="wait">
        {status === "done" && analysis ? (
          <Result key="result" analysis={analysis} imageUrl={image?.url} onAgain={startOver} />
        ) : source === "photo" ? (
          <motion.div key="photo" variants={rise} initial="hidden" animate="show" exit="leave">
            {image ? (
              <div className="glass overflow-hidden p-2">
                <div className="relative overflow-hidden rounded-2xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt="Рисунок" className="block max-h-[56vh] w-full object-contain" />
                  {status === "analyzing" && <ScanLine />}
                </div>
              </div>
            ) : (
              <motion.button
                {...press}
                onClick={() => cameraInput.current?.click()}
                className="glass glass-accent flex aspect-[4/5] w-full flex-col items-center justify-center gap-4 p-8"
              >
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-champagne" aria-hidden>
                  <rect x="4" y="10" width="32" height="24" rx="6" />
                  <circle cx="20" cy="22" r="6.5" />
                  <path d="M14 10l2.5-4h7L26 10" strokeLinejoin="round" />
                </svg>
                <span className="font-serif text-h3 font-light">Сфотографируйте рисунок</span>
                <span className="max-w-[16rem] text-center text-body text-mist">
                  Положите лист на ровную поверхность при дневном свете
                </span>
              </motion.button>
            )}

            <div className="mt-4 flex gap-2">
              {image ? (
                <>
                  <motion.button
                    {...press}
                    disabled={status === "analyzing"}
                    onClick={() => cameraInput.current?.click()}
                    className="rounded-2xl bg-tint/[0.06] px-6 py-4 font-sans text-body text-mist disabled:opacity-40"
                  >
                    Переснять
                  </motion.button>
                  <motion.button
                    {...press}
                    disabled={status === "analyzing"}
                    onClick={() => analyze(image.blob)}
                    className="flex-1 rounded-2xl bg-paper px-6 py-4 font-sans text-body font-medium text-ink disabled:opacity-60"
                  >
                    {status === "analyzing" ? "Смотрим на рисунок…" : "Разобрать рисунок"}
                  </motion.button>
                </>
              ) : (
                <motion.button
                  {...press}
                  onClick={() => galleryInput.current?.click()}
                  className="w-full rounded-2xl bg-tint/[0.06] px-6 py-4 font-sans text-body text-mist"
                >
                  Выбрать из галереи
                </motion.button>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div key="canvas" variants={rise} initial="hidden" animate="show" exit="leave">
            <DrawingCanvas ref={canvasRef} />
            <motion.button
              {...press}
              disabled={status === "analyzing"}
              onClick={analyzeCanvas}
              className="mt-6 w-full rounded-2xl bg-paper px-6 py-4 font-sans text-body font-medium text-ink disabled:opacity-60"
            >
              {status === "analyzing" ? "Смотрим на черновик…" : "Показать педагогу"}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {status !== "done" && account && (
        <p className="label mt-4 text-center">Разборов сегодня: {left} из {account.limits.art}</p>
      )}

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
            className="mt-4 text-center text-body text-danger"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// Медленная световая линия, сканирующая рисунок, пока идёт анализ.
function ScanLine() {
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-champagne/25 to-transparent"
      initial={{ top: "-25%" }}
      animate={{ top: ["-25%", "100%"] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: EASE_IN_OUT }}
    />
  );
}

// Четырёхлучевая звезда похвалы: появляется пружиной и тихо мерцает — без вспышек.
function Sparkle({ delay, size, className }: { delay: number; size: number; className: string }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`absolute text-champagne ${className}`}
      initial={{ scale: 0, rotate: -30, opacity: 0 }}
      animate={{ scale: 1, rotate: 0, opacity: [0, 1, 0.55, 1] }}
      transition={{
        scale: { ...spring, delay },
        rotate: { ...spring, delay },
        opacity: { delay, duration: 3.2, times: [0, 0.15, 0.6, 1], repeat: Infinity, repeatType: "mirror", ease: "easeInOut" },
      }}
      aria-hidden
    >
      <path d="M12 0c.7 6.4 5 11.3 12 12-7 .7-11.3 5.6-12 12-.7-6.4-5-11.3-12-12 7-.7 11.3-5.6 12-12z" fill="currentColor" />
    </motion.svg>
  );
}

function Result({ analysis, imageUrl, onAgain }: { analysis: Analysis; imageUrl?: string; onAgain: () => void }) {
  return (
    <motion.div variants={stagger(0.1)} initial="hidden" animate="show" exit="leave" className="space-y-4">
      <motion.div variants={rise} className="flex items-center gap-4">
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-16 w-16 rounded-2xl object-cover ring-1 ring-tint/10" />
        )}
        <div>
          <p className="label">Рисунок</p>
          <h2 className="mt-2 font-serif text-h2 font-light">{analysis.title}</h2>
        </div>
      </motion.div>

      {analysis.strengths.map((strength, index) => (
        <motion.div key={index} variants={rise} className="glass glass-accent relative overflow-hidden p-6">
          <Sparkle delay={0.5 + index * 0.25} size={16} className="right-6 top-6" />
          <Sparkle delay={0.65 + index * 0.25} size={10} className="right-12 top-12" />
          <Sparkle delay={0.8 + index * 0.25} size={8} className="right-4 top-16" />
          <p className="label text-champagne/80">Получилось</p>
          <h3 className="mt-2 pr-12 font-serif text-h3 font-light">{strength.title}</h3>
          <p className="mt-2 text-body text-paper/90">{strength.text}</p>
        </motion.div>
      ))}

      <motion.div variants={rise} className="glass p-6">
        <p className="label">Совет</p>
        <h3 className="mt-2 font-serif text-h3 font-light">{analysis.tip.title}</h3>
        <p className="mt-2 text-body text-mist">{analysis.tip.text}</p>
      </motion.div>

      <motion.div variants={rise} className="glass p-6">
        <p className="label">Следующее задание</p>
        <h3 className="mt-2 font-serif text-h2 font-light italic">{analysis.nextTask.title}</h3>
        <ol className="mt-4 space-y-2">
          {analysis.nextTask.steps.map((step, index) => (
            <li key={index} className="flex gap-4 text-body text-paper/90">
              <span className="font-serif text-lead italic text-champagne">{index + 1}</span>
              <span className="pt-1">{step}</span>
            </li>
          ))}
        </ol>
        {analysis.nextTask.materials && (
          <>
            <div className="hairline my-4" />
            <p className="text-body text-mist">
              <span className="label mr-2">Понадобится</span>
              {analysis.nextTask.materials}
            </p>
          </>
        )}
      </motion.div>

      <motion.button
        variants={rise}
        {...press}
        onClick={onAgain}
        className="w-full rounded-2xl bg-paper px-6 py-4 font-sans text-body font-medium text-ink"
      >
        Нарисовал — показать новый рисунок
      </motion.button>
    </motion.div>
  );
}
