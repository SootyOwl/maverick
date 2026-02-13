import { useState, useCallback, useRef } from "react";
import type { Client } from "@xmtp/node-sdk";
import type { AtpAgent } from "@atproto/api";
import type Database from "better-sqlite3";
import type { CommunityManager } from "../../community/manager.js";

export interface AuthSession {
  xmtpClient: Client;
  db: Database.Database;
  handle: string;
  did: string;
  agent: AtpAgent;
  privateKey: `0x${string}`;
  manager: CommunityManager;
}

export type Screen =
  | { type: "login" }
  | { type: "communityList" }
  | { type: "communityCreate" }
  | { type: "join" }
  | { type: "chat"; metaGroupId: string; communityName: string }
  | { type: "channelCreate"; metaGroupId: string; communityName: string }
  | { type: "addMember"; metaGroupId: string; communityName: string };

export interface AppState {
  screen: Screen;
  session: AuthSession | null;
}

export interface UseAppStateResult {
  state: AppState;
  setSession: (session: AuthSession) => void;
  navigate: (screen: Screen) => void;
  goBack: () => void;
}

export function useAppState(initialScreen?: Screen): UseAppStateResult {
  const [state, setState] = useState<AppState>({
    screen: initialScreen ?? { type: "login" },
    session: null,
  });

  const historyRef = useRef<Screen[]>([]);

  const setSession = useCallback((session: AuthSession) => {
    setState((prev) => ({ ...prev, session }));
  }, []);

  const navigate = useCallback((screen: Screen) => {
    setState((prev) => {
      historyRef.current.push(prev.screen);
      return { ...prev, screen };
    });
  }, []);

  const goBack = useCallback(() => {
    const prev = historyRef.current.pop();
    if (prev) {
      setState((s) => ({ ...s, screen: prev }));
    }
  }, []);

  return { state, setSession, navigate, goBack };
}
