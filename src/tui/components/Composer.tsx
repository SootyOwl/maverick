import React, { useState, useRef, useEffect } from "react";
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

  // Batch paste input (same approach as TextInput) to prevent
  // per-character re-renders that cause visual artifacts.
  const valueRef = useRef(text);
  valueRef.current = text;
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useInput(
    (input, key) => {
      if (!active) return;

      if (key.escape) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
          bufferRef.current = "";
        }
        setText("");
        onCancel();
        return;
      }

      if (key.return) {
        // Flush any pending buffer before sending
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        const final = (valueRef.current + bufferRef.current).trim();
        bufferRef.current = "";
        if (final) {
          onSubmit(final);
          setText("");
        }
        return;
      }

      if (key.backspace || key.delete) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (bufferRef.current) {
          const combined = valueRef.current + bufferRef.current;
          bufferRef.current = "";
          setText(combined.slice(0, -1));
        } else {
          setText((t) => t.slice(0, -1));
        }
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        // Strip control characters that may arrive in paste data
        const clean = input.replace(/[\r\n\x00-\x1f]/g, "");
        if (!clean) return;

        bufferRef.current += clean;

        if (!timerRef.current) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            const pending = bufferRef.current;
            bufferRef.current = "";
            if (pending) {
              const current = valueRef.current;
              if (current.length + pending.length > 100_000) {
                setText(current + pending.slice(0, 100_000 - current.length));
              } else {
                setText(current + pending);
              }
            }
          }, 0);
        }
      }
    },
    { isActive: active },
  );

  const hasReply = replyToIds.length > 0;

  // Use a stable element structure regardless of active state to prevent
  // Ink's reconciler from destroying/recreating elements on mode switch,
  // which causes a brief layout flicker (the "newline" artifact).
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
        <Text color={active ? theme.text : theme.dim} italic={!active}>
          {active ? text : `Press i to compose${sym.ellipsis}`}
          {active && <Text color={theme.accent}>▊</Text>}
        </Text>
      </Box>
    </Box>
  );
}
