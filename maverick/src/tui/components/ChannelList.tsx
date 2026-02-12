import React from "react";
import { Box, Text } from "ink";
import { theme, sym } from "../theme.js";
import { sanitize } from "../../utils/sanitize.js";
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
      width={26}
      borderStyle="round"
      borderColor={focused ? theme.accent : theme.border}
    >
      {/* Community header */}
      <Box paddingX={1} paddingY={0}>
        <Text bold color={focused ? theme.accentBright : theme.text}>
          {communityName.length > 22
            ? communityName.slice(0, 21) + sym.ellipsis
            : communityName}
        </Text>
      </Box>

      <Box paddingX={1}>
        <Text color={theme.borderSubtle}>
          {"─".repeat(22)}
        </Text>
      </Box>

      {/* Uncategorized channels */}
      {uncategorized.map((ch) => (
        <ChannelItem
          key={ch.channelId}
          channel={ch}
          isCurrent={ch.channelId === currentChannelId}
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
}: {
  channel: ChannelState;
  isCurrent: boolean;
}) {
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
        {sanitize(channel.name).length > 19
          ? sanitize(channel.name).slice(0, 18) + sym.ellipsis
          : sanitize(channel.name)}
      </Text>
    </Box>
  );
}
