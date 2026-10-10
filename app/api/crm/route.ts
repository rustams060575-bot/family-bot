import { NextResponse } from "next/server";
import { authenticate, badRequest, requireAccess, unauthorized } from "@/lib/server/session";
import { addStudent, listStudents, logLesson, removeLesson, removeStudent, updateStudent } from "@/lib/crm.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;
  return NextResponse.json({ students: listStudents(account) });
}

// Одна точка для всех изменений CRM: { action, studentId?, lessonId?, data? }.
export async function POST(request: Request) {
  const account = authenticate(request);
  if (!account) return unauthorized();
  const denied = requireAccess(account);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const data = body?.data && typeof body.data === "object" ? body.data : {};
  const studentId = typeof body?.studentId === "string" ? body.studentId : "";

  let result: { error?: string };
  switch (body?.action) {
    case "add":
      result = addStudent(account, data);
      break;
    case "update":
      result = updateStudent(account, studentId, data);
      break;
    case "remove":
      result = removeStudent(account, studentId);
      break;
    case "log":
      result = logLesson(account, studentId, data);
      break;
    case "unlog":
      result = removeLesson(account, studentId, String(body?.lessonId ?? ""));
      break;
    default:
      return badRequest("Неизвестное действие.");
  }

  if (result.error) return badRequest(result.error);
  return NextResponse.json({ students: listStudents(account) });
}
