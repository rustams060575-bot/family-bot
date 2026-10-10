export type Role = "student" | "tutor" | "parent";
export type TrackId = "spanish" | "english" | "art" | "translate";
export type Plan = "free" | "premium";

export type Account = {
  firstName: string;
  role: Role | null;
  track: TrackId | null;
  plan: Plan;
  // VIP (Атахан и др.): Premium без оплаты и срока, персональный тон ассистента.
  vip: boolean;
  premiumUntil: string | null;
  usage: { ai: number; art: number };
  // ai: null — без дневного лимита.
  limits: { ai: number | null; art: number };
  streak: { count: number; activeToday: boolean };
  reminders: { enabled: boolean; hour: number };
};

export type Offer = {
  priceStars: number | null;
  days: number;
  limits: Record<Plan, { ai: number | null; art: number }>;
};

export type Features = { tts: boolean; vision: boolean };

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
