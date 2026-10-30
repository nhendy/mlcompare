// Mirrors src/mlcompare/models.py.

export type Stat = "mean_std" | "mean_sem" | "median_minmax" | "median_iqr";

export const STAT_LABELS: Record<Stat, string> = {
  mean_std: "Mean ± std",
  mean_sem: "Mean ± sem",
  median_minmax: "Median, min–max",
  median_iqr: "Median, IQR",
};

export interface RunInfo {
  id: string;
  name: string;
  path: string;
  config: Record<string, string>;
  metrics: string[];
  num_rows: number;
  last_step: number | null;
}

export interface ConfigKeyInfo {
  key: string;
  values: string[];
  missing: number;
}

export interface RunsResponse {
  runs: RunInfo[];
  config_keys: ConfigKeyInfo[];
  metrics: string[];
  errors: string[];
}

export interface SeriesRequest {
  run_ids: string[] | null;
  metrics: string[];
  group_by: string[];
  stat: Stat;
  smoothing: number;
  bins: number;
  include_runs: boolean;
}

export interface RunLine {
  run_id: string;
  x: number[];
  y: number[];
}

export interface GroupSeries {
  key: string;
  run_ids: string[];
  x: number[];
  center: number[];
  lower: number[];
  upper: number[];
  count: number[];
  runs: RunLine[];
}

export interface SeriesResponse {
  metrics: Record<string, GroupSeries[] | undefined>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as T;
}

export function fetchRuns(reload: boolean): Promise<RunsResponse> {
  return request<RunsResponse>(reload ? "/api/reload" : "/api/runs", {
    method: reload ? "POST" : "GET",
  });
}

export function fetchSeries(body: SeriesRequest, signal: AbortSignal): Promise<SeriesResponse> {
  return request<SeriesResponse>("/api/series", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}
