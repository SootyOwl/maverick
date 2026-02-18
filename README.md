# Maverick

Private community chat in the terminal. Your Bluesky handle is your identity, XMTP handles the rest — end-to-end encrypted messaging, channels, roles, and invites.

## How it works

- **ATProto** (Bluesky) provides identity — your handle is your chat address
- **XMTP** provides E2E encrypted messaging, community structure, and permissions
- A **meta channel** (an XMTP group) acts as the encrypted control plane for community config
- **Multi-parent threading** lets you reply to multiple messages at once

The only public data is a `community.maverick.inbox` record on your PDS linking your Bluesky DID to your XMTP Inbox ID. All community structure, membership, channels, and messages are encrypted inside XMTP groups.

## Quick start

```bash
npx github:SootyOwl/maverick
```

Or install globally:

```bash
npm i -g github:SootyOwl/maverick
maverick
```

## Prerequisites

- Node.js 18+
- A Bluesky account with an [app password](https://bsky.app/settings/app-passwords)

## Setup

Maverick will prompt for your credentials interactively when you run `maverick tui` or `maverick login`.

You can also set them via environment variables:

```bash
cp .env.example .env
# Edit .env with your Bluesky handle and app password
```

| Variable | Description |
|----------|-------------|
| `MAVERICK_BLUESKY_HANDLE` | Your Bluesky handle (e.g. `you.bsky.social`) |
| `MAVERICK_BLUESKY_PASSWORD` | Bluesky app password |
| `MAVERICK_XMTP_ENV` | `dev` or `production` (default: `dev`) |
| `MAVERICK_DATA_DIR` | Data directory (default: `~/.maverick`) |

## CLI commands

### Identity & authentication

```
maverick login                          Authenticate + set up or recover XMTP identity
maverick recover                        Recover identity from a recovery phrase
maverick logout                         Clear saved credentials
maverick whoami                         Show current identity info
maverick status                         Show identity, installation count, and data status
```

### Installation management

```
maverick installations                  List XMTP installations for your inbox
maverick revoke-stale [--all]           Revoke stale XMTP installations
```

### Key management

```
maverick export-key                     Display your XMTP private key (use with care)
maverick import-key                     Import an XMTP private key directly
```

### Backup & restore

```
maverick backup [path]                  Create an encrypted backup of XMTP + Maverick databases
maverick restore <path>                 Restore databases from an encrypted backup
```

Backups are encrypted with AES-256-GCM using a passphrase you provide. This is the recommended way to protect against data loss — especially for solo communities where network-based recovery requires another online installation.

### Community management

```
maverick create <name>                  Create a new community
maverick communities                    List your communities
maverick channels <meta-group-id>       List channels in a community
maverick add-channel <id> <name>        Add a channel
maverick invite <meta-group-id>         Generate an invite token
maverick join <token>                   Join a community via invite
maverick add-member <id> <inbox-id>     Add a member by XMTP inbox ID
maverick resolve <handle>               Resolve a handle to XMTP Inbox ID
```

### Chat

```
maverick chat <id> <channel-name>       Interactive chat (simple mode)
maverick tui [meta-group-id]            Launch the full TUI
maverick                                Launch the TUI (default command)
```

## TUI keybindings

```
j/k or Up/Down    Navigate messages
h/l or Left/Right Switch panels (channels / messages / thread)
i                  Focus composer
r                  Reply to selected message
R                  Multi-reply (toggle additional parents)
Enter              Send message
Esc                Cancel / unfocus
Tab                Cycle channels
q                  Quit
```

## Recovery

When you first log in, Maverick generates a **6-word recovery phrase** that deterministically derives your XMTP private key. Write it down — you need it to restore your identity on a new device.

**Recovery methods (in order of preference):**

1. **Recovery phrase + another online installation** — `maverick recover` derives your key from the phrase, then syncs communities from your other running installation via XMTP history sync.
2. **Backup file** — `maverick restore` imports an encrypted backup created with `maverick backup`. Works offline, no other installation needed.
3. **Recovery phrase alone** — Restores your identity (same inbox ID) but communities need another member to come online before they're accessible again.

## Development

```bash
pnpm install
pnpm dev            # Run from source via tsx
pnpm test           # Run tests
pnpm build          # Compile TypeScript
```

## License

ISC
