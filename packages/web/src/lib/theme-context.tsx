"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_THEME, THEME_STORAGE_KEY, isValidTheme } from "./themes";

interface ThemeCtx {
  theme: string;
  setTheme: (t: string) => void;
}

const Ctx = createContext<ThemeCtx>({ theme: DEFAULT_THEME, setTheme: () => {} });

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}

/**
 * Holds the active theme in React state (so the page can pick a whole different
 * dashboard layout per theme, not just recolour) while keeping the <html
 * data-theme> attribute + localStorage in sync.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<string>(DEFAULT_THEME);

  // hydrate from the attribute the bootstrap script set before paint
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (isValidTheme(current)) setThemeState(current);
  }, []);

  const setTheme = (t: string) => {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {
      /* private mode — still applies for the session */
    }
    setThemeState(t);
  };

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}
