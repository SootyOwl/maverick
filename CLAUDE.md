# CLAUDE.md — Maverick Implementation Plan

## What is Maverick?

Maverick is a **private community chat app** (TUI-based) where:
- **ATProto** (Bluesky) provides identity — your handle is your chat address
- **XMTP** provides everything else — E2E encrypted messaging, community structure, permissions
- The **meta channel** (an XMTP group) is the encrypted control plane for community config
- **Multi-parent threading** lets users reply to multiple messages at once (DAG, not linear threads)

The only public data is `org.xmtp.inbox` on each user's PDS (linking Bluesky DID → XMTP Inbox ID). All community structure, membership, channels, and messages are encrypted inside XMTP groups.

Reference app: https://github.com/xmtplabs/bluesky-chat (Electron desktop app by XMTP Labs — we're building a TUI equivalent with community/channel support on top).

## Tech Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Package manager**: pnpm
- **Messaging**: `@xmtp/node-sdk` (NOT `@xmtp/browser-sdk` — we're a Node app, not a browser app)
- **Identity**: `@atproto/api` (Bluesky auth + PDS record operations)
- **TUI**: `ink` v5 (React renderer for terminals) + `react` 18
- **Database**: `better-sqlite3` (synchronous SQLite for message DAG + community cache)
- **Crypto**: `viem` (Ethereum keypair generation for XMTP signer)
- **Validation**: `zod` (runtime schema validation for messages + meta events)
- **Key storage**: `keytar` (OS keychain for XMTP private key)
- **Dev**: `tsx` (TypeScript execution), `vitest` (testing)

## Project Structure

```
maverick/
├── package.json
├── tsconfig.json
├── CLAUDE.md                        # This file
├── src/
│   ├── index.ts                     # Entry point (CLI commands)
│   ├── config.ts                    # App configuration + env
│   │
│   ├── identity/
│   │   ├── atproto.ts               # Bluesky auth (app password login)
│   │   ├── xmtp.ts                  # XMTP client creation + signer
│   │   ├── bridge.ts                # org.xmtp.inbox identity binding
│   │   └── resolver.ts             # Handle ↔ InboxID resolution
│   │
│   ├── community/
│   │   ├── meta-types.ts            # MetaMessage type definitions + Zod schemas
│   │   ├── meta-codec.ts            # XMTP content type codec for meta messages
│   │   ├── state.ts                 # State reconstruction from meta channel replay
│   │   ├── manager.ts               # Create/update community, channels, members
│   │   └── invites.ts               # Invite token generation + verification
│   │
│   ├── messaging/
│   │   ├── types.ts                 # MaverickMessage type + Zod schema
│   │   ├── codec.ts                 # XMTP content type codec for chat messages
│   │   ├── sender.ts                # Send messages to XMTP groups
│   │   ├── stream.ts                # Real-time message streaming
│   │   └── dag.ts                   # Message DAG operations (multi-parent queries)
│   │
│   ├── storage/
│   │   ├── db.ts                    # SQLite setup + migrations
│   │   ├── messages.ts              # Message CRUD + DAG queries
│   │   ├── community-cache.ts       # Community state cache
│   │   └── keys.ts                  # Encrypted key storage (keytar wrapper)
│   │
│   ├── tui/
│   │   ├── App.tsx                  # Root Ink component
│   │   ├── hooks/
│   │   │   ├── useMessages.ts       # Message list + streaming
│   │   │   ├── useCommunity.ts      # Community state
│   │   │   ├── useThread.ts         # Thread navigation
│   │   │   └── useKeyboard.ts       # Vim-style key bindings
│   │   ├── components/
│   │   │   ├── Layout.tsx           # Three-panel layout
│   │   │   ├── ChannelList.tsx      # Sidebar channel list
│   │   │   ├── MessageView.tsx      # Main message panel
│   │   │   ├── Message.tsx          # Single message component
│   │   │   ├── ThreadLines.tsx      # Visual thread indicators
│   │   │   ├── Composer.tsx         # Message input
│   │   │   ├── ReplySelector.tsx    # Reply-to picker
│   │   │   ├── StatusBar.tsx        # Bottom status bar
│   │   │   └── ProfileCard.tsx      # User profile display
│   │   └── theme.ts                 # Color theme constants
│   │
│   └── utils/
│       ├── crypto.ts                # Invite token signing/verification
│       └── time.ts                  # Timestamp formatting
│
└── test/
    ├── identity.test.ts
    ├── meta-channel.test.ts
    ├── messaging.test.ts
    └── dag.test.ts
```

---

# IMPLEMENTATION TASKS

The tasks below are ordered by dependency. Complete each task fully before moving to the next. Each task has a verification step — run it before proceeding.

---

## Task 0: Project Scaffolding

### 0.1 Initialize project

```bash
mkdir maverick && cd maverick
pnpm init
```

### 0.2 Install dependencies

```bash
pnpm add @xmtp/node-sdk @xmtp/content-type-primitives @atproto/api ink react better-sqlite3 viem zod chalk keytar
pnpm add -D typescript @types/react @types/better-sqlite3 @types/node tsx vitest
```

### 0.3 Create tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

### 0.4 Add scripts to package.json

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "build": "tsc"
  }
}
```

### 0.5 Create directory structure

Create all directories from the project structure above. Create placeholder `index.ts` files where needed.

**Verify**: `pnpm build` compiles without errors (even if the project is empty stubs).

---

## Task 1: Configuration + Key Storage

### 1.1 `src/config.ts`

Define app configuration. Read from environment variables with sensible defaults:

```typescript
// Environment variables:
// MAVERICK_BLUESKY_HANDLE — Bluesky handle (e.g., "dan.bsky.social")
// MAVERICK_BLUESKY_PASSWORD — Bluesky app password
// MAVERICK_XMTP_ENV — "dev" | "production" (default: "dev")
// MAVERICK_DATA_DIR — local data directory (default: ~/.maverick)

export interface Config {
  bluesky: {
    handle: string;
    password: string;
    pdsUrl: string; // default "https://bsky.social"
  };
  xmtp: {
    env: "dev" | "production";
    dbPath: string; // XMTP's internal DB (inside dataDir)
  };
  dataDir: string; // ~/.maverick
  sqlitePath: string; // ~/.maverick/maverick.db
}
```

### 1.2 `src/storage/keys.ts`

Wrap `keytar` for XMTP private key storage:

```typescript
// Service name: "maverick"
// Account: the Bluesky handle

export async function getStoredKey(handle: string): Promise<string | null>;
export async function storeKey(handle: string, privateKey: string): Promise<void>;
export async function deleteKey(handle: string): Promise<void>;
```

The private key is a hex string (Ethereum private key used to create the XMTP signer). On first run, generate a new one with `viem` and store it. On subsequent runs, retrieve it.

**Verify**: Write a small script that stores and retrieves a key from the OS keychain.

---

## Task 2: Bluesky Authentication

### 2.1 `src/identity/atproto.ts`

Authenticate with Bluesky using an app password (NOT OAuth — we're a TUI, not a browser app):

```typescript
import { AtpAgent } from "@atproto/api";

export async function createBlueskySession(config: Config): Promise<{
  agent: AtpAgent;
  did: string;
  handle: string;
}> {
  const agent = new AtpAgent({ service: config.bluesky.pdsUrl });
  await agent.login({
    identifier: config.bluesky.handle,
    password: config.bluesky.password,
  });
  return {
    agent,
    did: agent.session!.did,
    handle: agent.session!.handle,
  };
}
```

**Verify**: Run with real Bluesky credentials. Log the DID. Confirm it matches your Bluesky account.

---

## Task 3: XMTP Client Creation

### 3.1 `src/identity/xmtp.ts`

Create an XMTP client. This is the core messaging client.

**CRITICAL**: Study the bluesky-chat reference app's approach:
- Generate an Ethereum keypair with `viem` (or reuse stored one)
- Use `@xmtp/node-sdk`'s `Client.create()` with a signer
- The XMTP SDK uses `@xmtp/node-sdk`, NOT `@xmtp/browser-sdk`

```typescript
import { Client } from "@xmtp/node-sdk";
import { createSigner, createUser } from "@xmtp/node-sdk"; // Check if these exist in node-sdk, otherwise port from agent-sdk
import { generatePrivateKey } from "viem/accounts";

export async function createXmtpClient(config: Config, privateKey: string): Promise<Client> {
  // Create user from private key
  // Create signer from user
  // Create client with signer, env, and dbPath
  // Return client
}
```

**IMPORTANT**: The bluesky-chat reference uses `@xmtp/agent-sdk` for `createSigner` and `createUser`. Check if `@xmtp/node-sdk` exports these directly, or if you need to add `@xmtp/agent-sdk` as a dependency. Read the XMTP docs at https://docs.xmtp.org to find the correct imports.

If `@xmtp/agent-sdk` is needed:
```bash
pnpm add @xmtp/agent-sdk
```

**Verify**: Create an XMTP client. Log `client.inboxId`. This should be a stable identifier.

---

## Task 4: Identity Bridge

### 4.1 `src/identity/bridge.ts`

Link Bluesky DID to XMTP Inbox ID by publishing an `org.xmtp.inbox` record on the user's PDS.

This is a direct port from the bluesky-chat blog post code:

```typescript
export async function publishInboxRecord(
  agent: AtpAgent,
  xmtpClient: Client,
): Promise<void> {
  const did = agent.session!.did;

  // 1. Sign the DID with XMTP installation key
  const signatureBytes = xmtpClient.signWithInstallationKey(did);
  const verificationSignature = Buffer.from(signatureBytes).toString("base64");

  // 2. Publish to PDS
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: "org.xmtp.inbox",
    rkey: "self",
    record: {
      id: xmtpClient.inboxId,
      verificationSignature,
      createdAt: new Date().toISOString(),
    },
  });
}
```

### 4.2 `src/identity/resolver.ts`

Resolve handles to XMTP Inbox IDs and back:

```typescript
// Handle → InboxId: look up org.xmtp.inbox record on their PDS
export async function resolveHandleToInbox(
  agent: AtpAgent,
  handle: string,
): Promise<{ inboxId: string; did: string } | null>;

// Verify the signature is valid (proves the XMTP inbox owner controls the DID)
export async function verifyInboxAssociation(
  inboxId: string,
  did: string,
  verificationSignature: string,
  xmtpEnv: string,
): Promise<boolean>;
```

Use `Client.fetchInboxStates()` and `Client.verifySignedWithPublicKey()` for verification — see the bluesky-chat reference code above.

**Verify**: Publish the identity bridge record. Read it back. Verify the signature. All three should succeed.

---

## Task 5: SQLite Database

### 5.1 `src/storage/db.ts`

Set up SQLite with migrations:

```sql
-- Communities (cached from meta channel)
CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,                    -- meta channel XMTP group ID
  name TEXT NOT NULL,
  description TEXT,
  config_json TEXT,                        -- serialized CommunityConfig
  updated_at INTEGER NOT NULL
);

-- Channels (cached from meta channel)
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,                     -- stable channel ID from meta message
  community_id TEXT NOT NULL,
  xmtp_group_id TEXT NOT NULL,             -- actual XMTP group ID
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  permissions TEXT DEFAULT 'open',          -- open | moderated | read-only
  archived INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (community_id) REFERENCES communities(id)
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,                     -- XMTP message ID
  channel_id TEXT NOT NULL,                -- our channel ID
  sender_inbox_id TEXT NOT NULL,
  sender_did TEXT,
  sender_handle TEXT,
  text TEXT NOT NULL,
  edit_of TEXT,                            -- original message ID if this is an edit
  delete_of TEXT,                          -- message ID if this is a soft delete
  created_at INTEGER NOT NULL,
  raw_content BLOB,
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);

-- Multi-parent threading
CREATE TABLE IF NOT EXISTS message_parents (
  message_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  PRIMARY KEY (message_id, parent_id),
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (parent_id) REFERENCES messages(id)
);

-- Roles (cached from meta channel)
CREATE TABLE IF NOT EXISTS roles (
  community_id TEXT NOT NULL,
  did TEXT NOT NULL,
  role TEXT NOT NULL,                       -- owner | admin | moderator | member
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (community_id, did)
);

-- Profile cache
CREATE TABLE IF NOT EXISTS profiles (
  did TEXT PRIMARY KEY,
  handle TEXT,
  display_name TEXT,
  avatar_url TEXT,
  updated_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_parents_parent ON message_parents(parent_id);
CREATE INDEX IF NOT EXISTS idx_channels_community ON channels(community_id);
```

### 5.2 `src/storage/messages.ts`

Message CRUD + DAG queries:

```typescript
export function insertMessage(db: Database, msg: { ... }): void;
export function insertParents(db: Database, messageId: string, parentIds: string[]): void;
export function getChannelMessages(db: Database, channelId: string, limit?: number): Message[];
export function getMessageChildren(db: Database, messageId: string): Message[];
export function getMessageParents(db: Database, messageId: string): Message[];
// For multi-parent threading: get the full thread graph for a message
export function getThreadGraph(db: Database, messageId: string): Message[];
```

### 5.3 `src/storage/community-cache.ts`

Community state cache operations:

```typescript
export function upsertCommunity(db: Database, community: CommunityState): void;
export function upsertChannel(db: Database, channel: ChannelState): void;
export function upsertRole(db: Database, communityId: string, did: string, role: string): void;
export function getCommunity(db: Database, id: string): CommunityState | null;
export function getChannels(db: Database, communityId: string): ChannelState[];
export function getRole(db: Database, communityId: string, did: string): string;
```

**Verify**: Write a test that creates the DB, inserts messages with parents, and queries the DAG. Run `pnpm test`.

---

## Task 6: Meta Channel Types + Codec

### 6.1 `src/community/meta-types.ts`

Define all meta message types with Zod schemas:

```typescript
import { z } from "zod";

export const CommunityConfigSchema = z.object({
  type: z.literal("community.config"),
  name: z.string(),
  description: z.string().optional(),
  settings: z.object({
    allowMemberInvites: z.boolean(),
    defaultChannelPermissions: z.enum(["open", "moderated"]),
  }),
});

export const ChannelCreatedSchema = z.object({
  type: z.literal("channel.created"),
  channelId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  xmtpGroupId: z.string(),
  category: z.string().optional(),
  permissions: z.enum(["open", "moderated", "read-only"]),
});

export const ChannelUpdatedSchema = z.object({
  type: z.literal("channel.updated"),
  channelId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  permissions: z.enum(["open", "moderated", "read-only"]).optional(),
});

export const ChannelArchivedSchema = z.object({
  type: z.literal("channel.archived"),
  channelId: z.string(),
  reason: z.string().optional(),
});

export const RoleAssignmentSchema = z.object({
  type: z.literal("community.role"),
  targetDid: z.string(),
  role: z.enum(["owner", "admin", "moderator", "member"]),
});

export const AnnouncementSchema = z.object({
  type: z.literal("community.announcement"),
  title: z.string(),
  body: z.string(),
  priority: z.enum(["normal", "important"]),
});

export const ModerationActionSchema = z.object({
  type: z.literal("moderation.action"),
  action: z.enum(["redact", "ban", "unban", "mute"]),
  targetMessageId: z.string().optional(),
  targetDid: z.string().optional(),
  reason: z.string().optional(),
  channelId: z.string().optional(),
});

// Discriminated union — parse any meta message
export const MetaMessageSchema = z.discriminatedUnion("type", [
  CommunityConfigSchema,
  ChannelCreatedSchema,
  ChannelUpdatedSchema,
  ChannelArchivedSchema,
  RoleAssignmentSchema,
  AnnouncementSchema,
  ModerationActionSchema,
]);

export type MetaMessage = z.infer<typeof MetaMessageSchema>;
export type CommunityConfig = z.infer<typeof CommunityConfigSchema>;
// ... etc for each type
```

### 6.2 `src/community/meta-codec.ts`

XMTP custom content type codec for meta messages.

**CRITICAL**: Study how XMTP content types work. Read:
- https://docs.xmtp.org/inboxes/content-types/custom-content-types
- The `@xmtp/content-type-primitives` package for `ContentTypeId` and `ContentCodec` interfaces

The codec serializes/deserializes MetaMessage to/from bytes:

```typescript
import { ContentTypeId } from "@xmtp/content-type-primitives";

export const MetaMessageContentType = new ContentTypeId({
  authorityId: "community.maverick",
  typeId: "meta",
  versionMajor: 1,
  versionMinor: 0,
});

// Implement ContentCodec<MetaMessage>
// encode: JSON.stringify → TextEncoder → Uint8Array
// decode: TextDecoder → JSON.parse → MetaMessageSchema.parse()
// contentType: MetaMessageContentType
// fallback: return human-readable description of the meta event
```

Register the codec when creating the XMTP client.

**Verify**: Encode a CommunityConfig, decode it back, assert deep equality.

---

## Task 7: Chat Message Types + Codec

### 7.1 `src/messaging/types.ts`

```typescript
import { z } from "zod";

export const MaverickMessageSchema = z.object({
  text: z.string(),
  replyTo: z.array(z.string()).default([]),  // [] = top-level, [id] = reply, [id1,id2] = multi-parent
  quotes: z.array(z.object({
    parentMessageId: z.string(),
    quotedText: z.string(),
  })).optional(),
  editOf: z.string().optional(),    // original message ID if this is an edit
  deleteOf: z.string().optional(),  // message ID to soft-delete
});

export type MaverickMessage = z.infer<typeof MaverickMessageSchema>;
```

### 7.2 `src/messaging/codec.ts`

Same pattern as meta-codec but for MaverickMessage:

```typescript
export const MaverickMessageContentType = new ContentTypeId({
  authorityId: "community.maverick",
  typeId: "message",
  versionMajor: 1,
  versionMinor: 0,
});

// Implement ContentCodec<MaverickMessage>
```

**Verify**: Encode a multi-parent message, decode it, assert equality.

---

## Task 8: Community Manager

### 8.1 `src/community/state.ts`

State reconstruction from meta channel replay:

```typescript
export interface CommunityState {
  config: CommunityConfig | null;
  channels: Map<string, ChannelCreated & { archived?: boolean }>;
  roles: Map<string, "owner" | "admin" | "moderator" | "member">;
  bans: Set<string>;
  announcements: Announcement[];
}

// Fold over all meta messages to build current state
export function replayMetaChannel(messages: MetaMessage[]): CommunityState;
```

### 8.2 `src/community/manager.ts`

High-level community operations:

```typescript
export class CommunityManager {
  constructor(
    private xmtpClient: Client,
    private db: Database,
  ) {}

  // Create a new community: create meta channel XMTP group, send initial config
  async createCommunity(name: string, description?: string): Promise<string>;

  // Create a channel: create XMTP group, send channel.created to meta channel
  async createChannel(metaGroupId: string, name: string, permissions?: string): Promise<string>;

  // Add member: add to meta channel + all non-restricted chat channels
  async addMember(metaGroupId: string, memberInboxId: string): Promise<void>;

  // Remove member: remove from all groups
  async removeMember(metaGroupId: string, memberInboxId: string): Promise<void>;

  // Send a meta message to the meta channel
  async sendMetaMessage(metaGroupId: string, message: MetaMessage): Promise<void>;

  // Sync: replay meta channel, update local cache
  async syncCommunityState(metaGroupId: string): Promise<CommunityState>;

  // List communities this client belongs to (scan XMTP groups for meta channels)
  async listCommunities(): Promise<CommunityState[]>;
}
```

**IMPORTANT**: When creating XMTP groups, set permissions appropriately:
- Meta channel: creator is super_admin. Configure so only admins+ can send messages (since only admins should send config). Actually — members need to be able to read, so members can receive but the meta channel could allow all members to send if we want to support member-generated events in the future. For MVP, let all members send to meta channel but validate sender role on the receiving client side.
- Chat channels: default open (all members can send).

Study the XMTP group creation API:
- `client.conversations.newGroup(memberInboxIds, options)` or equivalent
- Check how to set group permissions, name, description

**Verify**: Create a community with 2 channels. Send a config message. Replay the meta channel. Assert the reconstructed state matches.

---

## Task 9: Message Sending + Streaming

### 9.1 `src/messaging/sender.ts`

```typescript
export async function sendMessage(
  group: Conversation, // XMTP group/conversation object
  text: string,
  replyTo?: string[],
  quotes?: { parentMessageId: string; quotedText: string }[],
): Promise<string>; // returns message ID
```

### 9.2 `src/messaging/stream.ts`

Stream messages from a channel in real-time:

```typescript
export async function streamMessages(
  group: Conversation,
  onMessage: (msg: DecodedMessage) => void,
): Promise<() => void>; // returns cleanup function
```

Use `group.stream()` or `group.streamMessages()` — check XMTP docs for the correct method name in `@xmtp/node-sdk`.

### 9.3 `src/messaging/dag.ts`

Multi-parent DAG operations:

```typescript
// Get ordered messages for a channel, resolving edit/delete chains
export function getVisibleMessages(db: Database, channelId: string): VisibleMessage[];

// Get thread context for a message (ancestors + descendants)
export function getThreadContext(db: Database, messageId: string): ThreadContext;
```

When displaying messages:
- If a message has `editOf`, replace the original's text (keep original in DB for history)
- If a message has `deleteOf`, hide the original from display
- If a message has `replyTo`, show thread indicators

**Verify**: Two XMTP clients in the same group. Client A sends a message. Client B streams and receives it. Both see the same content.

---

## Task 10: Invite System

### 10.1 `src/community/invites.ts`

```typescript
export interface InviteToken {
  communityName: string;
  metaChannelGroupId: string;
  inviterDid: string;
  role: "member" | "moderator";
  expiry: string; // ISO datetime
  signature: string;
}

// Generate a signed invite token
export function createInvite(
  xmtpClient: Client,
  communityName: string,
  metaGroupId: string,
  inviterDid: string,
  role: "member" | "moderator",
  expiryHours?: number,
): InviteToken;

// Verify an invite token's signature and expiry
export function verifyInvite(invite: InviteToken): Promise<boolean>;

// Encode/decode to shareable string (base64url JSON)
export function encodeInvite(invite: InviteToken): string;
export function decodeInvite(encoded: string): InviteToken;
```

The invite contains the meta channel group ID so the accepting client knows which community to join. The inviter's client must then add the new member to the meta channel and all appropriate chat channels.

**Verify**: Generate an invite, encode it, decode it, verify signature.

---

## Task 11: CLI Entry Point

### 11.1 `src/index.ts`

Before building the TUI, create a CLI interface for testing all the plumbing:

```typescript
// Commands:
// maverick login          — authenticate with Bluesky + create XMTP client + publish identity bridge
// maverick create <name>  — create a new community
// maverick channels       — list channels in current community  
// maverick add-channel <name> — add a channel to current community
// maverick invite         — generate an invite token
// maverick join <token>   — join a community via invite
// maverick chat <channel> — enter interactive chat mode in a channel (simple readline loop)
// maverick tui            — launch the full TUI (Phase 4)
```

Use a simple argument parser (process.argv or a lightweight lib like `commander`). Keep it simple — this is for testing, not production UX.

The `chat` command should:
1. Sync the meta channel → get community state
2. Find the XMTP group for the specified channel
3. Start streaming messages (print to stdout)
4. Read from stdin, send as messages
5. Support basic reply syntax: `> messageId your reply text`

**Verify**: Open two terminals. Both logged into different Bluesky accounts. One creates a community + channel, generates an invite. The other joins. Both enter `chat` mode on the same channel. Messages flow both ways.

---

## Task 12: TUI — Layout + Theme

### 12.1 `src/tui/theme.ts`

```typescript
export const theme = {
  bg: "#0a0e17",
  surface: "#111827",
  border: "#1e2d3d",
  text: "#e2e8f0",
  muted: "#64748b",
  accent: "#3b82f6",
  channels: "#06b6d4",
  messages: "#f97316",
  green: "#22c55e",
  red: "#ef4444",
  yellow: "#eab308",
};
```

### 12.2 `src/tui/App.tsx`

Root component. Manages global state + passes to layout:

```tsx
import React, { useState, useEffect } from "react";
import { Box } from "ink";
import { Layout } from "./components/Layout.js";

export function App({ client, communityManager, db }) {
  // State: current channel, community state, messages
  // Effects: sync community on mount, stream messages for current channel
  // Render: <Layout />
}
```

### 12.3 `src/tui/components/Layout.tsx`

Three-panel layout:

```
┌─────────────┬──────────────────────────────┬──────────────┐
│  Channels   │         Messages             │   Thread     │
│  (sidebar)  │                              │   (optional) │
│             │                              │              │
│  #general   │  alice: Has anyone tried...  │              │
│  #dev       │  bob: Yes! The auth flow...  │              │
│  #random    │  carol: Docs are lacking...  │              │
│             │  dan: ⊕ Agreed on both...    │              │
│             │                              │              │
├─────────────┴──────────────────────────────┴──────────────┤
│  [#general] > Type a message...            alice@bsky.social│
└───────────────────────────────────────────────────────────┘
```

Use `ink`'s `<Box>` with `flexDirection="row"` for the panels, `flexDirection="column"` for vertical stacking within each panel.

**IMPORTANT**: Ink v5 uses React 18. Import from `ink` for components (`Box`, `Text`, `useInput`, `useApp`). Check Ink's docs for the exact API — some things like `useInput` for keyboard handling are Ink-specific.

### 12.4 Individual components

Build these one at a time:
1. **ChannelList** — shows channels from community state, highlights current, shows unread counts
2. **MessageView** — scrollable message list for current channel
3. **Message** — single message: handle, timestamp, text, reply indicators, multi-parent markers
4. **Composer** — text input at the bottom, handles Enter to send
5. **StatusBar** — connection status, current user, current community
6. **ReplySelector** — when replying, show which message(s) you're replying to

### 12.5 Keyboard navigation

```
j/k or ↑/↓     — navigate messages
h/l or ←/→     — switch panels (channels ↔ messages ↔ thread)
Enter           — focus composer / send message
r               — reply to selected message
R               — multi-reply (toggle additional parents)
Esc             — cancel reply / unfocus composer
Tab             — cycle channels
q               — quit
```

**Verify**: Launch the TUI. Navigate channels, see messages, send a message, see it appear.

---

## Task 13: Profile Resolution

### 13.1 Profile fetching

When displaying messages, resolve sender Inbox IDs to Bluesky handles + display names:

```typescript
// In resolver.ts or a new profiles.ts:
export async function fetchBlueskyProfile(agent: AtpAgent, did: string): Promise<{
  handle: string;
  displayName?: string;
  avatar?: string;
}>;
```

Cache profiles in the SQLite `profiles` table. Only fetch from network if not cached or stale (>1 hour old).

**Verify**: Messages in the TUI show Bluesky handles instead of raw Inbox IDs.

---

# KEY XMTP API PATTERNS

These are the critical XMTP SDK calls you'll need. Check the actual `@xmtp/node-sdk` API — method names may differ slightly from examples:

```typescript
// Create client
const client = await Client.create(signer, { env: "dev", dbPath: "..." });

// List conversations/groups
const conversations = await client.conversations.list();
// or
await client.conversations.sync(); // sync from network first

// Create group
const group = await client.conversations.newGroup(memberInboxIds, {
  // Check API for permission options
});

// Send message (with custom content type)
await group.send(encodedContent, { contentType: MaverickMessageContentType });
// OR if the SDK expects a different send signature, check the docs

// Stream messages
const stream = await group.stream();
for await (const message of stream) {
  // message.content, message.senderInboxId, message.id, etc.
}

// Group management
await group.addMembers([inboxId]);
await group.removeMembers([inboxId]);

// Permissions (check exact API)
// group.updatePermission(...)
// group.isSuperAdmin(inboxId)
// group.isAdmin(inboxId)
```

**IMPORTANT**: The XMTP Node SDK API may have changed. Always check the actual installed package's types (`node_modules/@xmtp/node-sdk/dist/index.d.ts`) for the real method signatures. Use TypeScript's type checking to catch API mismatches early.

---

# GOTCHAS AND KNOWN ISSUES

1. **XMTP SDK versions**: The SDK is actively evolving. Pin versions in package.json. If something doesn't work, check the XMTP GitHub releases for breaking changes.

2. **XMTP env**: Use `"dev"` for development. Messages on dev and production don't interop. Switch to `"production"` only for real deployment.

3. **Content type registration**: Custom codecs MUST be registered when creating the client, otherwise messages with custom content types will be received but not decoded. Check how the SDK handles codec registration.

4. **Group sync**: After creating a group or adding members, other clients need to `sync()` before they see the new group. Build sync into the reconnection/startup flow.

5. **Ink + React 18**: Ink v5 requires React 18. Make sure `react` and `@types/react` are version 18.x, not 19.x (the bluesky-chat reference uses React 19 with Electron, but Ink may not support it).

6. **better-sqlite3 native module**: This is a native Node addon. It should work fine with Node 18+ but may need rebuild if switching Node versions. `pnpm rebuild better-sqlite3` if you get binding errors.

7. **keytar native module**: Same as above — native addon. On Linux, may need `libsecret-1-dev` installed. On macOS, uses Keychain. On Windows, uses Credential Manager.

8. **Message ordering**: XMTP messages have `sentAtNs` (nanosecond timestamp). Use this for ordering, not arrival time. Messages may arrive out of order during sync.

9. **Group size limit**: XMTP groups support up to 250 members. Fine for the MVP's small community use case.

10. **XMTP database**: The XMTP SDK maintains its own SQLite database (specified by `dbPath`). This is separate from Maverick's SQLite database. Don't use the same path for both.

---

# ORDER OF IMPLEMENTATION

For the fastest path to a working prototype:

1. **Tasks 0–4**: Get login + identity working end-to-end (you can verify with the bluesky-chat reference)
2. **Task 5**: Set up the database
3. **Tasks 6–7**: Build the codecs (these are pure functions, easy to test)
4. **Task 8**: Community manager (this is the core — meta channel + channel creation)
5. **Tasks 9–10**: Messaging + invites
6. **Task 11**: CLI for testing everything
7. **Tasks 12–13**: TUI (only after everything else works via CLI)

At the end of Task 11, you should have a fully functional CLI chat app. The TUI is polish on top of working infrastructure.

---

## Git Conventions

When asked for atomic commits, ALWAYS make separate commits for each logical change. Never combine multiple fixes into a single commit. If unsure, ask before committing.

---

## Build & Distribution

This is a TypeScript project. Always ensure fixes work for end-user runtime (not just dev environment). Check that dependencies used in bin scripts and CLI entry points are production dependencies, not devDependencies.

---

## Debugging Guidelines

When debugging, check the FULL error chain before proposing a fix. Specifically: check if errors are being silently swallowed, check if API calls require authentication, and check if redirects (HTTPS→HTTP) strip headers. Do not propose a fix until the root cause is confirmed.

---

## Code Review

When the user asks for a code review or adversarial review, go directly to reading the relevant code/diff. Do NOT spend time on setup steps, starting 'chainlink sessions', or other meta-work. Start reading code immediately.

---

## Security & Credentials

When implementing security or credential storage, always handle the case where OS-level services (keyring daemon, secure enclave) are unavailable. Provide a graceful fallback and a user-facing warning. Never silently fail.

---

## Design Patterns

Always consider and apply proven design patterns when writing or modifying code. Before implementing any feature, identify which patterns fit the problem and use them consistently with the rest of the codebase. Reference: https://refactoring.guru/design-patterns/catalog

### Patterns already in use — follow them:

- **Event Sourcing** — Meta channel replay reconstructs community state from an ordered event log (`replayMetaChannel`). New community features must be modeled as new event types, not as mutable state.
- **Repository / Data Access** — Storage layer (`storage/`) provides typed CRUD functions over SQLite. All DB access goes through these functions; never write raw SQL in business logic.
- **Codec** — Encode/decode pairs (`meta-codec.ts`, `messaging/codec.ts`) serialize domain objects to wire format. Any new XMTP content type gets its own codec following the same `ContentCodec<T>` interface.
- **Facade** — `CommunityManager` wraps complex multi-step operations (create community + group + config message) behind a single method. High-level orchestration belongs in facades, not scattered across callers.
- **Observer / Stream** — Message streaming uses async iterators with cleanup functions. New real-time features should follow the same `stream() → for await → cleanup` pattern.
- **Cache-aside** — Profile and community data is cached in SQLite, fetched from network only when missing or stale. New cacheable data should follow the same staleness check pattern.
- **Graceful Degradation** — Keychain access falls back to `0600` file storage. Any OS-dependent feature must have a fallback path with a user-facing warning.

### Patterns to apply when the situation fits:

- **Strategy** — When behavior varies by configuration (e.g., channel permissions: open/moderated/read-only), use strategy objects or discriminated unions rather than if/else chains.
- **Builder** — For complex object construction (XMTP group options, message payloads), use step-by-step builder methods that return `this` for chaining, producing the final object via `.build()`. Prefer this over constructors with many parameters.
- **Result type** — For operations that can fail in expected ways, return `{ ok: true, value } | { ok: false, error }` instead of throwing. Reserve exceptions for truly unexpected failures.
- **Chain of Responsibility** — When processing messages through multiple stages (decode → validate → store → render), compose handlers as a pipeline where each stage can process or pass along the request, rather than nesting calls.
- **Dispose / Cleanup** — Resources with lifecycle (streams, DB connections, XMTP clients) must implement explicit cleanup. Return cleanup functions or use `try/finally` — never rely on GC for resource release.

### Anti-patterns to avoid:

- **God object** — No class should own both networking and storage. Split responsibilities across layers.
- **Stringly-typed** — Use Zod schemas, TypeScript enums, or literal unions instead of raw strings for known value sets.
- **Silent swallowing** — Never catch errors and do nothing. Log, re-throw, or return a Result — pick one.
- **Implicit ordering** — If operations must happen in sequence, make the dependency explicit (await chains, pipeline stages) rather than relying on caller discipline.
