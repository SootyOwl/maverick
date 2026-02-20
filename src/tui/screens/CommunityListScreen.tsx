import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { theme, sym } from "../theme.js";
import { Spinner } from "../components/Spinner.js";
import { sanitize } from "../../utils/sanitize.js";
import type { AuthSession, Screen } from "../hooks/useAppState.js";

interface CommunityEntry {
  groupId: string;
  name: string;
}

interface CommunityListScreenProps {
  session: AuthSession;
  onNavigate: (screen: Screen) => void;
}

export function CommunityListScreen({
  session,
  onNavigate,
}: CommunityListScreenProps) {
  const { exit } = useApp();

  const [communities, setCommunities] = useState<CommunityEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await session.manager.listCommunities();
      setCommunities(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [session.manager]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInput((input, key) => {
    if (input === "q") {
      session.db.close();
      exit();
      return;
    }

    if (loading) return;

    if (input === "j" || key.downArrow) {
      setSelectedIndex((i) => Math.min(i + 1, communities.length - 1));
      return;
    }

    if (input === "k" || key.upArrow) {
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }

    if (key.return) {
      const selected = communities[selectedIndex];
      if (selected) {
        onNavigate({
          type: "chat",
          metaGroupId: selected.groupId,
          communityName: selected.name,
        });
      }
      return;
    }

    if (input === "n") {
      onNavigate({ type: "communityCreate" });
      return;
    }

    if (input === "J") {
      onNavigate({ type: "join" });
      return;
    }

    if (input === "r") {
      refresh();
      return;
    }
  });

  const inboxIdShort = session.xmtpClient?.inboxId
    ? session.xmtpClient.inboxId.slice(0, 12) + sym.ellipsis
    : "";

  return (
    <Box flexDirection="column" padding={1}>
      {/* Identity header */}
      <Box
        borderStyle="round"
        borderColor={theme.border}
        paddingX={1}
        marginBottom={1}
        flexDirection="column"
      >
        <Box justifyContent="space-between">
          <Text color={theme.accentBright} bold>
            maverick
          </Text>
          <Text color={theme.channels} bold>
            {session.handle}
          </Text>
        </Box>
        <Box gap={2}>
          <Text color={theme.dim}>
            DID <Text color={theme.textSecondary}>{session.did ? session.did.slice(0, 24) + sym.ellipsis : "n/a"}</Text>
          </Text>
          <Text color={theme.dim}>
            Inbox <Text color={theme.textSecondary}>{inboxIdShort || "n/a"}</Text>
          </Text>
        </Box>
      </Box>

      {/* Title */}
      <Box marginBottom={1} gap={1}>
        <Text color={theme.text} bold>
          Your Communities
        </Text>
        {!loading && (
          <Text color={theme.dim}>
            ({communities.length})
          </Text>
        )}
      </Box>

      {/* Content */}
      {loading ? (
        <Box flexDirection="column">
          <Box gap={1}>
            <Spinner />
            <Text color={theme.muted}>Scanning for communities{sym.ellipsis}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.muted}>q</Text>
            <Text color={theme.dim}>:quit</Text>
          </Box>
        </Box>
      ) : error ? (
        <Box flexDirection="column">
          <Box gap={1}>
            <Text color={theme.red}>{sym.dot}</Text>
            <Text color={theme.red}>{error}</Text>
          </Box>
          <Box marginTop={1} gap={2}>
            <Box>
              <Text color={theme.muted}>r</Text>
              <Text color={theme.dim}>:retry</Text>
            </Box>
            <Box>
              <Text color={theme.muted}>q</Text>
              <Text color={theme.dim}>:quit</Text>
            </Box>
          </Box>
        </Box>
      ) : communities.length === 0 ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.border}
          paddingX={2}
          paddingY={1}
        >
          <Text color={theme.dim}>No communities yet.</Text>
          <Box marginTop={1} flexDirection="column">
            <Box gap={1}>
              <Text color={theme.accentBright} bold>n</Text>
              <Text color={theme.textSecondary}>Create a new community</Text>
            </Box>
            <Box gap={1}>
              <Text color={theme.accentBright} bold>J</Text>
              <Text color={theme.textSecondary}>Join with an invite token</Text>
            </Box>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {communities.map((c, i) => {
            const selected = i === selectedIndex;
            return (
              <Box key={c.groupId} flexDirection="row" gap={1}>
                <Text color={selected ? theme.accent : undefined}>
                  {selected ? sym.bar : " "}
                </Text>
                <Text
                  color={selected ? theme.accentBright : theme.text}
                  bold={selected}
                >
                  {sanitize(c.name)}
                </Text>
                <Text color={theme.dim}>
                  {c.groupId.slice(0, 8)}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Keybinding hints */}
      <Box marginTop={1} paddingX={1} gap={1}>
        {[
          ["j/k", "nav"],
          ["Enter", "open"],
          ["n", "new"],
          ["J", "join"],
          ["r", "refresh"],
          ["q", "quit"],
        ].map(([key, desc]) => (
          <Box key={key}>
            <Text color={theme.muted}>{key}</Text>
            <Text color={theme.dim}>:{desc}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
