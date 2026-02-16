import { useState, useCallback } from "react";
import { useInput, type Key } from "ink";

export type Panel = "channels" | "messages" | "thread";
export type Mode = "normal" | "insert";

export interface UseKeyboardResult {
  panel: Panel;
  mode: Mode;
  setMode: (m: Mode) => void;
}

export interface KeyboardActions {
  onNavigateUp: () => void;
  onNavigateDown: () => void;
  /** G — jump to latest message */
  onJumpToLatest: () => void;
  onChannelUp: () => void;
  onChannelDown: () => void;
  /** r — reply to selected message (sets single reply target) */
  onReply: () => void;
  /** R — multi-reply toggle (adds/removes selected message from reply targets) */
  onMultiReply: () => void;
  onQuit: () => void;
  /** Optional: navigate back (e.g. to community list) */
  onBack?: () => void;
  /** Optional: N — create new channel */
  onNewChannel?: () => void;
  /** Optional: I — invite & add member */
  onInvite?: () => void;
  /** Optional: Esc in normal mode (e.g. cancel pending reply) */
  onEscape?: () => void;
}

export function useKeyboard(actions: KeyboardActions): UseKeyboardResult {
  const [panel, setPanel] = useState<Panel>("messages");
  const [mode, setMode] = useState<Mode>("normal");

  useInput(
    useCallback(
      (input: string, key: Key) => {
        if (mode === "insert") {
          if (key.escape) {
            setMode("normal");
          }
          return;
        }

        // Normal mode keybindings
        if (key.escape) {
          actions.onEscape?.();
          return;
        }

        if (input === "q") {
          actions.onQuit();
          return;
        }

        if (input === "j" || key.downArrow) {
          if (panel === "channels") {
            actions.onChannelDown();
          } else {
            actions.onNavigateDown();
          }
          return;
        }

        if (input === "k" || key.upArrow) {
          if (panel === "channels") {
            actions.onChannelUp();
          } else {
            actions.onNavigateUp();
          }
          return;
        }

        if (input === "h" || key.leftArrow) {
          setPanel((p) =>
            p === "thread" ? "messages" : p === "messages" ? "channels" : p,
          );
          return;
        }

        if (input === "l" || key.rightArrow) {
          setPanel((p) =>
            p === "channels" ? "messages" : p === "messages" ? "thread" : p,
          );
          return;
        }

        if (input === "i" || key.return) {
          setMode("insert");
          setPanel("messages");
          return;
        }

        if (input === "r") {
          actions.onReply();
          setMode("insert");
          setPanel("messages");
          return;
        }

        if (input === "R") {
          actions.onMultiReply();
          return;
        }

        if (input === "G") {
          actions.onJumpToLatest();
          return;
        }

        if (input === "N" && actions.onNewChannel) {
          actions.onNewChannel();
          return;
        }

        if (input === "I" && actions.onInvite) {
          actions.onInvite();
          return;
        }

        if (key.tab) {
          setPanel((p) =>
            p === "channels"
              ? "messages"
              : p === "messages"
                ? "thread"
                : "channels",
          );
          return;
        }
      },
      [mode, panel, actions],
    ),
  );

  return { panel, mode, setMode };
}
