// Categorical palette tuned to stay distinct on both light and dark panels.
const PALETTE = [
  "#2f7ee0",
  "#e0a01b",
  "#1aa37a",
  "#d9485f",
  "#8b5cf6",
  "#0ea5b7",
  "#f0743a",
  "#6b8e23",
  "#c2449a",
  "#64748b",
];

export function groupColor(index: number): string {
  return PALETTE[index % PALETTE.length] ?? "#2f7ee0";
}

export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
