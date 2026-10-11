"use client";

import { motion } from "framer-motion";
import { useApp } from "@/components/AppProvider";
import Onboarding from "@/components/Onboarding";
import PendingAccess from "@/components/PendingAccess";
import { press } from "@/lib/motion";

// Общий вход каждого экрана: загрузка → ошибка → онбординг → заявка в школу → содержимое.
export default function AppGate({ children }: { children: React.ReactNode }) {
  const { status, account, refresh } = useApp();

  if (status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <motion.p
          className="text-title3 font-semibold text-mist"
          animate={{ opacity: [0.35, 0.9, 0.35] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          ATA Academy
        </motion.p>
      </div>
    );
  }

  if (status === "error" || !account) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-title2 font-bold">Нет связи</p>
        <p className="mt-4 max-w-[18rem] text-body text-mist">
          Откройте ATA Academy из Telegram или проверьте интернет.
        </p>
        <motion.button
          {...press}
          onClick={refresh}
          className="mt-8 rounded-[0.875rem] bg-fill px-6 py-4 text-body text-paper"
        >
          Повторить
        </motion.button>
      </div>
    );
  }

  if (!account.role) return <Onboarding />;
  if (account.access !== "approved") return <PendingAccess />;
  return <>{children}</>;
}
