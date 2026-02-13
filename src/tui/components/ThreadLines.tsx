import React from "react";
import { Box, Text } from "ink";
import { theme, sym } from "../theme.js";
import { sanitize } from "../../utils/sanitize.js";
import type { ThreadContext } from "../../messaging/dag.js";

interface ThreadLinesProps {
  thread: ThreadContext | null;
  focused: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + sym.ellipsis : s;
}

export function ThreadLines({ thread, focused }: ThreadLinesProps) {
  const hasAncestors = thread && thread.ancestors.length > 0;

  return (
    <Box
      flexDirection="column"
      width={30}
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
          {"─".repeat(26)}
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
                    {truncate(sender, 12)}
                  </Text>
                </Box>
                <Box flexDirection="row" paddingLeft={3}>
                  <Text color={theme.dim} dimColor>
                    {truncate(sanitize(msg.text), 22)}
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
                  12,
                )}
              </Text>
              <Text color={theme.dim}>
                {" "}{formatTime(thread.message.created_at)}
              </Text>
            </Box>
            <Box flexDirection="row" paddingLeft={2}>
              <Text color={theme.text}>
                {truncate(sanitize(thread.message.text), 24)}
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
                    {truncate(sender, 12)}
                  </Text>
                </Box>
                <Box flexDirection="row" paddingLeft={3}>
                  <Text color={theme.textSecondary}>
                    {truncate(sanitize(msg.text), 22)}
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
