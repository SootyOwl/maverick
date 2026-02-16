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
  parentMap: Map<string, string[]>;
  siblingParentIds: Set<string>;
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

  const parentMap = useMemo<Map<string, string[]>>(() => {
    return thread?.parentMap ?? new Map();
  }, [thread]);

  // Compute siblingParentIds: messages in descendants that are NOT reachable
  // by walking down from the focus message through the parentMap's inverse
  const siblingParentIds = useMemo<Set<string>>(() => {
    if (!thread || !thread.parentMap) return new Set();

    const focusId = thread.message.id;

    // Build childMap (inverse of parentMap): parentId → childIds
    const childMap = new Map<string, string[]>();
    for (const [childId, pids] of thread.parentMap) {
      for (const pid of pids) {
        const existing = childMap.get(pid);
        if (existing) {
          existing.push(childId);
        } else {
          childMap.set(pid, [childId]);
        }
      }
    }

    // BFS down from focus through childMap to find true descendants
    const trueDescendants = new Set<string>();
    const queue = childMap.get(focusId) ?? [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (trueDescendants.has(id)) continue;
      trueDescendants.add(id);
      const children = childMap.get(id) ?? [];
      queue.push(...children);
    }

    // Any descendant not reachable = sibling parent
    const siblings = new Set<string>();
    for (const desc of thread.descendants) {
      if (!trueDescendants.has(desc.id)) {
        siblings.add(desc.id);
      }
    }
    return siblings;
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
    parentMap,
    siblingParentIds,
    openThread,
    closeThread,
    selectPrev,
    selectNext,
    refresh,
  };
}
