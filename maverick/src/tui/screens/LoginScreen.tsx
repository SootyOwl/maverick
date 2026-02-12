import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { theme, sym } from "../theme.js";
import { TextInput } from "../components/TextInput.js";
import type { AuthSession } from "../hooks/useAppState.js";
import type { Config } from "../../config.js";

interface LoginScreenProps {
  initialConfig: Config;
  onLogin: (session: AuthSession) => void;
}

type LoginStatus = "idle" | "authenticating" | "success" | "error";

const STEPS = [
  "Authenticating with Bluesky",
  "Creating XMTP client",
  "Publishing identity bridge",
  "Setting up database",
];

/** Animated spinner for current step */
function StepSpinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % sym.spinnerFrames.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return (
    <Text color={theme.accent}>{sym.spinnerFrames[frame]}</Text>
  );
}

export function LoginScreen({ initialConfig, onLogin }: LoginScreenProps) {
  const { exit } = useApp();

  const [handle, setHandle] = useState(initialConfig.bluesky.handle);
  const [password, setPassword] = useState(initialConfig.bluesky.password);
  const [activeField, setActiveField] = useState<"handle" | "password">(
    initialConfig.bluesky.handle ? "password" : "handle",
  );
  const [status, setStatus] = useState<LoginStatus>("idle");
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const autoLogin = !!(initialConfig.bluesky.handle && initialConfig.bluesky.password);

  const doLogin = useCallback(async (h: string, p: string) => {
    if (!h || !p) {
      setError("Handle and password are required");
      return;
    }

    setStatus("authenticating");
    setError(null);
    setStep(0);

    try {
      const { createBlueskySession } = await import("../../identity/atproto.js");
      const config: Config = {
        ...initialConfig,
        bluesky: { ...initialConfig.bluesky, handle: h, password: p },
      };
      const bsky = await createBlueskySession(config);

      setStep(1);
      const { createXmtpClient, getOrCreatePrivateKey } = await import("../../identity/xmtp.js");
      const privateKey = await getOrCreatePrivateKey(bsky.handle, p);
      const xmtpClient = await createXmtpClient(config, privateKey);

      setStep(2);
      const { publishInboxRecord } = await import("../../identity/bridge.js");
      await publishInboxRecord(bsky.agent, xmtpClient);

      setStep(3);
      const { createDatabase } = await import("../../storage/db.js");
      const db = createDatabase(config.sqlitePath);

      const { CommunityManager } = await import("../../community/manager.js");
      const manager = new CommunityManager(xmtpClient, db);

      // Cache the logged-in user's profile for handle resolution
      const { upsertProfile } = await import("../../storage/profiles.js");
      upsertProfile(db, {
        did: bsky.did,
        inboxId: xmtpClient.inboxId,
        handle: bsky.handle,
      });

      setStatus("success");

      onLogin({
        xmtpClient,
        db,
        handle: bsky.handle,
        did: bsky.did,
        agent: bsky.agent,
        privateKey,
        manager,
      });
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [initialConfig, onLogin]);

  useEffect(() => {
    if (autoLogin) {
      doLogin(handle, password);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input, key) => {
    if (key.escape) {
      exit();
      return;
    }

    if (status === "authenticating" || status === "success") return;

    if (key.tab) {
      setActiveField((f) => (f === "handle" ? "password" : "handle"));
      return;
    }

    if (key.return) {
      doLogin(handle, password);
      return;
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* Logo */}
      <Box
        borderStyle="round"
        borderColor={theme.accent}
        paddingX={2}
        marginBottom={1}
        justifyContent="center"
      >
        <Text color={theme.accentBright} bold>
          maverick
        </Text>
        <Text color={theme.dim}>
          {" "}{sym.separator} private community chat
        </Text>
      </Box>

      {status === "authenticating" ? (
        <Box flexDirection="column" paddingX={1}>
          {STEPS.map((s, i) => (
            <Box key={i} gap={1}>
              {i < step ? (
                <Text color={theme.green}>{sym.check}</Text>
              ) : i === step ? (
                <StepSpinner />
              ) : (
                <Text color={theme.dim}>{sym.dotEmpty}</Text>
              )}
              <Text color={i <= step ? theme.text : theme.dim}>
                {s}
              </Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text color={theme.dim}>
              Esc{" "}<Text color={theme.muted}>cancel</Text>
            </Text>
          </Box>
        </Box>
      ) : status === "success" ? (
        <Box paddingX={1} gap={1}>
          <Text color={theme.green}>{sym.check}</Text>
          <Text color={theme.green} bold>
            Logged in! Loading communities{sym.ellipsis}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1}>
          <Box marginBottom={1}>
            <Text color={theme.textSecondary}>
              Sign in with your Bluesky account
            </Text>
          </Box>

          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={theme.border}
            paddingX={1}
            paddingY={0}
          >
            <TextInput
              label="Handle"
              value={handle}
              onChange={setHandle}
              active={activeField === "handle"}
              placeholder="alice.bsky.social"
            />
            <TextInput
              label="Password"
              value={password}
              onChange={setPassword}
              active={activeField === "password"}
              secret
              placeholder="app password"
            />
          </Box>

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
              <Text color={theme.dim}>:login</Text>
            </Box>
            <Box>
              <Text color={theme.muted}>Esc</Text>
              <Text color={theme.dim}>:quit</Text>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
