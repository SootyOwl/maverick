import { useState, useEffect } from "react";
import type Database from "better-sqlite3";
import { getThreadContext, type ThreadContext } from "../../messaging/dag.js";

export interface UseThreadResult {
  thread: ThreadContext | null;
  threadMessageId: string | null;
  openThread: (messageId: string) => void;
  closeThread: () => void;
}

export function useThread(db: Database.Database): UseThreadResult {
  const [threadMessageId, setThreadMessageId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadContext | null>(null);

  useEffect(() => {
    if (!threadMessageId) {
      setThread(null);
      return;
    }
    const ctx = getThreadContext(db, threadMessageId);
    setThread(ctx);
  }, [db, threadMessageId]);

  return {
    thread,
    threadMessageId,
    openThread: setThreadMessageId,
    closeThread: () => setThreadMessageId(null),
  };
}
