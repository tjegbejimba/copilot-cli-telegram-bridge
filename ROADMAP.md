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

---

## Roadmap

### Phase 1: Core Reliability
- [x] **task_complete visibility** — Forward `task_complete` summary to Telegram
- [x] **Permission forwarding** — Forward permission prompts with inline keyboard (Allow/Deny buttons)
- [x] **Session status on connect** — Show branch, dir, session ID when bot connects
- [x] **Smart auto-connect** — Multi-bot support, skip if another live session holds the lock
- [x] **Compact mode** — `/compact` toggle to suppress tool bubbles
- [x] **/stop command** — Cancel current operation from Telegram
- [x] **Diff rendering** — Edit/create tool calls show formatted diffs
- [x] **Message deduplication** — Skip consecutive identical assistant.message events
- [ ] **Graceful reconnect on network drop** — Detect fetch failures and notify user before retry
- [ ] **Inline keyboard for ask_user** — Use InlineKeyboardMarkup for enum choices (same pattern as permissions)

### Phase 2: UX Polish
- [ ] **Message threading** — Use Telegram reply-to to thread tool outputs under the original prompt
- [ ] **Progress bar for long operations** — Show estimated progress for builds/tests using tool.execution_start/complete counts
- [ ] **Image rendering** — Forward show_file image outputs to Telegram as photos
- [ ] **Markdown table support** — Convert markdown tables to monospace `<pre>` blocks for readability
- [ ] **Smart notification batching** — Batch rapid-fire messages into a single Telegram message to reduce notification spam
- [ ] **Session switcher** — When multiple bots are connected, show which session you're talking to with a prefix

### Phase 3: Power Features
- [ ] **Multi-session support** — Connect multiple CLI sessions to the same bot (session selector via inline keyboard)
- [ ] **File send-back** — Send files from Telegram that get saved to the working directory
- [ ] **Notification webhook** — Optional webhook URL for build completion, test results, etc.
- [ ] **Pin important messages** — Auto-pin task_complete summaries and error messages
- [ ] **Search history** — `/search <query>` to search through past Telegram messages in the session
- [ ] **Persistent preferences** — Save compact mode, notification settings per-bot in config file

---

## Architecture Notes

### Event Flow
```
Telegram → getUpdates (long poll) → processUpdate → session.send({ prompt })
                                                         ↓
CLI Agent processes prompt, emits events:
  tool.execution_start → bubble update / diff rendering
  tool.execution_complete → relay images/docs / diff summary
  assistant.message → sendFormattedMessage to Telegram
  session.idle → dismiss bubble, stop typing
  permission.requested → inline keyboard (Allow/Deny)
```

### Key Design Decisions
- **`tool.execution_start` hook for ask_user**: The SDK's `onUserInputRequest` is never called for `ask_user` tool calls. We detect them via the tool execution event instead.
- **`onPermissionRequest` callback**: Returns `no-result` to fall through to terminal if Telegram doesn't respond. Whoever responds first (Telegram or terminal) wins.
- **Atomic command registration**: Commands passed to `joinSession({ commands })` instead of separate `session.resume` to avoid race condition.
- **Smart auto-connect**: With 1 bot, auto-connects unless another live session owns it. With multiple bots, auto-connects to first bot with no lock or stale lock. Never steals from a live session.
- **Compact mode**: Module-level `compactMode` flag suppresses tool bubble updates but preserves final responses, permissions, and ask_user prompts.
