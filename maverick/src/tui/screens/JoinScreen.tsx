import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { theme, sym } from "../theme.js";
import { sanitize } from "../../utils/sanitize.js";
import { TextInput } from "../components/TextInput.js";
import type { AuthSession } from "../hooks/useAppState.js";

interface JoinScreenProps {
  session: AuthSession;
  onBack: () => void;
}

type Status = "idle" | "verifying" | "verified" | "error";

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

export function JoinScreen({ session, onBack }: JoinScreenProps) {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ communityName: string; role: string; metaGroupId: string } | null>(null);

  const doVerify = useCallback(async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Invite token is required");
      return;
    }

    setStatus("verifying");
    setError(null);

    try {
      const { decodeInvite, verifyInvite } = await import("../../community/invites.js");
      const invite = decodeInvite(trimmed);

      const valid = await verifyInvite(invite);
      if (!valid) {
        setStatus("error");
        setError("Invite verification failed. Token may be expired or forged.");
        return;
      }

      setStatus("verified");
      setInfo({
        communityName: invite.communityName,
        role: invite.role,
        metaGroupId: invite.metaChannelGroupId,
      });
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }

    if (status === "verifying") return;

    if (key.return && (status === "idle" || status === "error")) {
      doVerify();
      return;
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color={theme.accentBright} bold>
          Join Community
        </Text>
      </Box>

      {status === "verifying" ? (
        <Box flexDirection="column" paddingX={1}>
          <Box gap={1}>
            <Spinner />
            <Text color={theme.text}>Verifying invite token{sym.ellipsis}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.muted}>Esc</Text>
            <Text color={theme.dim}>:cancel</Text>
          </Box>
        </Box>
      ) : status === "verified" && info ? (
        <Box flexDirection="column" paddingX={1}>
          <Box borderStyle="round" borderColor={theme.green} paddingX={1} flexDirection="column">
            <Box gap={1}>
              <Text color={theme.green}>{sym.check}</Text>
              <Text color={theme.green} bold>Invite verified</Text>
            </Box>
            <Box marginTop={1} flexDirection="column" paddingLeft={2}>
              <Text color={theme.dim}>
                Community <Text color={theme.text} bold>{sanitize(info.communityName)}</Text>
              </Text>
              <Text color={theme.dim}>
                Role <Text color={theme.textSecondary}>{info.role}</Text>
              </Text>
            </Box>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text color={theme.textSecondary}>
              Ask the community admin to add you. Share your Inbox ID:
            </Text>
            <Box borderStyle="round" borderColor={theme.accent} paddingX={1} marginTop={1}>
              <Text color={theme.channels} bold>{session.xmtpClient.inboxId}</Text>
            </Box>
          </Box>

          <Box marginTop={1}>
            <Text color={theme.muted}>Esc</Text>
            <Text color={theme.dim}>:back</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1}>
          <Box
            borderStyle="round"
            borderColor={theme.border}
            paddingX={1}
          >
            <TextInput
              label="Invite token"
              value={token}
              onChange={setToken}
              active={true}
              placeholder="paste invite token here"
            />
          </Box>

          {error && (
            <Box marginTop={1} gap={1}>
              <Text color={theme.red}>{sym.dot}</Text>
              <Text color={theme.red}>{error}</Text>
            </Box>
          )}

          <Box marginTop={1} gap={2}>
            <Box>
              <Text color={theme.muted}>Enter</Text>
              <Text color={theme.dim}>:verify</Text>
            </Box>
            <Box>
              <Text color={theme.muted}>Esc</Text>
              <Text color={theme.dim}>:back</Text>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
