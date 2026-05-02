# Copilot CLI Telegram Bridge — Roadmap

Fork of [examon/copilot-cli-telegram-bridge](https://github.com/examon/copilot-cli-telegram-bridge) with ARM-team improvements.

## Installation

```bash
# Symlink into copilot extensions directory
# Windows:
mklink /D "%USERPROFILE%\.copilot\extensions\copilot-cli-telegram-bridge" "C:\Users\toegbeji\Repos\copilot-cli-telegram-bridge"
```

After install, restart Copilot CLI. The extension auto-connects if exactly 1 bot is registered.

---

## Completed ✅

| # | Change | Type |
|---|--------|------|
| 1 | Windows `tmpdir()` fix | Bug fix |
| 2 | `sendPhoto`/`sendDocument` timeout (30s) | Bug fix |
| 3 | ask_user prompts forwarded to Telegram | Feature |
| 4 | Auto-connect on startup (1 bot) | Feature |
| 5 | Atomic command registration (`joinSession({ commands })`) | Bug fix |
| 6 | `eventHandlersRegistered` reset on disconnect | Bug fix |
| 7 | `lastCompletedToolDesc` cleared on connect | Bug fix |
| 8 | `processUpdate` null-safe (`message.chat?.id`) | Bug fix |
| 9 | File download collision fix (timestamp + random bytes) | Bug fix |
| 10 | Edited message support | Feature |
| 11 | `/telegram help` subcommand | Feature |
| 12 | Image rendering for generated image files | Feature |
| 13 | Markdown table rendering as aligned `<pre>` blocks | UX |
| 14 | Smart notification batching for assistant output | UX |
| 15 | Polling conflict recovery for Telegram `409 Conflict` | Reliability |
| 16 | SDK 1.0.40 permission decisions (`approve-once`, session, location, reject) | SDK |
| 17 | `/stop` uses SDK `session.abort()` | SDK |
| 18 | Degraded/recovered notifications for sustained polling failures | Reliability |
| 19 | Structured Telegram input flow for `ask_user`, user input, and elicitation prompts | SDK |
| 20 | Early lifecycle/error event capture with `joinSession({ onEvent })` | SDK |
| 21 | Windows DPAPI-backed bot token storage with legacy plaintext migration | Security |
| 22 | Telegram command menu registration with `setMyCommands` and `/synccommands` fallback | UX |
| 23 | Telegram `/help`, `/status`, `/health`, `/disconnect`, `/reconnect`, and safe `/command` pass-through | UX |
| 24 | Persisted polling health for `/status` and `/health` after reload | Reliability |
| 25 | Fake Telegram command-router tests for menu sync, routing, session controls, and pass-through allow-listing | Tests |

---

## Roadmap

### Phase 1: Core Reliability
- [x] **task_complete visibility** — Forward `task_complete` summary to Telegram
- [x] **Permission forwarding** — Forward permission prompts with inline keyboard (allow once/session/location and deny)
- [x] **Session status on connect** — Show branch, dir, session ID when bot connects
- [x] **Smart auto-connect** — Multi-bot support, skip if another live session holds the lock
- [x] **Compact mode** — `/compact` toggle to suppress tool bubbles
- [x] **/stop command** — Abort current operation from Telegram with `session.abort()`
- [x] **Diff rendering** — Edit/create tool calls show formatted diffs
- [x] **Message deduplication** — Skip consecutive identical assistant.message events
- [x] **Graceful reconnect on network drop** — Detect sustained fetch failures and report recovery
- [x] **Inline keyboard for ask_user** — Use InlineKeyboardMarkup for enum and boolean choices (same pattern as permissions)
- [x] **Telegram command surface** — Register bot slash commands, expose `/status` and `/health`, and keep sync failures non-fatal

### Phase 2: UX Polish
- [ ] **Message threading** — Use Telegram reply-to to thread tool outputs under the original prompt
- [ ] **Progress bar for long operations** — Show estimated progress for builds/tests using tool.execution_start/complete counts
- [x] **Image rendering** — Forward generated image files to Telegram as photos
- [x] **Markdown table support** — Convert markdown tables to monospace `<pre>` blocks for readability
- [x] **Smart notification batching** — Batch rapid-fire messages into a single Telegram message to reduce notification spam
- [ ] **Session switcher** — When multiple bots are connected, show which session you're talking to with a prefix

### Phase 3: Power Features
- [ ] **Multi-session support** — Connect multiple CLI sessions to the same bot (session selector via inline keyboard)
- [ ] **File send-back** — Send files from Telegram that get saved to the working directory
- [ ] **Notification webhook** — Optional webhook URL for build completion, test results, etc.
- [ ] **Pin important messages** — Auto-pin task_complete summaries and error messages
- [ ] **Search history** — `/search <query>` to search through past Telegram messages in the session
- [ ] **Persistent preferences** — Save compact mode, notification settings per-bot in config file
- [x] **Safe Copilot slash-command pass-through** — Allow-list low-risk Copilot CLI slash commands via Telegram `/command`

---

## Architecture Notes

### Event Flow
```
Telegram → getUpdates (long poll) → processUpdate → session.send({ prompt })
                       slash commands → telegram-command-router → bridge/session actions
                                                         ↓
CLI Agent processes prompt, emits events:
  tool.execution_start → bubble update / diff rendering
  tool.execution_complete → relay images/docs / diff summary
  assistant.message → sendFormattedMessage to Telegram
  session.idle → dismiss bubble, stop typing
  permission.requested → inline keyboard (allow once/session/location, deny)
  user_input / elicitation → shared structured prompt flow
```

### Key Design Decisions
- **`tool.execution_start` hook for ask_user**: The SDK's `onUserInputRequest` is never called for `ask_user` tool calls. We detect them via the tool execution event instead.
- **Permission decisions**: Telegram replies through `session.rpc.permissions.handlePendingPermissionRequest` using SDK 1.0.40 decision shapes.
- **Early event capture**: `joinSession({ onEvent })` buffers early lifecycle/error events before Telegram is connected, then flushes them on connect.
- **Atomic command registration**: Commands passed to `joinSession({ commands })` instead of separate `session.resume` to avoid race condition.
- **Smart auto-connect**: With 1 bot, auto-connects unless another live session owns it. With multiple bots, auto-connects to first bot with no lock or stale lock. Never steals from a live session.
- **Compact mode**: Module-level `compactMode` flag suppresses tool bubble updates but preserves final responses, permissions, and ask_user prompts.
- **Telegram and CLI command registries are separate**: Telegram commands are registered with `setMyCommands`; the CLI `/telegram` command is registered through `joinSession({ commands })`. Shared catalog data keeps descriptions aligned.
- **Safe pass-through only**: `/command` forwards only allow-listed low-risk Copilot CLI slash commands and rejects everything else visibly in Telegram.
- **Persisted health is non-secret state**: `health.json` stores the last polling state so `/status` and `/health` can explain recent degraded/recovered/error conditions after a reload.
