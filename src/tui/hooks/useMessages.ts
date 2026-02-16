import { useState, useEffect, useCallback, useRef } from "react";
import type { Client } from "@xmtp/node-sdk";
import type Database from "better-sqlite3";
import { getVisibleMessages, type VisibleMessage } from "../../messaging/dag.js";
import { MaverickMessageContentType } from "../../messaging/codec.js";
import { insertMessage, insertParents } from "../../storage/messages.js";
import { sendMessage } from "../../messaging/sender.js";
import { upsertProfile, resolveInboxIdToHandle } from "../../storage/profiles.js";
import type { ChannelState } from "../../community/state.js";

export interface UseMessagesResult {
  messages: VisibleMessage[];
  selectedIndex: number;
  selectedMessage: VisibleMessage | null;
  selectNext: () => void;
  selectPrev: () => void;
  selectLast: () => void;
  selectIndex: (idx: number) => void;
  send: (text: string, replyTo?: string[]) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useMessages(
  xmtpClient: Client,
  db: Database.Database,
  channel: ChannelState | null,
  senderHandle?: string,
): UseMessagesResult {
  const [messages, setMessages] = useState<VisibleMessage[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);

  const loadMessages = useCallback(() => {
    if (!channel) {
      setMessages([]);
      return;
    }
    const visible = getVisibleMessages(db, channel.channelId);
    setMessages(visible);
    setSelectedIndex(visible.length > 0 ? visible.length - 1 : -1);
  }, [db, channel]);

  // Sync XMTP group and start streaming when channel changes
  useEffect(() => {
    if (!channel) return;

    let cancelled = false;

    async function setup() {
      setLoading(true);
      try {
        await xmtpClient.conversations.sync();
        const group = await xmtpClient.conversations.getConversationById(
          channel!.xmtpGroupId,
        );
        if (!group || cancelled) return;

        await group.sync();

        // Load historical messages
        const histMsgs = await group.messages({ limit: 50 });
        for (const msg of histMsgs) {
          persistMessage(msg, channel!.channelId);
        }
        if (!cancelled) loadMessages();

        // Check cancellation before starting the stream to avoid leaking
        // an active stream if the component unmounted during sync above.
        if (cancelled) return;

        // Start streaming
        const stream = await group.stream({
          onValue: (msg) => {
            persistMessage(msg, channel!.channelId);
            if (!cancelled) loadMessages();
          },
        });

        // If cancelled while stream was starting, clean up immediately
        if (cancelled) {
          await stream.return();
          return;
        }

        cleanupRef.current = async () => {
          await stream.return();
        };
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setup();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [channel?.xmtpGroupId]);

  function persistMessage(
    msg: { senderInboxId: string; content: unknown; id: string; sentAt: Date; contentType?: { authorityId: string; typeId: string } },
    channelId: string,
  ) {
    try {
      if (
        msg.contentType?.authorityId === MaverickMessageContentType.authorityId &&
        msg.contentType?.typeId === MaverickMessageContentType.typeId
      ) {
        const content = msg.content as { text?: string; replyTo?: string[]; editOf?: string; deleteOf?: string; senderHandle?: string };

        // Resolve handle: prefer embedded handle, fall back to profile cache
        let handle = content?.senderHandle ?? null;
        if (!handle) {
          handle = resolveInboxIdToHandle(db, msg.senderInboxId);
        }

        // Cache the sender's profile if we got a handle from the message
        if (content?.senderHandle) {
          try {
            upsertProfile(db, {
              did: msg.senderInboxId, // use inboxId as did placeholder when real did unknown
              inboxId: msg.senderInboxId,
              handle: content.senderHandle,
            });
          } catch {
            // Non-fatal: profile cache is best-effort
          }
        }

        insertMessage(db, {
          id: msg.id,
          channelId,
          senderInboxId: msg.senderInboxId,
          senderHandle: handle ?? undefined,
          text: content?.text ?? "",
          editOf: content?.editOf,
          deleteOf: content?.deleteOf,
          createdAt: msg.sentAt.getTime(),
        });
        if (content?.replyTo && content.replyTo.length > 0) {
          insertParents(db, msg.id, content.replyTo);
        }
      }
    } catch {
      // Don't crash on persistence errors
    }
  }

  const send = useCallback(
    async (text: string, replyTo?: string[]) => {
      if (!channel) return;
      try {
        const group = await xmtpClient.conversations.getConversationById(
          channel.xmtpGroupId,
        );
        if (!group) return;
        await sendMessage(group, text, replyTo, undefined, senderHandle);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [xmtpClient, channel, senderHandle],
  );

  const selectNext = useCallback(() => {
    setSelectedIndex((i) => Math.min(i + 1, messages.length - 1));
  }, [messages.length]);

  const selectPrev = useCallback(() => {
    setSelectedIndex((i) => Math.max(i - 1, 0));
  }, []);

  const selectLast = useCallback(() => {
    setSelectedIndex(messages.length > 0 ? messages.length - 1 : -1);
  }, [messages.length]);

  const selectIndex = useCallback((idx: number) => {
    setSelectedIndex(Math.max(0, Math.min(idx, messages.length - 1)));
  }, [messages.length]);

  const selectedMessage =
    selectedIndex >= 0 && selectedIndex < messages.length
      ? messages[selectedIndex]
      : null;

  return {
    messages,
    selectedIndex,
    selectedMessage,
    selectNext,
    selectPrev,
    selectLast,
    selectIndex,
    send,
    loading,
    error,
  };
}
