"""Discover experiment directories and load them into Polars frames.

An experiment ("run") is any directory containing a ``config.yaml`` (or ``config.yml``)
and a metrics CSV. The CSV is ``metrics.csv`` if present, otherwise the only ``*.csv``
in the directory. Rows are sparse: each has a step and any subset of metric columns.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, cast

import polars as pl
import yaml
from typing_extensions import TypeIs

if TYPE_CHECKING:
    from collections.abc import Iterable, Iterator

NA = "N/A"
CONFIG_NAMES = ("config.yaml", "config.yml")
PREFERRED_CSV = "metrics.csv"
STEP = "step"
_SKIP_DIRS = frozenset({".git", "node_modules", "__pycache__", ".venv", "wandb"})


@dataclass(frozen=True)
class Run:
    id: str
    name: str
    path: Path
    config: dict[str, str]
    metrics: tuple[str, ...]
    frame: pl.DataFrame  # columns: STEP + metrics, all Float64, sorted by STEP


@dataclass(frozen=True)
class _CacheEntry:
    stamp: tuple[float, float]
    run: Run


def format_value(value: object) -> str:
    """Canonical string form of a config value, used for grouping and display."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float | str):
        return str(value)
    return json.dumps(value, sort_keys=True, default=str)


def _is_nonempty_mapping(value: object) -> TypeIs[dict[object, object]]:
    return isinstance(value, dict) and len(cast("dict[object, object]", value)) > 0


def flatten_config(config: object, prefix: str = "") -> dict[str, str]:
    """Flatten nested mappings into dotted keys; leaves become canonical strings."""
    if not isinstance(config, dict):
        return {prefix: format_value(config)} if prefix else {}
    out: dict[str, str] = {}
    for raw_key, value in cast("dict[object, object]", config).items():
        key = f"{prefix}.{raw_key}" if prefix else str(raw_key)
        if _is_nonempty_mapping(value):
            out.update(flatten_config(value, key))
        else:
            out[key] = format_value(value)
    return out


def _find_config(directory: Path) -> Path | None:
    for name in CONFIG_NAMES:
        candidate = directory / name
        if candidate.is_file():
            return candidate
    return None


def _find_csv(directory: Path) -> Path | None:
    preferred = directory / PREFERRED_CSV
    if preferred.is_file():
        return preferred
    csvs = sorted(directory.glob("*.csv"))
    return csvs[0] if len(csvs) == 1 else None


def discover(roots: Iterable[Path]) -> Iterator[tuple[Path, Path, Path, Path]]:
    """Yield ``(root, run_dir, config_path, csv_path)`` for every run under ``roots``."""
    seen: set[Path] = set()
    for root in roots:
        stack = [root.resolve()]
        while stack:
            directory = stack.pop()
            if directory in seen:
                continue
            seen.add(directory)
            config, csv = _find_config(directory), _find_csv(directory)
            if config is not None and csv is not None:
                yield root.resolve(), directory, config, csv
            children = (p for p in directory.iterdir() if p.is_dir() and p.name not in _SKIP_DIRS)
            stack.extend(sorted(children, reverse=True))


def read_metrics(csv_path: Path, step_col: str = STEP) -> pl.DataFrame:
    """Read a sparse metrics CSV into a frame with a ``step`` column and Float64 metrics.

    Non-numeric columns are dropped. If ``step_col`` is missing the row index is used.
    """
    raw = pl.read_csv(csv_path, infer_schema_length=None, null_values=["", "nan", "NaN"])
    if step_col in raw.columns:
        step = raw.get_column(step_col).cast(pl.Float64, strict=False).alias(STEP)
        raw = raw.drop(step_col)
    else:
        step = pl.Series(STEP, range(raw.height), dtype=pl.Float64)
    columns = [step]
    for name in raw.columns:
        series = raw.get_column(name)
        if series.dtype.is_numeric() or series.dtype == pl.Boolean:
            columns.append(series.cast(pl.Float64))
            continue
        cast_series = series.cast(pl.Float64, strict=False)
        if cast_series.null_count() == series.null_count():
            columns.append(cast_series)
    frame = pl.DataFrame(columns).filter(pl.col(STEP).is_not_null())
    return frame.sort(STEP, maintain_order=True)


def run_id_for(root: Path, run_dir: Path, *, prefix_root: bool) -> str:
    """Stable id: path relative to its root, optionally prefixed by the root's name."""
    if run_dir == root:
        return run_dir.name
    rel = run_dir.relative_to(root).as_posix()
    return f"{root.name}/{rel}" if prefix_root else rel


def load_run(run_id: str, run_dir: Path, config_path: Path, csv_path: Path, step_col: str) -> Run:
    with config_path.open(encoding="utf-8") as handle:
        config_obj: object = yaml.safe_load(handle)
    frame = read_metrics(csv_path, step_col)
    return Run(
        id=run_id,
        name=run_dir.name,
        path=run_dir,
        config=flatten_config(config_obj),
        metrics=tuple(c for c in frame.columns if c != STEP),
        frame=frame,
    )


class RunStore:
    """Thread-safe, mtime-cached collection of runs under one or more roots."""

    def __init__(self, roots: Iterable[Path], step_col: str = STEP) -> None:
        self.roots = [Path(r) for r in roots]
        self.step_col = step_col
        self._lock = threading.Lock()
        self._cache: dict[Path, _CacheEntry] = {}
        self._runs: dict[str, Run] = {}
        self.errors: list[str] = []

    def reload(self) -> None:
        runs: dict[str, Run] = {}
        errors: list[str] = []
        cache: dict[Path, _CacheEntry] = {}
        prefix_root = len(self.roots) > 1
        for root, run_dir, config, csv in discover(self.roots):
            stamp = (config.stat().st_mtime, csv.stat().st_mtime)
            cached = self._cache.get(run_dir)
            run_id = run_id_for(root, run_dir, prefix_root=prefix_root)
            try:
                if cached is not None and cached.stamp == stamp:
                    run = cached.run
                else:
                    run = load_run(run_id, run_dir, config, csv, self.step_col)
            except (OSError, yaml.YAMLError, pl.exceptions.PolarsError) as exc:
                errors.append(f"{run_dir}: {exc}")
                continue
            cache[run_dir] = _CacheEntry(stamp, run)
            runs[run.id] = run
        with self._lock:
            self._cache = cache
            self._runs = runs
            self.errors = errors

    def runs(self) -> list[Run]:
        with self._lock:
            return sorted(self._runs.values(), key=lambda r: r.id)

    def get(self, run_ids: Iterable[str] | None) -> list[Run]:
        with self._lock:
            if run_ids is None:
                return sorted(self._runs.values(), key=lambda r: r.id)
            return [self._runs[i] for i in run_ids if i in self._runs]
