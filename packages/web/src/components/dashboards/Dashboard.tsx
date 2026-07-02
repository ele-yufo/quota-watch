"use client";

import { useTheme } from "@/lib/theme-context";
import { MagazineDashboard } from "./MagazineDashboard";
import { TerminalDashboard } from "./TerminalDashboard";
import { OledDashboard } from "./OledDashboard";
import { SwissDashboard } from "./SwissDashboard";
import { BlueprintDashboard } from "./BlueprintDashboard";
import type { DashboardProps } from "./types";

/**
 * Picks a whole different dashboard layout per active theme — not a recolour.
 * Each theme owns its composition, gauges and effects.
 */
export function Dashboard(props: DashboardProps) {
  const { theme } = useTheme();
  switch (theme) {
    case "terminal":
      return <TerminalDashboard {...props} />;
    case "oled":
      return <OledDashboard {...props} />;
    case "swiss":
      return <SwissDashboard {...props} />;
    case "blueprint":
      return <BlueprintDashboard {...props} />;
    default:
      return <MagazineDashboard {...props} />;
  }
}
