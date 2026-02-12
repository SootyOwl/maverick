import React from "react";
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
  useInput(
    (input, key) => {
      if (!active) return;

      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }

      if (input && !key.ctrl && !key.meta && !key.return && !key.escape && !key.tab) {
        onChange(value + input);
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
