// Тема и размер текста — личные настройки устройства, поэтому живут в localStorage.
// «Как в Telegram» берёт colorScheme из WebApp и следит за его сменой.
export type ThemePref = "system" | "dark" | "light";
export type Theme = "dark" | "light";
export type TextSize = "normal" | "large";

const THEME_KEY = "ata-theme";
const TEXT_KEY = "ata-text";

// Цвет шапки и фона Telegram под каждую тему — совпадает с --ink.
export const THEME_INK: Record<Theme, `#${string}`> = { dark: "#000000", light: "#F2F2F7" };

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // приватный режим или запрет хранилища — настройка просто не запомнится
  }
}

export function readThemePref(): ThemePref {
  const value = read(THEME_KEY);
  return value === "dark" || value === "light" ? value : "system";
}

export function saveThemePref(pref: ThemePref) {
  write(THEME_KEY, pref);
}

export function readTextSize(): TextSize {
  return read(TEXT_KEY) === "large" ? "large" : "normal";
}

export function saveTextSize(size: TextSize) {
  write(TEXT_KEY, size);
}

let transitionTimer: ReturnType<typeof setTimeout> | null = null;

export function applyTheme(theme: Theme, animate: boolean) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  if (animate) {
    root.classList.add("theme-transition");
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => root.classList.remove("theme-transition"), 600);
  }
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_INK[theme]);
}

export function applyTextSize(size: TextSize) {
  document.documentElement.dataset.text = size;
}

// Выполняется в <head> до первой отрисовки — без вспышки неверной темы.
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("${THEME_KEY}");
if(t!=="dark"&&t!=="light"){var tg=window.Telegram&&window.Telegram.WebApp&&window.Telegram.WebApp.colorScheme;
t=tg||(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");}
d.dataset.theme=t;d.dataset.text=localStorage.getItem("${TEXT_KEY}")==="large"?"large":"normal";}catch(e){}})();`;
