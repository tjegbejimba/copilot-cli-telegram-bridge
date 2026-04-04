# Copilot CLI Telegram Bridge

A GitHub Copilot CLI extension that bridges Telegram messages bidirectionally with a CLI session — send messages from Telegram, get agent responses back.

Fork of [examon/copilot-cli-telegram-bridge](https://github.com/examon/copilot-cli-telegram-bridge) with major improvements.

## What's New in This Fork

### Smart Auto-Connect
- Auto-connects on startup when a bot is available
- Multi-bot aware — won't steal a bot from another live CLI session
- Handles missing or stale lock files gracefully

### Mobile Experience
- **Terminal input forwarded** — CLI input appears in Telegram as `💬 You: ...` so you can follow the full conversation from your phone
- **ask_user prompts** — agent questions are forwarded to Telegram with numbered choices
- **task_complete summaries** — see when the agent finishes and what it accomplished
- **Diff rendering** — file edits show as `📝 path` with `-`/`+` diff snippets, creates show as `📄 Created: path`
- **Session status on connect** — shows branch, directory, and session ID when the bot connects

### Telegram Commands
| Command | Description |
|---|---|
| `/stop` | Cancel the current agent operation |
| `/compact` | Toggle compact mode — suppresses tool bubble updates, shows only final responses |
| `/telegram help` | Show all bridge commands |

### Permission Prompts
- Real permission prompts (not auto-approved) are forwarded to Telegram with ✅ Allow / ❌ Deny inline buttons
- Auto-approved tools are silent — no spam
- Uses a 1.5s delay filter: if `permission.completed` arrives before the delay, the permission was auto-approved and no notification is sent

### Reliability
- Atomic command registration via `joinSession({ commands })` — no race conditions
- Event handlers properly reset on disconnect/reconnect
- Message deduplication for consecutive identical events
- Edited message support
- File download collision prevention (timestamp + random bytes)
- Windows `tmpdir()` fix
- `sendPhoto`/`sendDocument` timeout (30s)

## Prerequisites

- [GitHub Copilot CLI](https://github.com/github/copilot-cli) installed and working
- A Telegram account
- Node.js 18+ (the extension uses the built-in `fetch` API)

## Install

### Manual install

1. Clone the repo and copy the extension file:
   ```bash
   git clone https://github.com/tjegbejimba/copilot-cli-telegram-bridge.git
   mkdir -p ~/.copilot/extensions/copilot-cli-telegram-bridge
   cp copilot-cli-telegram-bridge/extension.mjs ~/.copilot/extensions/copilot-cli-telegram-bridge/
   ```
2. Restart Copilot CLI

## Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a display name and a username (must end in `bot`)
4. BotFather replies with a token like `123456789:ABCdefGHI...` — copy it

## Setup and Connect

1. Register the bot in Copilot CLI:
   ```
   /telegram setup mybot
   ```
2. Paste the bot token when prompted — the extension validates it against the Telegram API
3. Connect to the bot:
   ```
   /telegram connect mybot
   ```
4. Open Telegram and send any message to your bot
5. The bot replies asking you to check the Copilot CLI terminal for a pairing code
6. Type the 6-character pairing code back to the bot in Telegram (case-insensitive, expires after 5 minutes)
7. Done — messages now flow both ways between Telegram and your CLI session

## Commands

| Command | Description |
|---|---|
| `/telegram setup <name>` | Register a new bot with a local alias |
| `/telegram connect <name>` | Connect this session to the named bot |
| `/telegram connect` | List all registered bots with their status |
| `/telegram disconnect` | Disconnect from the current bot |
| `/telegram status` | Show all bots, availability, and paired users |
| `/telegram remove <name>` | Remove a bot from the registry |
| `/telegram help` | Show command help |

## Multiple Bots

You can register as many bots as you want with `/telegram setup`. Each Copilot CLI session connects to one bot at a time, but multiple sessions can run different bots simultaneously — useful with [git worktrees](https://git-scm.com/docs/git-worktree).

On startup, the extension auto-connects to the first available bot (one with no lock or a stale lock). It never steals a bot from another live session. Use `/telegram connect <name>` to manually take over if needed.

## Compact Mode

Send `/compact` in Telegram to toggle compact mode:
- **ON** — only final assistant responses are sent. Tool bubbles, progress updates, and intermediate output are suppressed.
- **OFF** — all updates are shown (default).

Permissions, ask_user prompts, and task_complete summaries are always sent regardless of compact mode.

## Troubleshooting

- **Extension not loading** — verify the file exists at `~/.copilot/extensions/copilot-cli-telegram-bridge/extension.mjs`
- **Bot not responding** — check that the token is valid. Try `/telegram disconnect` then `/telegram connect` again
- **Pairing code expired** — codes expire after 5 minutes. Send a new message to the bot to get a fresh one
- **"Another session has this bot"** — the bot is locked by another CLI session. Connecting again takes it over
- **Duplicate messages** — kill orphaned node/copilot processes from previous sessions

## Security

Bot tokens are stored **in plain text** in `bots.json` (with restricted file permissions — owner read/write only). Anyone with read access to that file can control your bot. Keep this in mind:

- Do not commit `bots.json` to version control
- Do not share or back up the extension directory without removing `bots.json` first
- If a token is compromised, revoke it immediately via @BotFather (`/revoke`) and register a new one with `/telegram setup`

## Uninstall

1. Disconnect if connected: `/telegram disconnect`
2. Remove the extension:
   ```bash
   rm -rf ~/.copilot/extensions/copilot-cli-telegram-bridge
   ```
