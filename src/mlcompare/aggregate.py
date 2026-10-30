"""Group runs by config values and aggregate metrics across each group with Polars."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import polars as pl

from mlcompare.loader import NA, STEP, Run
from mlcompare.models import GroupSeries, RunLine, SeriesRequest, SeriesResponse, Stat

if TYPE_CHECKING:
    from collections.abc import Sequence

ALL_RUNS = "all runs"
_RUN = "__run_id"
_GROUP = "__group"
_X = "__x"
_Y = "__y"


def group_key(config: dict[str, str], keys: Sequence[str]) -> str:
    """Default group name, e.g. ``lr:0.001,batch_size:64``. Missing keys become ``N/A``."""
    if not keys:
        return ALL_RUNS
    return ",".join(f"{k}:{config.get(k, NA)}" for k in keys)


def value_sort_key(value: str) -> tuple[int, float, str]:
    if value == NA:
        return (2, 0.0, value)
    try:
        return (0, float(value), value)
    except ValueError:
        return (1, 0.0, value)


def assign_groups(runs: Sequence[Run], keys: Sequence[str]) -> dict[str, list[str]]:
    """Map group name -> run ids, ordered by config values (numeric-aware, N/A last)."""
    buckets: dict[tuple[str, ...], list[str]] = {}
    for run in runs:
        values = tuple(run.config.get(k, NA) for k in keys)
        buckets.setdefault(values, []).append(run.id)
    ordered = sorted(buckets, key=lambda vs: tuple(value_sort_key(v) for v in vs))
    return {
        (",".join(f"{k}:{v}" for k, v in zip(keys, values, strict=True)) or ALL_RUNS): buckets[
            values
        ]
        for values in ordered
    }


def _long_frame(runs: Sequence[Run], metric: str, smoothing: float, bins: int) -> pl.DataFrame:
    """Stack ``(run, x, y)`` for one metric across runs, with optional EMA and step binning."""
    frames = [
        run.frame.select(pl.col(STEP).alias(_X), pl.col(metric).alias(_Y))
        .filter(pl.col(_Y).is_not_null() & pl.col(_Y).is_finite())
        .with_columns(pl.lit(run.id).alias(_RUN))
        for run in runs
        if metric in run.metrics
    ]
    if not frames:
        return pl.DataFrame(schema={_X: pl.Float64, _Y: pl.Float64, _RUN: pl.String})
    df = pl.concat(frames)
    if smoothing > 0.0:
        # Debiased EMA (TensorBoard/W&B style), applied per run before aggregation.
        df = df.with_columns(
            pl.col(_Y).ewm_mean(alpha=1.0 - smoothing, adjust=True).over(_RUN).alias(_Y)
        )
    if bins > 0 and df.height > 0:
        lo = float(df.get_column(_X).min())  # pyright: ignore[reportArgumentType]
        hi = float(df.get_column(_X).max())  # pyright: ignore[reportArgumentType]
        width = (hi - lo) / bins if hi > lo else 1.0
        idx = ((pl.col(_X) - lo) / width).floor().clip(0, bins - 1)
        df = (
            df.with_columns((lo + (idx + 0.5) * width).alias(_X))
            .group_by(_RUN, _X, maintain_order=True)
            .agg(pl.col(_Y).mean())
        )
    return df.sort(_RUN, _X)


def _bounds(stat: Stat) -> tuple[pl.Expr, pl.Expr, pl.Expr]:
    mean, med = pl.col(_Y).mean(), pl.col(_Y).median()
    std = pl.col(_Y).std(ddof=1).fill_null(0.0)
    if stat == "mean_std":
        return mean, mean - std, mean + std
    if stat == "mean_sem":
        sem = std / pl.len().cast(pl.Float64).sqrt()
        return mean, mean - sem, mean + sem
    if stat == "median_minmax":
        return med, pl.col(_Y).min(), pl.col(_Y).max()
    return med, pl.col(_Y).quantile(0.25, "linear"), pl.col(_Y).quantile(0.75, "linear")


def _finite(values: list[float]) -> list[float]:
    return [v if math.isfinite(v) else 0.0 for v in values]


def aggregate_metric(
    runs: Sequence[Run], metric: str, groups: dict[str, list[str]], request: SeriesRequest
) -> list[GroupSeries]:
    df = _long_frame(runs, metric, request.smoothing, request.bins)
    membership = pl.DataFrame(
        {
            _RUN: [rid for ids in groups.values() for rid in ids],
            _GROUP: [g for g, ids in groups.items() for _ in ids],
        },
        schema={_RUN: pl.String, _GROUP: pl.String},
    )
    df = df.join(membership, on=_RUN, how="inner")
    center, lower, upper = _bounds(request.stat)
    agg = (
        df.group_by(_GROUP, _X)
        .agg(
            center.alias("center"),
            lower.alias("lower"),
            upper.alias("upper"),
            pl.len().alias("count"),
        )
        .sort(_GROUP, _X)
    )
    out: list[GroupSeries] = []
    for name, run_ids in groups.items():
        sub = agg.filter(pl.col(_GROUP) == name)
        if sub.height == 0:
            continue
        lines: list[RunLine] = []
        if request.include_runs:
            raw = df.filter(pl.col(_GROUP) == name)
            for rid in run_ids:
                one = raw.filter(pl.col(_RUN) == rid)
                if one.height:
                    lines.append(
                        RunLine(
                            run_id=rid,
                            x=one.get_column(_X).to_list(),
                            y=one.get_column(_Y).to_list(),
                        )
                    )
        out.append(
            GroupSeries(
                key=name,
                run_ids=run_ids,
                x=sub.get_column(_X).to_list(),
                center=_finite(sub.get_column("center").to_list()),
                lower=_finite(sub.get_column("lower").to_list()),
                upper=_finite(sub.get_column("upper").to_list()),
                count=sub.get_column("count").to_list(),
                runs=lines,
            )
        )
    return out


def compute_series(runs: Sequence[Run], request: SeriesRequest) -> SeriesResponse:
    groups = assign_groups(runs, request.group_by)
    return SeriesResponse(
        metrics={m: aggregate_metric(runs, m, groups, request) for m in request.metrics}
    )
