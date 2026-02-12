import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Text } from "ink";
import { theme, sym } from "../theme.js";
import { Layout } from "../components/Layout.js";
import { useCommunity } from "../hooks/useCommunity.js";
import { useMessages } from "../hooks/useMessages.js";
import { useKeyboard, type KeyboardActions } from "../hooks/useKeyboard.js";
import { useThread } from "../hooks/useThread.js";
import type { AuthSession, Screen } from "../hooks/useAppState.js";

interface ChatScreenProps {
  session: AuthSession;
  metaGroupId: string;
  onNavigate: (screen: Screen) => void;
  onBack: () => void;
}

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % sym.spinnerFrames.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);
  return <Text color={theme.accent}>{sym.spinnerFrames[frame]}</Text>;
}

export function ChatScreen({
  session,
  metaGroupId,
  onNavigate,
  onBack,
}: ChatScreenProps) {
  const community = useCommunity(session.xmtpClient, session.db, metaGroupId);
  const msgs = useMessages(session.xmtpClient, session.db, community.currentChannel, session.handle);
  const threadCtx = useThread(session.db);

  const [replyToIds, setReplyToIds] = useState<string[]>([]);
  const [channelIdx, setChannelIdx] = useState(0);

  const channelName = community.currentChannel?.name ?? "none";
  const communityName = community.state?.config?.name ?? "Loading...";

  const keyActions: KeyboardActions = useMemo(
    () => ({
      onNavigateUp: () => msgs.selectPrev(),
      onNavigateDown: () => msgs.selectNext(),
      onJumpToLatest: () => msgs.selectLast(),
      onChannelUp: () => {
        setChannelIdx((i) => {
          const next = Math.max(i - 1, 0);
          const ch = community.channels[next];
          if (ch) community.setCurrentChannelId(ch.channelId);
          return next;
        });
      },
      onChannelDown: () => {
        setChannelIdx((i) => {
          const next = Math.min(i + 1, community.channels.length - 1);
          const ch = community.channels[next];
          if (ch) community.setCurrentChannelId(ch.channelId);
          return next;
        });
      },
      onReply: () => {
        if (msgs.selectedMessage) {
          setReplyToIds([msgs.selectedMessage.id]);
          threadCtx.openThread(msgs.selectedMessage.id);
        }
      },
      onMultiReply: () => {
        if (msgs.selectedMessage) {
          setReplyToIds((ids) => {
            const msgId = msgs.selectedMessage!.id;
            if (ids.includes(msgId)) {
              return ids.filter((id) => id !== msgId);
            }
            return [...ids, msgId];
          });
          threadCtx.openThread(msgs.selectedMessage.id);
        }
      },
      onQuit: () => {
        onBack();
      },
      onBack: () => {
        onBack();
      },
      onNewChannel: () => {
        onNavigate({
          type: "channelCreate",
          metaGroupId,
          communityName,
        });
      },
      onInvite: () => {
        onNavigate({
          type: "addMember",
          metaGroupId,
          communityName,
        });
      },
    }),
    [msgs, community, threadCtx, metaGroupId, communityName, onBack, onNavigate],
  );

  const keyboard = useKeyboard(keyActions);

  const handleSubmit = useCallback(
    (text: string) => {
      msgs.send(text, replyToIds.length > 0 ? replyToIds : undefined);
      setReplyToIds([]);
      keyboard.setMode("normal");
    },
    [msgs, replyToIds, keyboard],
  );

  const handleCancelCompose = useCallback(() => {
    setReplyToIds([]);
    keyboard.setMode("normal");
  }, [keyboard]);

  const replyTargets = useMemo(
    () => msgs.messages.filter((m) => replyToIds.includes(m.id)),
    [msgs.messages, replyToIds],
  );

  if (community.syncing && !community.state) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box gap={1}>
          <Spinner />
          <Text color={theme.text}>Syncing community state{sym.ellipsis}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>q</Text>
          <Text color={theme.dim}>:back</Text>
        </Box>
      </Box>
    );
  }

  if (community.error && !community.state) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box gap={1}>
          <Text color={theme.red}>{sym.dot}</Text>
          <Text color={theme.red}>{community.error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>q</Text>
          <Text color={theme.dim}>:back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Layout
      communityName={communityName}
      channels={community.channels}
      currentChannelId={community.currentChannelId}
      onChannelSelect={community.setCurrentChannelId}
      messages={msgs.messages}
      selectedIndex={msgs.selectedIndex}
      channelName={channelName}
      loading={msgs.loading}
      thread={threadCtx.thread}
      composerActive={keyboard.mode === "insert"}
      replyToIds={replyToIds}
      replyTargets={replyTargets}
      onSubmit={handleSubmit}
      onCancelCompose={handleCancelCompose}
      handle={session.handle}
      mode={keyboard.mode}
      panel={keyboard.panel}
      error={msgs.error ?? community.error}
    />
  );
}
