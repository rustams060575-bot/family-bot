"use client";

import AppGate from "@/components/AppGate";
import ChessSchool from "@/components/ChessSchool";
import ScreenHeader from "@/components/ScreenHeader";

// Детский раздел — SF Pro Rounded, как Kids Art.
export default function ChessPage() {
  return (
    <AppGate>
      <div className="font-rounded">
        <ScreenHeader eyebrow="ATA Kids · Шахматы & Логика" title="Шахматы с Лео" />
        <ChessSchool />
      </div>
    </AppGate>
  );
}
