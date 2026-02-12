import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { theme, sym } from "../theme.js";
import { TextInput } from "../components/TextInput.js";
import type { AuthSession, Screen } from "../hooks/useAppState.js";

interface CommunityCreateScreenProps {
  session: AuthSession;
  onNavigate: (screen: Screen) => void;
  onBack: () => void;
}

type Status = "idle" | "creating" | "error";

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

export function CommunityCreateScreen({
  session,
  onNavigate,
  onBack,
}: CommunityCreateScreenProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [activeField, setActiveField] = useState<"name" | "description">("name");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const doCreate = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Community name is required");
      return;
    }

    setStatus("creating");
    setError(null);

    try {
      const metaGroupId = await session.manager.createCommunity(
        trimmedName,
        description.trim() || undefined,
      );

      await session.manager.createChannel(metaGroupId, "general", "open", "General discussion");

      onNavigate({
        type: "chat",
        metaGroupId,
        communityName: trimmedName,
      });
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [name, description, session.manager, onNavigate]);

  useInput((input, key) => {
    if (status === "creating") return;

    if (key.escape) {
      onBack();
      return;
    }

    if (key.tab) {
      setActiveField((f) => (f === "name" ? "description" : "name"));
      return;
    }

    if (key.return && (status === "idle" || status === "error")) {
      doCreate();
      return;
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color={theme.accentBright} bold>
          Create Community
        </Text>
      </Box>

      {status === "creating" ? (
        <Box flexDirection="column" paddingX={1}>
          <Box gap={1}>
            <Spinner />
            <Text color={theme.text}>Creating community{sym.ellipsis}</Text>
          </Box>
          <Box gap={1}>
            <Text color={theme.dim}>{sym.dotEmpty}</Text>
            <Text color={theme.dim}>Creating {sym.hash}general channel{sym.ellipsis}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.muted}>Esc</Text>
            <Text color={theme.dim}>:cancel</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1}>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={theme.border}
            paddingX={1}
          >
            <TextInput
              label="Name"
              value={name}
              onChange={setName}
              active={activeField === "name"}
              placeholder="My Community"
            />
            <TextInput
              label="Description"
              value={description}
              onChange={setDescription}
              active={activeField === "description"}
              placeholder="optional"
            />
          </Box>

          <Box marginTop={1}>
            <Text color={theme.dim}>
              A <Text color={theme.channels}>{sym.hash}general</Text> channel will be created automatically.
            </Text>
          </Box>

          {error && (
            <Box marginTop={1} gap={1}>
              <Text color={theme.red}>{sym.dot}</Text>
              <Text color={theme.red}>{error}</Text>
            </Box>
          )}

          <Box marginTop={1} gap={2}>
            <Box>
              <Text color={theme.muted}>Tab</Text>
              <Text color={theme.dim}>:switch</Text>
            </Box>
            <Box>
              <Text color={theme.muted}>Enter</Text>
              <Text color={theme.dim}>:create</Text>
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
