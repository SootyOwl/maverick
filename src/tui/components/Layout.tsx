import React from "react";
import { Box, Text } from "ink";
import { ChannelList } from "./ChannelList.js";
import { MessageView } from "./MessageView.js";
import { ThreadLines } from "./ThreadLines.js";
import { Composer } from "./Composer.js";
import { ReplySelector } from "./ReplySelector.js";
import { StatusBar } from "./StatusBar.js";
import { theme } from "../theme.js";
import type { ChannelState } from "../../community/state.js";
import type { VisibleMessage } from "../../messaging/dag.js";
import type { ThreadContext } from "../../messaging/dag.js";
import type { Panel, Mode } from "../hooks/useKeyboard.js";

interface LayoutProps {
  // Community
  communityName: string;
  channels: ChannelState[];
  currentChannelId: string | null;
  onChannelSelect: (id: string) => void;

  // Messages
  messages: VisibleMessage[];
  selectedIndex: number;
  channelName: string;
  loading: boolean;

  // Thread
  thread: ThreadContext | null;

  // Composer
  composerActive: boolean;
  replyToIds: string[];
  replyTargets: VisibleMessage[];
  onSubmit: (text: string) => void;
  onCancelCompose: () => void;

  // Status
  handle: string;
  mode: Mode;
  panel: Panel;
  error: string | null;
  customHints?: string;
  isAdmin?: boolean;
}

export function Layout({
  communityName,
  channels,
  currentChannelId,
  onChannelSelect,
  messages,
  selectedIndex,
  channelName,
  loading,
  thread,
  composerActive,
  replyToIds,
  replyTargets,
  onSubmit,
  onCancelCompose,
  handle,
  mode,
  panel,
  error,
  customHints,
  isAdmin,
}: LayoutProps) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Main three-panel layout */}
      <Box flexDirection="row" flexGrow={1}>
        <ChannelList
          channels={channels}
          currentChannelId={currentChannelId}
          onSelect={onChannelSelect}
          focused={panel === "channels"}
          communityName={communityName}
        />
        <Box width={1}>
          <Text color={theme.borderSubtle}> </Text>
        </Box>
        <MessageView
          messages={messages}
          selectedIndex={selectedIndex}
          channelName={channelName}
          focused={panel === "messages"}
          loading={loading}
        />
        <Box width={1}>
          <Text color={theme.borderSubtle}> </Text>
        </Box>
        <ThreadLines thread={thread} focused={panel === "thread"} />
      </Box>

      {/* Reply selector */}
      <ReplySelector replyTargets={replyTargets} onClear={onCancelCompose} />

      {/* Composer */}
      <Composer
        active={composerActive}
        channelName={channelName}
        replyToIds={replyToIds}
        onSubmit={onSubmit}
        onCancel={onCancelCompose}
      />

      {/* Status bar */}
      <StatusBar
        communityName={communityName}
        handle={handle}
        mode={mode}
        panel={panel}
        error={error}
        customHints={customHints}
        isAdmin={isAdmin}
      />
    </Box>
  );
}
