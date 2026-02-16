import React from "react";
import { Box, Text, useStdout } from "ink";
import { theme, sym } from "../theme.js";
import { sanitize } from "../../utils/sanitize.js";
import { formatTime, truncate } from "../utils.js";
import type { ThreadContext } from "../../messaging/dag.js";

interface ThreadLinesProps {
  thread: ThreadContext | null;
  focused: boolean;
}

export function ThreadLines({ thread, focused }: ThreadLinesProps) {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  // Thread panel: ~20% of width, clamped to 20–34
  const panelWidth = Math.max(20, Math.min(34, Math.floor(cols * 0.2)));
  // Derive truncation lengths from panel width (account for border + padding)
  const innerWidth = panelWidth - 4;
  const senderMax = Math.max(6, Math.floor(innerWidth * 0.45));
  const textMax = Math.max(8, innerWidth - 3);
  const currentTextMax = Math.max(10, innerWidth - 2);

  const hasAncestors = thread && thread.ancestors.length > 0;

  return (
    <Box
      flexDirection="column"
      width={panelWidth}
      borderStyle="round"
      borderColor={focused ? theme.accent : theme.border}
    >
      {/* Header */}
      <Box paddingX={1}>
        <Text bold color={focused ? theme.accentBright : theme.text}>
          Thread
        </Text>
        {thread && (
          <Text color={theme.dim}>
            {" "}{sym.separator} {thread.ancestors.length + thread.descendants.length + 1} msgs
          </Text>
        )}
      </Box>

      <Box paddingX={1}>
        <Text color={theme.borderSubtle}>
          {"─".repeat(Math.max(4, innerWidth))}
        </Text>
      </Box>

      {/* Empty state */}
      {!thread && (
        <Box paddingX={1} paddingY={1} flexDirection="column">
          <Text color={theme.dim}>
            Select a message
          </Text>
          <Text color={theme.dim}>
            and press <Text color={theme.muted}>r</Text> to view
          </Text>
          <Text color={theme.dim}>
            its thread context
          </Text>
        </Box>
      )}

      {/* Thread tree */}
      {thread && (
        <Box flexDirection="column" paddingX={1}>
          {/* Ancestors */}
          {thread.ancestors.map((msg, i) => {
            const sender = sanitize(msg.sender_handle ?? msg.sender_inbox_id.slice(0, 8));
            const isLast = !hasAncestors || i === thread.ancestors.length - 1;
            return (
              <Box key={msg.id} flexDirection="column">
                <Box flexDirection="row">
                  <Text color={theme.dim}>
                    {isLast ? sym.treeBranch : sym.treeVert}
                    {sym.treeHoriz}{" "}
                  </Text>
                  <Text color={theme.muted}>
                    {truncate(sender, senderMax)}
                  </Text>
                </Box>
                <Box flexDirection="row" paddingLeft={3}>
                  <Text color={theme.dim} dimColor>
                    {truncate(sanitize(msg.text), textMax)}
                  </Text>
                </Box>
              </Box>
            );
          })}

          {/* Current message (highlighted) */}
          <Box flexDirection="column">
            <Box flexDirection="row">
              <Text color={theme.accent} bold>
                {sym.dot}{" "}
              </Text>
              <Text color={theme.accentBright} bold>
                {truncate(
                  sanitize(thread.message.sender_handle ??
                    thread.message.sender_inbox_id.slice(0, 8)),
                  senderMax,
                )}
              </Text>
              <Text color={theme.dim}>
                {" "}{formatTime(thread.message.created_at)}
              </Text>
            </Box>
            <Box flexDirection="row" paddingLeft={2}>
              <Text color={theme.text}>
                {truncate(sanitize(thread.message.text), currentTextMax)}
              </Text>
            </Box>
          </Box>

          {/* Descendants */}
          {thread.descendants.map((msg, i) => {
            const sender = sanitize(msg.sender_handle ?? msg.sender_inbox_id.slice(0, 8));
            const isLast = i === thread.descendants.length - 1;
            return (
              <Box key={msg.id} flexDirection="column">
                <Box flexDirection="row">
                  <Text color={theme.channelDim}>
                    {isLast ? sym.treeEnd : sym.treeBranch}
                    {sym.treeHoriz}{" "}
                  </Text>
                  <Text color={theme.channels}>
                    {truncate(sender, senderMax)}
                  </Text>
                </Box>
                <Box flexDirection="row" paddingLeft={3}>
                  <Text color={theme.textSecondary}>
                    {truncate(sanitize(msg.text), textMax)}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Fill remaining space */}
      <Box flexGrow={1} />
    </Box>
  );
}
