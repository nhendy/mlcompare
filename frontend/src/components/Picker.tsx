import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
}

interface PickerProps {
  label: ReactNode;
  options: PickerOption[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  /** Keep selection order (used for group-by, where order sets the group name). */
  ordered?: boolean;
}

/** Searchable multi-select popover. */
export function Picker({ label, options, selected, onChange, placeholder, ordered }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const visible = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const chosen = new Set(selected);

  const toggle = (value: string): void => {
    if (chosen.has(value)) onChange(selected.filter((v) => v !== value));
    else if (ordered === true) onChange([...selected, value]);
    else onChange(options.map((o) => o.value).filter((v) => v === value || chosen.has(v)));
  };

  return (
    <div className="picker" ref={root}>
      <button
        type="button"
        className={open ? "control control-open" : "control"}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        {label}
        <svg className="chev" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="popover" id={listId}>
          <input
            autoFocus
            className="search"
            placeholder={placeholder ?? "Filter"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
          <div className="popover-actions">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                onChange(
                  ordered === true
                    ? [...selected, ...visible.map((o) => o.value).filter((v) => !chosen.has(v))]
                    : options.map((o) => o.value).filter((v) => chosen.has(v) || visible.some((o) => o.value === v)),
                );
              }}
            >
              Select {q ? "matching" : "all"}
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                onChange(selected.filter((v) => !visible.some((o) => o.value === v)));
              }}
            >
              Clear {q ? "matching" : "all"}
            </button>
          </div>
          <ul className="options" role="listbox" aria-multiselectable="true">
            {visible.map((o) => {
              const order = ordered === true ? selected.indexOf(o.value) : -1;
              return (
                <li key={o.value}>
                  <label className="option">
                    <input
                      type="checkbox"
                      checked={chosen.has(o.value)}
                      onChange={() => {
                        toggle(o.value);
                      }}
                    />
                    <span className="option-label">{o.label}</span>
                    {order >= 0 && <span className="order">{order + 1}</span>}
                    {o.hint !== undefined && <span className="hint">{o.hint}</span>}
                  </label>
                </li>
              );
            })}
            {visible.length === 0 && <li className="none">Nothing matches “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
