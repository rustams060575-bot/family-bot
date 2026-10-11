import { chooseMove, type EngineLevel } from "./chessEngine";

// Лео думает в отдельном потоке: поиск до 2 секунд не замораживает интерфейс и анимации.
type Request = { id: number; fen: string; level: EngineLevel; seen: string[] };

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, fen, level, seen } = event.data;
  let result = null;
  try {
    result = chooseMove(fen, level, Math.random, seen);
  } catch {
    result = null;
  }
  self.postMessage({ id, result });
};
