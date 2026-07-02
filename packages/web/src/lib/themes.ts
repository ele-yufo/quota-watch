/**
 * Theme registry — the single source of theme ids/labels shared by the
 * switcher and the anti-flash bootstrap script. A theme is just a value of
 * `data-theme` on <html>; the CSS in globals.css does the rest.
 */
export interface ThemeMeta {
  id: string;
  label: string;
  /** one-word vibe shown under the label */
  hint: string;
}

export const THEMES: ThemeMeta[] = [
  { id: "magazine", label: "Magazine", hint: "印刷杂志" },
  { id: "terminal", label: "Terminal", hint: "极客终端" },
  { id: "oled", label: "OLED", hint: "纯黑暗色" },
  { id: "swiss", label: "Swiss", hint: "极简浅色" },
  { id: "blueprint", label: "Blueprint", hint: "蓝图工程" },
];

export const DEFAULT_THEME = "magazine";
export const THEME_STORAGE_KEY = "qw.theme";

export function isValidTheme(id: string | null | undefined): id is string {
  return !!id && THEMES.some((t) => t.id === id);
}

/**
 * Script (stringified) that applies the theme before first paint (no flash).
 * Precedence: `?theme=` URL param (shareable deep links) → localStorage → default.
 * Injected into <head>.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var valid=${JSON.stringify(
  THEMES.map((t) => t.id),
)};var q=new URLSearchParams(location.search).get('theme');var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var t=(q&&valid.indexOf(q)>-1)?q:((s&&valid.indexOf(s)>-1)?s:${JSON.stringify(
  DEFAULT_THEME,
)});document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
