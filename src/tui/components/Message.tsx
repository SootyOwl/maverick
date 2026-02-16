import React from "react";
import { Box, Text, useStdout } from "ink";
import { theme, sym } from "../theme.js";
import { sanitize } from "../../utils/sanitize.js";
import { formatTime, truncate } from "../utils.js";
import type { VisibleMessage } from "../../messaging/dag.js";

interface MessageProps {
  message: VisibleMessage;
  selected: boolean;
  /** Whether the previous message was from the same sender (for grouping) */
  compact?: boolean;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function Message({ message, selected, compact }: MessageProps) {
  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;

  const time = formatTime(message.createdAt);
  const rawSender = message.senderHandle ?? shortId(message.senderInboxId);
  const sender = sanitize(truncate(rawSender, 20));
  const hasParents = message.parentIds.length > 0;
  const bodyText = sanitize(message.text.length > 500 ? message.text.slice(0, 497) + "..." : message.text);

  // Calculate available width for the message body in a single-line layout:
  // indicator(1) + space+time+space(8) + sender(len) + space(1) + edited(~9) + border/padding(~6)
  const senderWidth = compact ? (rawSender.length > 20 ? 21 : rawSender.length + 1) : (sender.length + 1);
  const prefixWidth = 1 + 8 + senderWidth;
  const availableBody = termWidth - prefixWidth - 10; // some margin for borders/padding
  const isLong = bodyText.length > availableBody && availableBody > 0;

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

      {isLong ? (
        /* Two-line layout for long messages: header row then wrapped body */
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text color={selected ? theme.accent : undefined}>
              {selected ? sym.bar : " "}
            </Text>
            <Text color={selected ? theme.textSecondary : theme.dim}>
              {" "}{time}{" "}
            </Text>
            {compact ? (
              <Text>{"".padEnd(senderWidth)}</Text>
            ) : (
              <Text color={theme.channels} bold>
                {sender}{" "}
              </Text>
            )}
            {message.edited && (
              <Text color={theme.yellowDim} dimColor> (edited)</Text>
            )}
          </Box>
          <Box paddingLeft={9}>
            <Text color={selected ? theme.text : theme.textSecondary} wrap="wrap">
              {bodyText}
            </Text>
          </Box>
        </Box>
      ) : (
        /* Single-line layout for short messages */
        <Box flexDirection="row">
          <Text color={selected ? theme.accent : undefined}>
            {selected ? sym.bar : " "}
          </Text>
          <Text color={selected ? theme.textSecondary : theme.dim}>
            {" "}{time}{" "}
          </Text>
          {compact ? (
            <Text>{"".padEnd(senderWidth)}</Text>
          ) : (
            <Text color={theme.channels} bold>
              {sender}{" "}
            </Text>
          )}
          <Text color={selected ? theme.text : theme.textSecondary}>
            {bodyText}
          </Text>
          {message.edited && (
            <Text color={theme.yellowDim} dimColor>
              {" "}(edited)
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
