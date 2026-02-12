# Maverick MVP: XMTP + ATProto Private Community Chat

## The Big Picture

Maverick is a private community chat app where **ATProto provides identity** (who you are, via your Bluesky handle) and **XMTP provides everything else** — encrypted messaging, community structure, channel management, and role-based permissions. All community data is end-to-end encrypted; the only public artifact is the identity bridge linking your Bluesky handle to your XMTP inbox.

The MVP is a TUI client that connects to a small, invite-only community and lets you chat in channels with multi-parent threading — the killer feature where you can reply to multiple messages at once, creating conversation webs instead of linear threads.

---

## Architecture: Private-First

```
                         PUBLIC (ATProto)
┌──────────────────────────────────────────────────────┐
│  org.xmtp.inbox record on each user's PDS            │
│  (links Bluesky handle/DID to XMTP Inbox ID)         │
│  This is the ONLY public data.                        │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
                    ENCRYPTED (XMTP)
┌──────────────────────────────────────────────────────┐
│                                                       │
│  Meta Channel (XMTP group)                            │
│  ├── super_admin = community owners                   │
│  ├── admin = community admins                         │
│  └── member = everyone                                │
│                                                       │
│  Contains: community config, channel definitions,     │
│  role assignments, announcements, moderation events    │
│  → Append-only event log = free audit trail           │
│                                                       │
│  Chat Channels (XMTP groups, one per channel)         │
│  ├── #general         (all members)                   │
│  ├── #dev             (all members)                   │
│  ├── #leadership      (admins only)                   │
│  └── #announcements   (read-only for members)         │
│                                                       │
└──────────────────────────────────────────────────────┘
                       │
                       ▼
                     LOCAL
┌──────────────────────────────────────────────────────┐
│  SQLite (better-sqlite3)                              │
│  ├── Community state (replayed from meta channel)     │
│  ├── Message DAG (multi-parent threading)             │
│  ├── Channel ↔ XMTP group mapping                    │
│  └── Profile cache                                    │
└──────────────────────────────────────────────────────┘
```

### Why Private-First?

Every previous version of this plan put community structure on ATProto as public lexicon records. But for an invite-only community, even knowing *who's a member* is a leak. The meta channel pattern solves this: community structure is just another set of encrypted messages in an XMTP group. Outsiders see nothing. The only public data is the per-user identity bridge (`org.xmtp.inbox`), which exists regardless of which communities you're in.

### Data Flow

1. **Login** → Authenticate with Bluesky (app password) → get DID + session
2. **Identity bridge** → Create/read `org.xmtp.inbox` record on PDS → links DID to XMTP inbox
3. **Join community** → Accept invite → get added to meta channel + chat channels
4. **Sync state** → Replay meta channel history → reconstruct community config, channels, roles
5. **Chat** → Send/receive messages in XMTP group channels
6. **Threading** → Client maintains local DAG of message relationships

---

## The Meta Channel

The meta channel is an XMTP group where all community members are participants, but it's not for chatting — it's the community's encrypted control plane. Admins send structured config messages, and every client replays the history to reconstruct current state.

### Meta Message Types

```typescript
type MetaMessage =
  | CommunityConfig
  | ChannelCreated
  | ChannelUpdated
  | ChannelArchived
  | RoleAssignment
  | Announcement
  | ModerationAction;

interface CommunityConfig {
  type: "community.config";
  name: string;
  description?: string;
  settings: {
    allowMemberInvites: boolean;
    defaultChannelPermissions: "open" | "moderated";
  };
}

interface ChannelCreated {
  type: "channel.created";
  channelId: string;
  name: string;
  description?: string;
  xmtpGroupId: string;
  category?: string;
  permissions: "open" | "moderated" | "read-only";
}

interface ChannelUpdated {
  type: "channel.updated";
  channelId: string;
  name?: string;
  description?: string;
  category?: string;
  permissions?: "open" | "moderated" | "read-only";
}

interface ChannelArchived {
  type: "channel.archived";
  channelId: string;
  reason?: string;
}

interface RoleAssignment {
  type: "community.role";
  targetDid: string;
  role: "owner" | "admin" | "moderator" | "member";
}

interface Announcement {
  type: "community.announcement";
  title: string;
  body: string;
  priority: "normal" | "important";
}

interface ModerationAction {
  type: "moderation.action";
  action: "redact" | "ban" | "unban" | "mute";
  targetMessageId?: string;
  targetDid?: string;
  reason?: string;
  channelId?: string;
}
```

State reconstruction = fold over all meta messages in order. The meta channel IS the audit log.

### Role → XMTP Permission Mapping

```
Maverick Role    │ Meta Channel Role  │ Chat Channel Role
─────────────────┼────────────────────┼───────────────────
Owner            │ super_admin        │ super_admin
Admin            │ admin              │ admin
Moderator        │ member             │ admin
Member           │ member             │ member
```

XMTP enforces these cryptographically via the MLS protocol.

---

## Multi-Parent Threading

```typescript
interface MaverickMessage {
  text: string;
  replyTo: string[];     // [] = top-level, [id] = reply, [id1, id2] = multi-parent
  quotes?: {
    parentMessageId: string;
    quotedText: string;
  }[];
  editOf?: string;       // original message ID if this is an edit
  deleteOf?: string;     // message ID to soft-delete
}
```

### Message DAG Storage (SQLite)

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  sender_inbox_id TEXT NOT NULL,
  sender_did TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  raw_content BLOB
);

CREATE TABLE message_parents (
  message_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  PRIMARY KEY (message_id, parent_id)
);

CREATE INDEX idx_parents_parent ON message_parents(parent_id);
CREATE INDEX idx_messages_channel ON messages(channel_id, created_at);
```

---

## Editing, Deletion, and Banning

XMTP doesn't yet support message editing (on roadmap). Deletion is being formalized in XIP-76 (draft). Maverick handles these at the application layer:

- **Editing**: New message with `editOf` field → clients replace displayed text of original
- **Self-delete**: Message with `deleteOf` field → clients hide the original
- **Mod delete**: `ModerationAction` on meta channel → clients hide across all members
- **Banning**: `ModerationAction` ban event on meta channel → clients maintain ban list, refuse re-adds; admin removes banned user from all XMTP groups

All are "soft" operations — original encrypted bytes persist on XMTP but compliant clients respect the intent. Same model as Signal/WhatsApp. Upgrades to native protocol support when XMTP ships it.

---

## Invite Flow

```typescript
interface InviteToken {
  communityName: string;
  metaChannelGroupId: string;
  inviterDid: string;
  role: "member" | "moderator";
  expiry: string;
  signature: string;   // signed by inviter's XMTP key
}
```

1. Admin/member generates signed invite token
2. Shares out-of-band (DM, email, QR code)
3. New member's client verifies signature + inviter permissions
4. Inviter's client adds new member to meta channel + chat channels
5. New member syncs meta channel → full community state

---

## MVP Phases

### Phase 1: Identity + XMTP Plumbing (Week 1)

- Bluesky auth (app password)
- XMTP client creation (keypair, signer via viem)
- `org.xmtp.inbox` identity bridge on PDS
- Handle ↔ Inbox ID resolution
- Encrypted key storage on disk

**Deliverable**: CLI — login with Bluesky, bridge identity, resolve handles.

### Phase 2: Meta Channel + Community Setup (Week 2)

- Meta channel content type codec
- Create community (meta channel group + config message)
- Create channels (XMTP group + `channel.created` meta message)
- Invite flow (generate token, add member to groups)
- State reconstruction from meta channel replay
- Local SQLite cache

**Deliverable**: CLI — create community, add channels, invite members.

### Phase 3: Channel Messaging (Week 3)

- Maverick message content type codec
- Send/receive messages in channel groups
- Real-time message streaming
- Message persistence in SQLite
- Basic single-parent replies
- Message ordering and dedup on reconnect

**Deliverable**: Two-terminal chat — pick a channel, send messages, see replies.

### Phase 4: TUI Client (Weeks 4–5)

- Ink (React for terminals) setup
- Three-panel layout: channels | messages | thread info
- Channel sidebar with unread indicators
- Message rendering with reply indicators
- Composer with reply-to selection
- Bluesky profile display for members
- Vim-style keyboard navigation
- Status bar (connection, user, community)

**Deliverable**: Functional, attractive TUI client.

### Future Phases (Post-MVP)

- Multi-parent threading UI (DAG visualization, multi-reply composer)
- Moderation (soft delete, ban/mute, mod actions)
- Message editing (app-level → native when available)
- Channel categories, announcements, pinned messages
- Reactions (XMTP standard content type)
- Disappearing messages (XMTP native)
- Read-only / announcement channels
- Per-member display names
- Invite links with role-based access

---

## Dependencies

```json
{
  "dependencies": {
    "@xmtp/node-sdk": "latest",
    "@xmtp/content-type-primitives": "latest",
    "@atproto/api": "latest",
    "ink": "^5.0.0",
    "react": "^18.0.0",
    "better-sqlite3": "^11.0.0",
    "viem": "^2.0.0",
    "zod": "^3.0.0",
    "chalk": "^5.0.0",
    "keytar": "^7.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/react": "^18.0.0",
    "@types/better-sqlite3": "^7.0.0",
    "tsx": "^4.0.0",
    "vitest": "^2.0.0"
  }
}
```

---

## Key Design Principles

1. **ATProto is only identity.** Everything else is encrypted in XMTP. Outsiders see nothing.
2. **The meta channel is the source of truth.** Append-only event log = free audit trail.
3. **XMTP permissions are the enforcement layer.** Cryptographic, not client-trust.
4. **App-level features bridge protocol gaps.** Upgrade path built in.
5. **MVP = channels + messaging.** Everything else is designed in, built incrementally.
6. **Everything is extensible.** New meta message types add features without breaking clients.
