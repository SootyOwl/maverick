import React from "react";
import { Box, Text } from "ink";
import { theme, sym } from "../theme.js";
import { sanitize } from "../../utils/sanitize.js";

interface ProfileCardProps {
  handle: string;
  did: string;
  inboxId: string;
}

export function ProfileCard({ handle, did, inboxId }: ProfileCardProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
    >
      <Text bold color={theme.channels}>{sym.dot} {sanitize(handle)}</Text>
      <Box paddingLeft={2} flexDirection="column">
        <Text color={theme.dim}>
          DID{" "}<Text color={theme.textSecondary}>{did.slice(0, 30)}{sym.ellipsis}</Text>
        </Text>
        <Text color={theme.dim}>
          Inbox{" "}<Text color={theme.textSecondary}>{inboxId.slice(0, 20)}{sym.ellipsis}</Text>
        </Text>
      </Box>
    </Box>
  );
}
