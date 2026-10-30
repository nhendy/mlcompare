import { useState, type CSSProperties } from "react";
import type { Group } from "../groups";

interface GroupLegendProps {
  groups: Group[];
  names: Record<string, string>;
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onSolo: (key: string) => void;
  onRename: (key: string, name: string) => void;
}

/** One chip per group: click to hide/show, double-click the name to rename. */
export function GroupLegend({ groups, names, hidden, onToggle, onSolo, onRename }: GroupLegendProps) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="legend" aria-label="Groups">
      {groups.map((g) => {
        const name = names[g.key] ?? g.key;
        const off = hidden.has(g.key);
        return (
          <div key={g.key} className={off ? "chip chip-off" : "chip"} style={{ "--c": g.color } as CSSProperties}>
            <button
              type="button"
              className="swatch"
              aria-pressed={!off}
              title={off ? "Show group (alt-click: show only this)" : "Hide group (alt-click: show only this)"}
              onClick={(e) => {
                if (e.altKey) onSolo(g.key);
                else onToggle(g.key);
              }}
            />
            {editing === g.key ? (
              <input
                className="chip-input"
                autoFocus
                defaultValue={name}
                onBlur={(e) => {
                  onRename(g.key, e.target.value.trim());
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="chip-name"
                title={`${g.key}\nDouble-click to rename`}
                onClick={() => {
                  onToggle(g.key);
                }}
                onDoubleClick={() => {
                  setEditing(g.key);
                }}
              >
                {name}
              </button>
            )}
            <span className="chip-count">{g.runIds.length}</span>
          </div>
        );
      })}
    </div>
  );
}
