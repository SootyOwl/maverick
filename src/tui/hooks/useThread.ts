import { useState, useEffect, useCallback, useMemo } from "react";
import type Database from "better-sqlite3";
import { getThreadContext, type ThreadContext } from "../../messaging/dag.js";
import type { StoredMessage } from "../../storage/messages.js";

export interface UseThreadResult {
  thread: ThreadContext | null;
  threadMessageId: string | null;
  flatMessages: StoredMessage[];
  selectedIndex: number;
  selectedMessage: StoredMessage | null;
  openThread: (messageId: string) => void;
  closeThread: () => void;
  selectPrev: () => void;
  selectNext: () => void;
  refresh: () => void;
}

export function useThread(db: Database.Database): UseThreadResult {
  const [threadMessageId, setThreadMessageId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadContext | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    if (!threadMessageId) {
      setThread(null);
      setSelectedIndex(-1);
      return;
    }
    const ctx = getThreadContext(db, threadMessageId);
    setThread(ctx);
    // Default selection to the "current" message (after ancestors)
    if (ctx) {
      setSelectedIndex(ctx.ancestors.length);
    } else {
      setSelectedIndex(-1);
    }
  }, [db, threadMessageId, refreshCounter]);

  const flatMessages = useMemo<StoredMessage[]>(() => {
    if (!thread) return [];
    return [...thread.ancestors, thread.message, ...thread.descendants];
  }, [thread]);

  const selectedMessage = useMemo(() => {
    if (selectedIndex >= 0 && selectedIndex < flatMessages.length) {
      return flatMessages[selectedIndex];
    }
    return null;
  }, [flatMessages, selectedIndex]);

  const openThread = useCallback((messageId: string) => {
    if (messageId === threadMessageId) {
      // Same message — refresh instead of no-op
      setRefreshCounter((c) => c + 1);
    } else {
      setThreadMessageId(messageId);
    }
  }, [threadMessageId]);

  const closeThread = useCallback(() => {
    setThreadMessageId(null);
  }, []);

  const selectPrev = useCallback(() => {
    setSelectedIndex((i) => Math.max(i - 1, 0));
  }, []);

  const selectNext = useCallback(() => {
    setSelectedIndex((i) => Math.min(i + 1, flatMessages.length - 1));
  }, [flatMessages.length]);

  const refresh = useCallback(() => {
    if (threadMessageId) {
      setRefreshCounter((c) => c + 1);
    }
  }, [threadMessageId]);

  return {
    thread,
    threadMessageId,
    flatMessages,
    selectedIndex,
    selectedMessage,
    openThread,
    closeThread,
    selectPrev,
    selectNext,
    refresh,
  };
}
