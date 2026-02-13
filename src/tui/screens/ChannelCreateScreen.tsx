import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { theme, sym } from "../theme.js";
import { sanitize } from "../../utils/sanitize.js";
import { TextInput } from "../components/TextInput.js";
import type { AuthSession } from "../hooks/useAppState.js";

interface ChannelCreateScreenProps {
  session: AuthSession;
  metaGroupId: string;
  communityName: string;
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

export function ChannelCreateScreen({
  session,
  metaGroupId,
  communityName,
  onBack,
}: ChannelCreateScreenProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [activeField, setActiveField] = useState<"name" | "description">("name");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const doCreate = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Channel name is required");
      return;
    }

    setStatus("creating");
    setError(null);

    try {
      await session.manager.createChannel(
        metaGroupId,
        trimmedName,
        "open",
        description.trim() || undefined,
      );

      onBack();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [name, description, metaGroupId, session.manager, onBack]);

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
      <Box marginBottom={1} gap={1}>
        <Text color={theme.accentBright} bold>
          New Channel
        </Text>
        <Text color={theme.dim}>in {sanitize(communityName)}</Text>
      </Box>

      {status === "creating" ? (
        <Box flexDirection="column" paddingX={1}>
          <Box gap={1}>
            <Spinner />
            <Text color={theme.text}>Creating {sym.hash}{name.trim()}{sym.ellipsis}</Text>
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
              placeholder="dev"
            />
            <TextInput
              label="Description"
              value={description}
              onChange={setDescription}
              active={activeField === "description"}
              placeholder="optional"
            />
          </Box>

          {name.trim() && (
            <Box marginTop={1}>
              <Text color={theme.dim}>
                Will create <Text color={theme.channels}>{sym.hash}{name.trim()}</Text> with open permissions.
              </Text>
            </Box>
          )}

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
