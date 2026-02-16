import { sym } from "./theme.js";

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + sym.ellipsis : s;
}

/**
 * Estimate how many terminal rows a message will occupy.
 * Reply context adds 1 row, the main line is 1 for short messages
 * or 2 for long messages (header + wrapped body).
 */
export function estimateMessageHeight(
  textLength: number,
  hasParents: boolean,
  availableWidth: number,
): number {
  let rows = 0;
  if (hasParents) rows += 1; // reply context line
  // Header prefix is roughly: indicator(1) + space(1) + time(6) + space(1) + sender(~15) + space(1) = ~25
  const headerWidth = 25;
  const bodyWidth = availableWidth - headerWidth;
  if (bodyWidth > 0 && textLength > bodyWidth) {
    // Two-line layout: header row + wrapped body row(s)
    rows += 1 + Math.ceil(textLength / availableWidth);
  } else {
    rows += 1; // single line
  }
  return rows;
}
