"use client";

import AppGate from "@/components/AppGate";
import ArtAnalyzer from "@/components/ArtAnalyzer";
import ScreenHeader from "@/components/ScreenHeader";

// Детский раздел — SF Pro Rounded.
export default function ArtPage() {
  return (
    <AppGate>
      <div className="font-rounded">
        <ScreenHeader eyebrow="ATA Kids Art" title="Рисуем с Мартиной" />
        <ArtAnalyzer />
      </div>
    </AppGate>
  );
}
