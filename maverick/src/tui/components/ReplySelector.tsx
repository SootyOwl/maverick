import React from "react";
import { Box, Text } from "ink";
import { theme, sym } from "../theme.js";
import { sanitize } from "../../utils/sanitize.js";
import type { VisibleMessage } from "../../messaging/dag.js";

interface ReplySelectorProps {
  replyTargets: VisibleMessage[];
  onClear: () => void;
}

export function ReplySelector({ replyTargets, onClear }: ReplySelectorProps) {
  if (replyTargets.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accentDim}
      borderTop
      borderBottom
      borderLeft
      borderRight
      paddingX={1}
      marginX={1}
    >
      <Box flexDirection="row" gap={1}>
        <Text color={theme.accent} bold>
          {sym.treeCorner}{sym.treeHoriz} Replying to
        </Text>
        <Text color={theme.dim}>
          (Esc to cancel)
        </Text>
      </Box>
      {replyTargets.map((msg) => {
        const sender = sanitize(msg.senderHandle ?? msg.senderInboxId.slice(0, 8));
        const text = sanitize(msg.text);
        return (
          <Box key={msg.id} paddingLeft={2} flexDirection="row">
            <Text color={theme.channels} bold>
              {sender}
            </Text>
            <Text color={theme.textSecondary}>
              {" "}{sym.separator}{" "}
              {text.length > 55
                ? text.slice(0, 54) + sym.ellipsis
                : text}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
