import type { Config } from "tailwindcss";

// Токены ATA Academy. Все цвета — через CSS-переменные из globals.css, чтобы один
// источник правды был и для Tailwind, и для canvas-рисования (волна, холст).
// Типографическая шкала — модульная, одно соотношение 1.25 от 16 px.
// Отступы — только чётные шаги Tailwind (кратные 8 px): 2, 4, 6, 8, 10, 12…
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-raised": "rgb(var(--ink-raised) / <alpha-value>)",
        // Нейтральная «подкраска» поверхностей: белая в тёмной теме, графитовая в светлой.
        tint: "rgb(var(--tint) / <alpha-value>)",
        paper: "rgb(var(--paper) / <alpha-value>)",
        mist: "rgb(var(--mist) / <alpha-value>)",
        dim: "rgb(var(--dim) / <alpha-value>)",
        champagne: "rgb(var(--champagne) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      fontSize: {
        label: ["0.8rem", { lineHeight: "1.4", letterSpacing: "0.22em" }],
        body: ["1rem", { lineHeight: "1.5" }],
        lead: ["1.25rem", { lineHeight: "1.4", letterSpacing: "-0.005em" }],
        h3: ["1.5625rem", { lineHeight: "1.12", letterSpacing: "-0.01em" }],
        h2: ["1.953rem", { lineHeight: "1.04", letterSpacing: "-0.015em" }],
        h1: ["2.441rem", { lineHeight: "0.98", letterSpacing: "-0.02em" }],
        display: ["3.052rem", { lineHeight: "0.94", letterSpacing: "-0.025em" }],
      },
      borderRadius: {
        "3xl": "1.5rem",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
