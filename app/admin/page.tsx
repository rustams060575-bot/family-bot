"use client";

import AdminPanel from "@/components/AdminPanel";
import AppGate from "@/components/AppGate";
import { useApp } from "@/components/AppProvider";
import ScreenHeader from "@/components/ScreenHeader";

function AdminScreen() {
  const { account } = useApp();
  if (!account) return null;

  // Сервер всё равно проверяет права (403) — это только понятный экран для остальных.
  if (!account.admin) {
    return (
      <ScreenHeader
        eyebrow="ATA CRM"
        title={
          <>
            Только для <em className="italic text-champagne">админов</em>
          </>
        }
        caption="Этот раздел доступен администраторам академии."
      />
    );
  }

  return (
    <>
      <ScreenHeader
        eyebrow={`${account.superAdmin ? "Супер-админ" : "Админ"} · ${account.firstName || "ATA"}`}
        title={
          <>
            Вся <em className="italic text-champagne">академия</em>
          </>
        }
        caption="Заявки в закрытую школу, пользователи, тарифы и активность за сегодня."
      />
      <AdminPanel />
    </>
  );
}

export default function AdminPage() {
  return (
    <AppGate>
      <AdminScreen />
    </AppGate>
  );
}
