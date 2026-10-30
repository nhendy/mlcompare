from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
import pytest

from mlcompare.aggregate import assign_groups, compute_series, group_key
from mlcompare.api import create_app
from mlcompare.loader import NA, RunStore, flatten_config, read_metrics
from mlcompare.models import SeriesRequest

if TYPE_CHECKING:
    from pathlib import Path


def _make_run(root: Path, name: str, config: str, rows: str) -> None:
    run = root / name
    run.mkdir(parents=True)
    (run / "config.yaml").write_text(config)
    (run / "metrics.csv").write_text(rows)


@pytest.fixture
def store(tmp_path: Path) -> RunStore:
    _make_run(tmp_path, "a", "lr: 0.1\nbs: 32\n", "step,loss,acc\n0,1.0,\n1,0.5,0.7\n2,0.25,\n")
    _make_run(tmp_path, "b", "lr: 0.1\nbs: 64\n", "step,loss,acc\n0,3.0,\n1,1.5,0.9\n2,0.75,\n")
    _make_run(tmp_path, "nested/c", "lr: 0.01\n", "step,loss\n0,2.0\n1,2.0\n2,2.0\n")
    (tmp_path / "not_a_run").mkdir()
    s = RunStore([tmp_path])
    s.reload()
    return s


def test_flatten_config() -> None:
    cfg = {"a": {"b": 1, "c": {"d": True}}, "e": [1, 2], "f": None, "g": {}}
    assert flatten_config(cfg) == {
        "a.b": "1",
        "a.c.d": "true",
        "e": "[1, 2]",
        "f": "null",
        "g": "{}",
    }


def test_read_metrics_sparse_and_drops_text(tmp_path: Path) -> None:
    path = tmp_path / "m.csv"
    path.write_text("step,loss,note,acc\n2,0.5,hi,\n0,1.0,x,0.1\n")
    df = read_metrics(path)
    assert df.columns == ["step", "loss", "acc"]
    assert df.get_column("step").to_list() == [0.0, 2.0]
    assert df.get_column("acc").to_list() == [0.1, None]


def test_discovery(store: RunStore) -> None:
    assert [r.id for r in store.runs()] == ["a", "b", "nested/c"]
    assert store.runs()[2].metrics == ("loss",)


def test_grouping_with_missing_key(store: RunStore) -> None:
    groups = assign_groups(store.runs(), ["lr", "bs"])
    assert groups == {
        f"lr:0.01,bs:{NA}": ["nested/c"],
        "lr:0.1,bs:32": ["a"],
        "lr:0.1,bs:64": ["b"],
    }
    assert group_key({"lr": "0.1"}, ["lr", "bs"]) == f"lr:0.1,bs:{NA}"
    assert list(assign_groups(store.runs(), [])) == ["all runs"]


def test_mean_std_aggregation(store: RunStore) -> None:
    req = SeriesRequest(metrics=["loss", "acc"], group_by=["lr"], include_runs=True)
    res = compute_series(store.runs(), req)
    by_key = {g.key: g for g in res.metrics["loss"]}
    g = by_key["lr:0.1"]
    assert g.x == [0.0, 1.0, 2.0]
    assert g.center == [2.0, 1.0, 0.5]
    assert g.count == [2, 2, 2]
    assert g.upper[0] == pytest.approx(2.0 + 2**0.5)
    assert len(g.runs) == 2
    single = by_key["lr:0.01"]
    assert single.lower == single.center == single.upper
    acc = res.metrics["acc"]
    assert [x.key for x in acc] == ["lr:0.1"]
    assert acc[0].x == [1.0]


def test_median_minmax_binning_smoothing(store: RunStore) -> None:
    req = SeriesRequest(metrics=["loss"], stat="median_minmax", bins=1, smoothing=0.5)
    (group,) = compute_series(store.runs(), req).metrics["loss"]
    assert group.key == "all runs"
    assert group.x == [1.0]
    assert group.count == [3]
    assert group.lower[0] <= group.center[0] <= group.upper[0]


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_api(store: RunStore) -> None:
    transport = httpx.ASGITransport(app=create_app(store))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        runs: dict[str, list[dict[str, object]]] = (await client.get("/api/runs")).json()
        assert {k["key"]: k["missing"] for k in runs["config_keys"]} == {"bs": 1, "lr": 0}
        assert runs["metrics"] == ["acc", "loss"]
        res = await client.post(
            "/api/series", json={"metrics": ["loss"], "group_by": ["bs"], "run_ids": ["a", "b"]}
        )
        assert res.status_code == 200
        body: dict[str, dict[str, list[dict[str, object]]]] = res.json()
        assert [g["key"] for g in body["metrics"]["loss"]] == ["bs:32", "bs:64"]
        bad = await client.post("/api/series", json={"metrics": ["loss"], "smoothing": 1.0})
        assert bad.status_code == 422
        index = await client.get("/")
        assert index.status_code == 200
