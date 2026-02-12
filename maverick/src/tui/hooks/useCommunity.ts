import { useState, useEffect, useCallback } from "react";
import type { Client } from "@xmtp/node-sdk";
import type Database from "better-sqlite3";
import { CommunityManager } from "../../community/manager.js";
import type { CommunityState, ChannelState } from "../../community/state.js";

export interface UseCommunityResult {
  state: CommunityState | null;
  channels: ChannelState[];
  currentChannel: ChannelState | null;
  setCurrentChannelId: (id: string) => void;
  currentChannelId: string | null;
  manager: CommunityManager;
  syncing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCommunity(
  xmtpClient: Client,
  db: Database.Database,
  metaGroupId: string,
): UseCommunityResult {
  const [manager] = useState(() => new CommunityManager(xmtpClient, db));
  const [state, setState] = useState<CommunityState | null>(null);
  const [currentChannelId, setCurrentChannelId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const s = await manager.syncCommunityState(metaGroupId);
      setState(s);

      // Auto-select first channel if none selected
      if (!currentChannelId && s.channels.size > 0) {
        const firstChannel = [...s.channels.values()].find((c) => !c.archived);
        if (firstChannel) {
          setCurrentChannelId(firstChannel.channelId);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [manager, metaGroupId, currentChannelId]);

  useEffect(() => {
    refresh();
  }, []);

  const channels = state
    ? [...state.channels.values()].filter((c) => !c.archived)
    : [];

  const currentChannel =
    currentChannelId && state
      ? state.channels.get(currentChannelId) ?? null
      : null;

  return {
    state,
    channels,
    currentChannel,
    setCurrentChannelId,
    currentChannelId,
    manager,
    syncing,
    error,
    refresh,
  };
}
