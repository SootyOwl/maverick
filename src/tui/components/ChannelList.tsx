import React from "react";
import { Box, Text, useStdout } from "ink";
import { theme, sym } from "../theme.js";
import { sanitize } from "../../utils/sanitize.js";
import { truncate } from "../utils.js";
import type { ChannelState } from "../../community/state.js";

interface ChannelListProps {
  channels: ChannelState[];
  currentChannelId: string | null;
  onSelect: (id: string) => void;
  focused: boolean;
  communityName: string;
}

export function ChannelList({
  channels,
  currentChannelId,
  focused,
  communityName,
}: ChannelListProps) {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  // Shrink channel list on narrow terminals: ~25% of width, clamped to 16–26
  const sidebarWidth = Math.max(16, Math.min(26, Math.floor(cols * 0.25)));
  const nameMaxLen = sidebarWidth - 5; // account for bar + space + hash + padding

  // Group channels by category
  const categorized = new Map<string, ChannelState[]>();
  const uncategorized: ChannelState[] = [];
  for (const ch of channels) {
    if (ch.category) {
      const list = categorized.get(ch.category) ?? [];
      list.push(ch);
      categorized.set(ch.category, list);
    } else {
      uncategorized.push(ch);
    }
  }

  return (
    <Box
      flexDirection="column"
      width={sidebarWidth}
      borderStyle="round"
      borderColor={focused ? theme.accent : theme.border}
    >
      {/* Community header */}
      <Box paddingX={1} paddingY={0}>
        <Text bold color={focused ? theme.accentBright : theme.text}>
          {truncate(communityName, nameMaxLen)}
        </Text>
      </Box>

      <Box paddingX={1}>
        <Text color={theme.borderSubtle}>
          {"─".repeat(Math.max(4, sidebarWidth - 4))}
        </Text>
      </Box>

      {/* Uncategorized channels */}
      {uncategorized.map((ch) => (
        <ChannelItem
          key={ch.channelId}
          channel={ch}
          isCurrent={ch.channelId === currentChannelId}
          maxLen={nameMaxLen}
        />
      ))}

      {/* Categorized channels */}
      {[...categorized.entries()].map(([category, chs]) => (
        <Box key={category} flexDirection="column">
          <Box paddingX={1} marginTop={1}>
            <Text color={theme.dim} bold>
              {category.toUpperCase()}
            </Text>
          </Box>
          {chs.map((ch) => (
            <ChannelItem
              key={ch.channelId}
              channel={ch}
              isCurrent={ch.channelId === currentChannelId}
              maxLen={nameMaxLen}
            />
          ))}
        </Box>
      ))}

      {channels.length === 0 && (
        <Box paddingX={1} paddingY={1}>
          <Text color={theme.dim} italic>
            No channels yet
          </Text>
        </Box>
      )}

      {/* Bottom spacer to fill */}
      <Box flexGrow={1} />
    </Box>
  );
}

function ChannelItem({
  channel,
  isCurrent,
  maxLen,
}: {
  channel: ChannelState;
  isCurrent: boolean;
  maxLen: number;
}) {
  const name = sanitize(channel.name);
  return (
    <Box flexDirection="row" paddingLeft={0}>
      {/* Selection indicator bar */}
      <Text color={isCurrent ? theme.accent : undefined}>
        {isCurrent ? sym.bar : " "}
      </Text>
      <Text
        color={isCurrent ? theme.accentBright : theme.channels}
        bold={isCurrent}
      >
        {" "}
        {sym.hash}
        {truncate(name, maxLen)}
      </Text>
    </Box>
  );
}
