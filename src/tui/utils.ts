import { theme, sym } from "./theme.js";
import { sanitize } from "../utils/sanitize.js";
import type { VisibleMessage } from "../messaging/dag.js";

// ── Shared helpers ──────────────────────────────────────────────────────

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

// ── Formatting types ────────────────────────────────────────────────────

export interface TextSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}

export interface FormattedLine {
  spans: TextSpan[];
}

export interface FormattedMessage {
  lines: FormattedLine[];
  messageId: string;
}

export interface PanelMetrics {
  totalWidth: number;
  senderWidth: number;
  gutterWidth: number;
  bodyWidth: number;
}

export interface FormatOptions {
  selected: boolean;
  compact: boolean;
}

// ── Panel metrics ───────────────────────────────────────────────────────

export function getPanelMetrics(termWidth: number): PanelMetrics {
  const sidebarWidth = Math.max(16, Math.min(26, Math.floor(termWidth * 0.25)));
  const threadWidth = Math.max(20, Math.min(34, Math.floor(termWidth * 0.2)));
  // 2 separator columns + 2 border chars (borderStyle="round") + 2 paddingX on inner content
  const totalWidth = Math.max(20, termWidth - sidebarWidth - threadWidth - 6);

  const INDICATOR_W = 2; // "▎ " or "  "
  const TIME_W = 6;      // "HH:MM "
  const senderWidth = Math.max(6, Math.min(14, Math.floor(totalWidth * 0.2)));
  const gutterWidth = INDICATOR_W + TIME_W + senderWidth;
  const bodyWidth = Math.max(10, totalWidth - gutterWidth);

  return { totalWidth, senderWidth, gutterWidth, bodyWidth };
}

// ── Word wrap ───────────────────────────────────────────────────────────

export function wordWrap(text: string, width: number): string[] {
  if (width <= 0) return [text];
  if (text.length === 0) return [""];
  if (text.length <= width) return [text];

  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= width) {
      lines.push(remaining);
      break;
    }

    let breakAt = remaining.lastIndexOf(" ", width);
    if (breakAt <= 0) {
      // No word boundary — hard-break
      breakAt = width;
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt);
    } else {
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt + 1);
    }
  }

  return lines;
}

// ── Message formatter ───────────────────────────────────────────────────

export function formatMessage(
  msg: VisibleMessage,
  metrics: PanelMetrics,
  opts: FormatOptions,
): FormattedMessage {
  const { selected, compact } = opts;
  const lines: FormattedLine[] = [];

  // --- Reply context ---
  if (msg.parentIds.length > 0) {
    const ids = msg.parentIds.map((id) => id.slice(0, 8)).join(", ");
    lines.push({
      spans: [
        { text: "   " },
        { text: `${sym.treeCorner}${sym.treeHoriz} reply to ${ids}`, color: theme.dim },
      ],
    });
  }

  // --- Prepare content ---
  const rawSender = msg.senderHandle ?? msg.senderInboxId.slice(0, 8);
  const senderDisplay = sanitize(truncate(rawSender, metrics.senderWidth - 1));
  const bodyRaw = msg.text.length > 500 ? msg.text.slice(0, 497) + "..." : msg.text;
  const bodyText = sanitize(bodyRaw);

  // Word-wrap body
  const bodyLines = wordWrap(bodyText, metrics.bodyWidth);

  // --- Build the header line (first content line) ---
  const indicatorChar = selected ? sym.bar : " ";
  const time = formatTime(msg.createdAt);

  const indicatorSpan: TextSpan = {
    text: indicatorChar + " ",
    color: selected ? theme.accent : undefined,
  };
  const timeSpan: TextSpan = {
    text: time.padEnd(6),
    color: selected ? theme.textSecondary : theme.dim,
  };
  const senderSpan: TextSpan = compact
    ? { text: "".padEnd(metrics.senderWidth) }
    : { text: senderDisplay.padEnd(metrics.senderWidth), color: theme.channels, bold: true };

  const firstBody = bodyLines[0] ?? "";
  const isOnlyLine = bodyLines.length <= 1;

  // If edited and this is the only body line, split off the suffix
  const headerSpans: TextSpan[] = [indicatorSpan, timeSpan, senderSpan];
  if (msg.edited && isOnlyLine) {
    headerSpans.push({ text: firstBody, color: selected ? theme.text : theme.textSecondary });
    headerSpans.push({ text: " (edited)", color: theme.yellowDim, dimColor: true });
  } else {
    headerSpans.push({ text: firstBody, color: selected ? theme.text : theme.textSecondary });
  }
  lines.push({ spans: headerSpans });

  // --- Continuation lines ---
  const gutterPad = "".padEnd(metrics.gutterWidth);
  for (let i = 1; i < bodyLines.length; i++) {
    const isLast = i === bodyLines.length - 1;
    const spans: TextSpan[] = [{ text: gutterPad }];

    if (msg.edited && isLast) {
      spans.push({ text: bodyLines[i], color: selected ? theme.text : theme.textSecondary });
      spans.push({ text: " (edited)", color: theme.yellowDim, dimColor: true });
    } else {
      spans.push({ text: bodyLines[i], color: selected ? theme.text : theme.textSecondary });
    }
    lines.push({ spans });
  }

  return { lines, messageId: msg.id };
}
