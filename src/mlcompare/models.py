"""Wire types shared by the API and the aggregation layer."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Stat = Literal["mean_std", "mean_sem", "median_minmax", "median_iqr"]


class RunInfo(BaseModel):
    id: str
    name: str
    path: str
    config: dict[str, str]
    metrics: list[str]
    num_rows: int
    last_step: float | None


class ConfigKeyInfo(BaseModel):
    key: str
    values: list[str]
    missing: int


class RunsResponse(BaseModel):
    runs: list[RunInfo]
    config_keys: list[ConfigKeyInfo]
    metrics: list[str]
    errors: list[str]


class SeriesRequest(BaseModel):
    run_ids: list[str] | None = None
    metrics: list[str]
    group_by: list[str] = Field(default_factory=list[str])
    stat: Stat = "mean_std"
    smoothing: float = Field(default=0.0, ge=0.0, lt=1.0)
    bins: int = Field(default=0, ge=0, le=10_000)
    include_runs: bool = False


class RunLine(BaseModel):
    run_id: str
    x: list[float]
    y: list[float]


class GroupSeries(BaseModel):
    key: str
    run_ids: list[str]
    x: list[float]
    center: list[float]
    lower: list[float]
    upper: list[float]
    count: list[int]
    runs: list[RunLine]


class SeriesResponse(BaseModel):
    metrics: dict[str, list[GroupSeries]]
