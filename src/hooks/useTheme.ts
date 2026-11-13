import { useEffect, useState } from "react";
import type { ThemePreference } from "../types/studio";

const STORAGE_KEY = "etherloom:theme-preference";

function getSystemDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return true;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  } catch {
    // Ignore storage access errors in restricted WebView contexts
  }
  return "dark";
}

function applyDocumentTheme(theme: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
    root.style.colorScheme = "dark";
    root.style.backgroundColor = "#0D1321";
  } else {
    root.classList.remove("dark");
    root.style.colorScheme = "light";
    root.style.backgroundColor = "#F8FAFC";
  }
}

export function useTheme() {
  const [preference, setPreference] =
    useState<ThemePreference>(readStoredPreference);
  const [systemDark, setSystemDark] = useState<boolean>(getSystemDark);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
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
    applyDocumentTheme(resolvedTheme);
    try {
      window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Ignore storage quota / sandbox errors
    }

    // Sync native macOS NSWindow chrome & native form popups when running in Tauri
    if (
      typeof window !== "undefined" &&
      "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
    ) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().setTheme(
            preference === "system" ? null : resolvedTheme
          )
        )
        .catch(() => {
          // Non-fatal if capability or platform does not support dynamic window theme
        });
    }
  }, [preference, resolvedTheme]);

  return {
    preference,
    resolvedTheme,
    setPreference,
  };
}
