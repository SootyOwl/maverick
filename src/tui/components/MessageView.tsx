import React, { useState, useEffect } from "react";
import { Box, Text, useStdout } from "ink";
import { theme, sym } from "../theme.js";
import { Message } from "./Message.js";
import type { VisibleMessage } from "../../messaging/dag.js";

interface MessageViewProps {
  messages: VisibleMessage[];
  selectedIndex: number;
  channelName: string;
  focused: boolean;
  loading: boolean;
}

/** Animated loading spinner */
function Spinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % sym.spinnerFrames.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return (
    <Text color={theme.accent}>{sym.spinnerFrames[frame]}</Text>
  );
}

export function MessageView({
  messages,
  selectedIndex,
  channelName,
  focused,
  loading,
}: MessageViewProps) {
  const { stdout } = useStdout();
  // Account for border (2 chars) + padding (2 chars) + channel list (~26) + separators (~2)
  const separatorWidth = Math.max(10, (stdout.columns ?? 80) - 34);

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
          {messages.length > 0 ? `${messages.length} msgs` : ""}
        </Text>
      </Box>

      <Box paddingX={1}>
        <Text color={theme.borderSubtle}>
          {"─".repeat(separatorWidth)}
        </Text>
      </Box>

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
        {messages.map((msg, i) => {
          // Group consecutive messages from the same sender
          const prevMsg = i > 0 ? messages[i - 1] : null;
          const sameSender =
            prevMsg !== null &&
            prevMsg.senderInboxId === msg.senderInboxId &&
            msg.createdAt - prevMsg.createdAt < 300_000 && // within 5 min
            msg.parentIds.length === 0; // not a reply

          return (
            <Message
              key={msg.id}
              message={msg}
              selected={i === selectedIndex}
              compact={sameSender}
            />
          );
        })}
      </Box>
    </Box>
  );
}
