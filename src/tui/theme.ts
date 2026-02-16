export const theme = {
  // Background layers — kept subtle so they don't fight the terminal bg
  bg: "",
  surface: "#1e293b",
  surfaceHover: "#334155",
  overlay: "#1e293b",

  // Borders — bright enough to see on dark terminals
  border: "#475569",
  borderFocus: "#3b82f6",
  borderSubtle: "#334155",

  // Text
  text: "#e2e8f0",
  textSecondary: "#94a3b8",
  muted: "#94a3b8",
  dim: "#64748b",

  // Accent
  accent: "#3b82f6",
  accentDim: "#2563eb",
  accentBright: "#60a5fa",

  // Semantic
  channels: "#06b6d4",
  channelDim: "#0891b2",
  messages: "#f97316",
  green: "#22c55e",
  greenDim: "#16a34a",
  red: "#ef4444",
  redDim: "#dc2626",
  yellow: "#eab308",
  yellowDim: "#ca8a04",
  purple: "#a78bfa",
  pink: "#f472b6",

  // Special
  selection: "#2d4a7a",
  highlight: "#2563eb",
};

/** Unicode symbols for consistent visual language */
export const sym = {
  // Selection & status
  dot: "●",
  dotEmpty: "○",
  dotSmall: "•",
  check: "✓",
  cross: "✗",
  arrow: "→",
  arrowLeft: "←",
  chevronRight: "›",
  chevronDown: "⌄",

  // Indicators
  bar: "▎",
  barThick: "▌",
  block: "█",
  blockLight: "░",

  // Threading
  treeVert: "│",
  treeBranch: "├",
  treeEnd: "└",
  treeHoriz: "─",
  treeCorner: "╰",
  replyArrow: "↳",

  // Channel
  hash: "#",

  // Loading spinner frames
  spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],

  // Decorative
  ellipsis: "…",
  separator: "·",
  pipe: "│",
};
