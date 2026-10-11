import type { Metadata, Viewport } from "next";
import AppProvider from "@/components/AppProvider";
import TabBar from "@/components/TabBar";
import { THEME_BOOT_SCRIPT } from "@/lib/client/theme";
// Шрифты — системные SF Pro (и SF Pro Rounded в детских разделах): ничего не грузится
// из сети, кириллица и Dynamic Type работают как в нативных приложениях iOS.
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
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme и data-text выставляет скрипт до гидратации — расхождение с сервером ожидаемо.
    <html lang="ru" data-theme="dark" data-text="normal" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <AppProvider>
          <div className="relative z-10 mx-auto flex min-h-[100dvh] max-w-md flex-col">{children}</div>
          <TabBar />
        </AppProvider>
      </body>
    </html>
  );
}
