import React from "react";
import { Box, Text, useStdout } from "ink";
import {
  formatMessage,
  type FormattedLine,
  type PanelMetrics,
} from "../utils.js";
import type { VisibleMessage } from "../../messaging/dag.js";

interface MessagePropsFormatted {
  lines: FormattedLine[];
  selected: boolean;
}

interface MessagePropsLegacy {
  message: VisibleMessage;
  selected: boolean;
  compact?: boolean;
}

type MessageProps = MessagePropsFormatted | MessagePropsLegacy;

function isFormattedProps(props: MessageProps): props is MessagePropsFormatted {
  return "lines" in props && Array.isArray(props.lines);
}

export function Message(props: MessageProps) {
  let lines: FormattedLine[];

  if (isFormattedProps(props)) {
    lines = props.lines;
  } else {
    // Legacy path: format inline (used by tests that pass message prop)
    // Use standalone metrics — not getPanelMetrics which assumes 3-panel layout
    const { stdout } = useStdout();
    const termWidth = stdout.columns ?? 80;
    const senderWidth = 20;
    const gutterWidth = 2 + 6 + senderWidth; // indicator + time + sender
    const metrics: PanelMetrics = {
      totalWidth: termWidth,
      senderWidth,
      gutterWidth,
      bodyWidth: Math.max(10, termWidth - gutterWidth),
    };
    const fm = formatMessage(props.message, metrics, {
      selected: props.selected,
      compact: props.compact ?? false,
    });
    lines = fm.lines;
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>
          {line.spans.map((span, j) => (
            <Text
              key={j}
              color={span.color}
              bold={span.bold}
              dimColor={span.dimColor}
            >
              {span.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
