import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { theme, sym } from "../theme.js";
import { Spinner } from "./Spinner.js";
import { Message } from "./Message.js";
import { estimateMessageHeight } from "../utils.js";
import type { VisibleMessage } from "../../messaging/dag.js";

interface MessageViewProps {
  messages: VisibleMessage[];
  selectedIndex: number;
  channelName: string;
  focused: boolean;
  loading: boolean;
  availableRows: number;
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
  // Account for border (2 chars) + padding (2 chars) + channel list (~26) + separators (~2)
  const separatorWidth = Math.max(10, termWidth - 34);

  const [scrollOffset, setScrollOffset] = useState(0);

  // Reset scroll when channel changes
  const [prevChannel, setPrevChannel] = useState(channelName);
  if (channelName !== prevChannel) {
    setPrevChannel(channelName);
    setScrollOffset(0);
  }

  // Compute which messages fit in the viewport
  const { startIdx, endIdx } = useMemo(() => {
    if (messages.length === 0) return { startIdx: 0, endIdx: 0 };

    // Estimate message body width for height calculation
    const bodyWidth = Math.max(20, termWidth - 40);

    // First, ensure selectedIndex is visible by adjusting scrollOffset
    let start = scrollOffset;

    // If selected is before the viewport, scroll up to it
    if (selectedIndex < start) {
      start = selectedIndex;
    }

    // Find how many messages fit starting from `start`
    let rowsUsed = 0;
    let end = start;
    for (let i = start; i < messages.length; i++) {
      const msg = messages[i];
      const h = estimateMessageHeight(
        msg.text.length,
        msg.parentIds.length > 0,
        bodyWidth,
      );
      if (rowsUsed + h > availableRows && i > start) break;
      rowsUsed += h;
      end = i + 1;
    }

    // If selected is after the viewport, scroll down
    if (selectedIndex >= end) {
      // Work backwards from selectedIndex to fit window
      let rows = 0;
      end = selectedIndex + 1;
      start = selectedIndex;
      for (let i = selectedIndex; i >= 0; i--) {
        const msg = messages[i];
        const h = estimateMessageHeight(
          msg.text.length,
          msg.parentIds.length > 0,
          bodyWidth,
        );
        if (rows + h > availableRows && i < selectedIndex) break;
        rows += h;
        start = i;
      }
    }

    return { startIdx: start, endIdx: end };
  }, [messages, selectedIndex, scrollOffset, availableRows, termWidth]);

  // Sync scrollOffset state with computed start
  useEffect(() => {
    setScrollOffset(startIdx);
  }, [startIdx]);

  const aboveCount = startIdx;
  const belowCount = messages.length - endIdx;
  const visibleMessages = messages.slice(startIdx, endIdx);

  // Position indicator for header
  const positionHint = messages.length > 0
    ? `${startIdx + 1}-${endIdx}/${messages.length}`
    : "";

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
        <Text color={theme.dim}>
          {positionHint}
        </Text>
      </Box>

      <Box paddingX={1}>
        <Text color={theme.borderSubtle}>
          {"─".repeat(separatorWidth)}
        </Text>
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
              This is the beginning of <Text bold color={theme.channels}>{sym.hash}{channelName}</Text>
            </Text>
            <Box marginTop={1}>
              <Text color={theme.dim}>
                Press <Text color={theme.accentBright} bold>i</Text> to compose a message
              </Text>
            </Box>
          </Box>
        )}
        {visibleMessages.map((msg, i) => {
          const globalIdx = startIdx + i;
          // Group consecutive messages from the same sender
          // At viewport boundary (i===0), check against actual previous message
          const prevMsg = globalIdx > 0 ? messages[globalIdx - 1] : null;
          const sameSender =
            prevMsg !== null &&
            prevMsg.senderInboxId === msg.senderInboxId &&
            msg.createdAt - prevMsg.createdAt < 300_000 && // within 5 min
            msg.parentIds.length === 0; // not a reply

          return (
            <Message
              key={msg.id}
              message={msg}
              selected={globalIdx === selectedIndex}
              compact={sameSender}
            />
          );
        })}
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
