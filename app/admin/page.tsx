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
            Только для <span className="text-champagne">админов</span>
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
            Вся <span className="text-champagne">академия</span>
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
