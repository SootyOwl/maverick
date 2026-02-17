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

type LoginStatus =
  | "idle"           // handle/password form
  | "authenticating" // progress steps
  | "phraseDisplay"  // show generated phrase (new user)
  | "phraseConfirm"  // type phrase back to confirm
  | "phraseEntry"    // enter recovery phrase (returning user)
  | "recovering"     // running recovery steps
  | "success"
  | "error";

const STEPS = [
  "Authenticating with Bluesky",
  "Setting up XMTP identity",
  "Publishing identity bridge",
  "Setting up database",
  "Recovering communities",
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

/** Intermediate state saved after Bluesky auth, before phrase flow */
interface BlueskyResult {
  agent: import("@atproto/api").AtpAgent;
  did: string;
  handle: string;
  config: Config;
  password: string;
}

export function LoginScreen({ initialConfig, onLogin }: LoginScreenProps) {
  const { exit } = useApp();

  // ── Login form state ─────────────────────────────────────────────────
  const [handle, setHandle] = useState(initialConfig.bluesky.handle);
  const [password, setPassword] = useState(initialConfig.bluesky.password);
  const [activeField, setActiveField] = useState<"handle" | "password">(
    initialConfig.bluesky.handle ? "password" : "handle",
  );

  // ── Login flow state ─────────────────────────────────────────────────
  const [status, setStatus] = useState<LoginStatus>("idle");
  const [step, setStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(4); // default: no recovery step
  const [error, setError] = useState<string | null>(null);

  // ── Phrase flow state ────────────────────────────────────────────────
  const [recoveryPhrase, setRecoveryPhrase] = useState(""); // generated phrase (new user)
  const [phraseInput, setPhraseInput] = useState("");        // user's typed phrase
  const [phraseError, setPhraseError] = useState<string | null>(null);
  const [existingInboxId, setExistingInboxId] = useState<string | null>(null);

  // ── Intermediate state (saved between Bluesky auth and phrase flow) ──
  const [bskyResult, setBskyResult] = useState<BlueskyResult | null>(null);

  const autoLogin = !!(initialConfig.bluesky.handle && initialConfig.bluesky.password);

  // ── Phase 1: Bluesky auth + key check ────────────────────────────────
  const doLogin = useCallback(async (h: string, p: string) => {
    if (!h || !p) {
      setError("Handle and password are required");
      return;
    }

    setStatus("authenticating");
    setError(null);
    setStep(0);
    setTotalSteps(4);

    try {
      // Step 0: Authenticate with Bluesky
      const { createBlueskySession } = await import("../../identity/atproto.js");
      const config: Config = {
        ...initialConfig,
        bluesky: { ...initialConfig.bluesky, handle: h, password: p },
      };
      const bsky = await createBlueskySession(config);

      setStep(1);

      // Step 1: Check for cached key
      const { getCachedPrivateKey, migrateLegacyIdentity, createNewIdentity } =
        await import("../../identity/xmtp.js");

      // 1a: Try cached key (keychain / plaintext file)
      let privateKey = await getCachedPrivateKey(bsky.handle);
      if (privateKey) {
        // Have a cached key -- skip phrase flow entirely
        await finishLogin(config, bsky, privateKey, p, false);
        return;
      }

      // 1b: Try legacy key migration (old passphrase-encrypted format)
      privateKey = await migrateLegacyIdentity(bsky.handle, p);
      if (privateKey) {
        await finishLogin(config, bsky, privateKey, p, false);
        return;
      }

      // 1c: Check PDS for existing community.maverick.inbox record
      const { getMaverickRecord } = await import("../../identity/bridge.js");
      const record = await getMaverickRecord(bsky.agent, bsky.did);

      // Save intermediate state for phrase flow continuation
      const result: BlueskyResult = {
        agent: bsky.agent,
        did: bsky.did,
        handle: bsky.handle,
        config,
        password: p,
      };
      setBskyResult(result);

      if (record) {
        // Returning user: record exists on PDS, need recovery phrase
        setExistingInboxId(record.inboxId);
        setStatus("phraseEntry");
      } else {
        // New user: generate a recovery phrase and display it
        const identity = await createNewIdentity(bsky.handle, bsky.did);
        setRecoveryPhrase(identity.recoveryPhrase);
        setStatus("phraseDisplay");
        // Note: privateKey is saved in createNewIdentity but we don't proceed
        // until the user confirms the phrase. The key is already cached.
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [initialConfig, onLogin]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phase 2: Finish login (create XMTP client, publish bridge, etc.) ─
  const finishLogin = useCallback(async (
    config: Config,
    bsky: { agent: import("@atproto/api").AtpAgent; did: string; handle: string },
    privateKey: `0x${string}`,
    pwd: string,
    isRecovery: boolean,
  ) => {
    try {
      if (isRecovery) {
        setStatus("recovering");
        setTotalSteps(5);
      }

      // Step 1: Create XMTP client
      setStep(1);
      const { createXmtpClient } = await import("../../identity/xmtp.js");
      const xmtpClient = await createXmtpClient(config, privateKey);

      // Step 2: Publish identity bridge
      setStep(2);
      const { publishMaverickRecord } = await import("../../identity/bridge.js");
      await publishMaverickRecord(bsky.agent, xmtpClient);

      // Step 3: Set up database
      setStep(3);
      const { createDatabase } = await import("../../storage/db.js");
      const db = createDatabase(config.sqlitePath);

      const { CommunityManager } = await import("../../community/manager.js");
      const manager = new CommunityManager(xmtpClient, db);

      // Cache profile
      const { upsertProfile } = await import("../../storage/profiles.js");
      upsertProfile(db, {
        did: bsky.did,
        inboxId: xmtpClient.inboxId,
        handle: bsky.handle,
      });

      // Step 4: Recovery (only during recovery flow)
      if (isRecovery) {
        setStep(4);
        try {
          await manager.recoverAllCommunities();
        } catch {
          // Non-fatal: community recovery can fail gracefully
        }
      }

      // Persist session credentials
      try {
        const { saveSession } = await import("../../storage/session.js");
        saveSession(bsky.handle, pwd);
      } catch {
        // Non-fatal: keychain may be unavailable
      }

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
  }, [onLogin]);

  // ── Phrase confirmation handler (new user) ───────────────────────────
  const handlePhraseConfirm = useCallback(async () => {
    if (!bskyResult) return;

    const { normalizePhrase } = await import("../../identity/recovery-phrase.js");
    const normalized = normalizePhrase(phraseInput);
    const expected = normalizePhrase(recoveryPhrase);

    if (normalized !== expected) {
      setPhraseError("Phrase does not match. Please try again.");
      setPhraseInput("");
      return;
    }

    // Phrase confirmed -- proceed with login
    setPhraseError(null);
    setStatus("authenticating");

    const { getCachedPrivateKey } = await import("../../identity/xmtp.js");
    const privateKey = await getCachedPrivateKey(bskyResult.handle);
    if (!privateKey) {
      setStatus("error");
      setError("Failed to retrieve cached key after identity creation.");
      return;
    }

    await finishLogin(
      bskyResult.config,
      bskyResult,
      privateKey,
      bskyResult.password,
      false,
    );
  }, [bskyResult, phraseInput, recoveryPhrase, finishLogin]);

  // ── Phrase entry handler (returning user / recovery) ─────────────────
  const handlePhraseEntry = useCallback(async () => {
    if (!bskyResult) return;

    const { validateRecoveryPhrase } = await import("../../identity/recovery-phrase.js");

    if (!validateRecoveryPhrase(phraseInput)) {
      setPhraseError(
        "Invalid phrase. Must be 6 words from the Diceware wordlist.",
      );
      return;
    }

    setPhraseError(null);
    setStatus("recovering");
    setTotalSteps(5);
    setStep(1);

    try {
      const { recoverIdentity, createXmtpClient } = await import("../../identity/xmtp.js");

      // Derive key from phrase + DID
      const privateKey = await recoverIdentity(
        bskyResult.handle,
        bskyResult.did,
        phraseInput,
      );

      // Create XMTP client to verify the inbox ID matches
      const xmtpClient = await createXmtpClient(bskyResult.config, privateKey);

      // Verify the recovered inbox ID matches the PDS record
      if (existingInboxId && xmtpClient.inboxId !== existingInboxId) {
        setStatus("phraseEntry");
        setPhraseError(
          "Recovery phrase does not match the identity on record. " +
          "The derived inbox ID differs from your published record.",
        );
        setPhraseInput("");
        return;
      }

      // Step 2: Publish bridge
      setStep(2);
      const { publishMaverickRecord } = await import("../../identity/bridge.js");
      await publishMaverickRecord(bskyResult.agent, xmtpClient);

      // Step 3: Set up database
      setStep(3);
      const { createDatabase } = await import("../../storage/db.js");
      const db = createDatabase(bskyResult.config.sqlitePath);

      const { CommunityManager } = await import("../../community/manager.js");
      const manager = new CommunityManager(xmtpClient, db);

      // Cache profile
      const { upsertProfile } = await import("../../storage/profiles.js");
      upsertProfile(db, {
        did: bskyResult.did,
        inboxId: xmtpClient.inboxId,
        handle: bskyResult.handle,
      });

      // Step 4: Recover communities
      setStep(4);
      try {
        await manager.recoverAllCommunities();
      } catch {
        // Non-fatal
      }

      // Persist session
      try {
        const { saveSession } = await import("../../storage/session.js");
        saveSession(bskyResult.handle, bskyResult.password);
      } catch {
        // Non-fatal
      }

      setStatus("success");

      onLogin({
        xmtpClient,
        db,
        handle: bskyResult.handle,
        did: bskyResult.did,
        agent: bskyResult.agent,
        privateKey,
        manager,
      });
    } catch (err) {
      setStatus("phraseEntry");
      setPhraseError(err instanceof Error ? err.message : String(err));
      setPhraseInput("");
    }
  }, [bskyResult, phraseInput, existingInboxId, onLogin]);

  // ── Auto-login on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (autoLogin) {
      doLogin(handle, password);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard handling ────────────────────────────────────────────────
  useInput((input, key) => {
    if (key.escape) {
      // In phrase states, Esc goes back to idle (cancel)
      if (status === "phraseDisplay" || status === "phraseConfirm" || status === "phraseEntry") {
        setStatus("idle");
        setPhraseInput("");
        setPhraseError(null);
        setRecoveryPhrase("");
        setExistingInboxId(null);
        setBskyResult(null);
        return;
      }
      exit();
      return;
    }

    if (status === "authenticating" || status === "recovering" || status === "success") return;

    // ── phraseDisplay: wait for Enter ──────────────────────────────
    if (status === "phraseDisplay") {
      if (key.return) {
        setStatus("phraseConfirm");
        setPhraseInput("");
        setPhraseError(null);
      }
      return;
    }

    // ── phraseConfirm: Enter to confirm ────────────────────────────
    if (status === "phraseConfirm") {
      if (key.return) {
        handlePhraseConfirm();
      }
      return;
    }

    // ── phraseEntry: Enter to recover ──────────────────────────────
    if (status === "phraseEntry") {
      if (key.return) {
        handlePhraseEntry();
      }
      return;
    }

    // ── idle: login form ───────────────────────────────────────────
    if (status === "idle" || status === "error") {
      if (key.tab) {
        setActiveField((f) => (f === "handle" ? "password" : "handle"));
        return;
      }

      if (key.return) {
        doLogin(handle, password);
        return;
      }
    }
  });

  // ── Render: steps display (authenticating / recovering) ──────────────
  const renderSteps = () => {
    const visibleSteps = STEPS.slice(0, totalSteps);
    return (
      <Box flexDirection="column" paddingX={1}>
        {visibleSteps.map((s, i) => (
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
    );
  };

  // ── Render: phrase display (new user) ────────────────────────────────
  const renderPhraseDisplay = () => (
    <Box flexDirection="column" paddingX={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.yellow}
        paddingX={2}
        paddingY={1}
      >
        <Text color={theme.yellow} bold>
          Your Recovery Phrase
        </Text>
        <Box marginTop={1}>
          <Text color={theme.textSecondary}>
            Write this down and keep it safe:
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.text} bold>
            {recoveryPhrase}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.textSecondary}>
            You need this phrase to recover your
          </Text>
        </Box>
        <Text color={theme.textSecondary}>
          identity on a new device.
        </Text>
      </Box>

      <Box marginTop={1} gap={2}>
        <Box>
          <Text color={theme.muted}>Enter</Text>
          <Text color={theme.dim}>:I've saved it</Text>
        </Box>
        <Box>
          <Text color={theme.muted}>Esc</Text>
          <Text color={theme.dim}>:cancel</Text>
        </Box>
      </Box>
    </Box>
  );

  // ── Render: phrase confirm (new user types phrase back) ──────────────
  const renderPhraseConfirm = () => (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.textSecondary}>
          Confirm your recovery phrase:
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
          label="Phrase"
          value={phraseInput}
          onChange={setPhraseInput}
          active={true}
          placeholder="word1 word2 word3 word4 word5 word6"
        />
      </Box>

      {phraseError && (
        <Box marginTop={1} gap={1}>
          <Text color={theme.red}>{sym.dot}</Text>
          <Text color={theme.red}>{phraseError}</Text>
        </Box>
      )}

      <Box marginTop={1} gap={2}>
        <Box>
          <Text color={theme.muted}>Enter</Text>
          <Text color={theme.dim}>:confirm</Text>
        </Box>
        <Box>
          <Text color={theme.muted}>Esc</Text>
          <Text color={theme.dim}>:cancel</Text>
        </Box>
      </Box>
    </Box>
  );

  // ── Render: phrase entry (returning user) ────────────────────────────
  const renderPhraseEntry = () => (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text color={theme.yellow}>
          Existing Maverick identity found.
        </Text>
        <Text color={theme.textSecondary}>
          Enter your recovery phrase to restore:
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
          label="Phrase"
          value={phraseInput}
          onChange={setPhraseInput}
          active={true}
          placeholder="word1 word2 word3 word4 word5 word6"
        />
      </Box>

      {phraseError && (
        <Box marginTop={1} gap={1}>
          <Text color={theme.red}>{sym.dot}</Text>
          <Text color={theme.red}>{phraseError}</Text>
        </Box>
      )}

      <Box marginTop={1} gap={2}>
        <Box>
          <Text color={theme.muted}>Enter</Text>
          <Text color={theme.dim}>:recover</Text>
        </Box>
        <Box>
          <Text color={theme.muted}>Esc</Text>
          <Text color={theme.dim}>:cancel</Text>
        </Box>
      </Box>
    </Box>
  );

  // ── Render: success ──────────────────────────────────────────────────
  const renderSuccess = () => (
    <Box paddingX={1} gap={1}>
      <Text color={theme.green}>{sym.check}</Text>
      <Text color={theme.green} bold>
        Logged in! Loading communities{sym.ellipsis}
      </Text>
    </Box>
  );

  // ── Render: login form (idle / error) ────────────────────────────────
  const renderForm = () => (
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
  );

  // ── Main render ──────────────────────────────────────────────────────
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

      {(status === "authenticating" || status === "recovering") ? renderSteps()
        : status === "phraseDisplay" ? renderPhraseDisplay()
        : status === "phraseConfirm" ? renderPhraseConfirm()
        : status === "phraseEntry" ? renderPhraseEntry()
        : status === "success" ? renderSuccess()
        : renderForm()}
    </Box>
  );
}
