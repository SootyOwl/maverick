import React from "react";
import { Box, Text } from "ink";
import { theme, sym } from "../theme.js";
import { sanitize } from "../../utils/sanitize.js";
import type { Mode, Panel } from "../hooks/useKeyboard.js";

interface StatusBarProps {
  communityName: string;
  handle: string;
  mode: Mode;
  panel: Panel;
  error: string | null;
  customHints?: string;
  isAdmin?: boolean;
}

const BASE_HINTS: Array<[string, string]> = [
  ["j/k", "nav"],
  ["h/l", "panel"],
  ["i", "compose"],
  ["r", "reply"],
  ["R", "multi"],
  ["G", "bottom"],
  ["q", "quit"],
];

const ADMIN_HINTS: Array<[string, string]> = [
  ["I", "invite"],
  ["N", "new ch"],
];

const INSERT_HINTS: Array<[string, string]> = [
  ["Enter", "send"],
  ["Esc", "cancel"],
];

export function StatusBar({
  communityName,
  handle,
  mode,
  panel,
  error,
  customHints,
  isAdmin,
}: StatusBarProps) {
  const isInsert = mode === "insert";
  const normalHints = isAdmin ? [...BASE_HINTS, ...ADMIN_HINTS] : BASE_HINTS;
  const hints = isInsert ? INSERT_HINTS : normalHints;

  return (
    <Box flexDirection="column">
      {/* Error display */}
      {error && (
        <Box paddingX={1}>
          <Text color={theme.red} bold>
            {sym.dot}{" "}
          </Text>
          <Text color={theme.red}>
            {error.length > 80 ? error.slice(0, 79) + sym.ellipsis : error}
          </Text>
        </Box>
      )}

      {/* Main status line */}
      <Box flexDirection="row" justifyContent="space-between">
        {/* Left: mode + community + panel */}
        <Box gap={0}>
          <Text
            color="#000000"
            backgroundColor={isInsert ? theme.yellow : theme.green}
            bold
          >
            {isInsert ? " INSERT " : " NORMAL "}
          </Text>
          <Text
            color={theme.text}
            backgroundColor={theme.surfaceHover}
          >
            {" "}{sanitize(communityName)}{" "}
          </Text>
          <Text
            color={theme.muted}
            backgroundColor={theme.overlay}
          >
            {" "}{panel}{" "}
          </Text>
          <Text> </Text>
        </Box>

        {/* Right: handle */}
        <Box>
          <Text color={theme.dim}>{sym.dot} </Text>
          <Text color={theme.channels} bold>{sanitize(handle)}</Text>
          <Text> </Text>
        </Box>
      </Box>

      {/* Key hints */}
      <Box paddingX={1} gap={1}>
        {!isInsert && customHints ? (
          <Text color={theme.dim}>{customHints}</Text>
        ) : (
          hints.map(([key, desc]) => (
            <Box key={key}>
              <Text color={theme.muted}>{key}</Text>
              <Text color={theme.dim}>:{desc}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
