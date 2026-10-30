import { useState } from "react";
import type { RunInfo } from "../api";
import { NA } from "../groups";

interface RunsTableProps {
  runs: RunInfo[];
  columns: string[];
  colorOf: ReadonlyMap<string, string>;
  hidden: ReadonlySet<string>;
  onSetHidden: (ids: string[], hide: boolean) => void;
}

function matches(run: RunInfo, query: string): boolean {
  if (run.id.toLowerCase().includes(query)) return true;
  return Object.entries(run.config).some(([k, v]) => `${k}:${v}`.toLowerCase().includes(query));
}

function formatStep(step: number | null): string {
  if (step === null) return "–";
  return step >= 10_000 ? `${(step / 1000).toFixed(step >= 100_000 ? 0 : 1)}k` : String(step);
}

export function RunsTable({ runs, columns, colorOf, hidden, onSetHidden }: RunsTableProps) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q ? runs.filter((r) => matches(r, q)) : runs;
  const shown = visible.filter((r) => !hidden.has(r.id)).length;
  const ids = visible.map((r) => r.id);

  return (
    <div className="runs">
      <div className="runs-head">
        <input
          className="search"
          type="search"
          placeholder="Filter runs, e.g. lr:0.001"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        <label className="runs-all" title={shown === visible.length ? "Hide these runs" : "Show these runs"}>
          <input
            type="checkbox"
            checked={visible.length > 0 && shown === visible.length}
            ref={(el) => {
              if (el) el.indeterminate = shown > 0 && shown < visible.length;
            }}
            onChange={() => {
              onSetHidden(ids, shown === visible.length);
            }}
          />
          <span>
            {shown} of {visible.length} shown
          </span>
        </label>
      </div>
      <div className="runs-scroll">
        <table>
          <thead>
            <tr>
              <th />
              <th>Run</th>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th className="num">Last step</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((run) => {
              const off = hidden.has(run.id);
              return (
                <tr
                  key={run.id}
                  className={off ? "row-off" : undefined}
                  onClick={() => {
                    onSetHidden([run.id], !off);
                  }}
                >
                  <td>
                    <span className="dot" style={{ background: colorOf.get(run.id) }} />
                  </td>
                  <td className="run-name" title={run.path}>
                    {run.id}
                  </td>
                  {columns.map((c) => (
                    <td key={c} className={run.config[c] === undefined ? "na" : undefined}>
                      {run.config[c] ?? NA}
                    </td>
                  ))}
                  <td className="num">{formatStep(run.last_step)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && <p className="none">No runs match “{query}”.</p>}
      </div>
    </div>
  );
}
