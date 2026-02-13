# Maverick

Private community chat in the terminal. Your Bluesky handle is your identity, XMTP handles the rest — end-to-end encrypted messaging, channels, roles, and invites.

## How it works

- **ATProto** (Bluesky) provides identity — your handle is your chat address
- **XMTP** provides E2E encrypted messaging, community structure, and permissions
- A **meta channel** (an XMTP group) acts as the encrypted control plane for community config
- **Multi-parent threading** lets you reply to multiple messages at once

The only public data is an `org.xmtp.inbox` record on your PDS linking your Bluesky DID to your XMTP Inbox ID. All community structure, membership, channels, and messages are encrypted inside XMTP groups.

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

## CLI commands

```
maverick login                          Authenticate with Bluesky + XMTP
maverick logout                         Clear saved credentials
maverick whoami                         Show current identity info
maverick resolve <handle>               Resolve a handle to XMTP Inbox ID
maverick create <name>                  Create a new community
maverick channels <meta-group-id>       List channels in a community
maverick add-channel <id> <name>        Add a channel
maverick invite <meta-group-id>         Generate an invite token
maverick join <token>                   Join a community via invite
maverick add-member <id> <inbox-id>     Add a member by XMTP inbox ID
maverick communities                    List your communities
maverick chat <id> <channel-name>       Interactive chat (simple mode)
maverick tui [meta-group-id]            Launch the full TUI
maverick                                Launch the full TUI, prompting for community if not specified
```

## Development

```bash
pnpm install
pnpm dev            # Run from source via tsx
pnpm test           # Run tests
pnpm build          # Compile TypeScript
```

## License

ISC
