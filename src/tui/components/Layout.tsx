import React from "react";
import { Box, Text, useStdout } from "ink";
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
  const { stdout } = useStdout();
  const termHeight = stdout.rows ?? 24;

  // Compute fixed chrome heights:
  // Composer: 3 lines (border top + content + border bottom), +1 if reply indicator shown
  // StatusBar: 2-3 lines (error? + status line + hints)
  // ReplySelector: 0 if empty, else 2 + replyTargets.length (border + header + items + border)
  // MessageView internal chrome: 4 lines (border top + header + separator + border bottom + paddingBottom)
  const composerHeight = 3 + (replyToIds.length > 0 ? 1 : 0);
  const statusBarHeight = 2 + (error ? 1 : 0);
  const replySelectorHeight = replyTargets.length > 0 ? 2 + replyTargets.length + 2 : 0;
  const messageViewChrome = 5; // border(2) + header(1) + separator(1) + paddingBottom(1)

  const chromeTotal = composerHeight + statusBarHeight + replySelectorHeight + messageViewChrome;
  const availableRows = Math.max(3, termHeight - chromeTotal);

  return (
    <Box flexDirection="column" height={termHeight}>
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
          availableRows={availableRows}
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
