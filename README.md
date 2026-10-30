# MLCompare

A W&B-style dashboard for comparing ML experiments logged to plain files: one
`metrics.csv` and one `config.yaml` per run. Group runs by any combination of
config keys, and see each group's mean ± std (or median with min–max / IQR) as
interactive Plotly charts.

```bash
uv run mlcompare path/to/runs          # scans recursively, opens http://127.0.0.1:8765
```

Try it on synthetic data:

```bash
uv run python examples/make_demo_runs.py demo_runs
uv run mlcompare demo_runs
```

## Run format

Any directory containing a `config.yaml` (or `config.yml`) and a CSV is a run.
The CSV is `metrics.csv`, or the only `*.csv` in the folder.

```
runs/
  adam/lr0.001_bs32_s0/
    config.yaml        # any nested YAML; flattened to dotted keys (optim.lr)
    metrics.csv        # step,train/loss,eval/accuracy,...
```

- Rows are sparse: each row has a `step` and any subset of metrics (empty cells are
  fine). Use `--step-col` if your step column has another name; without one, the row
  index is used.
- Non-numeric columns are ignored.
- A config key missing from a run groups as `N/A`.

## Features

- **Grouping** by any set of config keys. One group per value combination, named
  `lr:0.001,batch_size:32` by default. Double-click a legend chip to rename it,
  click to hide it, alt-click to show only that group.
- **Statistics**: mean ± std, mean ± sem, median with min–max, median with IQR.
  Computed server-side with Polars.
- **Smoothing**: debiased EMA (TensorBoard/W&B style), applied per run before
  aggregation.
- **Step alignment**: when runs log at different steps, bin the x axis
  (50–1000 bins) so groups aggregate cleanly.
- **Charts**: hover for every group's value and spread, box-zoom (synced across
  panels by default), double-click to reset, expand any panel, PNG export,
  optional individual-run lines, log y.
- **Panels** are sectioned by metric prefix (`train/`, `eval/`), and you can pick
  which ones to show.
- **Runs table**: filter by name or `key:value`, click rows to show/hide runs.
- **Live updates**: Refresh rescans the folders. Auto refreshes every 15 s, so
  you can watch training runs. Unchanged files are cached by mtime.
- Light/dark theme, responsive down to phone width, settings remembered per browser.

## Development

```bash
uv sync                                   # Python deps incl. dev tools
uv run ruff format --check . && uv run ruff check .
uv run pyright                            # strict mode
uv run pytest

cd frontend
npm install
npm run check                             # tsc (strict) + eslint (strictTypeChecked)
npm run dev                               # Vite on :5173, proxies /api to :8765
npm run build                             # writes to src/mlcompare/static/
```

The built frontend is committed under `src/mlcompare/static/`, so `uv run
mlcompare` works without Node. Rebuild it after frontend changes.

### Layout

```
src/mlcompare/
  loader.py      run discovery, YAML flattening, sparse CSV → Polars
  aggregate.py   grouping, EMA, step binning, group statistics
  api.py         FastAPI: GET /api/runs, POST /api/reload, POST /api/series
  cli.py         `mlcompare` entry point
frontend/src/
  App.tsx        state, data fetching, toolbar
  charts.ts      Plotly traces and layout
  groups.ts      client-side grouping (mirrors the backend) and colors
  components/    Plot, MetricPanel, Picker, GroupLegend, RunsTable
```

API docs are served at `/api/docs` while the app runs.
