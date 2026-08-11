"use client";

export type Theme = "light" | "dark";

let activeTheme: Theme = "light";
const listeners = new Set<() => void>();

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  activeTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  return activeTheme;
}

export function getThemeSnapshot(): Theme {
  return readTheme();
}

export function getServerThemeSnapshot(): Theme {
  return "light";
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTheme(theme: Theme) {
  activeTheme = theme;
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem("nr-theme", theme);
  listeners.forEach((listener) => listener());
}
