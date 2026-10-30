"""Generate a synthetic sweep of runs for trying out MLCompare.

Usage: ``uv run python examples/make_demo_runs.py demo_runs``
"""

from __future__ import annotations

import argparse
import csv
import itertools
import math
import random
from pathlib import Path

import yaml


def write_run(  # noqa: PLR0913
    out: Path, *, lr: float, batch_size: int, optimizer: str, seed: int, steps: int
) -> None:
    rng = random.Random(hash((lr, batch_size, optimizer, seed)) & 0xFFFFFFFF)
    out.mkdir(parents=True, exist_ok=True)
    config: dict[str, object] = {
        "model": {"name": "mlp", "width": 256, "depth": 4},
        "optim": {"name": optimizer, "lr": lr, "weight_decay": 0.01},
        "batch_size": batch_size,
        "seed": seed,
    }
    if optimizer == "adamw":
        config["optim"] = {**config["optim"], "betas": [0.9, 0.95]}  # type: ignore[dict-item]
    if seed % 2 == 0:
        config["warmup_steps"] = 200
    with (out / "config.yaml").open("w", encoding="utf-8") as handle:
        yaml.safe_dump(config, handle, sort_keys=False)

    speed = math.log10(lr / 1e-5) * (1.3 if optimizer == "adamw" else 1.0)
    floor = 0.15 + 0.05 * math.log2(batch_size / 32) + rng.uniform(-0.03, 0.03)
    with (out / "metrics.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            ["step", "train/loss", "train/grad_norm", "eval/loss", "eval/accuracy", "lr"]
        )
        for step in range(0, steps + 1, 10):
            t = step / steps
            loss = floor + 2.3 * math.exp(-speed * 3 * t) + rng.gauss(0, 0.04)
            grad = 1.5 * math.exp(-2 * t) + abs(rng.gauss(0, 0.2))
            sched = lr * min(1.0, step / 200) * 0.5 * (1 + math.cos(math.pi * t))
            row: list[object] = [step, f"{loss:.5f}", f"{grad:.5f}", "", "", f"{sched:.3e}"]
            if step % 100 == 0:
                eval_loss = loss + 0.05 + rng.gauss(0, 0.02)
                acc = 1 / (1 + math.exp(3 * (eval_loss - 0.9)))
                row[3], row[4] = f"{eval_loss:.5f}", f"{acc:.5f}"
            writer.writerow(row)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("out", type=Path, nargs="?", default=Path("demo_runs"))
    parser.add_argument("--steps", type=int, default=2000)
    args = parser.parse_args()
    out: Path = args.out
    grid = itertools.product([1e-4, 3e-4, 1e-3], [32, 128], ["adam", "adamw"], range(3))
    for lr, bs, opt, seed in grid:
        write_run(
            out / opt / f"lr{lr:g}_bs{bs}_s{seed}",
            lr=lr,
            batch_size=bs,
            optimizer=opt,
            seed=seed,
            steps=args.steps,
        )
    print(f"wrote demo runs to {out}")


if __name__ == "__main__":
    main()
