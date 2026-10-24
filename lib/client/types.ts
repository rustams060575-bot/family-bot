export type Role = "student" | "tutor" | "parent";
export type TrackId = "spanish" | "english" | "german" | "art" | "translate";
export type Plan = "free" | "premium";
export type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type ArtTask = { title: string; idea: string; steps: string[]; materials: string; givenAt: string };

export type Account = {
  firstName: string;
  role: Role | null;
  track: TrackId | null;
  plan: Plan;
  // VIP (Атахан и др.): Premium без оплаты и срока, персональный тон ассистента.
  vip: boolean;
  // Детский профиль (Атахан): Мартина в игровом режиме, SF Pro Rounded, без исправлений.
  kid: boolean;
  // Последнее творческое задание Мартины в Kids Art (разбор рисунка учитывает его).
  artTask: ArtTask | null;
  // Мальчик или девочка — для обращения в нужном роде; null — ещё не указано.
  gender: "boy" | "girl" | null;
  // Заявку только что одобрили — показать праздничный поп-ап (один раз).
  celebrate: boolean;
  // Уровень по CEFR в языковых треках (тест уровня или выбор вручную).
  levels: { spanish: Level | null; english: Level | null; german: Level | null };
  // Администратор школы: доступ к /admin. Супер-админ (@r_design_space) получает заявки.
  admin: boolean;
  superAdmin: boolean;
  // Закрытая школа: approved — полный доступ; pending — заявка ждёт решения.
  access: "none" | "pending" | "approved" | "rejected";
  // После отказа — когда можно подать заявку снова.
  reapplyAt: string | null;
  premiumUntil: string | null;
  usage: { ai: number; art: number };
  // ai: null — без дневного лимита.
  // art: всегда null — разборы рисунков безлимитны.
  limits: { ai: number | null; art: null };
  streak: { count: number; activeToday: boolean };
  reminders: { enabled: boolean; hour: number };
};

export type Offer = {
  priceStars: number | null;
  days: number;
  limits: Record<Plan, { ai: number | null; art: null }>;
};

export type Features = { vision: boolean };

export type Lesson = { id: string; date: string; topic: string; note: string; mood: "great" | "ok" | "hard" };

export type Student = {
  id: string;
  name: string;
  age: number | null;
  subject: string;
  goal: string;
  createdAt: string;
  lessons: Lesson[];
};

export type MeResponse = { account: Account; features: Features; offer: Offer };
