import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchRuns,
  fetchSeries,
  STAT_LABELS,
  type RunsResponse,
  type SeriesRequest,
  type SeriesResponse,
  type Stat,
} from "./api";
import { CHART_THEMES, type StyledGroup } from "./charts";
import { GroupLegend } from "./components/GroupLegend";
import { MetricPanel } from "./components/MetricPanel";
import { Picker } from "./components/Picker";
import type { XRange } from "./components/Plot";
import { RunsTable } from "./components/RunsTable";
import { groupRuns, sectionOf } from "./groups";
import { usePersistentSettings, type Theme } from "./settings";

const BIN_OPTIONS = [0, 50, 100, 250, 500, 1000];
const AUTO_REFRESH_MS = 15_000;

function useResolvedTheme(theme: Theme): "light" | "dark" {
  const query = "(prefers-color-scheme: dark)";
  const [systemDark, setSystemDark] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mql = matchMedia(query);
    const onChange = (e: MediaQueryListEvent): void => {
      setSystemDark(e.matches);
    };
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, []);
  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  useEffect(() => {
    document.documentElement.dataset["theme"] = resolved;
  }, [resolved]);
  return resolved;
}

export function App() {
  const [settings, update] = usePersistentSettings();
  const [data, setData] = useState<RunsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [xRange, setXRange] = useState<XRange>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const resolvedTheme = useResolvedTheme(settings.theme);
  const chartTheme = CHART_THEMES[resolvedTheme];

  // State is only set from async callbacks, so this is safe to call from effects.
  const load = useCallback((reload: boolean) => {
    fetchRuns(reload)
      .then((res) => {
        setData(res);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      load(true);
    }, AUTO_REFRESH_MS);
    return () => {
      clearInterval(id);
    };
  }, [autoRefresh, load]);

  const runs = useMemo(() => data?.runs ?? [], [data]);
  const configKeys = useMemo(() => new Set(data?.config_keys.map((k) => k.key)), [data]);
  const groupBy = useMemo(
    () => settings.groupBy.filter((k) => configKeys.has(k)),
    [settings.groupBy, configKeys],
  );
  const hiddenRuns = useMemo(() => new Set(settings.hiddenRuns), [settings.hiddenRuns]);
  const hiddenGroups = useMemo(() => new Set(settings.hiddenGroups), [settings.hiddenGroups]);
  const selectedIds = useMemo(
    () => runs.filter((r) => !hiddenRuns.has(r.id)).map((r) => r.id),
    [runs, hiddenRuns],
  );

  // Groups are computed over all runs so colors stay put when runs are hidden.
  const groups = useMemo(() => groupRuns(runs, groupBy), [runs, groupBy]);
  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const id of g.runIds) m.set(id, g.color);
    return m;
  }, [groups]);
  const legendGroups = useMemo(() => {
    const selected = new Set(selectedIds);
    return groups
      .map((g) => ({ ...g, runIds: g.runIds.filter((id) => selected.has(id)) }))
      .filter((g) => g.runIds.length > 0);
  }, [groups, selectedIds]);

  const allMetrics = useMemo(() => data?.metrics ?? [], [data]);
  const panels = useMemo(() => {
    if (settings.panels === null) return allMetrics;
    const available = new Set(allMetrics);
    return settings.panels.filter((m) => available.has(m));
  }, [settings.panels, allMetrics]);

  const request = useMemo<SeriesRequest | null>(() => {
    if (data === null || panels.length === 0 || selectedIds.length === 0) return null;
    return {
      run_ids: selectedIds.length === runs.length ? null : selectedIds,
      metrics: panels,
      group_by: groupBy,
      stat: settings.stat,
      smoothing: settings.smoothing,
      bins: settings.bins,
      include_runs: settings.showRuns,
    };
  }, [data, panels, selectedIds, runs.length, groupBy, settings.stat, settings.smoothing, settings.bins, settings.showRuns]);

  useEffect(() => {
    if (request === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSeriesLoading(true);
      fetchSeries(request, controller.signal)
        .then((res) => {
          setSeries(res);
          setSeriesError(null);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setSeriesError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setSeriesLoading(false);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [request]);

  const colorOfGroup = useMemo(() => new Map(groups.map((g) => [g.key, g.color])), [groups]);
  const styledFor = useCallback(
    (metric: string): StyledGroup[] =>
      ((request === null ? null : series)?.metrics[metric] ?? [])
        .filter((g) => !hiddenGroups.has(g.key))
        .map((g) => ({
          series: g,
          name: settings.groupNames[g.key] ?? g.key,
          color: colorOfGroup.get(g.key) ?? "#888",
        })),
    [request, series, hiddenGroups, settings.groupNames, colorOfGroup],
  );

  const sections = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const m of panels) {
      const s = sectionOf(m);
      out.set(s, [...(out.get(s) ?? []), m]);
    }
    return [...out.entries()];
  }, [panels]);

  const revision = `${groupBy.join(",")}|${settings.stat}`;
  const onXRange = useCallback(
    (range: XRange) => {
      if (settings.syncX) setXRange(range);
    },
    [settings.syncX],
  );
  const panelXRange = settings.syncX ? xRange : null;

  const toggleList = (list: string[], key: string): string[] =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

  const groupByOptions = (data?.config_keys ?? []).map((k) => ({
    value: k.key,
    label: k.key,
    hint: `${k.values.length}${k.missing ? " + N/A" : ""}`,
  }));
  const usefulKeys = (data?.config_keys ?? []).filter((k) => k.values.length + (k.missing ? 1 : 0) > 1);
  const tableColumns = groupBy.length ? groupBy : usefulKeys.slice(0, 3).map((k) => k.key);

  return (
    <div className={sidebarOpen ? "app sidebar-open" : "app"}>
      <aside className="sidebar">
        <div className="brand">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="logo">
            <path d="M1 13 L5 7 L9 9 L15 2" />
          </svg>
          <span className="wordmark">MLCompare</span>
          <span className="brand-meta">{runs.length} runs</span>
        </div>
        <RunsTable
          runs={runs}
          columns={tableColumns}
          colorOf={colorOf}
          hidden={hiddenRuns}
          onSetHidden={(ids, hide) => {
            const next = new Set(hiddenRuns);
            for (const id of ids) {
              if (hide) next.add(id);
              else next.delete(id);
            }
            update({ hiddenRuns: [...next] });
          }}
        />
        {data !== null && data.errors.length > 0 && (
          <details className="load-errors">
            <summary>{data.errors.length} folders couldn’t be read</summary>
            <ul>
              {data.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        )}
      </aside>
      <button
        type="button"
        className="scrim"
        aria-label="Close runs"
        onClick={() => {
          setSidebarOpen(false);
        }}
      />

      <main className="main">
        <div className="toolbar">
          <button
            type="button"
            className="control runs-toggle"
            onClick={() => {
              setSidebarOpen(true);
            }}
          >
            Runs
          </button>
          <Picker
            ordered
            label={
              groupBy.length ? (
                <>
                  Group by <b>{groupBy.join(", ")}</b>
                </>
              ) : (
                "Group by…"
              )
            }
            options={groupByOptions}
            selected={groupBy}
            onChange={(keys) => {
              update({ groupBy: keys, hiddenGroups: [] });
            }}
            placeholder="Filter config keys"
          />
          <label className="control">
            <span className="control-label">Show</span>
            <select
              value={settings.stat}
              onChange={(e) => {
                update({ stat: e.target.value as Stat });
              }}
            >
              {(Object.keys(STAT_LABELS) as Stat[]).map((s) => (
                <option key={s} value={s}>
                  {STAT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="control slider">
            <span className="control-label">Smoothing</span>
            <input
              type="range"
              min={0}
              max={0.99}
              step={0.01}
              value={settings.smoothing}
              onChange={(e) => {
                update({ smoothing: Number(e.target.value) });
              }}
            />
            <output>{settings.smoothing.toFixed(2)}</output>
          </label>
          <label className="control" title="Align runs that log at different steps by binning the x axis">
            <span className="control-label">Steps</span>
            <select
              value={settings.bins}
              onChange={(e) => {
                update({ bins: Number(e.target.value) });
              }}
            >
              {BIN_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b === 0 ? "Exact" : `${b} bins`}
                </option>
              ))}
            </select>
          </label>
          <Picker
            label={`Panels ${panels.length}/${allMetrics.length}`}
            options={allMetrics.map((m) => ({ value: m, label: m }))}
            selected={panels}
            onChange={(sel) => {
              update({ panels: sel.length === allMetrics.length ? null : sel });
            }}
            placeholder="Filter metrics"
          />
          <div className="toggles">
            <Toggle label="Runs" title="Draw individual runs behind each group" on={settings.showRuns} set={(v) => { update({ showRuns: v }); }} />
            <Toggle label="Log y" on={settings.logY} set={(v) => { update({ logY: v }); }} />
            <Toggle label="Sync x" title="Zooming one chart zooms them all" on={settings.syncX} set={(v) => { update({ syncX: v }); setXRange(null); }} />
          </div>
          <div className="toolbar-end">
            {(seriesLoading || refreshing) && <span className="spinner" aria-label="Loading" />}
            <button
              type="button"
              className="control"
              onClick={() => {
                setRefreshing(true);
                load(true);
              }}
              title="Rescan folders for new runs and new rows"
            >
              Refresh
            </button>
            <Toggle label="Auto" title={`Refresh every ${AUTO_REFRESH_MS / 1000}s`} on={autoRefresh} set={setAutoRefresh} />
            <button
              type="button"
              className="icon-btn theme-btn"
              title={`Theme: ${settings.theme}`}
              onClick={() => {
                const order: Theme[] = ["system", "light", "dark"];
                update({ theme: order[(order.indexOf(settings.theme) + 1) % order.length] ?? "system" });
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5.5" />
                <path d="M8 2.5v11A5.5 5.5 0 0 0 8 2.5z" className="fill" />
              </svg>
            </button>
          </div>
        </div>

        {legendGroups.length > 0 && groupBy.length > 0 && (
          <GroupLegend
            groups={legendGroups}
            names={settings.groupNames}
            hidden={hiddenGroups}
            onToggle={(key) => {
              update({ hiddenGroups: toggleList(settings.hiddenGroups, key) });
            }}
            onSolo={(key) => {
              update({ hiddenGroups: legendGroups.map((g) => g.key).filter((k) => k !== key) });
            }}
            onRename={(key, name) => {
              const names = Object.fromEntries(
                Object.entries(settings.groupNames).filter(([k]) => k !== key),
              );
              update({ groupNames: name === "" || name === key ? names : { ...names, [key]: name } });
            }}
          />
        )}

        {loadError !== null && (
          <div className="banner error">
            Couldn’t reach the MLCompare server: {loadError}. Check that <code>mlcompare</code> is
            still running, then refresh.
          </div>
        )}
        {seriesError !== null && <div className="banner error">{seriesError}</div>}

        {data !== null && runs.length === 0 && (
          <div className="empty">
            <h2>No runs found</h2>
            <p>
              MLCompare looks for folders containing a <code>config.yaml</code> and a{" "}
              <code>metrics.csv</code>. Point it at your experiment directory:
            </p>
            <pre>uv run mlcompare path/to/runs</pre>
          </div>
        )}
        {data !== null && runs.length > 0 && selectedIds.length === 0 && (
          <div className="empty">
            <h2>All runs are hidden</h2>
            <p>Tick runs in the table to plot them.</p>
          </div>
        )}

        {selectedIds.length > 0 &&
          sections.map(([section, metrics]) => (
            <details key={section} className="section" open>
              <summary>
                <span className="section-name">{section}</span>
                <span className="section-count">{metrics.length}</span>
              </summary>
              <div className="grid">
                {metrics.map((m) => (
                  <MetricPanel
                    key={m}
                    metric={m}
                    groups={styledFor(m)}
                    theme={chartTheme}
                    revision={revision}
                    logY={settings.logY}
                    showRuns={settings.showRuns}
                    xRange={panelXRange}
                    onXRange={onXRange}
                    onExpand={() => {
                      setExpanded(m);
                    }}
                  />
                ))}
              </div>
            </details>
          ))}
      </main>

      {expanded !== null && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label={expanded}
          onKeyDown={(e) => {
            if (e.key === "Escape") setExpanded(null);
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpanded(null);
          }}
        >
          <MetricPanel
            large
            metric={expanded}
            groups={styledFor(expanded)}
            theme={chartTheme}
            revision={`${revision}|expanded`}
            logY={settings.logY}
            showRuns={settings.showRuns}
            xRange={null}
            onXRange={() => undefined}
            onClose={() => {
              setExpanded(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

interface ToggleProps {
  label: string;
  on: boolean;
  set: (on: boolean) => void;
  title?: string;
}

function Toggle({ label, on, set, title }: ToggleProps) {
  return (
    <button
      type="button"
      className={on ? "toggle toggle-on" : "toggle"}
      aria-pressed={on}
      title={title}
      onClick={() => {
        set(!on);
      }}
    >
      {label}
    </button>
  );
}
