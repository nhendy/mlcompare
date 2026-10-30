import { useMemo } from "react";
import { buildLayout, buildTraces, type ChartTheme, type StyledGroup } from "../charts";
import { Plot, type XRange } from "./Plot";

interface MetricPanelProps {
  metric: string;
  groups: StyledGroup[];
  theme: ChartTheme;
  revision: string;
  logY: boolean;
  showRuns: boolean;
  xRange: XRange;
  onXRange: (range: XRange) => void;
  onExpand?: () => void;
  onClose?: () => void;
  large?: boolean;
}

export function MetricPanel(props: MetricPanelProps) {
  const { metric, groups, theme, revision, logY, showRuns, xRange, onXRange } = props;
  const data = useMemo(() => buildTraces(groups, showRuns), [groups, showRuns]);
  const layout = useMemo(
    () => buildLayout(theme, `${revision}|${metric}`, logY, xRange),
    [theme, revision, metric, logY, xRange],
  );
  const empty = groups.length === 0;
  return (
    <section className={props.large === true ? "panel panel-large" : "panel"}>
      <header className="panel-head">
        <h3 title={metric}>{metric}</h3>
        <div className="panel-actions">
          {props.onExpand && (
            <button type="button" className="icon-btn" onClick={props.onExpand} title="Expand">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
              </svg>
            </button>
          )}
          {props.onClose && (
            <button type="button" className="icon-btn" onClick={props.onClose} title="Close">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          )}
        </div>
      </header>
      {empty ? (
        <p className="panel-empty">No selected run logs this metric.</p>
      ) : (
        <Plot data={data} layout={layout} filename={metric.replaceAll("/", "_")} onXRange={onXRange} />
      )}
    </section>
  );
}
