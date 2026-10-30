"""Command line entry point: ``uv run mlcompare <dirs...>``."""

from __future__ import annotations

import argparse
import threading
import webbrowser
from pathlib import Path

import uvicorn

from mlcompare.api import create_app
from mlcompare.loader import STEP, RunStore


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mlcompare",
        description="Compare ML experiments (metrics.csv + config.yaml) in the browser.",
    )
    parser.add_argument(
        "roots",
        nargs="*",
        type=Path,
        default=[Path()],
        help="Directories to scan recursively for runs (default: current directory).",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--step-col", default=STEP, help="Name of the step column in CSVs.")
    parser.add_argument("--no-browser", action="store_true", help="Don't open a browser tab.")
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    roots: list[Path] = args.roots
    missing = [r for r in roots if not r.is_dir()]
    if missing:
        build_parser().error(f"not a directory: {', '.join(map(str, missing))}")
    store = RunStore(roots, step_col=args.step_col)
    store.reload()
    print(f"mlcompare: found {len(store.runs())} runs under {', '.join(map(str, roots))}")
    for err in store.errors:
        print(f"  skipped {err}")
    url = f"http://{args.host}:{args.port}"
    if not args.no_browser:
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    print(f"mlcompare: serving on {url}")
    uvicorn.run(create_app(store), host=args.host, port=args.port, log_level="warning")
