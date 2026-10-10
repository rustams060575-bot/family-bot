"use client";

import AppGate from "@/components/AppGate";
import ArtAnalyzer from "@/components/ArtAnalyzer";
import ScreenHeader from "@/components/ScreenHeader";

export default function ArtPage() {
  return (
    <AppGate>
      <ScreenHeader
        eyebrow="ATA Kids Art"
        title={
          <>
            Рисуем <em className="italic text-champagne">на бумаге</em>
          </>
        }
        caption="Сфотографируйте рисунок — педагог отметит, что получилось, даст совет и новое задание."
      />
      <ArtAnalyzer />
    </AppGate>
  );
}
