import { useEffect, useState } from "react";
import type { Stat } from "./api";

export type Theme = "system" | "light" | "dark";

export interface Settings {
  groupBy: string[];
  stat: Stat;
  smoothing: number;
  bins: number;
  showRuns: boolean;
  logY: boolean;
  /** Metrics shown as panels; null means "all metrics". */
  panels: string[] | null;
  hiddenRuns: string[];
  hiddenGroups: string[];
  groupNames: Record<string, string>;
  theme: Theme;
  syncX: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  groupBy: [],
  stat: "mean_std",
  smoothing: 0,
  bins: 0,
  showRuns: false,
  logY: false,
  panels: null,
  hiddenRuns: [],
  hiddenGroups: [],
  groupNames: {},
  theme: "system",
  syncX: true,
};

const STORAGE_KEY = "mlcompare.settings.v1";

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Settings persisted per browser, so a reload keeps your grouping and panels. */
export function usePersistentSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(load);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage can be unavailable (private mode); settings still work in memory.
    }
  }, [settings]);
  const update = (patch: Partial<Settings>): void => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };
  return [settings, update];
}
