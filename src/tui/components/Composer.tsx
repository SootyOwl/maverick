import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme, sym } from "../theme.js";

interface ComposerProps {
  active: boolean;
  channelName: string;
  replyToIds: string[];
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function Composer({
  active,
  channelName,
  replyToIds,
  onSubmit,
  onCancel,
}: ComposerProps) {
  const [text, setText] = useState("");

  useInput(
    (input, key) => {
      if (!active) return;

      if (key.escape) {
        setText("");
        onCancel();
        return;
      }

      if (key.return) {
        const trimmed = text.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setText("");
        }
        return;
      }

      if (key.backspace || key.delete) {
        setText((t) => t.slice(0, -1));
        return;
      }

      // Only handle printable characters, with a length cap to prevent
      // memory issues from large pastes (100KB matches MaverickMessage max text).
      if (input && !key.ctrl && !key.meta) {
        setText((t) => (t.length + input.length > 100_000 ? t : t + input));
      }
    },
    { isActive: active },
  );

  const hasReply = replyToIds.length > 0;

  return (
    <Box flexDirection="column">
      {hasReply && (
        <Box paddingX={2}>
          <Text color={theme.accentDim}>
            {sym.treeCorner}{sym.treeHoriz} replying to{" "}
          </Text>
          <Text color={theme.accentBright}>
            {replyToIds.map((id) => id.slice(0, 8)).join(", ")}
          </Text>
        </Box>
      )}
      <Box
        borderStyle="round"
        borderColor={active ? theme.accent : theme.borderSubtle}
        paddingX={1}
      >
        <Text color={active ? theme.channels : theme.dim}>
          {sym.hash}{channelName}
        </Text>
        <Text color={theme.borderSubtle}> {sym.pipe} </Text>
        {active ? (
          <Text color={theme.text}>
            {text}
            <Text color={theme.accent}>▊</Text>
          </Text>
        ) : (
          <Text color={theme.dim} italic>
            Press <Text color={theme.muted}>i</Text> to compose{sym.ellipsis}
          </Text>
        )}
      </Box>
    </Box>
  );
}
