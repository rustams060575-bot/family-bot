"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Chess, type Square } from "chess.js";
import { useApp } from "@/components/AppProvider";
import ChessBoard from "@/components/ChessBoard";
import MartinaNote from "@/components/MartinaNote";
import { chooseMove, quickEvalWhite, type EngineLevel, type EngineResult } from "@/lib/chessEngine";
import { leoComment, resultComment, ruSan, type MoveFacts } from "@/lib/client/leoComments";
import { enter, exit, press, rise, stagger } from "@/lib/motion";

// Партия с Лео: ученик выбирает цвет, ходит касаниями, Лео отвечает ходом движка
// (в отдельном потоке) и комментирует интересные моменты. Сила Лео — по уровню ученика:
// без поддавков, но глубина расчёта и разброс среди почти равных ходов адаптивны.
// Партия хранится на устройстве — её можно продолжить позже; итог уходит в прогресс.

type Color = "w" | "b";
type Over = { result: "win" | "loss" | "draw"; reason: string };
type Saved = { color: Color; moves: string[]; comment: string | null; over: Over | null; reported?: boolean };

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const STORAGE_KEY = "chess:game";
const LEO = "Л";
const MIN_THINK_MS = 650;

const primaryButton =
  "min-h-[3.125rem] w-full rounded-[0.875rem] bg-paper px-5 text-headline font-semibold text-ink disabled:opacity-50";
const secondaryButton =
  "min-h-[3.125rem] w-full rounded-[0.875rem] bg-fill px-5 text-headline font-semibold text-champagne disabled:opacity-50";

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as Saved) : null;
    return saved && (saved.color === "w" || saved.color === "b") && Array.isArray(saved.moves) ? saved : null;
  } catch {
    return null;
  }
}

function store(saved: Saved | null) {
  try {
    if (saved) localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Хранилище недоступно — партия просто не переживёт перезапуск.
  }
}

// Позиция по списку ходов; битая история (например, после обновления) — новая доска.
function replay(moves: string[]) {
  const game = new Chess();
  for (const uci of moves) {
    try {
      game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
  }
  return game;
}

const keyOf = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

function finished(game: Chess, color: Color): Over | null {
  if (game.isCheckmate()) return { result: game.turn() === color ? "loss" : "win", reason: "mate" };
  if (game.isStalemate()) return { result: "draw", reason: "пат" };
  if (game.isThreefoldRepetition()) return { result: "draw", reason: "троекратное повторение" };
  if (game.isInsufficientMaterial()) return { result: "draw", reason: "мало материала для мата" };
  if (game.isDraw()) return { result: "draw", reason: "правило 50 ходов" };
  return null;
}

function facts(move: { san: string; piece: string; captured?: string; promotion?: string; flags: string }): MoveFacts {
  return { san: move.san, piece: move.piece, captured: move.captured, promotion: move.promotion, flags: move.flags };
}

// Движок в Web Worker; если воркер недоступен — тот же расчёт в основном потоке.
function useLeoEngine() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (result: EngineResult | null) => void>());
  const nextId = useRef(1);

  useEffect(() => {
    try {
      const instance = new Worker(new URL("../lib/chessEngine.worker.ts", import.meta.url));
      instance.onmessage = (event: MessageEvent<{ id: number; result: EngineResult | null }>) => {
        pending.current.get(event.data.id)?.(event.data.result);
        pending.current.delete(event.data.id);
      };
      worker.current = instance;
    } catch {
      worker.current = null;
    }
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, []);

  return useCallback(async (fen: string, level: EngineLevel, seen: string[]) => {
    if (worker.current) {
      const id = nextId.current++;
      return new Promise<EngineResult | null>((resolve) => {
        pending.current.set(id, resolve);
        worker.current!.postMessage({ id, fen, level, seen });
      });
    }
    return chooseMove(fen, level, Math.random, seen);
  }, []);
}

export default function ChessGame({
  level,
  levelLabel,
  young,
  onFinished,
}: {
  level: EngineLevel;
  levelLabel: string;
  young: boolean;
  onFinished: (payload: { result: Over["result"]; color: Color; plies: number }) => void;
}) {
  const { account, haptic } = useApp();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [ready, setReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const think = useLeoEngine();
  const evalBefore = useRef(0);

  useEffect(() => {
    setSaved(load());
    setReady(true);
  }, []);

  const update = useCallback((next: Saved | null) => {
    setSaved(next);
    store(next);
  }, []);

  const game = useMemo(() => replay(saved?.moves ?? []), [saved?.moves]);
  const color = saved?.color ?? "w";
  const over = saved?.over ?? null;
  const leoTurn = !!saved && !over && game.turn() !== color;

  // Итог партии — в прогресс, один раз.
  useEffect(() => {
    if (!saved?.over || saved.reported) return;
    onFinished({ result: saved.over.result, color: saved.color, plies: saved.moves.length });
    update({ ...saved, reported: true });
  }, [saved, onFinished, update]);

  // Ход Лео.
  useEffect(() => {
    if (!saved || !leoTurn || thinking) return;
    let cancelled = false;
    setThinking(true);
    const started = Date.now();
    const seen = game.history({ verbose: true }).map((move) => keyOf(move.before));
    const fen = game.fen();
    (async () => {
      const result = await think(fen, level, seen);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_THINK_MS - (Date.now() - started))));
      if (cancelled) return;
      if (!result) {
        setThinking(false);
        return;
      }
      const next = new Chess(fen);
      const leoMove = next.move({
        from: result.move.slice(0, 2),
        to: result.move.slice(2, 4),
        promotion: result.move[4],
      });
      const sign = color === "w" ? 1 : -1;
      const history = game.history({ verbose: true });
      const playerMove = history[history.length - 1];
      const afterPlayer = sign * quickEvalWhite(fen);
      const afterLeo = sign * quickEvalWhite(next.fen());
      const moves = [...saved.moves, result.move];
      const after = replay(moves);
      const end = finished(after, color);
      const comment = playerMove
        ? leoComment({
            young,
            player: facts(playerMove),
            leo: facts(leoMove),
            before: evalBefore.current,
            afterPlayer,
            afterLeo,
            plies: moves.length,
            leoMates: after.isCheckmate(),
            leoChecks: after.inCheck(),
          })
        : young
          ? "Я начинаю! Твоя очередь — выводи фигуры в центр."
          : `Начинаю: ${ruSan(leoMove.san)}. Твой ход.`;
      haptic(after.inCheck() ? "warning" : "light");
      update({ ...saved, moves, comment: end ? resultComment(end.result, young, end.reason) : comment, over: end });
      setThinking(false);
    })();
    return () => {
      cancelled = true;
      setThinking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.moves, leoTurn]);

  function start(side: Color) {
    haptic("success");
    evalBefore.current = 0;
    update({
      color: side,
      moves: [],
      over: null,
      comment:
        side === "w"
          ? young
            ? "Ты играешь белыми — ходи первым! Я буду играть всерьёз, держись!"
            : "Белые за тобой. Играю всерьёз — покажи, на что способен."
          : null,
    });
  }

  function play(uci: string) {
    if (!saved || over || leoTurn) return;
    const next = new Chess(game.fen());
    try {
      // Оценка до хода ученика — опорная точка для комментария Лео.
      evalBefore.current = (color === "w" ? 1 : -1) * quickEvalWhite(game.fen());
      next.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: "q" });
    } catch {
      haptic("warning");
      setWrong(uci.slice(2, 4));
      setTimeout(() => setWrong(null), 700);
      return;
    }
    haptic("selection");
    const promoted = next.history({ verbose: true }).at(-1)?.promotion;
    const moves = [...saved.moves, `${uci.slice(0, 4)}${promoted ?? ""}`];
    const end = finished(replay(moves), color);
    update({ ...saved, moves, over: end, comment: end ? resultComment(end.result, young, end.reason) : saved.comment });
  }

  function undo() {
    if (!saved || over || leoTurn) return;
    // Снимаем свой последний ход и ответ Лео; за чёрных первый ход Лео не трогаем.
    const keep = saved.moves.length - 2;
    if (keep < (color === "b" ? 1 : 0)) return;
    haptic("light");
    update({
      ...saved,
      moves: saved.moves.slice(0, keep),
      comment: young ? "Переходим! Подумай ещё разок." : "Ход назад. Посчитай варианты ещё раз.",
    });
  }

  function resign() {
    if (!saved || over) return;
    haptic("warning");
    update({ ...saved, over: { result: "loss", reason: "resign" }, comment: resultComment("loss", young, "resign") });
  }

  if (!ready) return null;

  // ── Предложение Лео ────────────────────────────────────────────────────────
  if (!saved) {
    return (
      <motion.div variants={stagger()} initial="hidden" animate="show" className="space-y-4">
        <motion.div variants={rise}>
          <MartinaNote
            monogram={LEO}
            text={
              young
                ? `${account?.firstName ? `${account.firstName}, хочешь` : "Хочешь"} сыграть со мной партию? Я буду играть по-настоящему — без поддавков!`
                : "Хочешь сыграть со мной партию? Играю всерьёз, под твой уровень — и комментирую интересные ходы."
            }
          />
        </motion.div>
        <motion.div variants={rise} className="grid grid-cols-2 gap-2">
          <motion.button {...press} onClick={() => start("w")} className={primaryButton}>
            Да, играю белыми
          </motion.button>
          <motion.button {...press} onClick={() => start("b")} className={secondaryButton}>
            Играю чёрными
          </motion.button>
        </motion.div>
        <motion.p variants={rise} className="px-4 text-footnote text-dim">
          Сила Лео — под уровень «{levelLabel}». Белые ходят первыми.
        </motion.p>
      </motion.div>
    );
  }

  const history = game.history({ verbose: true });
  const lastMove = history.length ? `${history.at(-1)!.from}${history.at(-1)!.to}` : null;
  const kingSquare = game.inCheck()
    ? (game
        .board()
        .flat()
        .find((cell) => cell?.type === "k" && cell.color === game.turn())?.square ?? null)
    : null;
  const status = over
    ? over.result === "win"
      ? "Победа!"
      : over.result === "loss"
        ? "Победа Лео"
        : "Ничья"
    : thinking || leoTurn
      ? "Лео думает…"
      : game.inCheck()
        ? "Тебе шах — защищайся"
        : "Твой ход";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-footnote font-semibold text-champagne">
            Партия с Лео · ты {color === "w" ? "белыми" : "чёрными"}
          </p>
          <p className="text-headline font-semibold" aria-live="polite">
            {status}
          </p>
        </div>
        <span className="text-footnote tabular-nums text-dim">ход {Math.floor(history.length / 2) + 1}</span>
      </div>

      <ChessBoard
        fen={START}
        moves={saved.moves}
        orientation={color}
        movable={!over && !leoTurn && !thinking ? color : null}
        targets={(from) => game.moves({ square: from as Square, verbose: true }).map((move) => move.to)}
        lastMove={lastMove}
        checkSquare={kingSquare}
        wrong={wrong}
        disabled={!!over || leoTurn || thinking}
        onMove={play}
      />

      <AnimatePresence mode="wait">
        {saved.comment && (
          <motion.div
            key={saved.comment}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
          >
            <MartinaNote monogram={LEO} text={saved.comment} />
          </motion.div>
        )}
      </AnimatePresence>

      {!!history.length && (
        <div className="glass px-4 py-3">
          <p className="label pb-1">Ходы</p>
          <p className="text-subhead tabular-nums text-mist">
            {history.map((move, index) => `${index % 2 === 0 ? `${index / 2 + 1}. ` : ""}${ruSan(move.san)}`).join(" ")}
          </p>
        </div>
      )}

      {over ? (
        <div className="grid grid-cols-2 gap-2">
          <motion.button {...press} onClick={() => start("w")} className={primaryButton}>
            Белыми
          </motion.button>
          <motion.button {...press} onClick={() => start("b")} className={secondaryButton}>
            Чёрными
          </motion.button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <motion.button
            {...press}
            onClick={undo}
            disabled={leoTurn || thinking || saved.moves.length < (color === "b" ? 3 : 2)}
            className={secondaryButton}
          >
            Ход назад
          </motion.button>
          <motion.button {...press} onClick={resign} disabled={thinking} className={secondaryButton}>
            Сдаться
          </motion.button>
        </div>
      )}
    </div>
  );
}
