"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { exit, spring } from "@/lib/motion";

// Доска Лео: позиция из FEN (+ последовательность ходов), ход — касание своей фигуры,
// затем клетки назначения. Правила проверяет вызывающий код (сервер для задач, chess.js
// для партии); доска показывает и переставляет фигуры: рокировка, взятие на проходе и
// превращение отрисовываются верно.

type Color = "w" | "b";
type Piece = { id: string; type: string; color: Color; square: string };

const FILES = "abcdefgh";
// Заполненные глифы для обеих сторон — цвет задаёт CSS; U+FE0E — текстовое, не эмодзи-начертание.
const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const NAME: Record<string, string> = { k: "король", q: "ферзь", r: "ладья", b: "слон", n: "конь", p: "пешка" };

export function parseFen(fen: string) {
  const [placement, turn = "w"] = fen.split(" ");
  const pieces: Piece[] = [];
  placement.split("/").forEach((row, rowIndex) => {
    let file = 0;
    for (const char of row) {
      if (/\d/.test(char)) {
        file += Number(char);
        continue;
      }
      const square = `${FILES[file]}${8 - rowIndex}`;
      pieces.push({ id: square, type: char.toLowerCase(), color: char === char.toUpperCase() ? "w" : "b", square });
      file += 1;
    }
  });
  return { pieces, turn: turn as Color };
}

// Переставляет фигуры по ходу «откуда-куда» с учётом особых ходов.
export function applyMove(pieces: Piece[], uci: string): Piece[] {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const mover = pieces.find((piece) => piece.square === from);
  if (!mover) return pieces;
  let next = pieces.filter((piece) => piece.square !== to);
  const fileDelta = FILES.indexOf(to[0]) - FILES.indexOf(from[0]);
  // Взятие на проходе: пешка ушла по диагонали на пустую клетку.
  if (mover.type === "p" && fileDelta !== 0 && !pieces.some((piece) => piece.square === to)) {
    next = next.filter((piece) => piece.square !== `${to[0]}${from[1]}`);
  }
  // Рокировка: король шагнул на две клетки — ладья перепрыгивает через него.
  if (mover.type === "k" && Math.abs(fileDelta) === 2) {
    const rookFrom = `${fileDelta > 0 ? "h" : "a"}${from[1]}`;
    const rookTo = `${fileDelta > 0 ? "f" : "d"}${from[1]}`;
    next = next.map((piece) => (piece.square === rookFrom ? { ...piece, square: rookTo } : piece));
  }
  const promotes = mover.type === "p" && (to[1] === "8" || to[1] === "1");
  const promotion = /^[qrbn]$/.test(uci[4] ?? "") ? uci[4] : "q";
  return next.map((piece) =>
    piece.id === mover.id ? { ...piece, square: to, type: promotes ? promotion : piece.type } : piece,
  );
}

type Props = {
  fen: string;
  // Показать позицию после хода (решение или ход ученика).
  move?: string | null;
  // Партия: все ходы от начальной позиции по порядку.
  moves?: string[];
  // Чья сторона внизу; по умолчанию — та, что ходит в исходной позиции.
  orientation?: Color;
  // Чьи фигуры можно двигать (null — ничьи); по умолчанию — сторона из FEN.
  movable?: Color | null;
  // Допустимые клетки для выбранной фигуры — точки-подсказки и фильтр выбора.
  targets?: (from: string) => string[];
  lastMove?: string | null;
  // Клетка короля под шахом.
  checkSquare?: string | null;
  // Клетки-подсказки: откуда и куда шёл верный ход.
  marks?: string[];
  // Клетка неверного хода — коротко подсвечивается.
  wrong?: string | null;
  disabled?: boolean;
  onMove?: (uci: string) => void;
};

export default function ChessBoard({
  fen,
  move,
  moves,
  orientation,
  movable,
  targets,
  lastMove,
  checkSquare,
  marks = [],
  wrong,
  disabled,
  onMove,
}: Props) {
  const initial = useMemo(() => parseFen(fen), [fen]);
  const sequence = useMemo(() => moves ?? (move ? [move] : []), [moves, move]);
  const pieces = useMemo(() => sequence.reduce(applyMove, initial.pieces), [initial, sequence]);
  const [selected, setSelected] = useState<string | null>(null);
  const side = movable === undefined ? initial.turn : movable;
  const flip = (orientation ?? initial.turn) === "b";

  useEffect(() => setSelected(null), [fen, sequence, disabled]);
  const hints = selected && targets ? targets(selected) : [];

  const bySquare = new Map(pieces.map((piece) => [piece.square, piece]));
  const ranks = flip ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = flip ? FILES.split("").reverse() : FILES.split("");
  const position = (square: string) => {
    const col = files.indexOf(square[0]);
    const row = ranks.indexOf(Number(square[1]));
    return { left: `${col * 12.5}%`, top: `${row * 12.5}%` };
  };

  function tap(square: string) {
    if (disabled || !onMove || !side) return;
    const piece = bySquare.get(square);
    if (piece && piece.color === side && !(selected && hints.includes(square))) {
      // Фигура без единого хода не выбирается — сразу понятно, что ей некуда идти.
      if (targets && !targets(square).length) return;
      setSelected(square === selected ? null : square);
      return;
    }
    if (selected) {
      onMove(`${selected}${square}`);
      setSelected(null);
    }
  }

  return (
    <div
      className="relative aspect-square w-full overflow-hidden rounded-[0.875rem]"
      role="grid"
      aria-label={`Шахматная доска${side ? `, ходят ${side === "w" ? "белые" : "чёрные"}` : ""}`}
    >
      <div className="grid h-full w-full grid-cols-8 grid-rows-8">
        {ranks.map((rank, rowIndex) =>
          files.map((file, colIndex) => {
            const square = `${file}${rank}`;
            const dark = (FILES.indexOf(file) + rank) % 2 === 1; // a1 — тёмное поле
            const piece = bySquare.get(square);
            const label = piece ? `${square}, ${piece.color === "w" ? "белый" : "чёрный"} ${NAME[piece.type]}` : square;
            return (
              <button
                key={square}
                type="button"
                onClick={() => tap(square)}
                disabled={disabled}
                aria-label={label}
                aria-pressed={selected === square}
                className={`relative ${dark ? "chess-dark" : "chess-light"} disabled:cursor-default`}
                style={{ transform: "none" }}
              >
                {lastMove && (lastMove.slice(0, 2) === square || lastMove.slice(2, 4) === square) && (
                  <span className="absolute inset-0 bg-champagne/30" />
                )}
                {marks.includes(square) && <span className="absolute inset-0 bg-champagne/45" />}
                {checkSquare === square && (
                  <span className="absolute inset-0 bg-[radial-gradient(circle,rgb(var(--danger)/0.55)_0%,transparent_70%)]" />
                )}
                {hints.includes(square) && (
                  <span
                    className={`absolute inset-0 m-auto rounded-full ${
                      piece
                        ? "h-full w-full shadow-[inset_0_0_0_3px_rgb(28_28_30/0.45)]"
                        : "h-[28%] w-[28%] bg-[rgb(28_28_30/0.28)]"
                    }`}
                  />
                )}
                {wrong === square && <span className="absolute inset-0 bg-danger/40" />}
                {selected === square && (
                  <span className="absolute inset-0 shadow-[inset_0_0_0_3px_rgb(28_28_30/0.7)]" />
                )}
                {colIndex === 0 && (
                  <span
                    className={`absolute left-[3px] top-[2px] text-caption2 font-semibold ${
                      dark ? "text-[rgb(236_226_206)]" : "text-[rgb(140_112_70)]"
                    }`}
                  >
                    {rank}
                  </span>
                )}
                {rowIndex === 7 && (
                  <span
                    className={`absolute bottom-[1px] right-[3px] text-caption2 font-semibold ${
                      dark ? "text-[rgb(236_226_206)]" : "text-[rgb(140_112_70)]"
                    }`}
                  >
                    {file}
                  </span>
                )}
              </button>
            );
          }),
        )}
      </div>

      {/* Фигуры — отдельный слой: при ходе они переезжают пружиной, а не перескакивают */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <AnimatePresence initial={false}>
          {pieces.map((piece) => (
            <motion.span
              key={piece.id}
              initial={false}
              animate={{ ...position(piece.square), opacity: 1, transition: spring }}
              exit={{ opacity: 0, transition: exit }}
              className={`chess-piece absolute grid h-[12.5%] w-[12.5%] place-items-center text-[min(9.5vw,2.75rem)] ${
                piece.color === "w" ? "chess-piece-w" : "chess-piece-b"
              }`}
            >
              {piece.type === "p" ? <Pawn white={piece.color === "w"} /> : GLYPH[piece.type]}
              {piece.type !== "p" && "︎"}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Пешка — векторный силуэт: глиф ♟ на iOS и в Telegram рисуется эмодзи и остаётся
// чёрным при любом цвете. Заливка — цвет стороны, у белой — тонкая тёмная обводка.
function Pawn({ white }: { white: boolean }) {
  return (
    <svg
      viewBox="0 0 45 45"
      className="h-[78%] w-[78%]"
      fill="currentColor"
      stroke={white ? "rgb(28 28 30)" : "none"}
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <circle cx="22.5" cy="12" r="5" />
      <path d="M17.5 18.5h10a1.5 1.5 0 0 1 0 3h-10a1.5 1.5 0 0 1 0-3z" />
      <path d="M18.5 21.5h8c.5 4.5 2.5 8.5 5 12.5h-18c2.5-4 4.5-8 5-12.5z" />
      <path d="M12 34h21a1.75 1.75 0 0 1 0 3.5H12a1.75 1.75 0 0 1 0-3.5z" />
    </svg>
  );
}
