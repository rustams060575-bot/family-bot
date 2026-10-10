"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import { apiJson } from "@/lib/client/api";
import type { Lesson, Role, Student } from "@/lib/client/types";
import { enter, exit, press, rise, spring, stagger } from "@/lib/motion";

// Тексты CRM под роль владельца: репетитор ведёт учеников, родитель — детей,
// ученик — собственные предметы.
export const CRM_COPY: Record<
  Role,
  { title: string; accent: string; person: string; add: string; empty: string; count: [string, string, string] }
> = {
  tutor: { title: "Мои", accent: "ученики", person: "Ученик", count: ["ученик", "ученика", "учеников"], add: "Добавить ученика", empty: "Добавьте первого ученика — любой предмет и возраст." },
  parent: { title: "Мои", accent: "дети", person: "Ребёнок", count: ["ребёнок", "ребёнка", "детей"], add: "Добавить ребёнка", empty: "Добавьте ребёнка и предмет, которым занимаетесь дома." },
  student: { title: "Мои", accent: "предметы", person: "Ученик", count: ["предмет", "предмета", "предметов"], add: "Добавить предмет", empty: "Добавьте предмет, который изучаете, — ассистент поможет с планом." },
};

const SUBJECT_HINTS = [
  "Математика",
  "Английский",
  "Испанский",
  "Русский язык",
  "Узбекский язык",
  "Чтение",
  "Рисование",
  "Музыка",
  "Шахматы",
  "Программирование",
  "Физика",
  "Подготовка к школе",
];

const MOODS: { id: Lesson["mood"]; label: string }[] = [
  { id: "great", label: "Легко" },
  { id: "ok", label: "Нормально" },
  { id: "hard", label: "Трудно" },
];

function plural(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function ageLabel(age: number | null) {
  return age === null ? null : `${age} ${plural(age, ["год", "года", "лет"])}`;
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

const chip = "min-h-11 rounded-full px-4 font-sans text-label font-medium uppercase tracking-[0.12em]";
const primaryButton = "min-h-14 w-full rounded-2xl bg-paper px-6 font-sans text-body font-medium text-ink disabled:opacity-40";
const quietButton = "min-h-14 rounded-2xl bg-tint/[0.06] px-6 font-sans text-body text-mist disabled:opacity-40";

export default function CrmPanel() {
  const { account, haptic, handleError, refresh } = useApp();
  const [students, setStudents] = useState<Student[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = CRM_COPY[account?.role ?? "tutor"];

  const load = useCallback(async () => {
    try {
      const data = await apiJson<{ students: Student[] }>("/api/crm");
      setStudents(data.students);
    } catch (err) {
      setError(handleError(err));
      setStudents([]);
    }
  }, [handleError]);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      setError(null);
      try {
        const data = await apiJson<{ students: Student[] }>("/api/crm", payload);
        setStudents(data.students);
        haptic("success");
        return true;
      } catch (err) {
        setError(handleError(err));
        return false;
      }
    },
    [haptic, handleError],
  );

  const stats = useMemo(() => {
    const list = students ?? [];
    const weekAgo = Date.now() - 7 * 86_400_000;
    return {
      people: list.length,
      week: list.reduce((sum, s) => sum + s.lessons.filter((l) => Date.parse(l.date) > weekAgo).length, 0),
      subjects: new Set(list.map((s) => s.subject.toLowerCase())).size,
    };
  }, [students]);

  return (
    <div>
      <motion.div variants={stagger()} initial="hidden" animate="show" className="grid grid-cols-3 gap-2">
        {[
          { value: stats.people, label: plural(stats.people, copy.count) },
          { value: stats.week, label: `${plural(stats.week, ["занятие", "занятия", "занятий"])} за неделю` },
          { value: stats.subjects, label: plural(stats.subjects, ["предмет", "предмета", "предметов"]) },
        ].map((tile) => (
          <motion.div key={tile.label} variants={rise} className="glass p-4">
            <p className="font-serif text-h2 font-light lining-nums tabular-nums">{students === null ? "—" : tile.value}</p>
            <p className="label mt-2 tracking-[0.12em]">{tile.label}</p>
          </motion.div>
        ))}
      </motion.div>

      <AnimatePresence mode="wait" initial={false}>
        {adding ? (
          <StudentForm
            key="form"
            title={copy.add}
            onCancel={() => setAdding(false)}
            onSubmit={async (data) => {
              if (await mutate({ action: "add", data })) setAdding(false);
            }}
          />
        ) : (
          <motion.button
            key="add"
            {...press}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
            onClick={() => {
              haptic("light");
              setAdding(true);
            }}
            className={`${primaryButton} mt-4`}
          >
            {copy.add}
          </motion.button>
        )}
      </AnimatePresence>

      {error && <p className="mt-4 text-center text-body text-danger">{error}</p>}

      <div className="mt-6 space-y-2">
        {students?.length === 0 && !adding && (
          <motion.p variants={rise} initial="hidden" animate="show" className="glass p-6 text-body text-mist">
            {copy.empty}
          </motion.p>
        )}
        {students?.map((student) => (
          <StudentCard
            key={student.id}
            student={student}
            open={openId === student.id}
            onToggle={() => {
              haptic("selection");
              setOpenId(openId === student.id ? null : student.id);
            }}
            mutate={mutate}
            onAiUsed={refresh}
          />
        ))}
      </div>
    </div>
  );
}

function StudentForm({
  title,
  onCancel,
  onSubmit,
}: {
  title: string;
  onCancel: () => void;
  onSubmit: (data: { name: string; age: number | null; subject: string; goal: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [subject, setSubject] = useState("");
  const [goal, setGoal] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = name.trim() && subject.trim();

  return (
    <motion.form
      initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: enter }}
      exit={{ opacity: 0, y: -8, transition: exit }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!valid) return;
        setSaving(true);
        await onSubmit({ name, age: age ? Number(age) : null, subject, goal });
        setSaving(false);
      }}
      className="glass mt-4 space-y-4 p-6"
    >
      <p className="label">{title}</p>
      <input className="field" placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
      <input
        className="field"
        placeholder="Возраст (необязательно)"
        inputMode="numeric"
        value={age}
        onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
      />
      <div>
        <input className="field" placeholder="Предмет — любой" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={60} />
        <div className="no-scrollbar -mx-6 mt-2 overflow-x-auto px-6">
          <div className="flex w-max gap-2">
            {SUBJECT_HINTS.map((hint) => (
              <button
                type="button"
                key={hint}
                onClick={() => setSubject(hint)}
                className={`${chip} ${subject === hint ? "bg-paper text-ink" : "bg-tint/[0.06] text-mist"}`}
              >
                {hint}
              </button>
            ))}
          </div>
        </div>
      </div>
      <input className="field" placeholder="Цель (необязательно)" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={160} />
      <div className="flex gap-2 pt-2">
        <motion.button type="button" {...press} onClick={onCancel} className={quietButton}>
          Отмена
        </motion.button>
        <motion.button type="submit" {...press} disabled={!valid || saving} className={`${primaryButton} flex-1`}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </motion.button>
      </div>
    </motion.form>
  );
}

function StudentCard({
  student,
  open,
  onToggle,
  mutate,
  onAiUsed,
}: {
  student: Student;
  open: boolean;
  onToggle: () => void;
  mutate: (payload: Record<string, unknown>) => Promise<boolean>;
  onAiUsed: () => void;
}) {
  const { haptic, handleError } = useApp();
  const [topic, setTopic] = useState("");
  const [note, setNote] = useState("");
  const [mood, setMood] = useState<Lesson["mood"]>("ok");
  const [plan, setPlan] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const last = student.lessons[0];
  const meta = [ageLabel(student.age), student.subject].filter(Boolean).join(" · ");

  async function makePlan() {
    haptic("medium");
    setPlanning(true);
    setPlanError(null);
    try {
      const { reply } = await apiJson<{ reply: string }>("/api/chat", {
        track: "crm",
        studentId: student.id,
        messages: [{ role: "user", content: "Составь план следующего занятия." }],
      });
      setPlan(reply);
      onAiUsed();
    } catch (err) {
      setPlanError(handleError(err));
    } finally {
      setPlanning(false);
    }
  }

  return (
    <motion.div layout="position" transition={spring} className="glass overflow-hidden">
      <button onClick={onToggle} className="flex min-h-[4.5rem] w-full items-center gap-4 p-4 text-left" aria-expanded={open}>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-tint/[0.06] font-serif text-h3 italic text-champagne">
          {student.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-sans text-body font-medium text-paper">{student.name}</span>
          <span className="block truncate text-body text-mist">{meta}</span>
        </span>
        <span className="text-right">
          <span className="block font-serif text-lead lining-nums tabular-nums">{student.lessons.length}</span>
          <span className="label block text-[0.64rem] tracking-[0.12em]">{last ? shortDate(last.date) : "нет занятий"}</span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transition: enter }}
            exit={{ height: 0, opacity: 0, transition: exit }}
          >
            <div className="space-y-6 px-4 pb-6">
              <div className="hairline" />
              {student.goal && (
                <p className="text-body text-mist">
                  <span className="label mr-2">Цель</span>
                  {student.goal}
                </p>
              )}

              {/* План от ИИ — под возраст и предмет, с учётом последних занятий */}
              <div>
                <motion.button {...press} onClick={makePlan} disabled={planning} className={`${primaryButton} glass-accent`}>
                  {planning ? "Готовим план…" : plan ? "Другой вариант плана" : "План следующего занятия"}
                </motion.button>
                {planError && <p className="mt-2 text-center text-body text-danger">{planError}</p>}
                <AnimatePresence>
                  {plan && (
                    <motion.p
                      variants={rise}
                      initial="hidden"
                      animate="show"
                      exit="leave"
                      className="mt-4 whitespace-pre-wrap rounded-2xl bg-tint/[0.04] p-4 text-body text-paper"
                    >
                      {plan}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>

              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!topic.trim()) return;
                  if (await mutate({ action: "log", studentId: student.id, data: { topic, note, mood } })) {
                    setTopic("");
                    setNote("");
                    setMood("ok");
                  }
                }}
                className="space-y-2"
              >
                <p className="label">Записать занятие</p>
                <input className="field" placeholder="Тема занятия" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} />
                <input className="field" placeholder="Заметка (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} />
                <div className="grid grid-cols-3 gap-1 rounded-full bg-tint/[0.04] p-1">
                  {MOODS.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => setMood(item.id)}
                      className="relative min-h-11 rounded-full"
                      aria-pressed={mood === item.id}
                    >
                      {mood === item.id && (
                        <motion.span layoutId={`mood-${student.id}`} transition={spring} className="absolute inset-0 rounded-full bg-tint/10" />
                      )}
                      <span className={`relative font-sans text-label font-medium uppercase ${mood === item.id ? "text-paper" : "text-dim"}`}>
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
                <motion.button type="submit" {...press} disabled={!topic.trim()} className={`${quietButton} w-full text-paper`}>
                  Сохранить занятие
                </motion.button>
              </form>

              {student.lessons.length > 0 && (
                <div>
                  <p className="label mb-2">Журнал</p>
                  <ul className="space-y-2">
                    {student.lessons.slice(0, 20).map((lesson) => (
                      <li key={lesson.id} className="flex items-start gap-4 rounded-2xl bg-tint/[0.03] p-4">
                        <span className="w-12 shrink-0 font-sans text-label text-dim">{shortDate(lesson.date)}</span>
                        <span className="min-w-0 flex-1 text-body">
                          <span className="block text-paper">{lesson.topic}</span>
                          {lesson.note && <span className="block text-mist">{lesson.note}</span>}
                          <span className="label mt-1 block tracking-[0.12em]">{MOODS.find((m) => m.id === lesson.mood)?.label}</span>
                        </span>
                        <button
                          onClick={() => mutate({ action: "unlog", studentId: student.id, lessonId: lesson.id })}
                          aria-label="Удалить запись"
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-dim"
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
                            <path d="M3 3l8 8M11 3l-8 8" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                onClick={() => {
                  if (!confirmDelete) {
                    haptic("medium");
                    setConfirmDelete(true);
                    setTimeout(() => setConfirmDelete(false), 3000);
                    return;
                  }
                  mutate({ action: "remove", studentId: student.id });
                }}
                className={`min-h-11 w-full font-sans text-label font-medium uppercase tracking-[0.12em] ${
                  confirmDelete ? "text-danger" : "text-dim"
                }`}
              >
                {confirmDelete ? "Нажмите ещё раз, чтобы удалить" : "Удалить из списка"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
