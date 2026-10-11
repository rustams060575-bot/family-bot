"use client";

import AppGate from "@/components/AppGate";
import ScreenHeader from "@/components/ScreenHeader";
import Translator from "@/components/Translator";

export default function TranslatePage() {
  return (
    <AppGate>
      <ScreenHeader
        eyebrow="ATA Translate"
        title={
          <>
            Говорите <span className="text-champagne">свободно</span>
          </>
        }
        caption="Узбекский, русский, испанский и английский — бытовой и деловой регистр."
      />
      <Translator />
    </AppGate>
  );
}
