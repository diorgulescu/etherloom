import { useEffect, useState } from "react";
import type { ThemePreference } from "../types/studio";

const STORAGE_KEY = "etherloom:theme-preference";

function getSystemDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return true;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") return "dark";
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
    return "dark";
  });

  const [systemDark, setSystemDark] = useState<boolean>(getSystemDark);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const resolvedTheme: "light" | "dark" =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    window.localStorage.setItem(STORAGE_KEY, preference);
  }, [preference, resolvedTheme]);

  return {
    preference,
    resolvedTheme,
    setPreference,
  };
}
