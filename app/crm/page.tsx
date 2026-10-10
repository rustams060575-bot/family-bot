"use client";

import AppGate from "@/components/AppGate";
import { useApp } from "@/components/AppProvider";
import CrmPanel, { CRM_COPY } from "@/components/CrmPanel";
import ScreenHeader from "@/components/ScreenHeader";

function CrmScreen() {
  const { account } = useApp();
  if (!account) return null;
  const copy = CRM_COPY[account.role ?? "tutor"];

  return (
    <>
      <ScreenHeader
        eyebrow={`ATA CRM${account.firstName ? ` · ${account.firstName}` : ""}`}
        title={
          <>
            {copy.title} <em className="italic text-champagne">{copy.accent}</em>
          </>
        }
        caption="Любой предмет и возраст — от первоклассника до взрослых учеников. Ассистент подстроит план занятия."
      />
      <CrmPanel />
    </>
  );
}

export default function CrmPage() {
  return (
    <AppGate>
      <CrmScreen />
    </AppGate>
  );
}
