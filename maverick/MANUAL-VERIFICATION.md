# Maverick Manual Verification Guide

End-to-end walkthrough for testing the current CLI implementation with two Bluesky accounts.

## Prerequisites

- Node.js 18+
- pnpm installed
- Two Bluesky accounts with app passwords (see `alice.env` and `bob.env`)
- Linux: `libsecret-1-dev` installed (for native modules)

## Setup

```bash
cd maverick
pnpm install
pnpm build       # verify clean compile
pnpm test        # 116 tests should pass
```

## Running Commands

All commands use `pnpm dev` which runs `tsx src/index.ts`. Environment variables are loaded from the shell, so source an env file before each session.

**Terminal 1 (Alice):**
```bash
cd maverick
source alice.env && export MAVERICK_BLUESKY_HANDLE MAVERICK_BLUESKY_PASSWORD MAVERICK_DATA_DIR
```

**Terminal 2 (Bob):**
```bash
cd maverick
source bob.env && export MAVERICK_BLUESKY_HANDLE MAVERICK_BLUESKY_PASSWORD MAVERICK_DATA_DIR
```

> **Note:** `source` alone sets shell variables. You must also `export` them so `tsx` can read them. Alternatively, use `env $(cat alice.env | xargs)` as a prefix.

One-liner alternative:
```bash
env $(cat alice.env | xargs) pnpm dev -- <command>
```

---

## Test Scenarios

### 1. Identity — Login & Bridge

**Alice (Terminal 1):**
```bash
pnpm dev -- login
```

Expected output:
```
Logged in as tyto.cc (did:plc:...)
XMTP Inbox ID: <hex string>
Installation ID: <hex string>
Publishing identity bridge record...
Published org.xmtp.inbox record on PDS
Login complete!
```

**Bob (Terminal 2):**
```bash
pnpm dev -- login
```

Same shape of output with Bob's handle and DID.

**Verify:** Both accounts now have `org.xmtp.inbox` records on their PDS.

### 2. Identity — Resolve

**Alice resolves Bob:**
```bash
pnpm dev -- resolve maverick-test.bsky.social
```

Expected:
```
Resolving maverick-test.bsky.social...
DID:      did:plc:...
Inbox ID: <bob's inbox id>
Verified: true
```

**Bob resolves Alice:**
```bash
pnpm dev -- resolve tyto.cc
```

**Verify:** Both can look up each other's XMTP Inbox ID via their Bluesky handle. `Verified: true` confirms the signature is valid.

### 3. Identity — Whoami

```bash
pnpm dev -- whoami
```

Quick sanity check that returns handle, DID, Inbox ID, and Installation ID.

---

### 4. Community — Create

**Alice creates a community:**
```bash
pnpm dev -- create "Test Community" -d "A test community for verification"
```

Expected:
```
Creating community "Test Community"...
Community created! Meta group ID: <META_GROUP_ID>
Creating #general channel...
Channel created! ID: <channel_id>
```

**Save the `<META_GROUP_ID>`** — you'll need it for every subsequent command.

### 5. Community — List Channels

```bash
pnpm dev -- channels <META_GROUP_ID>
```

Expected:
```
Syncing community state...

Community: Test Community
  A test community for verification

Channels:
  #general (open) - <xmtp_group_id>
```

### 6. Community — Add Channel

```bash
pnpm dev -- add-channel <META_GROUP_ID> dev -d "Development discussion"
```

Then verify:
```bash
pnpm dev -- channels <META_GROUP_ID>
```

Should now list both `#general` and `#dev`.

### 7. Community — List Communities

```bash
pnpm dev -- communities
```

Expected:
```
Scanning for communities...

Found 1 community(ies):

  Test Community
    Meta group: <META_GROUP_ID>
```

---

### 8. Invites — Generate & Verify

**Alice generates an invite:**
```bash
pnpm dev -- invite <META_GROUP_ID>
```

Expected:
```
Invite token generated!
Community: Test Community
Role: member
Expires: <ISO datetime ~72h from now>

Share this token:
<BASE64URL_TOKEN>
```

**Copy the token string.**

### 9. Invites — Join (Bob)

**Bob (Terminal 2):**
```bash
pnpm dev -- join <BASE64URL_TOKEN>
```

Expected:
```
Joining community: Test Community
Role: member
Invited by: did:plc:... (Alice's DID)
Invite signature verified.

Your XMTP Inbox ID: <BOB_INBOX_ID>

Ask the inviter to run:
  maverick add-member <META_GROUP_ID> <BOB_INBOX_ID>
```

**Copy Bob's Inbox ID.**

### 10. Members — Add Bob

**Alice (Terminal 1):**
```bash
pnpm dev -- add-member <META_GROUP_ID> <BOB_INBOX_ID>
```

Expected:
```
Adding member <BOB_INBOX_ID> to community...
Member added to meta channel and all channels.
```

**Verify from Bob's side:**
```bash
pnpm dev -- communities
```

Bob should now see "Test Community" in his community list.

```bash
pnpm dev -- channels <META_GROUP_ID>
```

Bob should see the same channels as Alice.

---

### 11. Chat — Two-Way Messaging

This is the main end-to-end test. Open both terminals side by side.

**Alice (Terminal 1):**
```bash
pnpm dev -- chat <META_GROUP_ID> general
```

**Bob (Terminal 2):**
```bash
pnpm dev -- chat <META_GROUP_ID> general
```

Both should see:
```
═══ #general ═══
Type messages and press Enter to send. Use "> msgId text" to reply.
Press Ctrl+C to exit.
```

**Test messaging:**

1. **Alice types:** `Hello from Alice!` → press Enter
2. **Bob should see:** `[HH:MM] <alice_inbox>: Hello from Alice!`
3. **Bob types:** `Hey Alice, Bob here!` → press Enter
4. **Alice should see:** `[HH:MM] <bob_inbox>: Hey Alice, Bob here!`

**Test replies:**

1. Note a message ID from the output (the short hex prefix shown)
2. Type: `> <msg_id> This is a reply` → press Enter
3. Both sides should see the reply with `(reply to <msg_id>)` indicator

**Exit:** `Ctrl+C` in both terminals.

---

## What's Verified by Each Scenario

| # | Scenario | Modules Tested |
|---|----------|----------------|
| 1 | Login | config, atproto, xmtp, bridge, keys |
| 2 | Resolve | resolver, bridge (signature verification) |
| 3 | Whoami | config, atproto, xmtp (bootstrap) |
| 4 | Create | community manager, meta-codec, meta-types, state, db |
| 5-6 | Channels | state replay, community-cache, meta channel sync |
| 7 | Communities | conversation listing, meta channel detection |
| 8-9 | Invites | crypto signing, invite encode/decode/verify |
| 10 | Add member | group membership, snapshot generation |
| 11 | Chat | sender, stream, codec, real-time messaging |

## Known Limitations

- **Sender display**: Chat shows truncated Inbox IDs (`abc123ef`), not Bluesky handles. Profile resolution (Task 13) is not yet wired into the CLI.
- **No TUI**: Task 12 components are placeholders. All interaction is via CLI commands.
- **Reply syntax**: The `> msgId text` reply format requires knowing the full message ID, which isn't displayed in chat output — only the first 8 chars of the sender's inbox ID are shown. You'd need to inspect the raw XMTP message IDs.
- **No edit/delete CLI**: The `sendEdit` and `sendDelete` functions exist in `src/messaging/sender.ts` but aren't exposed as CLI commands or chat syntax.
- **Single community at a time**: The `chat` command requires the meta group ID each time. There's no "current community" concept persisted between runs.
- **No offline support**: All commands require network access to XMTP and Bluesky.
- **XMTP dev network**: All testing runs on `MAVERICK_XMTP_ENV=dev` (the default). Messages don't interop with production.

## Troubleshooting

**"XMTP group not found"** after `add-member`:
The joining client may need to sync. Run `pnpm dev -- communities` or `pnpm dev -- channels <META_GROUP_ID>` first — these trigger a sync.

**Key storage errors**:
Keys are stored encrypted in `<MAVERICK_DATA_DIR>/keys/`. If you see decryption errors, delete the data directory and re-run `login` to regenerate.

**Native module build errors** (`better-sqlite3`):
```bash
pnpm rebuild better-sqlite3
```

**Stale state after channel creation**:
If a second user doesn't see new channels, re-run `channels <META_GROUP_ID>` to force a meta channel sync.
