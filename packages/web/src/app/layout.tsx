import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "quota-watch",
  description: "Local-first AI subscription quota monitoring",
};

// Runs before first paint: resolves 夜间/白天/跟随系统 from localStorage and
// pins data-theme on <html> so the page never flashes the wrong world.
const THEME_INIT = `(function(){try{var m=localStorage.getItem('theme-mode')||'system';var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();`;
const THEME_WATCH = `(function(){try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(e){if((localStorage.getItem('theme-mode')||'system')==='system')document.documentElement.dataset.theme=e.matches?'dark':'light';});}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_WATCH }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
