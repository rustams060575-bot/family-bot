import { Chess } from "chess.js";

// Движок Лео: альфа-бета с итеративным углублением, тихий поиск по взятиям,
// таблица транспозиций не нужна при этой глубине. Ходы генерирует chess.js через
// внутренний API (доска 0x88, _moves / _makeMove / _undoMove): публичный moves()
// на каждый ход строит SAN и две FEN-строки и медленнее в разы. Поэтому версия
// chess.js в package.json закреплена точно (1.0.0).
//
// оценка — материал + таблицы позиционных бонусов. Сила подстраивается под уровень
// ученика: глубина, время на ход и «запас», в пределах которого Лео выбирает среди
// почти равных ходов. Поддавков нет: Лео никогда не выбирает ход хуже лучшего
// больше чем на этот запас.

export type EngineLevel = "novice" | "amateur" | "strategist";

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100_000;

// Позиционные таблицы (с точки зрения белых, a8 → h1).
const PST: Record<string, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15,
    20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10,
    5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10,
    -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0,
    0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0,
    -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10,
    -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40,
    -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20,
    -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
  ],
  // Король в эндшпиле идёт в центр.
  kEnd: [
    -50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30,
    -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0,
    0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50,
  ],
};

type Piece = { type: string; color: "w" | "b" };
type IMove = { color: "w" | "b"; from: number; to: number; piece: string; captured?: string; promotion?: string };
type Internal = {
  _board: (Piece | undefined)[];
  _turn: "w" | "b";
  _halfMoves: number;
  _moves(options?: { legal?: boolean }): IMove[];
  _makeMove(move: IMove): void;
  _undoMove(): IMove | null;
  _isKingAttacked(color: "w" | "b"): boolean;
};
const internal = (game: Chess) => game as unknown as Internal;

const square = (sq: number) => `${"abcdefgh"[sq & 7]}${8 - (sq >> 4)}`;

// Оценка позиции с точки зрения белых, в сантипешках (доска 0x88: a8 = 0, h1 = 119).
function evaluateBoard(board: (Piece | undefined)[]) {
  let heavy = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const cell = board[sq];
    if (cell && (cell.type === "q" || cell.type === "r")) heavy += 1;
  }
  const endgame = heavy <= 2;
  let score = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const cell = board[sq];
    if (!cell) continue;
    const r = sq >> 4;
    const c = sq & 7;
    const index = cell.color === "w" ? r * 8 + c : (7 - r) * 8 + c;
    const table = cell.type === "k" && endgame ? PST.kEnd : PST[cell.type];
    const value = VALUE[cell.type] + table[index];
    score += cell.color === "w" ? value : -value;
  }
  return score;
}

export function evaluateWhite(game: Chess) {
  return evaluateBoard(internal(game)._board);
}

const sideScore = (raw: Internal) => (raw._turn === "w" ? 1 : -1) * evaluateBoard(raw._board);

// Порядок ходов: сначала выгодные взятия и превращения — альфа-бета отсекает больше.
function ordered(moves: IMove[]) {
  const weight = (move: IMove) =>
    (move.captured ? 10 * VALUE[move.captured] - VALUE[move.piece] : 0) + (move.promotion ? VALUE[move.promotion] : 0);
  return moves.sort((a, b) => weight(b) - weight(a));
}

type Search = { nodes: number; deadline: number; aborted: boolean };

function quiesce(raw: Internal, alpha: number, beta: number, search: Search, depth = 0): number {
  search.nodes += 1;
  const stand = sideScore(raw);
  if (stand >= beta) return beta;
  if (alpha < stand) alpha = stand;
  if (depth >= 6) return alpha;
  const captures = ordered(raw._moves().filter((move) => move.captured || move.promotion));
  for (const move of captures) {
    raw._makeMove(move);
    const score = -quiesce(raw, -beta, -alpha, search, depth + 1);
    raw._undoMove();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(raw: Internal, depth: number, alpha: number, beta: number, ply: number, search: Search): number {
  if ((search.nodes & 1023) === 0 && Date.now() > search.deadline) search.aborted = true;
  if (search.aborted) return 0;
  const moves = raw._moves();
  if (!moves.length) return raw._isKingAttacked(raw._turn) ? -MATE + ply : 0;
  if (raw._halfMoves >= 100) return 0;
  if (depth === 0) return quiesce(raw, alpha, beta, search);
  search.nodes += 1;
  for (const move of ordered(moves)) {
    raw._makeMove(move);
    const score = -negamax(raw, depth - 1, -beta, -alpha, ply + 1, search);
    raw._undoMove();
    if (search.aborted) return 0;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

const SETTINGS: Record<EngineLevel, { maxDepth: number; timeMs: number; margin: number }> = {
  novice: { maxDepth: 2, timeMs: 700, margin: 45 },
  amateur: { maxDepth: 3, timeMs: 1200, margin: 20 },
  strategist: { maxDepth: 5, timeMs: 2200, margin: 8 },
};

export type EngineResult = {
  move: string; // uci (e2e4, e7e8q)
  san: string;
  score: number; // оценка после хода с точки зрения Лео
  depth: number;
};

// Ключ позиции для повторений: расстановка, очередь хода, рокировки, взятие на проходе.
export const positionKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

// Выбор хода Лео. seen — ключи позиций, уже бывших в партии: повтор оценивается как
// ничья, поэтому при перевесе Лео не «топчется» на месте. random — для тестов.
export function chooseMove(
  fen: string,
  level: EngineLevel,
  random = Math.random,
  seen: string[] = [],
): EngineResult | null {
  const game = new Chess(fen);
  const raw = internal(game);
  const root = raw._moves();
  if (!root.length) return null;
  const settings = SETTINGS[level];
  const search: Search = { nodes: 0, deadline: Date.now() + settings.timeMs, aborted: false };
  let scored = ordered(root).map((move) => ({ move, score: 0 }));
  let reached = 0;

  // Итеративное углубление: результат последней полностью просчитанной глубины;
  // лучший ход прошлой итерации считается первым — альфа-бета отсекает больше.
  for (let depth = 1; depth <= settings.maxDepth; depth++) {
    const next: { move: IMove; score: number }[] = [];
    let alpha = -MATE - 1;
    for (const { move } of scored) {
      raw._makeMove(move);
      // Окно шире альфы на запас: ходы в пределах запаса нужны с точной оценкой.
      const score = -negamax(raw, depth - 1, -MATE - 1, -(alpha - settings.margin - 1), 1, search);
      raw._undoMove();
      if (search.aborted) break;
      next.push({ move, score });
      if (score > alpha) alpha = score;
    }
    if (search.aborted) break;
    scored = next.sort((a, b) => b.score - a.score);
    reached = depth;
    if (scored[0].score > MATE - 100) break; // нашёл мат — дальше не нужно
  }

  if (seen.length) {
    const repeated = new Set(seen);
    scored = scored
      .map((item) => {
        raw._makeMove(item.move);
        const repeats = repeated.has(positionKey(game.fen()));
        raw._undoMove();
        return repeats ? { ...item, score: Math.min(item.score, 0) } : item;
      })
      .sort((a, b) => b.score - a.score);
  }

  const best = scored[0].score;
  // Мат и защита от мата не размываются: только лучший ход.
  const margin = Math.abs(best) > MATE - 1000 ? 0 : settings.margin;
  const pool = scored.filter((item) => item.score >= best - margin);
  const pick = pool[Math.floor(random() * pool.length)] ?? scored[0];
  const uci = `${square(pick.move.from)}${square(pick.move.to)}${pick.move.promotion ?? ""}`;
  const san = game.move({ from: square(pick.move.from), to: square(pick.move.to), promotion: pick.move.promotion }).san;
  return { move: uci, san, score: pick.score, depth: reached };
}

// Быстрая оценка для комментариев: тихий поиск, с точки зрения белых.
export function quickEvalWhite(fen: string) {
  const game = new Chess(fen);
  const raw = internal(game);
  const search: Search = { nodes: 0, deadline: Date.now() + 200, aborted: false };
  if (!raw._moves().length) return raw._isKingAttacked(raw._turn) ? (raw._turn === "w" ? -MATE : MATE) : 0;
  const score = quiesce(raw, -MATE - 1, MATE + 1, search);
  return raw._turn === "w" ? score : -score;
}
