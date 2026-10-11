import type { Config } from "tailwindcss";

// Токены ATA Academy. Все цвета — через CSS-переменные из globals.css, чтобы один
// источник правды был и для Tailwind, и для canvas-рисования (волна, холст).
// Типографическая шкала — iOS Dynamic Type (размер «Large», по умолчанию), трекинг —
// из таблицы SF Pro. Отступы — сетка 4/8 px: края экрана 16 или 20 px.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-raised": "rgb(var(--ink-raised) / <alpha-value>)",
        "ink-sheet": "rgb(var(--ink-sheet) / <alpha-value>)",
        // Нейтральная «подкраска» поверхностей: белая в тёмной теме, чёрная в светлой.
        tint: "rgb(var(--tint) / <alpha-value>)",
        paper: "rgb(var(--paper) / <alpha-value>)",
        mist: "rgb(var(--mist) / <alpha-value>)",
        dim: "rgb(var(--dim) / <alpha-value>)",
        champagne: "rgb(var(--champagne) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        rounded: ["var(--font-rounded)"],
      },
      fontSize: {
        "large-title": ["2.125rem", { lineHeight: "2.5625rem", letterSpacing: "0.011em" }], // 34 / 41
        title1: ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "0.013em" }], // 28 / 34
        title2: ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.016em" }], // 22 / 28
        title3: ["1.25rem", { lineHeight: "1.5625rem", letterSpacing: "-0.022em" }], // 20 / 25
        headline: ["1.0625rem", { lineHeight: "1.375rem", letterSpacing: "-0.026em" }], // 17 / 22 semibold
        body: ["1.0625rem", { lineHeight: "1.375rem", letterSpacing: "-0.026em" }], // 17 / 22
        callout: ["1rem", { lineHeight: "1.3125rem", letterSpacing: "-0.02em" }], // 16 / 21
        subhead: ["0.9375rem", { lineHeight: "1.25rem", letterSpacing: "-0.016em" }], // 15 / 20
        footnote: ["0.8125rem", { lineHeight: "1.125rem", letterSpacing: "-0.006em" }], // 13 / 18
        caption: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0" }], // 12 / 16
        caption2: ["0.6875rem", { lineHeight: "0.8125rem", letterSpacing: "0.006em" }], // 11 / 13
      },
      borderRadius: {
        card: "1.25rem", // 20 px — карточки Grouped List
        "3xl": "1.375rem", // 22 px — крупные блоки
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
