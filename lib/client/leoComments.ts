// Комментарии Лео во время партии. Строятся по фактам позиции (взятие, шах, рокировка,
// превращение) и по оценке движка до и после хода — поэтому всегда шахматно верны и не
// тратят запросы к ИИ. Малышам (4–7) — образно и без нотации, школьникам — с нотацией.

export type MoveFacts = {
  san: string;
  piece: string;
  captured?: string;
  promotion?: string;
  flags: string;
};

const ACCUSATIVE: Record<string, string> = { p: "пешку", n: "коня", b: "слона", r: "ладью", q: "ферзя", k: "короля" };
const MY: Record<string, string> = {
  p: "мою пешку",
  n: "моего коня",
  b: "моего слона",
  r: "мою ладью",
  q: "моего ферзя",
};
const RU_PIECE: Record<string, string> = { K: "Кр", Q: "Ф", R: "Л", B: "С", N: "К" };

// e4, Nf3 → Кf3, O-O остаётся O-O — так пишут в русских шахматных книгах.
export function ruSan(san: string) {
  return san
    .replace(/^[KQRBN]/, (letter) => RU_PIECE[letter])
    .replace(/=([QRBN])/, (_, letter) => `=${RU_PIECE[letter]}`);
}

const castles = (move: MoveFacts) => move.flags.includes("k") || move.flags.includes("q");
const pick = <T>(list: T[], seed: number) => list[seed % list.length];

type Context = {
  young: boolean;
  player: MoveFacts;
  leo: MoveFacts | null;
  // Оценка с точки зрения ученика (сантипешки): до его хода и после ответа Лео.
  before: number;
  afterPlayer: number;
  afterLeo: number;
  plies: number;
  leoMates: boolean;
  leoChecks: boolean;
};

export function leoComment(context: Context) {
  const { young, player, leo, before, afterPlayer, afterLeo, plies } = context;
  const parts: string[] = [];
  const swing = afterPlayer - before;

  // Ход ученика.
  if (player.captured && swing >= 200) {
    parts.push(
      young ? `Ух ты, ты забрал ${MY[player.captured]}! Хитро!` : `Сильно: ${ruSan(player.san)} выигрывает материал.`,
    );
  } else if (swing <= -250) {
    parts.push(
      young
        ? "Осторожно! Перед ходом проверь: кто защищает твои фигуры?"
        : `Неточно: после ${ruSan(player.san)} теряется материал. Перед ходом проверяй, что атакует соперник.`,
    );
  } else if (castles(player)) {
    parts.push(young ? "Король спрятался в замок — умно!" : "Рокировка вовремя — король в безопасности.");
  } else if (player.promotion) {
    parts.push(young ? "Твоя пешка стала ферзём — вот это превращение!" : "Пешка прошла в ферзи — серьёзный аргумент.");
  } else if (plies <= 2 && /^[de][45]$/.test(player.san)) {
    parts.push(young ? "Пешка вышла в самый центр — отличное начало!" : "Классика: занимаешь центр с первого хода.");
  } else if (player.san.includes("+")) {
    parts.push(young ? "Шах! Смело!" : "Шах — инициатива у тебя.");
  }

  // Ответ Лео.
  if (leo) {
    if (context.leoMates) {
      parts.push(
        young
          ? "Мат! Спасибо за игру — ты сражался как настоящий рыцарь. Сыграем ещё?"
          : `${ruSan(leo.san)} — мат. Хороший бой! Разберём, где можно было усилиться, и в бой снова?`,
      );
    } else if (leo.captured) {
      parts.push(
        young ? `А я забираю ${ACCUSATIVE[leo.captured]}!` : `Забираю ${ACCUSATIVE[leo.captured]}: ${ruSan(leo.san)}.`,
      );
    } else if (context.leoChecks) {
      parts.push(young ? "Шах твоему королю! Как спасёшься?" : `${ruSan(leo.san)} — шах. Как будешь защищаться?`);
    } else if (castles(leo)) {
      parts.push(young ? "А я прячу своего короля в замок." : "Я рокирую — король в безопасности, ладьи связаны.");
    } else if (leo.promotion) {
      parts.push(young ? "Моя пешка тоже стала ферзём!" : `${ruSan(leo.san)} — у меня новый ферзь.`);
    } else if (afterLeo <= -300 && plies % 6 < 2) {
      parts.push(
        pick(
          young
            ? ["У меня сейчас больше сил, но ты ещё можешь отыграться!", "Я впереди, но не сдавайся — ищи хитрый ход!"]
            : [
                "У меня перевес, но партия не окончена — ищи контригру.",
                "Позиция за мной. Попробуй создать угрозы королю.",
              ],
          plies,
        ),
      );
    } else if (afterLeo >= 300 && plies % 6 < 2) {
      parts.push(
        pick(
          young
            ? ["Ты меня теснишь! Придётся защищаться изо всех сил.", "Ого, ты сильнее сейчас — держусь!"]
            : ["Ты давишь — придётся защищаться точно.", "У тебя перевес. Реализуй его: размены в твою пользу."],
          plies,
        ),
      );
    }
  }
  return parts.join(" ") || null;
}

export function resultComment(result: "win" | "loss" | "draw", young: boolean, reason: string) {
  if (result === "win") {
    return young
      ? "Мат! Ты победил меня! Вот это игра — я горжусь тобой. Реванш?"
      : "Мат — чистая победа. Снимаю шляпу. Реванш?";
  }
  if (result === "loss") {
    return reason === "resign"
      ? young
        ? "Ничего, сдаться — тоже смелый шаг. Сыграем ещё раз? Я верю, что ты меня обыграешь!"
        : "Партия за мной. Сдаться в проигранной позиции — по-взрослому. Ещё одну?"
      : young
        ? "Мат! Но ты сражался храбро. Давай ещё — я покажу тебе новый приём!"
        : "Мат. Хороший бой — в следующей партии следи за безопасностью короля.";
  }
  return young
    ? "Ничья — никто не проиграл! Отличная битва."
    : `Ничья${reason ? ` (${reason})` : ""}. Достойная партия.`;
}
