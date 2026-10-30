import type { RunInfo } from "./api";
import { groupColor } from "./colors";

export const NA = "N/A";
export const ALL_RUNS = "all runs";

export interface Group {
  key: string;
  values: string[];
  runIds: string[];
  color: string;
}

function sortKey(value: string): [number, number, string] {
  if (value === NA) return [2, 0, value];
  const n = Number(value);
  return Number.isFinite(n) && value.trim() !== "" ? [0, n, value] : [1, 0, value];
}

function compareValues(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const [ra, na, sa] = sortKey(a[i] ?? NA);
    const [rb, nb, sb] = sortKey(b[i] ?? NA);
    if (ra !== rb) return ra - rb;
    if (na !== nb) return na - nb;
    if (sa !== sb) return sa < sb ? -1 : 1;
  }
  return a.length - b.length;
}

/** Same grouping rule as the backend: one group per combination of config values. */
export function groupRuns(runs: readonly RunInfo[], keys: readonly string[]): Group[] {
  const buckets = new Map<string, { values: string[]; runIds: string[] }>();
  for (const run of runs) {
    const values = keys.map((k) => run.config[k] ?? NA);
    const key = keys.length ? keys.map((k, i) => `${k}:${values[i] ?? NA}`).join(",") : ALL_RUNS;
    const bucket = buckets.get(key);
    if (bucket) bucket.runIds.push(run.id);
    else buckets.set(key, { values, runIds: [run.id] });
  }
  return [...buckets.entries()]
    .sort(([, a], [, b]) => compareValues(a.values, b.values))
    .map(([key, b], i) => ({ key, values: b.values, runIds: b.runIds, color: groupColor(i) }));
}

/** Panel sections, W&B-style: metrics are grouped by their prefix before "/". */
export function sectionOf(metric: string): string {
  const slash = metric.indexOf("/");
  return slash > 0 ? metric.slice(0, slash) : "Charts";
}
