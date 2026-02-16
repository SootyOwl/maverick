import React from "react";
import { Box, Text } from "ink";
import { theme, sym } from "../theme.js";
import { sanitize } from "../../utils/sanitize.js";
import type { VisibleMessage } from "../../messaging/dag.js";

interface MessageProps {
  message: VisibleMessage;
  selected: boolean;
  /** Whether the previous message was from the same sender (for grouping) */
  compact?: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function Message({ message, selected, compact }: MessageProps) {
  const time = formatTime(message.createdAt);
  const sender = sanitize(message.senderHandle ?? shortId(message.senderInboxId));
  const hasParents = message.parentIds.length > 0;

  return (
    <Box flexDirection="column">
      {/* Reply context line */}
      {hasParents && (
        <Box paddingLeft={3}>
          <Text color={theme.dim}>
            {sym.treeCorner}{sym.treeHoriz}{" "}
          </Text>
          <Text color={theme.dim}>
            reply to {message.parentIds.map(shortId).join(", ")}
          </Text>
        </Box>
      )}

      {/* Main message line */}
      <Box flexDirection="row">
        {/* Selection indicator */}
        <Text color={selected ? theme.accent : undefined}>
          {selected ? sym.bar : " "}
        </Text>

        {/* Timestamp */}
        <Text color={selected ? theme.textSecondary : theme.dim}>
          {" "}{time}{" "}
        </Text>

        {/* Sender (hidden if compact/grouped) */}
        {compact ? (
          <Text>{"".padEnd(sender.length > 20 ? 21 : sender.length + 1)}</Text>
        ) : (
          <Text color={theme.channels} bold>
            {sender.length > 20 ? sender.slice(0, 19) + sym.ellipsis : sender}
            {" "}
          </Text>
        )}

        {/* Message body */}
        <Text color={selected ? theme.text : theme.textSecondary} wrap="wrap">
          {sanitize(message.text.length > 500 ? message.text.slice(0, 497) + "..." : message.text)}
        </Text>

        {/* Edited badge */}
        {message.edited && (
          <Text color={theme.yellowDim} dimColor>
            {" "}(edited)
          </Text>
        )}
      </Box>
    </Box>
  );
}
