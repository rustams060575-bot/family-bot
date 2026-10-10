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
            Говорите <em className="italic text-champagne">свободно</em>
          </>
        }
        caption="Узбекский, русский, испанский и английский — бытовой и деловой регистр."
      />
      <Translator />
    </AppGate>
  );
}
