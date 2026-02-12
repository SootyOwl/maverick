import React, { useCallback } from "react";
import { Box, Text, useApp } from "ink";
import type { Client } from "@xmtp/node-sdk";
import type Database from "better-sqlite3";
import { theme } from "./theme.js";
import { useAppState, type AuthSession, type Screen } from "./hooks/useAppState.js";
import { useTerminalResize } from "./hooks/useTerminalResize.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { CommunityListScreen } from "./screens/CommunityListScreen.js";
import { CommunityCreateScreen } from "./screens/CommunityCreateScreen.js";
import { JoinScreen } from "./screens/JoinScreen.js";
import { ChatScreen } from "./screens/ChatScreen.js";
import { ChannelCreateScreen } from "./screens/ChannelCreateScreen.js";
import { AddMemberScreen } from "./screens/AddMemberScreen.js";
import { CommunityManager } from "../community/manager.js";
import type { Config } from "../config.js";

// Legacy props for backward compatibility (direct TUI launch with pre-authenticated session)
interface LegacyAppProps {
  xmtpClient: Client;
  db: Database.Database;
  metaGroupId: string;
  handle: string;
}

// New props for the full-workflow TUI
interface FullWorkflowAppProps {
  initialConfig: Config;
}

type AppProps = LegacyAppProps | FullWorkflowAppProps;

function isLegacyProps(props: AppProps): props is LegacyAppProps {
  return "xmtpClient" in props;
}

export function App(props: AppProps) {
  if (isLegacyProps(props)) {
    return <LegacyApp {...props} />;
  }
  return <FullWorkflowApp {...props} />;
}

/**
 * Legacy single-screen app: jumps directly to ChatScreen with a pre-built session.
 * Used when `maverick tui <meta-group-id>` is called with env-var auth.
 */
function LegacyApp({ xmtpClient, db, metaGroupId, handle }: LegacyAppProps) {
  const { exit } = useApp();
  useTerminalResize();

  // Build a minimal session without agent/privateKey (not needed for chat)
  const session: AuthSession = {
    xmtpClient,
    db,
    handle,
    did: "",
    agent: null as any,
    privateKey: "0x" as `0x${string}`,
    manager: new CommunityManager(xmtpClient, db),
  };

  const handleBack = useCallback(() => {
    db.close();
    exit();
  }, [db, exit]);

  return (
    <ChatScreen
      session={session}
      metaGroupId={metaGroupId}
      onNavigate={() => {}}
      onBack={handleBack}
    />
  );
}

/** Full-workflow app with screen router */
function FullWorkflowApp({ initialConfig }: FullWorkflowAppProps) {
  useTerminalResize();
  const { state, setSession, navigate, goBack } = useAppState();

  const handleLogin = useCallback(
    (session: AuthSession) => {
      setSession(session);
      navigate({ type: "communityList" });
    },
    [setSession, navigate],
  );

  const handleNavigate = useCallback(
    (screen: Screen) => {
      navigate(screen);
    },
    [navigate],
  );

  const handleBack = useCallback(() => {
    goBack();
  }, [goBack]);

  const { screen } = state;
  const { session } = state;

  // Build a unique key per screen+params to force React to fully destroy
  // the old component tree before mounting the new one (prevents stale text artifacts).
  const screenKey =
    "metaGroupId" in screen
      ? `${screen.type}:${screen.metaGroupId}`
      : screen.type;

  switch (screen.type) {
    case "login":
      return <Box key={screenKey}><LoginScreen initialConfig={initialConfig} onLogin={handleLogin} /></Box>;

    case "communityList":
      if (!session) return <Text color={theme.red}>No session</Text>;
      return (
        <Box key={screenKey}>
          <CommunityListScreen
            session={session}
            onNavigate={handleNavigate}
          />
        </Box>
      );

    case "communityCreate":
      if (!session) return <Text color={theme.red}>No session</Text>;
      return (
        <Box key={screenKey}>
          <CommunityCreateScreen
            session={session}
            onNavigate={handleNavigate}
            onBack={handleBack}
          />
        </Box>
      );

    case "join":
      if (!session) return <Text color={theme.red}>No session</Text>;
      return <Box key={screenKey}><JoinScreen session={session} onBack={handleBack} /></Box>;

    case "chat":
      if (!session) return <Text color={theme.red}>No session</Text>;
      return (
        <Box key={screenKey}>
          <ChatScreen
            session={session}
            metaGroupId={screen.metaGroupId}
            onNavigate={handleNavigate}
            onBack={handleBack}
          />
        </Box>
      );

    case "channelCreate":
      if (!session) return <Text color={theme.red}>No session</Text>;
      return (
        <Box key={screenKey}>
          <ChannelCreateScreen
            session={session}
            metaGroupId={screen.metaGroupId}
            communityName={screen.communityName}
            onBack={handleBack}
          />
        </Box>
      );

    case "addMember":
      if (!session) return <Text color={theme.red}>No session</Text>;
      return (
        <Box key={screenKey}>
          <AddMemberScreen
            session={session}
            metaGroupId={screen.metaGroupId}
            communityName={screen.communityName}
            onBack={handleBack}
          />
        </Box>
      );

    default:
      return <Text color={theme.red}>Unknown screen</Text>;
  }
}
