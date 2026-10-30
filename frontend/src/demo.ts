/**
 * Static demo mode (`npm run build:demo`): no Python server. Generates the same
 * synthetic sweep as examples/make_demo_runs.py and answers /api/* in the browser
 * with a TypeScript port of the backend's grouping and aggregation.
 */
import type {
  ConfigKeyInfo,
  GroupSeries,
  RunInfo,
  RunLine,
  RunsResponse,
  SeriesRequest,
  SeriesResponse,
} from "./api";
import { ALL_RUNS, NA } from "./groups";

interface DemoRun {
  info: RunInfo;
  step: number[];
  values: Record<string, (number | null)[]>;
}

const METRICS = ["train/loss", "train/grad_norm", "eval/loss", "eval/accuracy", "lr"];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number, sigma: number): number {
  const u = Math.max(rng(), 1e-12);
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function makeRun(lr: number, bs: number, opt: string, seed: number, idx: number): DemoRun {
  const rng = mulberry32(1000 + idx * 7919);
  const steps = 2000;
  const config: Record<string, string> = {
    "model.name": "mlp",
    "model.width": "256",
    "model.depth": "4",
    "optim.name": opt,
    "optim.lr": String(lr),
    "optim.weight_decay": "0.01",
    batch_size: String(bs),
    seed: String(seed),
  };
  if (opt === "adamw") config["optim.betas"] = "[0.9, 0.95]";
  if (seed % 2 === 0) config["warmup_steps"] = "200";

  const speed = Math.log10(lr / 1e-5) * (opt === "adamw" ? 1.3 : 1.0);
  const floor = 0.15 + 0.05 * Math.log2(bs / 32) + (rng() - 0.5) * 0.06;
  const step: number[] = [];
  const values: Record<string, (number | null)[]> = Object.fromEntries(METRICS.map((m) => [m, []]));
  const push = (m: string, v: number | null): void => {
    values[m]?.push(v);
  };
  for (let s = 0; s <= steps; s += 10) {
    const t = s / steps;
    const loss = floor + 2.3 * Math.exp(-speed * 3 * t) + gauss(rng, 0.04);
    step.push(s);
    push("train/loss", loss);
    push("train/grad_norm", 1.5 * Math.exp(-2 * t) + Math.abs(gauss(rng, 0.2)));
    push("lr", lr * Math.min(1, s / 200) * 0.5 * (1 + Math.cos(Math.PI * t)));
    if (s % 100 === 0) {
      const evalLoss = loss + 0.05 + gauss(rng, 0.02);
      push("eval/loss", evalLoss);
      push("eval/accuracy", 1 / (1 + Math.exp(3 * (evalLoss - 0.9))));
    } else {
      push("eval/loss", null);
      push("eval/accuracy", null);
    }
  }
  const id = `${opt}/lr${String(lr)}_bs${bs}_s${seed}`;
  return {
    info: {
      id,
      name: id.split("/")[1] ?? id,
      path: `demo_runs/${id}`,
      config,
      metrics: [...METRICS].sort(),
      num_rows: step.length,
      last_step: steps,
    },
    step,
    values,
  };
}

function makeRuns(): DemoRun[] {
  const runs: DemoRun[] = [];
  let idx = 0;
  for (const lr of [1e-4, 3e-4, 1e-3])
    for (const bs of [32, 128])
      for (const opt of ["adam", "adamw"])
        for (const seed of [0, 1, 2]) runs.push(makeRun(lr, bs, opt, seed, idx++));
  return runs.sort((a, b) => (a.info.id < b.info.id ? -1 : 1));
}

function sortKey(value: string): [number, number, string] {
  if (value === NA) return [2, 0, value];
  const n = Number(value);
  return Number.isFinite(n) && value.trim() !== "" ? [0, n, value] : [1, 0, value];
}

function compareKeys(a: [number, number, string], b: [number, number, string]): number {
  return a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
}

function runsResponse(runs: DemoRun[]): RunsResponse {
  const keys = [...new Set(runs.flatMap((r) => Object.keys(r.info.config)))].sort();
  const config_keys: ConfigKeyInfo[] = keys.map((key) => {
    const values = [...new Set(runs.flatMap((r) => r.info.config[key] ?? []))];
    values.sort((a, b) => compareKeys(sortKey(a), sortKey(b)));
    return { key, values, missing: runs.filter((r) => !(key in r.info.config)).length };
  });
  return { runs: runs.map((r) => r.info), config_keys, metrics: [...METRICS].sort(), errors: [] };
}

function assignGroups(runs: DemoRun[], keys: string[]): [string, string[]][] {
  const buckets = new Map<string, { values: string[]; ids: string[] }>();
  for (const r of runs) {
    const values = keys.map((k) => r.info.config[k] ?? NA);
    const name = keys.length ? keys.map((k, i) => `${k}:${values[i] ?? NA}`).join(",") : ALL_RUNS;
    const b = buckets.get(name);
    if (b) b.ids.push(r.info.id);
    else buckets.set(name, { values, ids: [r.info.id] });
  }
  return [...buckets.entries()]
    .sort(([, a], [, b]) => {
      for (let i = 0; i < a.values.length; i++) {
        const c = compareKeys(sortKey(a.values[i] ?? NA), sortKey(b.values[i] ?? NA));
        if (c !== 0) return c;
      }
      return 0;
    })
    .map(([name, b]) => [name, b.ids]);
}

function points(run: DemoRun, metric: string, smoothing: number): [number[], number[]] {
  const xs: number[] = [];
  const ys: number[] = [];
  const col = run.values[metric] ?? [];
  run.step.forEach((s, i) => {
    const v = col[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      xs.push(s);
      ys.push(v);
    }
  });
  if (smoothing > 0) {
    // Debiased EMA, matching polars ewm_mean(alpha=1-smoothing, adjust=True).
    const decay = smoothing;
    let num = 0;
    let den = 0;
    for (let i = 0; i < ys.length; i++) {
      num = num * decay + (ys[i] ?? 0);
      den = den * decay + 1;
      ys[i] = num / den;
    }
  }
  return [xs, ys];
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

function stats(ys: number[], stat: SeriesRequest["stat"]): [number, number, number] {
  const n = ys.length;
  const mean = ys.reduce((s, v) => s + v, 0) / n;
  const std = n > 1 ? Math.sqrt(ys.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const sorted = [...ys].sort((a, b) => a - b);
  switch (stat) {
    case "mean_std":
      return [mean, mean - std, mean + std];
    case "mean_sem":
      return [mean, mean - std / Math.sqrt(n), mean + std / Math.sqrt(n)];
    case "median_minmax":
      return [quantile(sorted, 0.5), sorted[0] ?? 0, sorted[n - 1] ?? 0];
    case "median_iqr":
      return [quantile(sorted, 0.5), quantile(sorted, 0.25), quantile(sorted, 0.75)];
  }
}

function series(all: DemoRun[], req: SeriesRequest): SeriesResponse {
  const wanted = req.run_ids === null ? null : new Set(req.run_ids);
  const runs = all.filter((r) => wanted === null || wanted.has(r.info.id));
  const groups = assignGroups(runs, req.group_by);
  const byId = new Map(runs.map((r) => [r.info.id, r]));
  const metrics: Record<string, GroupSeries[]> = {};
  for (const metric of req.metrics) {
    const lines = new Map<string, [number[], number[]]>();
    for (const r of runs) {
      if (r.info.metrics.includes(metric)) lines.set(r.info.id, points(r, metric, req.smoothing));
    }
    if (req.bins > 0) {
      const allX = [...lines.values()].flatMap(([xs]) => xs);
      const lo = Math.min(...allX);
      const hi = Math.max(...allX);
      const width = hi > lo ? (hi - lo) / req.bins : 1;
      for (const [id, [xs, ys]] of lines) {
        const acc = new Map<number, [number, number]>();
        xs.forEach((x, i) => {
          const b = Math.min(Math.max(Math.floor((x - lo) / width), 0), req.bins - 1);
          const cur = acc.get(b) ?? [0, 0];
          acc.set(b, [cur[0] + (ys[i] ?? 0), cur[1] + 1]);
        });
        const keys = [...acc.keys()].sort((a, b) => a - b);
        lines.set(id, [
          keys.map((b) => lo + (b + 0.5) * width),
          keys.map((b) => {
            const [s, c] = acc.get(b) ?? [0, 1];
            return s / c;
          }),
        ]);
      }
    }
    const out: GroupSeries[] = [];
    for (const [key, ids] of groups) {
      const atX = new Map<number, number[]>();
      const runLines: RunLine[] = [];
      for (const id of ids) {
        const line = lines.get(id);
        if (!line || !byId.has(id)) continue;
        const [xs, ys] = line;
        xs.forEach((x, i) => {
          const list = atX.get(x) ?? [];
          list.push(ys[i] ?? 0);
          atX.set(x, list);
        });
        if (req.include_runs && xs.length) runLines.push({ run_id: id, x: xs, y: ys });
      }
      if (atX.size === 0) continue;
      const x = [...atX.keys()].sort((a, b) => a - b);
      const s = x.map((xi) => stats(atX.get(xi) ?? [], req.stat));
      out.push({
        key,
        run_ids: ids,
        x,
        center: s.map((v) => v[0]),
        lower: s.map((v) => v[1]),
        upper: s.map((v) => v[2]),
        count: x.map((xi) => atX.get(xi)?.length ?? 0),
        runs: runLines,
      });
    }
    metrics[metric] = out;
  }
  return { metrics };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

export function installDemoApi(): void {
  const runs = makeRuns();
  try {
    // Open on an interesting grouping the first time someone views the demo.
    const key = "mlcompare.settings.v1";
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ groupBy: ["optim.lr", "optim.name"] }));
    }
  } catch {
    // Storage unavailable: the demo just starts ungrouped.
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, window.location.href).pathname;
    if (path.endsWith("/api/runs") || path.endsWith("/api/reload")) {
      return Promise.resolve(json(runsResponse(runs)));
    }
    if (path.endsWith("/api/series") && typeof init?.body === "string") {
      return Promise.resolve(json(series(runs, JSON.parse(init.body) as SeriesRequest)));
    }
    return realFetch(input, init);
  };
}
