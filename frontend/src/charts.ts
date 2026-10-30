import type Plotly from "plotly.js-basic-dist-min";
import type { GroupSeries } from "./api";
import { withAlpha } from "./colors";
import type { XRange } from "./components/Plot";

export interface ChartTheme {
  ink: string;
  muted: string;
  grid: string;
  panel: string;
  line: string;
  font: string;
}

export interface StyledGroup {
  series: GroupSeries;
  name: string;
  color: string;
}

const FONT = "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif";

/** Keep in sync with the tokens in styles.css. */
export const CHART_THEMES: Record<"light" | "dark", ChartTheme> = {
  light: { ink: "#1d2433", muted: "#687386", grid: "#edf0f4", panel: "#ffffff", line: "#dde1e8", font: FONT },
  dark: { ink: "#e5e8ee", muted: "#8f98a9", grid: "#242a33", panel: "#1b1f27", line: "#2a303b", font: FONT },
};

function hasSpread(g: GroupSeries): boolean {
  return g.lower.some((lo, i) => lo !== g.center[i]) || g.upper.some((hi, i) => hi !== g.center[i]);
}

export function buildTraces(groups: StyledGroup[], showRuns: boolean): Plotly.Data[] {
  const traces: Plotly.Data[] = [];
  for (const { series: g, name, color } of groups) {
    const sparse = g.x.length < 40;
    if (showRuns) {
      for (const run of g.runs) {
        traces.push({
          type: "scatter",
          mode: sparse ? "lines+markers" : "lines",
          x: run.x,
          y: run.y,
          name: run.run_id,
          legendgroup: g.key,
          showlegend: false,
          line: { color: withAlpha(color, 0.35), width: 1 },
          marker: { size: 3 },
          hoverinfo: "skip",
        });
      }
    }
    if (hasSpread(g)) {
      traces.push(
        {
          type: "scatter",
          mode: "lines",
          x: g.x,
          y: g.upper,
          legendgroup: g.key,
          showlegend: false,
          line: { width: 0, color },
          hoverinfo: "skip",
        },
        {
          type: "scatter",
          mode: "lines",
          x: g.x,
          y: g.lower,
          legendgroup: g.key,
          showlegend: false,
          fill: "tonexty",
          fillcolor: withAlpha(color, 0.16),
          line: { width: 0, color },
          hoverinfo: "skip",
        },
      );
    }
    traces.push({
      type: "scatter",
      mode: sparse ? "lines+markers" : "lines",
      x: g.x,
      y: g.center,
      name,
      legendgroup: g.key,
      line: { color, width: 2 },
      marker: { size: 5, color },
      customdata: g.x.map((_, i) => [g.lower[i] ?? 0, g.upper[i] ?? 0, g.count[i] ?? 0]),
      hovertemplate: `${name}: %{y:.4g} <span style="opacity:.6">[%{customdata[0]:.4g}, %{customdata[1]:.4g}] n=%{customdata[2]}</span><extra></extra>`,
    });
  }
  return traces;
}

export function buildLayout(
  theme: ChartTheme,
  revision: string,
  logY: boolean,
  xRange: XRange,
): Partial<Plotly.Layout> {
  const axis = {
    gridcolor: theme.grid,
    linecolor: theme.line,
    zeroline: false,
    tickfont: { color: theme.muted, size: 10, family: theme.font, weight: 400 },
    exponentformat: "SI" as const,
    automargin: true,
  };
  return {
    uirevision: revision,
    margin: { l: 8, r: 12, t: 8, b: 8 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: theme.font, size: 11, color: theme.muted },
    showlegend: false,
    hovermode: "x unified",
    hoverlabel: {
      bgcolor: theme.panel,
      bordercolor: theme.line,
      font: { color: theme.ink, family: theme.font, size: 11 },
    },
    xaxis:
      xRange === null
        ? { ...axis, autorange: true }
        : { ...axis, autorange: false, range: [xRange[0], xRange[1]] },
    yaxis: logY ? { ...axis, type: "log", dtick: "D2" } : { ...axis, type: "linear" },
  };
}
