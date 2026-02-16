import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { theme, sym } from "../theme.js";
import {
  formatThreadMessage,
  getThreadPanelMetrics,
  type FormattedThreadMessage,
  type TextSpan,
} from "../utils.js";
import type { ThreadContext } from "../../messaging/dag.js";
import type { StoredMessage } from "../../storage/messages.js";

interface ThreadLinesProps {
  thread: ThreadContext | null;
  focused: boolean;
  flatMessages?: StoredMessage[];
  selectedIndex?: number;
  focusedMessageIndex?: number;
}

export function ThreadLines({
  thread,
  focused,
  flatMessages: flatMessagesProp,
  selectedIndex: selectedIndexProp,
  focusedMessageIndex,
}: ThreadLinesProps) {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const termRows = stdout.rows ?? 24;
  // Thread panel: ~20% of width, clamped to 20–34
  const panelWidth = Math.max(20, Math.min(34, Math.floor(cols * 0.2)));
  const metrics = getThreadPanelMetrics(panelWidth);

  // Derive effective flat messages from props or thread
  const flatMessages = useMemo(() => {
    if (flatMessagesProp) return flatMessagesProp;
    if (!thread) return [];
    return [...thread.ancestors, thread.message, ...thread.descendants];
  }, [flatMessagesProp, thread]);

  const selectedIndex = selectedIndexProp ?? -1;
  const focusedIdx = focusedMessageIndex ?? (thread ? thread.ancestors.length : -1);

  // Format all messages
  const formatted = useMemo<FormattedThreadMessage[]>(() => {
    if (!thread || flatMessages.length === 0) return [];

    const ancestorCount = thread.ancestors.length;
    const totalCount = flatMessages.length;

    return flatMessages.map((msg, i) => {
      let position: "ancestor" | "current" | "descendant";
      let isLast: boolean;
      if (i < ancestorCount) {
        position = "ancestor";
        isLast = i === ancestorCount - 1;
      } else if (i === ancestorCount) {
        position = "current";
        isLast = false;
      } else {
        position = "descendant";
        isLast = i === totalCount - 1;
      }

      return formatThreadMessage(msg, metrics, {
        selected: i === selectedIndex,
        position,
        isLast,
        totalAncestors: ancestorCount,
      });
    });
  }, [thread, flatMessages, metrics, selectedIndex]);

  // Compute available content rows (panel height minus header/separator/hints/border chrome)
  // Header: 1, separator: 1, bottom hints: 1 when focused, border: 2
  const chromeRows = 2 + 1 + 1 + (focused && thread ? 1 : 0);
  const availableRows = Math.max(3, termRows - chromeRows - 6); // 6 for outer chrome (composer, statusbar, etc.)

  // Flatten all formatted message lines for viewport scrolling
  const allLines = useMemo(() => {
    const lines: { spans: TextSpan[]; msgIndex: number }[] = [];
    for (let mi = 0; mi < formatted.length; mi++) {
      for (const line of formatted[mi].lines) {
        lines.push({ spans: line.spans, msgIndex: mi });
      }
    }
    return lines;
  }, [formatted]);

  // Viewport scrolling: center on selected message
  const { startLine, endLine } = useMemo(() => {
    if (allLines.length <= availableRows) {
      return { startLine: 0, endLine: allLines.length };
    }

    // Find the first line of the selected message
    let selectedFirstLine = 0;
    let selectedLastLine = 0;
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].msgIndex === selectedIndex) {
        selectedFirstLine = i;
        // Find last line of this message
        selectedLastLine = i;
        while (selectedLastLine + 1 < allLines.length && allLines[selectedLastLine + 1].msgIndex === selectedIndex) {
          selectedLastLine++;
        }
        break;
      }
    }

    // Center the selected message in the viewport
    const msgMidLine = Math.floor((selectedFirstLine + selectedLastLine) / 2);
    let start = msgMidLine - Math.floor(availableRows / 2);
    start = Math.max(0, Math.min(start, allLines.length - availableRows));
    return { startLine: start, endLine: start + availableRows };
  }, [allLines, availableRows, selectedIndex]);

  const visibleLines = allLines.slice(startLine, endLine);
  const hasScrollUp = startLine > 0;
  const hasScrollDown = endLine < allLines.length;
  const innerWidth = metrics.innerWidth;

  return (
    <Box
      flexDirection="column"
      width={panelWidth}
      borderStyle="round"
      borderColor={focused ? theme.accent : theme.border}
    >
      {/* Header */}
      <Box paddingX={1}>
        <Text bold color={focused ? theme.accentBright : theme.text}>
          Thread
        </Text>
        {thread && (
          <Text color={theme.dim}>
            {" "}{sym.separator} {flatMessages.length} msgs
          </Text>
        )}
      </Box>

      <Box paddingX={1}>
        <Text color={theme.borderSubtle}>
          {"─".repeat(Math.max(4, innerWidth))}
        </Text>
      </Box>

      {/* Empty state */}
      {!thread && (
        <Box paddingX={1} paddingY={1} flexDirection="column">
          <Text color={theme.dim}>
            Select a message
          </Text>
          <Text color={theme.dim}>
            and press <Text color={theme.muted}>r</Text> to view
          </Text>
          <Text color={theme.dim}>
            its thread context
          </Text>
        </Box>
      )}

      {/* Thread content */}
      {thread && (
        <Box flexDirection="column" paddingX={1}>
          {/* Scroll up indicator */}
          {hasScrollUp && (
            <Text color={theme.dim}>{"  " + sym.chevronRight + " more above"}</Text>
          )}

          {/* Visible lines */}
          {visibleLines.map((line, i) => (
            <Text key={i}>
              {line.spans.map((span, si) => (
                <Text
                  key={si}
                  color={span.color}
                  bold={span.bold}
                  dimColor={span.dimColor}
                >
                  {span.text}
                </Text>
              ))}
            </Text>
          ))}

          {/* Scroll down indicator */}
          {hasScrollDown && (
            <Text color={theme.dim}>{"  " + sym.chevronRight + " more below"}</Text>
          )}
        </Box>
      )}

      {/* Fill remaining space */}
      <Box flexGrow={1} />

      {/* Keyboard hints when focused */}
      {focused && thread && (
        <Box paddingX={1}>
          <Text color={theme.dim}>
            <Text color={theme.muted}>j/k</Text>:nav{" "}
            <Text color={theme.muted}>Enter</Text>:jump{" "}
            <Text color={theme.muted}>r</Text>:reply
          </Text>
        </Box>
      )}
    </Box>
  );
}
