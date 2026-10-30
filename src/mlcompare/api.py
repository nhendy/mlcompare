"""FastAPI app: JSON API under ``/api`` plus the built frontend as static files."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from mlcompare.aggregate import compute_series, value_sort_key
from mlcompare.models import (
    ConfigKeyInfo,
    RunInfo,
    RunsResponse,
    SeriesRequest,
    SeriesResponse,
)

if TYPE_CHECKING:
    from mlcompare.loader import Run, RunStore

STATIC_DIR = Path(__file__).parent / "static"

_MISSING_FRONTEND = """<!doctype html><title>MLCompare</title>
<body style="font-family:system-ui;padding:2rem">
<h1>Frontend not built</h1>
<p>Run <code>cd frontend &amp;&amp; npm install &amp;&amp; npm run build</code>,
or use the dev server with <code>npm run dev</code>.</p></body>"""


def _runs_response(runs: list[Run], errors: list[str]) -> RunsResponse:
    keys = sorted({k for run in runs for k in run.config})
    config_keys: list[ConfigKeyInfo] = []
    for key in keys:
        values = {run.config[key] for run in runs if key in run.config}
        missing = sum(1 for run in runs if key not in run.config)
        config_keys.append(
            ConfigKeyInfo(key=key, values=sorted(values, key=value_sort_key), missing=missing)
        )
    metrics = sorted({m for run in runs for m in run.metrics})
    infos = [
        RunInfo(
            id=run.id,
            name=run.name,
            path=str(run.path),
            config=run.config,
            metrics=list(run.metrics),
            num_rows=run.frame.height,
            last_step=run.frame.get_column("step").max() if run.frame.height else None,  # pyright: ignore[reportArgumentType]
        )
        for run in runs
    ]
    return RunsResponse(runs=infos, config_keys=config_keys, metrics=metrics, errors=errors)


def create_app(store: RunStore, static_dir: Path = STATIC_DIR) -> FastAPI:
    app = FastAPI(title="MLCompare", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.add_middleware(GZipMiddleware, minimum_size=2048)

    @app.get("/api/runs")
    def list_runs() -> RunsResponse:
        return _runs_response(store.runs(), store.errors)

    @app.post("/api/reload")
    def reload_runs() -> RunsResponse:
        store.reload()
        return _runs_response(store.runs(), store.errors)

    @app.post("/api/series")
    def series(request: SeriesRequest) -> SeriesResponse:
        return compute_series(store.get(request.run_ids), request)

    index = static_dir / "index.html"
    if index.is_file():
        assets = static_dir / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{_path:path}", include_in_schema=False)
        def spa(_path: str) -> FileResponse:
            return FileResponse(index)

    else:

        @app.get("/", include_in_schema=False)
        def missing() -> HTMLResponse:
            return HTMLResponse(_MISSING_FRONTEND)

    return app
