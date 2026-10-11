"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import { apiJson } from "@/lib/client/api";
import { ROLES, trackById } from "@/lib/client/tracks";
import type { Plan, Role, TrackId } from "@/lib/client/types";
import { enter, exit, press, rise, spring, stagger } from "@/lib/motion";

type UserRow = {
  id: string;
  name: string;
  lastName: string;
  username: string | null;
  role: Role | null;
  track: TrackId | null;
  plan: Plan;
  vip: boolean;
  admin: boolean;
  access: "none" | "pending" | "approved" | "rejected";
  requestedAt: string | null;
  note: string;
  decidedBy: string | null;
  premiumUntil: string | null;
  usage: { ai: number; art: number };
  streak: number;
  activeToday: boolean;
  lastActiveDate: string | null;
  students: number;
  createdAt: string;
};

type Overview = {
  totals: { pending: number; users: number; activeToday: number; premium: number; vip: number; lessonsToday: number; artToday: number };
  users: UserRow[];
};

type Filter = "all" | "today" | "premium" | "free";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "today", label: "Сегодня" },
  { id: "premium", label: "Premium" },
  { id: "free", label: "Free" },
];

const ACCESS_LABEL = { none: "Без заявки", pending: "Заявка", approved: "Одобрен", rejected: "Отказ" } as const;

function shortDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export default function AdminPanel() {
  const { haptic, handleError } = useApp();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiJson<Overview>("/api/admin"));
    } catch (err) {
      setError(handleError(err));
    }
  }, [handleError]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(userId: string, action: "grant" | "revoke" | "approve" | "reject") {
    haptic("medium");
    setBusyId(userId);
    try {
      setData(await apiJson<Overview>("/api/admin", { action, userId, days: 30 }));
      haptic("success");
    } catch (err) {
      setError(handleError(err));
    } finally {
      setBusyId(null);
    }
  }

  const users = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, "");
    return (data?.users ?? []).filter((user) => {
      if (filter === "today" && !user.activeToday) return false;
      if (filter === "premium" && user.plan !== "premium") return false;
      if (filter === "free" && user.plan !== "free") return false;
      if (!q) return true;
      return [user.name, user.lastName, user.username ?? "", user.id].some((field) => field.toLowerCase().includes(q));
    });
  }, [data, filter, query]);

  if (error && !data) return <p className="glass p-6 text-body text-danger">{error}</p>;

  const totals = data?.totals;
  const applications = (data?.users ?? []).filter((user) => user.access === "pending");
  const tiles = [
    { value: totals?.pending, label: "заявок" },
    { value: totals?.users, label: "в школе" },
    { value: totals?.activeToday, label: "активны сегодня" },
    { value: totals?.premium, label: "Premium" },
    { value: totals?.vip, label: "VIP" },
    { value: totals?.lessonsToday, label: "занятий сегодня" },
  ];

  return (
    <div>
      <motion.div variants={stagger()} initial="hidden" animate="show" className="grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <motion.div key={tile.label} variants={rise} className="glass p-4">
            <p className="text-title2 font-bold lining-nums tabular-nums">{tile.value ?? "—"}</p>
            <p className="label mt-2">{tile.label}</p>
          </motion.div>
        ))}
      </motion.div>

      {/* Заявки в закрытую школу — первым блоком, пока есть необработанные */}
      <AnimatePresence initial={false}>
        {applications.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
            className="mt-6 space-y-2"
          >
            <p className="label">Заявки на вступление</p>
            {applications.map((user) => (
              <motion.div key={user.id} layout="position" transition={spring} className="glass glass-accent space-y-4 p-4">
                <div>
                  <p className=" text-body font-medium text-paper">
                    {[user.name, user.lastName].filter(Boolean).join(" ") || "Без имени"}
                  </p>
                  <p className="text-body text-mist">
                    {user.username ? `@${user.username}` : `ID ${user.id}`} · {ROLES.find((r) => r.id === user.role)?.title ?? "—"} ·{" "}
                    {trackById(user.track)?.name ?? "—"}
                  </p>
                  {user.note && <p className="mt-2 text-body text-paper/90">«{user.note}»</p>}
                  <p className="label mt-2">{shortDate(user.requestedAt)}</p>
                </div>
                <div className="flex gap-2">
                  <motion.button
                    {...press}
                    disabled={busyId === user.id}
                    onClick={() => act(user.id, "approve")}
                    className="min-h-14 flex-1 rounded-[0.875rem] bg-paper px-4 text-headline font-semibold text-ink disabled:opacity-40"
                  >
                    Принять
                  </motion.button>
                  <motion.button
                    {...press}
                    disabled={busyId === user.id}
                    onClick={() => act(user.id, "reject")}
                    className="min-h-14 rounded-[0.875rem] bg-fill px-6 text-body font-semibold text-champagne disabled:opacity-40"
                  >
                    Отклонить
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </motion.section>
        )}
      </AnimatePresence>

      <div className="mt-6 space-y-2">
        <input
          className="field"
          placeholder="Поиск: имя, @username, ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="grid grid-cols-4 gap-1 rounded-full bg-fill p-1">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                haptic("selection");
                setFilter(item.id);
              }}
              className="relative min-h-11 rounded-full"
              aria-pressed={filter === item.id}
            >
              {filter === item.id && <motion.span layoutId="admin-filter" transition={spring} className="absolute inset-0 rounded-full segment-thumb" />}
              <span className={`relative text-subhead font-medium ${filter === item.id ? "text-paper" : "text-dim"}`}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-4 text-center text-body text-danger">{error}</p>}

      <div className="mt-6 space-y-2">
        {data && users.length === 0 && <p className="glass p-6 text-body text-mist">Никого не найдено.</p>}
        {users.map((user) => {
          const open = openId === user.id;
          const role = ROLES.find((item) => item.id === user.role)?.title ?? "Без роли";
          const track = trackById(user.track)?.name.replace("ATA ", "") ?? "—";
          return (
            <motion.div key={user.id} layout="position" transition={spring} className="glass overflow-hidden">
              <button
                onClick={() => {
                  haptic("selection");
                  setOpenId(open ? null : user.id);
                }}
                aria-expanded={open}
                className="flex min-h-[4.5rem] w-full items-center gap-4 p-4 text-left"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[0.875rem] bg-fill text-title3 font-semibold text-champagne">
                  {(user.name || "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-paper">
                    {[user.name, user.lastName].filter(Boolean).join(" ") || "Без имени"}
                  </span>
                  <span className="block truncate text-body text-mist">
                    {user.username ? `@${user.username}` : `ID ${user.id}`} · {role}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-[0.64rem] font-medium uppercase ${
                    user.plan === "premium" ? "bg-champagne/15 text-champagne" : "bg-fill text-dim"
                  }`}
                >
                  {user.admin ? "Админ" : user.vip ? "VIP" : user.access !== "approved" ? ACCESS_LABEL[user.access] : user.plan === "premium" ? "Premium" : "Free"}
                </span>
              </button>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1, transition: enter }}
                    exit={{ height: 0, opacity: 0, transition: exit }}
                  >
                    <div className="space-y-4 px-4 pb-6">
                      <div className="hairline" />
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body">
                        {[
                          ["Трек", track],
                          ["Стрик", String(user.streak)],
                          ["Занятий сегодня", String(user.usage.ai)],
                          ["Рисунков сегодня", String(user.usage.art)],
                          ["Был активен", shortDate(user.lastActiveDate)],
                          ["В академии с", shortDate(user.createdAt)],
                          ["Учеников в CRM", String(user.students)],
                          ["Premium до", user.vip ? "без срока (VIP)" : shortDate(user.premiumUntil)],
                          ["Доступ", user.admin || user.vip ? "по роли" : `${ACCESS_LABEL[user.access]}${user.decidedBy ? ` · ${user.decidedBy}` : ""}`],
                        ].map(([term, value]) => (
                          <div key={term}>
                            <dt className="label">{term}</dt>
                            <dd className="lining-nums text-paper">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      {user.access === "approved" && !user.admin && !user.vip && (
                        <motion.button
                          {...press}
                          disabled={busyId === user.id}
                          onClick={() => act(user.id, "reject")}
                          className="min-h-11 w-full text-subhead font-medium text-dim"
                        >
                          Закрыть доступ к школе
                        </motion.button>
                      )}
                      {user.access === "rejected" && (
                        <motion.button
                          {...press}
                          disabled={busyId === user.id}
                          onClick={() => act(user.id, "approve")}
                          className="min-h-14 w-full rounded-[0.875rem] bg-fill px-4 text-body text-paper disabled:opacity-40"
                        >
                          Открыть доступ
                        </motion.button>
                      )}
                      {!user.vip && (
                        <div className="flex gap-2">
                          <motion.button
                            {...press}
                            disabled={busyId === user.id}
                            onClick={() => act(user.id, "grant")}
                            className="min-h-14 flex-1 rounded-[0.875rem] bg-paper px-4 text-headline font-semibold text-ink disabled:opacity-40"
                          >
                            {user.premiumUntil ? "Продлить на 30 дней" : "Выдать Premium · 30 дн."}
                          </motion.button>
                          {user.premiumUntil && (
                            <motion.button
                              {...press}
                              disabled={busyId === user.id}
                              onClick={() => act(user.id, "revoke")}
                              className="min-h-14 rounded-[0.875rem] bg-fill px-4 text-body font-semibold text-champagne disabled:opacity-40"
                            >
                              Снять
                            </motion.button>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
