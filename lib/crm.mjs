import crypto from "crypto";
import { markDirty } from "./store.mjs";

// CRM репетитора и родителя: ученики с любым предметом и возрастом, журнал занятий.
// Хранится внутри аккаунта владельца — чужие ученики недоступны по определению.
const MAX_STUDENTS = 200;
const MAX_LESSONS = 300;
const MOODS = ["great", "ok", "hard"];

function clean(value, max) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanAge(value) {
  const age = Number(value);
  return Number.isInteger(age) && age >= 3 && age <= 120 ? age : null;
}

function crmOf(account) {
  account.crm ??= { students: [] };
  return account.crm;
}

export function listStudents(account) {
  return crmOf(account).students;
}

export function findStudent(account, studentId) {
  return crmOf(account).students.find((student) => student.id === studentId) ?? null;
}

export function addStudent(account, data) {
  const crm = crmOf(account);
  const name = clean(data.name, 60);
  const subject = clean(data.subject, 60);
  if (!name || !subject) return { error: "Нужны имя и предмет." };
  if (crm.students.length >= MAX_STUDENTS) return { error: "Достигнут предел в 200 учеников." };
  const student = {
    id: crypto.randomUUID(),
    name,
    age: cleanAge(data.age),
    subject,
    goal: clean(data.goal, 160),
    createdAt: new Date().toISOString(),
    lessons: [],
  };
  crm.students.unshift(student);
  markDirty();
  return { student };
}

export function updateStudent(account, studentId, data) {
  const student = findStudent(account, studentId);
  if (!student) return { error: "Ученик не найден." };
  if (data.name !== undefined) student.name = clean(data.name, 60) || student.name;
  if (data.subject !== undefined) student.subject = clean(data.subject, 60) || student.subject;
  if (data.age !== undefined) student.age = cleanAge(data.age);
  if (data.goal !== undefined) student.goal = clean(data.goal, 160);
  markDirty();
  return { student };
}

export function removeStudent(account, studentId) {
  const crm = crmOf(account);
  crm.students = crm.students.filter((student) => student.id !== studentId);
  markDirty();
  return {};
}

export function logLesson(account, studentId, data) {
  const student = findStudent(account, studentId);
  if (!student) return { error: "Ученик не найден." };
  const topic = clean(data.topic, 120);
  if (!topic) return { error: "Нужна тема занятия." };
  student.lessons.unshift({
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    topic,
    note: clean(data.note, 400),
    mood: MOODS.includes(data.mood) ? data.mood : "ok",
  });
  student.lessons = student.lessons.slice(0, MAX_LESSONS);
  markDirty();
  return { student };
}

export function removeLesson(account, studentId, lessonId) {
  const student = findStudent(account, studentId);
  if (!student) return { error: "Ученик не найден." };
  student.lessons = student.lessons.filter((lesson) => lesson.id !== lessonId);
  markDirty();
  return { student };
}

const MOOD_TEXT = { great: "легко", ok: "нормально", hard: "трудно" };

// Последние занятия одной строкой на каждое — контекст для ИИ-плана.
export function recentLessonsText(student, count = 5) {
  return student.lessons
    .slice(0, count)
    .map(
      (lesson) =>
        `${lesson.date.slice(0, 10)} — ${lesson.topic} (${MOOD_TEXT[lesson.mood]})${lesson.note ? `: ${lesson.note}` : ""}`,
    )
    .join("\n");
}
