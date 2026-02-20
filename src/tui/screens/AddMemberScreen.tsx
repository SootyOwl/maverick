import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { theme, sym } from "../theme.js";
import { Spinner } from "../components/Spinner.js";
import { sanitize } from "../../utils/sanitize.js";
import { TextInput } from "../components/TextInput.js";
import { resolveHandleToInbox } from "../../identity/resolver.js";
import { upsertProfile } from "../../storage/profiles.js";
import { createInvite, encodeInvite } from "../../community/invites.js";
import type { AuthSession } from "../hooks/useAppState.js";

interface AddMemberScreenProps {
  session: AuthSession;
  metaGroupId: string;
  communityName: string;
  onBack: () => void;
}

type Status = "idle" | "resolving" | "adding" | "generating" | "done" | "error";

function StepLine({ done, active, text }: { done: boolean; active: boolean; text: string }) {
  return (
    <Box gap={1}>
      {done ? (
        <Text color={theme.green}>{sym.check}</Text>
      ) : active ? (
        <Spinner />
      ) : (
        <Text color={theme.dim}>{sym.dotEmpty}</Text>
      )}
      <Text color={done || active ? theme.text : theme.dim}>{text}</Text>
    </Box>
  );
}

export function AddMemberScreen({
  session,
  metaGroupId,
  communityName,
  onBack,
}: AddMemberScreenProps) {
  const [identifier, setIdentifier] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [resultHandle, setResultHandle] = useState<string | null>(null);
  const [resultInboxId, setResultInboxId] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  const doAdd = useCallback(async () => {
    const trimmed = identifier.trim();
    if (!trimmed) {
      setError("Handle or Inbox ID is required");
      return;
    }

    setError(null);

    let inboxId = trimmed;
    let resolvedHandle: string | null = null;
    let resolvedDid: string | null = null;

    // If it looks like a handle (contains a dot), try to resolve it
    if (trimmed.includes(".")) {
      setStatus("resolving");
      try {
        const resolved = await resolveHandleToInbox(session.agent, trimmed);
        inboxId = resolved.inboxId;
        resolvedHandle = trimmed;
        resolvedDid = resolved.did;
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    // Add member to community
    setStatus("adding");
    try {
      await session.manager.addMember(metaGroupId, inboxId);
      setResultHandle(resolvedHandle);
      setResultInboxId(inboxId);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    // Cache profile if we resolved a handle (use real DID, not inboxId)
    if (resolvedHandle && resolvedDid) {
      try {
        upsertProfile(session.db, {
          did: resolvedDid,
          inboxId,
          handle: resolvedHandle,
        });
      } catch {
        // Non-fatal
      }
    }

    // Generate invite token (non-fatal if it fails — member is already added)
    setStatus("generating");
    try {
      const invite = await createInvite(
        session.privateKey,
        communityName,
        metaGroupId,
        session.did,
        "member",
        72,
      );
      setInviteToken(encodeInvite(invite));
    } catch {
      // Non-fatal: member was already added successfully
    }

    setStatus("done");
  }, [identifier, session, metaGroupId, communityName]);

  useInput((input, key) => {
    if (status === "resolving" || status === "adding" || status === "generating") return;

    if (key.escape) {
      onBack();
      return;
    }

    if (key.return && (status === "idle" || status === "error")) {
      doAdd();
      return;
    }
  });

  const displayName = resultHandle ?? resultInboxId ?? identifier;
  const isProcessing = status === "resolving" || status === "adding" || status === "generating";
  const stepOrder: Status[] = ["resolving", "adding", "generating", "done"];
  const currentStep = stepOrder.indexOf(status);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} gap={1}>
        <Text color={theme.accentBright} bold>
          Invite & Add Member
        </Text>
        <Text color={theme.dim}>to {sanitize(communityName)}</Text>
      </Box>

      {isProcessing ? (
        <Box flexDirection="column" paddingX={1}>
          <StepLine
            done={currentStep > 0}
            active={currentStep === 0}
            text="Resolving handle"
          />
          <StepLine
            done={currentStep > 1}
            active={currentStep === 1}
            text="Adding to community and channels"
          />
          <StepLine
            done={currentStep > 2}
            active={currentStep === 2}
            text="Generating invite token"
          />
          <Box marginTop={1}>
            <Text color={theme.muted}>Esc</Text>
            <Text color={theme.dim}>:cancel</Text>
          </Box>
        </Box>
      ) : status === "done" ? (
        <Box flexDirection="column" paddingX={1}>
          <Box borderStyle="round" borderColor={theme.green} paddingX={1} flexDirection="column">
            <Box gap={1}>
              <Text color={theme.green}>{sym.check}</Text>
              <Text color={theme.green} bold>Added {sanitize(displayName)} to {sanitize(communityName)}</Text>
            </Box>
            {resultHandle && resultInboxId && (
              <Box paddingLeft={2}>
                <Text color={theme.dim}>
                  Inbox <Text color={theme.textSecondary}>{resultInboxId}</Text>
                </Text>
              </Box>
            )}
          </Box>

          {inviteToken && (
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.dim}>Share this invite token with them:</Text>
              <Box marginTop={1} borderStyle="round" borderColor={theme.border} paddingX={1}>
                <Text color={theme.channels} wrap="wrap">{inviteToken}</Text>
              </Box>
            </Box>
          )}

          <Box marginTop={1}>
            <Text color={theme.muted}>Esc</Text>
            <Text color={theme.dim}>:back</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1}>
          <Box
            borderStyle="round"
            borderColor={theme.border}
            paddingX={1}
          >
            <TextInput
              label="Handle or Inbox ID"
              value={identifier}
              onChange={setIdentifier}
              active={true}
              placeholder="alice.bsky.social or inbox-abc..."
            />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.dim}>
              Enter a Bluesky handle (auto-resolved) or raw XMTP Inbox ID.
            </Text>
          </Box>

          {error && (
            <Box marginTop={1} gap={1}>
              <Text color={theme.red}>{sym.dot}</Text>
              <Text color={theme.red}>{error}</Text>
            </Box>
          )}

          <Box marginTop={1} gap={2}>
            <Box>
              <Text color={theme.muted}>Enter</Text>
              <Text color={theme.dim}>:add</Text>
            </Box>
            <Box>
              <Text color={theme.muted}>Esc</Text>
              <Text color={theme.dim}>:back</Text>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
