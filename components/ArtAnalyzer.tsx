"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import DrawingCanvas, { type DrawingCanvasHandle } from "@/components/DrawingCanvas";
import { ApiError, apiJson } from "@/lib/client/api";
import { martinaGreeting } from "@/lib/client/tracks";
import SpeakButton from "@/components/SpeakButton";
import { EASE_IN_OUT, enter, exit, press, rise, spring, stagger } from "@/lib/motion";

type Analysis = {
  title: string;
  praise: string;
  colors: { name: string; hex: string | null }[];
  details: { title: string; text: string }[];
  question: string;
  nextTask: { title: string; steps: string[]; materials: string };
};

type Source = "photo" | "canvas";
// 1024 px и JPEG 0.8 — ~150–300 КБ вместо 3–5 МБ с iPhone: загрузка не упирается в таймаут,
// а для разбора цветов и деталей детского рисунка этого достаточно.
const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.8;
const SENDABLE = ["image/jpeg", "image/png", "image/webp"];

// Мягкие реплики Мартины вместо системных ошибок.
const LOOK_AGAIN = "Ой, я не успела как следует рассмотреть рисунок. Давай попробуем ещё раз?";
const CANT_OPEN = "Ой, это фото у меня не открылось. Сфотографируй рисунок ещё разок, пожалуйста!";
const EMPTY_CANVAS = "Холст пока пустой — нарисуй что-нибудь, и я сразу посмотрю!";

// Фото с телефона бывают по 12 Мп и в HEIC — перекодируем в JPEG до 1024 px по длинной
// стороне: формат понятен любому Vision, а загрузка быстрая даже на мобильном интернете.
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
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("toBlob вернул null");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Точная причина сбоя для экрана: HTTP-статус и ответ сервера или текст исключения JS.
function describeFailure(stage: string, err: unknown, blob?: Blob | null) {
  const parts = [`Этап: ${stage}`];
  if (err instanceof ApiError) {
    parts.push(`HTTP ${err.status}`);
    if (err.data.error) parts.push(`error: ${err.data.error}`);
    if (err.data.message) parts.push(`message: ${err.data.message}`);
    if (err.data.reason) parts.push(`reason: ${err.data.reason}`);
    if (err.data.raw) parts.push(`ответ: ${err.data.raw}`);
    if (err.data.url) parts.push(`URL: ${err.data.url}`);
  } else if (err instanceof Error) {
    parts.push(`${err.name}: ${err.message || "(пустое сообщение)"}`);
  } else {
    parts.push(String(err));
  }
  if (blob !== undefined) parts.push(`фото: ${blob ? `${blob.size} байт, ${blob.type || "без типа"}` : "нет"}`);
  if (typeof window !== "undefined") parts.push(`страница: ${window.location.origin}`);
  return parts.join("\n");
}

export default function ArtAnalyzer() {
  const { account, features, refresh, haptic, handleError } = useApp();
  const [source, setSource] = useState<Source>("photo");
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "done">("idle");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Техническая причина последнего сбоя — показывается под репликой Мартины.
  const [debug, setDebug] = useState<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const kid = !!account?.kid;

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
    setNote(null);
    setDebug(null);
    let blob: Blob | null = null;
    try {
      blob = await downscale(file);
    } catch (err) {
      console.error("[ArtAnalyzer] сжатие не удалось", err);
      blob = SENDABLE.includes(file.type) ? file : null;
      if (!blob) setDebug(describeFailure(`сжатие фото (${file.type || "без типа"}, ${file.size} байт)`, err));
    }
    if (!blob) {
      setNote(CANT_OPEN);
      haptic("warning");
      return;
    }
    setImage({ blob, url: URL.createObjectURL(blob) });
    setAnalysis(null);
    setStatus("idle");
    haptic("selection");
  }

  async function analyze(blob: Blob | null | undefined) {
    // Пустой файл не отправляем: сервер всё равно отклонит его, а ребёнок увидит сбой.
    if (!blob || blob.size === 0) {
      console.error("[ArtAnalyzer] картинка пустая — запрос не отправлен", { size: blob?.size, type: blob?.type });
      setDebug(describeFailure("подготовка", new Error("картинка пустая — запрос не отправлен"), blob ?? null));
      setNote(CANT_OPEN);
      haptic("warning");
      return;
    }
    haptic("medium");
    setStatus("analyzing");
    setNote(null);
    setDebug(null);
    const startedAt = performance.now();
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
      setDebug(describeFailure(`отправка на /api/art (${Math.round(performance.now() - startedAt)} мс)`, err, blob));
      if (err instanceof ApiError && err.status === 422) {
        setNote(err.message);
        haptic("warning");
        return;
      }
      // Настоящая причина — в консоль (Telegram Desktop → «Inspect»), ребёнку — мягкая реплика Мартины.
      console.error("[ArtAnalyzer] анализ не удался", {
        status: err instanceof ApiError ? err.status : "сеть",
        error: err instanceof ApiError ? err.data.error : String(err),
        reason: err instanceof ApiError ? err.data.reason : undefined,
        ms: Math.round(performance.now() - startedAt),
        image: { size: blob.size, type: blob.type },
      });
      if (err instanceof ApiError && err.status === 400) {
        setNote(CANT_OPEN);
        haptic("warning");
        return;
      }
      // Лимит открывает плашку Premium; любой другой сбой — мягкая реплика Мартины.
      if (handleError(err) !== null) setNote(LOOK_AGAIN);
    }
  }

  async function analyzeCanvas() {
    if (canvasRef.current?.isEmpty()) {
      setNote(EMPTY_CANVAS);
      return;
    }
    // Холст на ретине экспортируется в 2–3× размере — сжимаем так же, как фото.
    setDebug(null);
    let blob: Blob | null = null;
    try {
      const raw = await canvasRef.current?.exportBlob();
      blob = raw ? await downscale(raw).catch(() => raw) : null;
      if (!blob) throw new Error("холст не отдал картинку (toBlob вернул null)");
    } catch (err) {
      console.error("[ArtAnalyzer] экспорт холста не удался", err);
      setDebug(describeFailure("экспорт холста", err));
      setNote(LOOK_AGAIN);
      return;
    }
    setImage({ blob, url: URL.createObjectURL(blob) });
    analyze(blob);
  }

  function startOver() {
    setImage(null);
    setAnalysis(null);
    setStatus("idle");
    setNote(null);
    setDebug(null);
  }

  if (!features.vision) {
    return (
      <div className="glass p-5">
        <p className="label">Скоро</p>
        <p className="mt-2 text-body text-mist">Разбор рисунков подключается. Загляните чуть позже.</p>
      </div>
    );
  }

  const greeting = kid
    ? `${martinaGreeting(account?.firstName)} Покажи мне свой рисунок — мне очень интересно, что ты нарисовал!`
    : `${martinaGreeting()} Покажите мне рисунок ребёнка — я отмечу, что получилось, и предложу новое задание.`;

  return (
    <div>
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={pickFile} />
      <input ref={galleryInput} type="file" accept="image/*" hidden onChange={pickFile} />

      <AnimatePresence mode="wait">
        {status === "done" && analysis ? (
          <Result key="result" analysis={analysis} imageUrl={image?.url} onAgain={startOver} />
        ) : (
          <motion.div key="pick" variants={rise} initial="hidden" animate="show" exit="leave">
            <MartinaNote text={greeting} />

            {/* Источник рисунка — сегментированный контрол iOS */}
            <div className="relative mb-4 mt-6 grid grid-cols-2 rounded-[0.5625rem] bg-fill p-0.5">
              {(["photo", "canvas"] as Source[]).map((value) => (
                <button
                  key={value}
                  onClick={() => {
                    setSource(value);
                    setNote(null);
                    haptic("selection");
                  }}
                  className="relative z-10 min-h-9 px-2 text-subhead font-semibold"
                  aria-pressed={source === value}
                >
                  {source === value && (
                    <motion.span
                      layoutId="art-source"
                      transition={spring}
                      className="absolute inset-0 -z-10 rounded-[0.4375rem] segment-thumb"
                    />
                  )}
                  <span className={source === value ? "text-paper" : "text-mist"}>
                    {value === "photo" ? "📸 Фото с бумаги" : "🎨 Холст"}
                  </span>
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {source === "photo" ? (
                <motion.div key="photo" variants={rise} initial="hidden" animate="show" exit="leave">
                  {image ? (
                    <div className="glass overflow-hidden p-2">
                      <div className="relative overflow-hidden rounded-[0.875rem]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image.url} alt="Рисунок" className="block max-h-[56vh] w-full object-contain" />
                        {status === "analyzing" && <ScanLine />}
                      </div>
                    </div>
                  ) : (
                    <motion.button
                      {...press}
                      onClick={() => cameraInput.current?.click()}
                      className="glass flex aspect-[4/5] w-full flex-col items-center justify-center gap-3 p-8"
                    >
                      <span className="grid h-16 w-16 place-items-center rounded-full bg-champagne/[0.14] text-champagne">
                        <svg
                          width="30"
                          height="30"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          aria-hidden
                        >
                          <path
                            d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.3-2h7l1.3 2h1.7A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"
                            strokeLinejoin="round"
                          />
                          <circle cx="12" cy="13" r="3.8" />
                        </svg>
                      </span>
                      <span className="text-title3 font-semibold">Сфотографировать рисунок с бумаги</span>
                      <span className="max-w-[16rem] text-center text-subhead text-mist">
                        Положи лист на ровный стол при дневном свете
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
                          className="min-h-[3.125rem] rounded-[0.875rem] bg-fill px-5 text-headline font-semibold text-champagne disabled:opacity-40"
                        >
                          Переснять
                        </motion.button>
                        <motion.button
                          {...press}
                          disabled={status === "analyzing"}
                          onClick={() => analyze(image.blob)}
                          className="min-h-[3.125rem] flex-1 rounded-[0.875rem] bg-paper px-5 text-headline font-semibold text-ink disabled:opacity-60"
                        >
                          {status === "analyzing" ? "Мартина смотрит…" : "Показать Мартине"}
                        </motion.button>
                      </>
                    ) : (
                      <motion.button
                        {...press}
                        onClick={() => galleryInput.current?.click()}
                        className="min-h-[3.125rem] w-full rounded-[0.875rem] bg-fill px-5 text-headline font-semibold text-champagne"
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
                    className="mt-6 min-h-[3.125rem] w-full rounded-[0.875rem] bg-paper px-5 text-headline font-semibold text-ink disabled:opacity-60"
                  >
                    {status === "analyzing" ? "Мартина смотрит…" : "Показать Мартине"}
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {note && (
                <motion.div
                  key={note}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: enter }}
                  exit={{ opacity: 0, transition: exit }}
                  className="mt-4"
                >
                  <MartinaNote text={note} />
                </motion.div>
              )}
            </AnimatePresence>

            {debug && (
              <div className="mt-3 rounded-xl bg-fill px-3 py-2">
                <p className="text-footnote font-semibold text-mist">Техническая причина</p>
                <pre className="mt-1 select-text whitespace-pre-wrap break-all font-mono text-caption text-paper">
                  {debug}
                </pre>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Реплика Мартины: монограмма + пузырь, как в чате занятий.
function MartinaNote({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-champagne text-headline font-semibold text-ink"
        aria-hidden
      >
        М
      </span>
      <div className="rounded-[1.25rem] rounded-bl-md bg-ink-raised px-4 pb-1 pt-3 shadow-[var(--card-shadow)]">
        <p className="text-body text-paper">{text}</p>
        <SpeakButton text={text} className="-ml-1 px-1" />
      </div>
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
        opacity: {
          delay,
          duration: 3.2,
          times: [0, 0.15, 0.6, 1],
          repeat: Infinity,
          repeatType: "mirror",
          ease: "easeInOut",
        },
      }}
      aria-hidden
    >
      <path
        d="M12 0c.7 6.4 5 11.3 12 12-7 .7-11.3 5.6-12 12-.7-6.4-5-11.3-12-12 7-.7 11.3-5.6 12-12z"
        fill="currentColor"
      />
    </motion.svg>
  );
}

function Result({ analysis, imageUrl, onAgain }: { analysis: Analysis; imageUrl?: string; onAgain: () => void }) {
  return (
    <motion.div variants={stagger(0.1)} initial="hidden" animate="show" exit="leave" className="space-y-4">
      <motion.div variants={rise} className="flex items-center gap-4">
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-16 w-16 rounded-[0.875rem] object-cover" />
        )}
        <div className="min-w-0">
          <p className="label">Твой рисунок</p>
          <h2 className="mt-0.5 text-title2 font-bold">{analysis.title}</h2>
        </div>
      </motion.div>

      <motion.div variants={rise} className="relative">
        <MartinaNote text={analysis.praise} />
        <Sparkle delay={0.5} size={16} className="-top-2 right-2" />
        <Sparkle delay={0.7} size={10} className="right-8 top-2" />
      </motion.div>

      {!!analysis.colors.length && (
        <motion.div variants={rise}>
          <p className="label px-4 pb-2">Твои цвета</p>
          <div className="flex flex-wrap gap-2">
            {analysis.colors.map((color) => (
              <span
                key={color.name}
                className="flex min-h-9 items-center gap-2 rounded-full bg-ink-raised py-1 pl-1.5 pr-4 text-subhead text-paper"
              >
                <span
                  className="h-6 w-6 rounded-full ring-1 ring-inset ring-tint/10"
                  style={{ background: color.hex ?? "var(--fill)" }}
                  aria-hidden
                />
                {color.name}
              </span>
            ))}
          </div>
        </motion.div>
      )}

      {!!analysis.details.length && (
        <motion.div variants={rise}>
          <p className="label px-4 pb-2">Что получилось</p>
          <div className="glass overflow-hidden">
            {analysis.details.map((detail, index) => (
              <div key={index}>
                {index > 0 && <div className="hairline ml-14" />}
                <div className="flex gap-3 px-4 py-3">
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-champagne/[0.14] text-champagne"
                    aria-hidden
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24">
                      <path
                        d="M12 0c.7 6.4 5 11.3 12 12-7 .7-11.3 5.6-12 12-.7-6.4-5-11.3-12-12 7-.7 11.3-5.6 12-12z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <div>
                    <p className="text-headline font-semibold">{detail.title}</p>
                    <p className="mt-0.5 text-subhead text-mist">{detail.text}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {analysis.question && (
        <motion.div variants={rise} className="glass glass-accent p-5">
          <p className="text-footnote font-semibold text-champagne">Вопрос от Мартины</p>
          <p className="mt-1 text-title3 font-semibold">{analysis.question}</p>
          <SpeakButton text={`Вопрос от Мартины. ${analysis.question}`} className="-ml-1 mt-1 px-1" />
        </motion.div>
      )}

      {analysis.nextTask.title && (
        <motion.div variants={rise}>
          <p className="label px-4 pb-2">Новое задание</p>
          <div className="glass p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-title3 font-semibold">{analysis.nextTask.title}</h3>
              <SpeakButton
                label={false}
                className="-mr-2 -mt-2 justify-center px-2"
                text={[
                  `Новое задание: ${analysis.nextTask.title}.`,
                  ...analysis.nextTask.steps.map((step, index) => `${index + 1}. ${step}`),
                  analysis.nextTask.materials ? `Понадобится: ${analysis.nextTask.materials}.` : "",
                ].join(" ")}
              />
            </div>
            <ol className="mt-3 space-y-2">
              {analysis.nextTask.steps.map((step, index) => (
                <li key={index} className="flex gap-3 text-body">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-fill text-footnote font-semibold tabular-nums text-paper">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            {analysis.nextTask.materials && (
              <>
                <div className="hairline my-3" />
                <p className="text-subhead text-mist">
                  <span className="font-semibold text-paper">Понадобится: </span>
                  {analysis.nextTask.materials}
                </p>
              </>
            )}
          </div>
        </motion.div>
      )}

      <motion.button
        variants={rise}
        {...press}
        onClick={onAgain}
        className="min-h-[3.125rem] w-full rounded-[0.875rem] bg-paper px-5 text-headline font-semibold text-ink"
      >
        Нарисовал — показать новый рисунок
      </motion.button>
    </motion.div>
  );
}
