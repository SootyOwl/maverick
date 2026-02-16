import React, { useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";

interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  active: boolean;
  secret?: boolean;
  placeholder?: string;
}

export function TextInput({
  label,
  value,
  onChange,
  active,
  secret = false,
  placeholder,
}: TextInputProps) {
  // Keep a ref to the latest value so the flush callback always sees current state
  const valueRef = useRef(value);
  valueRef.current = value;

  // Buffer for batching paste input: accumulates characters and flushes
  // on the next macrotask so a multi-character paste triggers a single
  // state update instead of one per character (which causes Ink rendering
  // artifacts — stars appearing vertically instead of horizontally).
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useInput(
    (input, key) => {
      if (!active) return;

      if (key.backspace || key.delete) {
        // Flush any pending buffer first, then delete
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (bufferRef.current) {
          const combined = valueRef.current + bufferRef.current;
          bufferRef.current = "";
          onChange(combined.slice(0, -1));
        } else {
          onChange(value.slice(0, -1));
        }
        return;
      }

      if (input && !key.ctrl && !key.meta && !key.return && !key.escape && !key.tab) {
        // Strip control characters that may arrive in paste data
        const clean = input.replace(/[\r\n\x00-\x1f]/g, "");
        if (!clean) return;

        bufferRef.current += clean;

        // Schedule a flush: all characters from a paste arrive synchronously
        // within the same event loop tick, so setTimeout(0) fires after all
        // of them have been buffered.
        if (!timerRef.current) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            const pending = bufferRef.current;
            bufferRef.current = "";
            if (pending) {
              const current = valueRef.current;
              if (current.length + pending.length <= 1000) {
                onChange(current + pending);
              } else {
                onChange(current + pending.slice(0, 1000 - current.length));
              }
            }
          }, 0);
        }
      }
    },
    { isActive: active },
  );

  const displayValue = secret ? "*".repeat(value.length) : value;
  const showPlaceholder = !value && placeholder && !active;

  return (
    <Box>
      <Text color={active ? theme.accent : theme.muted} bold={active}>
        {label}:{" "}
      </Text>
      {showPlaceholder ? (
        <Text color={theme.dim} italic>
          {placeholder}
        </Text>
      ) : (
        <Text color={theme.text}>
          {displayValue}
          {active && <Text color={theme.accent}>▊</Text>}
        </Text>
      )}
    </Box>
  );
}
