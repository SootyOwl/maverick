import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { theme, sym } from "../theme.js";
import { Spinner } from "./Spinner.js";
import { Message } from "./Message.js";
import {
  formatMessage,
  getPanelMetrics,
  type FormattedMessage,
} from "../utils.js";
import type { VisibleMessage } from "../../messaging/dag.js";

interface MessageViewProps {
  messages: VisibleMessage[];
  selectedIndex: number;
  channelName: string;
  focused: boolean;
  loading: boolean;
  availableRows?: number;
}

export function MessageView({
  messages,
  selectedIndex,
  channelName,
  focused,
  loading,
  availableRows,
}: MessageViewProps) {
  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;
  const separatorWidth = Math.max(10, termWidth - 34);
  const metrics = getPanelMetrics(termWidth);
  const effectiveRows = availableRows ?? 100;

  const [scrollOffset, setScrollOffset] = useState(0);

  // Reset scroll when channel changes
  const [prevChannel, setPrevChannel] = useState(channelName);
  if (channelName !== prevChannel) {
    setPrevChannel(channelName);
    setScrollOffset(0);
  }

  // Step 1: Compute exact line heights for all messages (selection doesn't affect height)
  const allHeights = useMemo(() => {
    return messages.map((msg, i) => {
      const prevMsg = i > 0 ? messages[i - 1] : null;
      const sameSender =
        prevMsg !== null &&
        prevMsg.senderInboxId === msg.senderInboxId &&
        msg.createdAt - prevMsg.createdAt < 300_000 &&
        msg.parentIds.length === 0;

      return formatMessage(msg, metrics, { selected: false, compact: sameSender }).lines.length;
    });
  }, [messages, metrics]);

  // Step 2: Viewport bounds using exact heights
  const { startIdx, endIdx } = useMemo(() => {
    if (messages.length === 0) return { startIdx: 0, endIdx: 0 };

    let start = scrollOffset;
    if (selectedIndex < start) start = selectedIndex;

    // Forward pass: fill viewport from start
    let rowsUsed = 0;
    let end = start;
    for (let i = start; i < messages.length; i++) {
      const h = allHeights[i];
      if (rowsUsed + h > effectiveRows && i > start) break;
      rowsUsed += h;
      end = i + 1;
    }

    // If selected is past viewport, scroll down
    if (selectedIndex >= end) {
      let rows = 0;
      end = selectedIndex + 1;
      start = selectedIndex;
      for (let i = selectedIndex; i >= 0; i--) {
        const h = allHeights[i];
        if (rows + h > effectiveRows && i < selectedIndex) break;
        rows += h;
        start = i;
      }
    }

    return { startIdx: start, endIdx: end };
  }, [messages, allHeights, selectedIndex, scrollOffset, effectiveRows]);

  // Sync scrollOffset state
  useEffect(() => {
    setScrollOffset(startIdx);
  }, [startIdx]);

  // Step 3: Format only visible messages with correct selection + sameSender
  const visibleFormatted = useMemo(() => {
    const result: FormattedMessage[] = [];
    for (let gi = startIdx; gi < endIdx; gi++) {
      const msg = messages[gi];
      const localIdx = gi - startIdx;
      const prevMsg = gi > 0 ? messages[gi - 1] : null;
      const prevIsVisible = localIdx > 0;
      const sameSender =
        prevIsVisible &&
        prevMsg !== null &&
        prevMsg.senderInboxId === msg.senderInboxId &&
        msg.createdAt - prevMsg.createdAt < 300_000 &&
        msg.parentIds.length === 0;

      result.push(
        formatMessage(msg, metrics, {
          selected: gi === selectedIndex,
          compact: sameSender,
        }),
      );
    }
    return result;
  }, [messages, startIdx, endIdx, selectedIndex, metrics]);

  const aboveCount = startIdx;
  const belowCount = messages.length - endIdx;

  const positionHint =
    messages.length > 0 ? `${startIdx + 1}-${endIdx}/${messages.length}` : "";

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="round"
      borderColor={focused ? theme.accent : theme.border}
    >
      {/* Channel header */}
      <Box paddingX={1} justifyContent="space-between">
        <Box gap={1}>
          <Text bold color={focused ? theme.accentBright : theme.channels}>
            {sym.hash}{channelName}
          </Text>
          {loading && (
            <Box gap={1}>
              <Spinner />
              <Text color={theme.muted}>syncing</Text>
            </Box>
          )}
        </Box>
        <Text color={theme.dim}>{positionHint}</Text>
      </Box>

      <Box paddingX={1}>
        <Text color={theme.borderSubtle}>{"─".repeat(separatorWidth)}</Text>
      </Box>

      {/* Scroll-up indicator */}
      {aboveCount > 0 && (
        <Box paddingX={2}>
          <Text color={theme.dim}>
            {sym.chevronDown} {aboveCount} more above
          </Text>
        </Box>
      )}

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} paddingBottom={1}>
        {messages.length === 0 && !loading && (
          <Box paddingX={2} paddingY={1} flexDirection="column">
            <Text color={theme.muted}>
              This is the beginning of{" "}
              <Text bold color={theme.channels}>
                {sym.hash}{channelName}
              </Text>
            </Text>
            <Box marginTop={1}>
              <Text color={theme.dim}>
                Press <Text color={theme.accentBright} bold>i</Text> to compose a message
              </Text>
            </Box>
          </Box>
        )}
        {visibleFormatted.map((fm, i) => (
          <Message
            key={fm.messageId}
            lines={fm.lines}
            selected={startIdx + i === selectedIndex}
          />
        ))}
      </Box>

      {/* Scroll-down indicator */}
      {belowCount > 0 && (
        <Box paddingX={2}>
          <Text color={theme.dim}>
            {sym.chevronDown} {belowCount} more below
          </Text>
        </Box>
      )}
    </Box>
  );
}
