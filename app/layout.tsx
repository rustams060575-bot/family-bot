import type { Metadata, Viewport } from "next";
import AppProvider from "@/components/AppProvider";
import TabBar from "@/components/TabBar";
import { THEME_BOOT_SCRIPT } from "@/lib/client/theme";
// Антиква для заголовков + нео-гротеск для интерфейса. Шрифты встроены локально
// (@fontsource, woff2 с латиницей и кириллицей через unicode-range) — рендер
// не зависит от сети и Google Fonts.
import "@fontsource/cormorant-garamond/300.css";
import "@fontsource/cormorant-garamond/300-italic.css";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ATA Academy",
  description: "Испанский, английский, рисование и переводчик — в Telegram.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0B0F17",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme и data-text выставляет скрипт до гидратации — расхождение с сервером ожидаемо.
    <html lang="ru" data-theme="dark" data-text="normal" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <div className="atmosphere" />
        <AppProvider>
          <div className="relative z-10 mx-auto flex min-h-[100dvh] max-w-md flex-col">{children}</div>
          <TabBar />
        </AppProvider>
        <div className="grain" />
      </body>
    </html>
  );
}
