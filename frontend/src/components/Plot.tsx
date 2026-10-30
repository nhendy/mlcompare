import Plotly from "plotly.js-basic-dist-min";
import { useEffect, useRef } from "react";

export type XRange = readonly [number, number] | null;

interface PlotProps {
  data: Plotly.Data[];
  layout: Partial<Plotly.Layout>;
  filename: string;
  onXRange?: (range: XRange) => void;
}

const CONFIG: Partial<Plotly.Config> = {
  displaylogo: false,
  responsive: true,
  scrollZoom: false,
  modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toggleSpikelines"],
};

function readXRange(event: Readonly<Plotly.PlotRelayoutEvent>): XRange | undefined {
  const fields = event as Record<string, unknown>;
  if (fields["xaxis.autorange"] === true) return null;
  const lo = fields["xaxis.range[0]"];
  const hi = fields["xaxis.range[1]"];
  if (typeof lo === "number" && typeof hi === "number") return [lo, hi];
  const range = fields["xaxis.range"];
  if (Array.isArray(range) && typeof range[0] === "number" && typeof range[1] === "number") {
    return [range[0], range[1]];
  }
  return undefined;
}

/** Thin imperative wrapper around Plotly.react with resize handling. */
export function Plot({ data, layout, filename, onXRange }: PlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onXRangeRef = useRef(onXRange);
  useEffect(() => {
    onXRangeRef.current = onXRange;
  });

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const config = { ...CONFIG, toImageButtonOptions: { filename, scale: 2 } };
    void Plotly.react(el, data, layout, config).then((plot) => {
      plot.removeAllListeners("plotly_relayout");
      plot.on("plotly_relayout", (event) => {
        const range = readXRange(event);
        if (range !== undefined) onXRangeRef.current?.(range);
      });
    });
  }, [data, layout, filename]);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const observer = new ResizeObserver(() => {
      if (el.isConnected && el.offsetParent !== null) {
        Plotly.Plots.resize(el);
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      Plotly.purge(el);
    };
  }, []);

  return <div ref={ref} className="plot" />;
}
