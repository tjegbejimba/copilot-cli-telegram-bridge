// ============================================================
// Copilot CLI Telegram Bridge Extension
// ============================================================

import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { execFile, execSync } from "node:child_process";

// ============================================================
// Section 1: Constants & Configuration
// ============================================================

const EXT_DIR = import.meta.dirname;
const ACCESS_PATH = join(EXT_DIR, "access.json");
const BOTS_REGISTRY_PATH = join(EXT_DIR, "bots.json");
const BOTS_DIR = join(EXT_DIR, "bots");
const TMP_DIR = join(tmpdir(), `telegram-bridge-${process.pid}`);

const TELEGRAM_API = "https://api.telegram.org";
const POLL_TIMEOUT = 30;
const CHUNK_MAX = 4096;
const SEND_PACE_MS = 50;
const TYPING_INTERVAL_MS = 4000;
const TYPING_DEBOUNCE_MS = 60000;
const ASK_USER_TIMEOUT_MS = 300000;
const PAIRING_EXPIRY_MS = 300000;
const ERROR_RETRY_BASE_MS = 5000;
const ERROR_RETRY_MAX_MS = 60000;
const API_TIMEOUT_MS = 30000;


// ============================================================
// Section 2: Utility Functions
// ============================================================

function loadJsonOrDefault(filePath, defaultValue) {
    try {
        return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (err) {
        if (err.code === "ENOENT") return structuredClone(defaultValue);
        if (err instanceof SyntaxError) {
            console.warn(`telegram-bridge: corrupted JSON in ${filePath}, using defaults`);
            return structuredClone(defaultValue);
        }
        throw err;
    }
}

function saveJsonAtomic(filePath, data, mode) {
    const tmp = filePath + ".tmp";
    const opts = mode != null ? { mode } : undefined;
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", opts);
    renameSync(tmp, filePath);
}

function botDir(name) { return join(BOTS_DIR, name); }
function botStatePath(name) { return join(botDir(name), "state.json"); }
function botLockPath(name) { return join(botDir(name), "lock.json"); }

function chunkMessage(text, maxLen = CHUNK_MAX) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLen) {
        let splitAt = remaining.lastIndexOf("\n\n", maxLen);
        if (splitAt <= 0) splitAt = remaining.lastIndexOf("\n", maxLen);
        if (splitAt <= 0) splitAt = maxLen;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).replace(/^\n+/, "");
    }
    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
}

// --- Markdown to Telegram HTML converter ---

function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function markdownToTelegramHtml(md) {
    const holds = [];

    function hold(html) {
        const i = holds.length;
        holds.push(html);
        return `\x00${i}\x00`;
    }

    let t = md;

    // Phase 1: Extract protected regions (no markdown processing inside these)

    // Fenced code blocks: ```lang\ncode\n```
    t = t.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        code = code.replace(/\n$/, "");
        const cls = lang ? ` class="language-${lang}"` : "";
        return hold(`<pre><code${cls}>${escapeHtml(code)}</code></pre>`);
    });

    // Inline code: `code`
    t = t.replace(/`([^`\n]+)`/g, (_, code) => {
        return hold(`<code>${escapeHtml(code)}</code>`);
    });

    // Images: ![alt](url) -> linked text (before regular links)
    t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
        const label = alt || "image";
        return hold(`<a href="${escapeHtml(url)}">[${escapeHtml(label)}]</a>`);
    });

    // Links: [text](url)
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
        return hold(`<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`);
    });

    // Phase 2: HTML-escape remaining text
    t = escapeHtml(t);

    // Phase 3: Inline formatting (order matters: bold+italic before bold before italic)

    // Bold+italic: ***text***
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, "<b><i>$1</i></b>");

    // Bold: **text**
    t = t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

    // Italic: *text* (not adjacent to other asterisks)
    t = t.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

    // Strikethrough: ~~text~~
    t = t.replace(/~~(.+?)~~/g, "<s>$1</s>");

    // Phase 4: Block-level formatting

    // Headers: # text -> bold text
    t = t.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

    // Blockquotes: consecutive lines starting with > (escaped to &gt;)
    t = t.replace(/(?:^&gt;[ ]?.*$\n?)+/gm, (block) => {
        const lines = block.trimEnd().split("\n");
        const content = lines.map(l => l.replace(/^&gt;[ ]?/, "")).join("\n");
        return `<blockquote>${content}</blockquote>\n`;
    });

    // Horizontal rules
    t = t.replace(/^-{3,}$/gm, "\u2500".repeat(20));
    t = t.replace(/^\*{3,}$/gm, "\u2500".repeat(20));
    t = t.replace(/^_{3,}$/gm, "\u2500".repeat(20));

    // Phase 5: Restore placeholders
    t = t.replace(/\x00(\d+)\x00/g, (_, i) => holds[parseInt(i)]);

    return t;
}

function generatePairingCode() {
    return randomBytes(4).toString("hex").slice(0, 6);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// Section 3: Telegram Bot API Client
// ============================================================

let botToken;

async function callTelegram(method, params = {}) {
    const url = `${TELEGRAM_API}/bot${botToken}/${method}`;
    const timeoutMs = method === "getUpdates"
        ? (POLL_TIMEOUT + 10) * 1000
        : API_TIMEOUT_MS;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = method === "getUpdates" && abortController
        ? AbortSignal.any([abortController.signal, timeoutSignal])
        : timeoutSignal;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal,
    });
    if (res.status === 409) {
        const err = new Error("Conflict: another process is polling this bot");
        err.status = 409;
        throw err;
    }
    if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        const err = new Error("Rate limited");
        err.status = 429;
        err.retryAfter = body?.parameters?.retry_after || 5;
        throw err;
    }
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`Telegram API ${method} failed: ${res.status} ${body}`);
        err.status = res.status;
        throw err;
    }
    const json = await res.json();
    if (!json.ok) throw new Error(`Telegram API ${method} returned ok=false: ${JSON.stringify(json)}`);
    return json.result;
}

function getMe() { return callTelegram("getMe"); }

function getUpdates(offset, timeout) {
    return callTelegram("getUpdates", { offset, timeout, allowed_updates: ["message", "edited_message", "callback_query"] });
}

function sendMessage(chatId, text, parseMode) {
    const params = { chat_id: chatId, text };
    if (parseMode) params.parse_mode = parseMode;
    return callTelegram("sendMessage", params);
}

async function sendFormattedMessage(chatId, markdown) {
    const html = markdownToTelegramHtml(markdown);
    try {
        return await callTelegram("sendMessage", {
            chat_id: chatId, text: html, parse_mode: "HTML",
        });
    } catch (err) {
        // Fall back to plain text if Telegram rejects our HTML
        if (err.message && /can.t parse|entit/i.test(err.message)) {
            return callTelegram("sendMessage", { chat_id: chatId, text: markdown });
        }
        throw err;
    }
}

async function sendPhoto(chatId, base64Data, mimeType, caption) {
    const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/gif" ? "gif" : "png";
    const buf = Buffer.from(base64Data, "base64");
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", new File([buf], `image.${ext}`, { type: mimeType }));
    if (caption) form.append("caption", caption.slice(0, 1024));

    const url = `${TELEGRAM_API}/bot${botToken}/sendPhoto`;
    const res = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Telegram sendPhoto failed: ${res.status} ${body}`);
    }
    return (await res.json()).result;
}

async function sendDocument(chatId, base64Data, mimeType, filename, caption) {
    const buf = Buffer.from(base64Data, "base64");
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("document", new File([buf], filename || "file", { type: mimeType }));
    if (caption) form.append("caption", caption.slice(0, 1024));

    const url = `${TELEGRAM_API}/bot${botToken}/sendDocument`;
    const res = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Telegram sendDocument failed: ${res.status} ${body}`);
    }
    return (await res.json()).result;
}

function sendChatAction(chatId, action = "typing") {
    return callTelegram("sendChatAction", { chat_id: chatId, action });
}

function editMessageText(chatId, messageId, text, parseMode) {
    const params = { chat_id: chatId, message_id: messageId, text };
    if (parseMode) params.parse_mode = parseMode;
    return callTelegram("editMessageText", params);
}

function deleteMessage(chatId, messageId) {
    return callTelegram("deleteMessage", { chat_id: chatId, message_id: messageId });
}


function setMessageReaction(chatId, messageId, emoji) {
    return callTelegram("setMessageReaction", {
        chat_id: chatId, message_id: messageId,
        reaction: [{ type: "emoji", emoji }],
    });
}

function getFile(fileId) {
    return callTelegram("getFile", { file_id: fileId });
}

async function downloadFile(filePath) {
    const url = `${TELEGRAM_API}/file/bot${botToken}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    ensureTmpDir();
    const localName = `${Date.now()}-${randomBytes(4).toString("hex")}-${basename(filePath)}`;
    const localPath = join(TMP_DIR, localName);
    writeFileSync(localPath, buffer);
    return localPath;
}

// ============================================================
// Section 3b: Voice Message Transcription
// ============================================================

function runShellCommand(cmd, args, timeoutMs = 30000) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
            if (err) resolve({ ok: false, error: stderr || err.message });
            else resolve({ ok: true, output: stdout.trim() });
        });
    });
}

let ffmpegAvailable = null;
async function checkFfmpeg() {
    if (ffmpegAvailable !== null) return ffmpegAvailable;
    const result = await runShellCommand("ffmpeg", ["-version"], 5000);
    ffmpegAvailable = result.ok;
    return ffmpegAvailable;
}

async function transcribeVoice(oggPath) {
    // Step 1: Convert OGG/OPUS to WAV using ffmpeg
    if (!(await checkFfmpeg())) return null;

    const wavPath = oggPath.replace(/\.[^.]+$/, ".wav");
    const convert = await runShellCommand("ffmpeg", [
        "-i", oggPath, "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", wavPath, "-y",
    ], 15000);
    if (!convert.ok) return null;

    // Step 2: Transcribe WAV using Windows Speech Recognition
    const psScript = `
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToWaveFile('${wavPath.replace(/\\/g, "\\\\")}')
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($grammar)
try {
    $result = $recognizer.Recognize()
    if ($result -and $result.Text) { Write-Output $result.Text }
    else { Write-Output "[NO_SPEECH]" }
} catch { Write-Output "[ERROR] $_" }
finally { $recognizer.Dispose() }
`;
    const result = await runShellCommand("powershell", ["-NoProfile", "-Command", psScript], 30000);

    // Cleanup temp WAV
    try { unlinkSync(wavPath); } catch {}

    if (!result.ok || !result.output || result.output === "[NO_SPEECH]" || result.output.startsWith("[ERROR]")) {
        return null;
    }
    return result.output;
}

// ============================================================
// Section 4: Send Queue (outbound message pacing)
// ============================================================

const sendQueue = [];
let sendQueueRunning = false;

function enqueue(fn) {
    return new Promise((resolve, reject) => {
        sendQueue.push({ fn, resolve, reject });
        if (!sendQueueRunning) drainQueue();
    });
}

async function drainQueue() {
    sendQueueRunning = true;
    while (sendQueue.length > 0) {
        const { fn, resolve, reject } = sendQueue.shift();
        try {
            const result = await fn();
            resolve(result);
        } catch (err) {
            if (err.status === 429) {
                sendQueue.unshift({ fn, resolve, reject });
                await sleep(err.retryAfter * 1000);
                continue;
            }
            reject(err);
        }
        if (sendQueue.length > 0) await sleep(SEND_PACE_MS);
    }
    sendQueueRunning = false;
}

// ============================================================
// Section 5: State Management
// ============================================================

let registry = {};
let access;
let state;
let session;
let abortController;
let shutdownRequested = false;
let awaitingInput = null;
let connected = false;
let lastTelegramPrompts = new Set(); // track prompts sent from Telegram to avoid echo
let compactMode = false;

let botInfo = null;
let currentSessionId = null;
let currentBotName = null;

// ============================================================
// Section 5b: Lock File Management
// ============================================================

function readLock(name) {
    const data = loadJsonOrDefault(botLockPath(name), null);
    if (!data || !data.pid || !data.sessionId) return null;
    return data;
}

function writeLock(name, sessionId) {
    saveJsonAtomic(botLockPath(name), {
        pid: process.pid,
        sessionId,
        connectedAt: new Date().toISOString(),
    });
}

function removeLock(name, sessionId) {
    const lock = readLock(name);
    if (lock && lock.sessionId === sessionId) {
        try { rmSync(botLockPath(name), { force: true }); } catch {}
    }
}

function isLockStale(lock) {
    if (!lock) return true;
    try {
        process.kill(lock.pid, 0);
        return false;
    } catch {
        return true;
    }
}

// ============================================================
// Section 6: Access Control & Pairing
// ============================================================

function reloadAccess() {
    access = loadJsonOrDefault(ACCESS_PATH, { allowedUsers: [], pending: {} });
}

function isAllowed(userId) {
    return access.allowedUsers.includes(String(userId));
}

function cleanExpiredPending() {
    const now = Date.now();
    let changed = false;
    for (const [chatId, entry] of Object.entries(access.pending || {})) {
        if (now - entry.timestamp > PAIRING_EXPIRY_MS) {
            delete access.pending[chatId];
            changed = true;
        }
    }
    if (changed) saveJsonAtomic(ACCESS_PATH, access);
}

async function handlePairing(chatId, userId, text) {
    const chatIdStr = String(chatId);
    const userIdStr = String(userId);

    const pending = access.pending?.[chatIdStr];
    if (pending) {
        if (text.trim().toLowerCase() === pending.code.toLowerCase()) {
            if (!access.allowedUsers.includes(userIdStr)) {
                access.allowedUsers.push(userIdStr);
            }
            delete access.pending[chatIdStr];
            saveJsonAtomic(ACCESS_PATH, access);
            await enqueue(() => sendMessage(chatId, "Paired! You can now send messages to Copilot CLI."));
            await session.log(`Telegram user ${userIdStr} paired successfully.`);
            return;
        } else {
            await enqueue(() => sendMessage(chatId, "Invalid code. Try again."));
            return;
        }
    }

    cleanExpiredPending();
    const code = generatePairingCode();
    if (!access.pending) access.pending = {};
    access.pending[chatIdStr] = { code, timestamp: Date.now() };
    saveJsonAtomic(ACCESS_PATH, access);
    await enqueue(() => sendMessage(chatId, "A pairing code has been generated. Check the Copilot CLI terminal for the code and send it here to confirm."));
    await session.log(`Telegram pairing request from user ${userIdStr}. Pairing code: ${code}`);
}

// ============================================================
// Section 7: Typing Indicator
// ============================================================

let typingInterval = null;
let typingDebounceTimer = null;

function startTyping(chatIds) {
    stopTyping();
    const doType = () => {
        for (const chatId of chatIds) {
            enqueue(() => sendChatAction(chatId).catch(() => {}));
        }
        if (bubbleActive) resetTypingDebounce();
    };
    doType();
    typingInterval = setInterval(doType, TYPING_INTERVAL_MS);
    resetTypingDebounce();
}

function resetTypingDebounce() {
    if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
    typingDebounceTimer = setTimeout(stopTyping, TYPING_DEBOUNCE_MS);
}

function stopTyping() {
    if (typingInterval) { clearInterval(typingInterval); typingInterval = null; }
    if (typingDebounceTimer) { clearTimeout(typingDebounceTimer); typingDebounceTimer = null; }
}

// ============================================================
// Section 7c: Tool Call Bubble (ephemeral status message)
// ============================================================

const activeTools = new Map(); // toolCallId -> { name, description }
const bubbleMessageIds = new Map(); // chatId -> messageId (current, for editing)
const allBubbleIds = new Map(); // chatId -> Set<messageId> (every bubble msg ever created, for guaranteed cleanup)
let bubbleDebounceTimer = null;
let bubbleActive = false; // guards against stale updates after dismiss
let flushInProgress = false; // mutex: prevents concurrent flushBubble from creating duplicate messages
let reflushNeeded = false; // set when an update arrives while a flush is in-flight
let lastCompletedToolDesc = null; // persists last tool description so it stays visible between tool calls
const BUBBLE_DEBOUNCE_MS = 300;

function trackBubbleMsg(chatId, messageId) {
    bubbleMessageIds.set(chatId, messageId);
    if (!allBubbleIds.has(chatId)) allBubbleIds.set(chatId, new Set());
    allBubbleIds.get(chatId).add(messageId);
}

function untrackBubbleMsg(chatId, messageId) {
    if (bubbleMessageIds.get(chatId) === messageId) bubbleMessageIds.delete(chatId);
    allBubbleIds.get(chatId)?.delete(messageId);
}

function describeToolCall(toolName, args) {
    if (!args) return toolName;
    try {
        switch (toolName) {
            case "bash":
            case "powershell": {
                const cmd = args.command || "";
                return cmd.split("\n")[0];
            }
            case "grep": {
                const pat = args.pattern || "";
                const g = args.glob ? ` ${args.glob}` : (args.path ? ` ${basename(args.path)}` : "");
                return `grep "${pat}"${g}`;
            }
            case "glob":
                return `glob ${args.pattern || ""}`;
            case "view":
                return args.path ? `view ${basename(args.path)}` : "view";
            case "edit":
                return args.path ? `edit ${basename(args.path)}` : "edit";
            case "create":
                return args.path ? `create ${basename(args.path)}` : "create";
            case "task": {
                const desc = args.description || args.agent_type || "";
                return desc ? `task: ${desc}` : "task";
            }
            case "web_fetch":
                try { return `fetch ${new URL(args.url).hostname}`; } catch { return "fetch"; }
            case "sql":
                return args.description || "sql";
            case "skill":
                return args.skill ? `skill: ${args.skill}` : "skill";
            case "ask_user":
                return "waiting for input";
            case "read_agent":
            case "write_agent":
            case "list_agents":
            case "read_bash":
            case "write_bash":
            case "stop_bash":
                return null; // suppress noisy internal tools
            case "report_intent":
            case "store_memory":
                return null;
            default:
                return toolName.replace(/_/g, " ");
        }
    } catch {
        return toolName;
    }
}

function composeBubbleText() {
    const lines = [];
    for (const [, info] of activeTools) {
        if (info.description) {
            lines.push(`● ${info.description}`);
        }
    }
    if (lines.length === 0) {
        if (lastCompletedToolDesc) {
            return `● ${lastCompletedToolDesc}`;
        }
        return null; // nothing to show
    }
    return lines.join("\n");
}

function scheduleBubbleUpdate() {
    if (!bubbleActive) return;
    if (compactMode) return;
    if (bubbleDebounceTimer) clearTimeout(bubbleDebounceTimer);
    bubbleDebounceTimer = setTimeout(flushBubble, BUBBLE_DEBOUNCE_MS);
}

async function flushBubble() {
    bubbleDebounceTimer = null;
    if (!bubbleActive) return;

    if (flushInProgress) {
        reflushNeeded = true;
        return;
    }
    flushInProgress = true;

    try {
        const text = composeBubbleText();
        if (!text) { return; } // nothing to display
        const chatIds = getAllowedChatIds();
        for (const chatId of chatIds) {
            const existingId = bubbleMessageIds.get(chatId);
            if (existingId) {
                try {
                    await enqueue(() => editMessageText(chatId, existingId, text));
                } catch (err) {
                    if (/message is not modified/i.test(err?.message)) {
                        // Text unchanged, message still exists, keep tracking it
                    } else if (/message to edit not found/i.test(err?.message)) {
                        untrackBubbleMsg(chatId, existingId);
                        if (!bubbleActive) continue;
                        try {
                            const sent = await enqueue(() => sendMessage(chatId, text));
                            if (!bubbleActive) {
                                try { await enqueue(() => deleteMessage(chatId, sent.message_id)); } catch {}
                            } else {
                                trackBubbleMsg(chatId, sent.message_id);
                            }
                        } catch {}
                    }
                }
            } else {
                if (!bubbleActive) continue;
                try {
                    const sent = await enqueue(() => sendMessage(chatId, text));
                    if (!bubbleActive) {
                        try { await enqueue(() => deleteMessage(chatId, sent.message_id)); } catch {}
                    } else {
                        trackBubbleMsg(chatId, sent.message_id);
                    }
                } catch {}
            }
        }
    } finally {
        flushInProgress = false;
        if (reflushNeeded) {
            reflushNeeded = false;
            scheduleBubbleUpdate();
        }
    }
}

async function dismissBubble() {
    bubbleActive = false;
    reflushNeeded = false;
    if (bubbleDebounceTimer) {
        clearTimeout(bubbleDebounceTimer);
        bubbleDebounceTimer = null;
    }
    activeTools.clear();
    lastCompletedToolDesc = null;

    // Delete every bubble message we ever created (not just the "current" one).
    // This catches orphans from races, duplicates, anything.
    await deleteAllBubbleMessages();

    // Safety net: retry 2s later in case a flushBubble was mid-await during
    // our first sweep and created a message after we finished deleting.
    setTimeout(() => deleteAllBubbleMessages(), 2000);
}

async function deleteAllBubbleMessages() {
    for (const [chatId, ids] of allBubbleIds) {
        for (const msgId of ids) {
            try { await enqueue(() => deleteMessage(chatId, msgId)); } catch {}
        }
        ids.clear();
    }
    allBubbleIds.clear();
    bubbleMessageIds.clear();
}

// ============================================================
// Section 8: File/Photo Handling
// ============================================================

function ensureTmpDir() {
    if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
}

function cleanupTmpDir() {
    try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
}

async function handleFileAttachment(message) {
    let fileId, displayName;
    if (message.photo && message.photo.length > 0) {
        const photo = message.photo[message.photo.length - 1];
        fileId = photo.file_id;
        displayName = `photo_${message.message_id}.jpg`;
    } else if (message.document) {
        fileId = message.document.file_id;
        displayName = message.document.file_name || `document_${message.message_id}`;
    } else {
        return null;
    }
    const fileInfo = await getFile(fileId);
    const localPath = await downloadFile(fileInfo.file_path);
    return { path: localPath, displayName };
}

// ============================================================
// Section 9: Message Processing (inbound from Telegram)
// ============================================================

function getAllowedChatIds() {
    return access.allowedUsers.map(Number);
}

async function processUpdate(update) {
    // --- Handle callback queries (inline keyboard responses) ---
    if (update.callback_query) {
        const cbq = update.callback_query;
        const cbChatId = cbq.message?.chat?.id;
        const cbUserId = cbq.from?.id;
        const cbUserIdStr = String(cbUserId);
        const cbData = cbq.data;

        reloadAccess();

        // Dismiss the spinner immediately
        enqueue(() => callTelegram("answerCallbackQuery", { callback_query_id: cbq.id }).catch(() => {}));

        if (cbChatId != null && cbUserId != null && isAllowed(cbUserIdStr)) {
            // Handle permission inline keyboard buttons
            if (cbData && cbData.startsWith("perm_")) {
                const [action, reqId] = cbData.split(":");
                if (reqId) {
                    const approved = action === "perm_allow";
                    const result = approved
                        ? { kind: "approved" }
                        : { kind: "denied-by-rules", rules: [] };

                    // Respond to the permission via SDK
                    sess.rpc.permissions.handlePendingPermissionRequest({
                        requestId: reqId,
                        result,
                    }).catch(err => console.error("telegram-bridge: permission response failed:", err.message));

                    // Edit the message to show the decision
                    const decisionText = approved ? "✅ Permission granted" : "❌ Permission denied";
                    enqueue(() => callTelegram("editMessageText", {
                        chat_id: cbChatId,
                        message_id: cbq.message?.message_id,
                        text: decisionText,
                    }).catch(() => {}));
                }
                return;
            }
        }
        // Unknown callback data — ignore
        return;
    }

    const message = update.message || update.edited_message;
    if (!message) return;

    const chatId = message.chat?.id;
    const userId = message.from?.id;
    if (chatId == null || userId == null) return;
    const text = message.text || message.caption || "";
    const userIdStr = String(userId);

    // Reload access.json on each message (hot-reload)
    reloadAccess();

    // If awaiting ask_user input and sender is allowed, resolve the pending promise
    if (awaitingInput && isAllowed(userIdStr)) {
        const { resolve } = awaitingInput;
        clearTimeout(awaitingInput.timer);
        awaitingInput = null;
        resolve(text);
        return;
    }

    if (!isAllowed(userIdStr)) {
        await handlePairing(chatId, userId, text);
        return;
    }

    // Handle /stop command — cancel the current agent turn
    if (text.trim().toLowerCase() === "/stop") {
        try {
            if (typeof session.cancel === "function") {
                await session.cancel();
            } else if (session.connection && typeof session.connection.sendRequest === "function") {
                await session.connection.sendRequest("session.cancel", { sessionId: session.sessionId });
            } else {
                await session.send({ cancel: true });
            }
        } catch (err) {
            console.error("telegram-bridge: cancel error:", err.message);
        }
        await enqueue(() => sendMessage(chatId, "⏹️ Cancel requested."));
        stopTyping();
        await dismissBubble();
        return;
    }

    // Ack reaction
    enqueue(() => setMessageReaction(chatId, message.message_id, "\uD83D\uDC40").catch(() => {}));

    // Start typing for all allowed chats
    const allChatIds = getAllowedChatIds();
    startTyping(allChatIds);
    bubbleActive = true;
    scheduleBubbleUpdate();

    // Handle file attachments
    if (message.photo || message.document) {
        try {
            const attachment = await handleFileAttachment(message);
            if (attachment) {
                await session.send({
                    prompt: text || "User sent a file.",
                    attachments: [{ type: "file", path: attachment.path, displayName: attachment.displayName }],
                });
                return;
            }
        } catch (err) {
            await enqueue(() => sendMessage(chatId, `Failed to process attachment: ${err.message}`));
            return;
        }
    }

    // Handle voice messages
    if (message.voice || message.audio) {
        const voice = message.voice || message.audio;
        try {
            const fileInfo = await getFile(voice.file_id);
            const localPath = await downloadFile(fileInfo.file_path);
            const caption = message.caption || "";

            // Try local transcription (ffmpeg + Windows Speech Recognition)
            const transcribed = await transcribeVoice(localPath);
            if (transcribed) {
                const prompt = caption
                    ? `${caption}\n\n[Voice message transcription]: ${transcribed}`
                    : transcribed;
                await session.send({ prompt });
                return;
            }

            // Fallback: send as file attachment for the agent to handle
            const displayName = `voice_${message.message_id}.ogg`;
            await session.send({
                prompt: caption || "The user sent a voice message. Please transcribe it if possible, or let them know voice transcription requires ffmpeg to be installed.",
                attachments: [{ type: "file", path: localPath, displayName }],
            });
            return;
        } catch (err) {
            await enqueue(() => sendMessage(chatId, `Failed to process voice message: ${err.message}`));
            return;
        }
    }

    // Handle /compact toggle command
    if (text.trim().toLowerCase() === "/compact") {
        compactMode = !compactMode;
        const msg = compactMode
            ? "🔇 Compact mode ON — only final responses shown"
            : "🔊 Compact mode OFF — all updates shown";
        await enqueue(() => sendMessage(chatId, msg));
        return;
    }

    if (text) {
        lastTelegramPrompts.add(text);
        await session.send({ prompt: text });
        return;
    }

    await enqueue(() => sendMessage(chatId, "Unsupported message type. Supported: text, photos, documents, and voice messages."));
}

// ============================================================
// Section 9b: Render ask_user prompt for Telegram
// ============================================================

function renderAskUserPrompt(args) {
    let questionText = args.question || args.message || "Input needed:";

    if (args.requestedSchema?.properties) {
        const props = args.requestedSchema.properties;
        const lines = [questionText, ""];
        for (const [key, field] of Object.entries(props)) {
            const label = field.title || key;
            if (field.enum && field.enum.length > 0) {
                const names = field.enumNames || field.enum;
                lines.push(`${label}:`);
                names.forEach((name, i) => {
                    const marker = field.default === field.enum[i] ? " ✓" : "";
                    lines.push(`  ${i + 1}) ${name}${marker}`);
                });
            } else if (field.oneOf && field.oneOf.length > 0) {
                lines.push(`${label}:`);
                field.oneOf.forEach((opt, i) => {
                    const marker = field.default === opt.const ? " ✓" : "";
                    lines.push(`  ${i + 1}) ${opt.title || opt.const}${marker}`);
                });
            } else if (field.type === "boolean") {
                const def = field.default != null ? ` (default: ${field.default ? "yes" : "no"})` : "";
                lines.push(`${label}: yes/no${def}`);
            } else {
                const def = field.default != null ? ` (default: ${field.default})` : "";
                lines.push(`${label}${def}`);
            }
            if (field.description) lines.push(`  → ${field.description}`);
        }
        lines.push("", "↩️ Reply in the terminal to answer.");
        questionText = lines.join("\n");
    }

    return questionText;
}

// ============================================================
// Section 9c: Permission request handler for Telegram
// ============================================================

// ============================================================
// Section 10: Event Handlers (outbound to Telegram)
// ============================================================

let eventHandlersRegistered = false;

function setupEventHandlers(sess) {
    if (eventHandlersRegistered) return;
    eventHandlersRegistered = true;

    // Permission prompt forwarding: only notify Telegram for prompts that
    // actually need user input (not auto-approved). We delay 1.5s after
    // permission.requested — if permission.completed arrives before then,
    // it was auto-approved and we skip the notification.
    const pendingPermissions = new Map(); // requestId → timer
    let activePermissionRequestId = null; // requestId of the permission currently shown on Telegram

    sess.on("permission.requested", (event) => {
        if (!connected) return;
        const req = event.data.permissionRequest || event.data;
        const requestId = event.data.requestId;

        const timer = setTimeout(() => {
            pendingPermissions.delete(requestId);
            activePermissionRequestId = requestId;

            // Still pending after 1.5s — this is a real user prompt
            const lines = ["🔐 **Permission needed**", ""];
            if (req.kind === "shell" && req.fullCommandText) {
                lines.push(`Command: \`${req.fullCommandText}\``);
            } else if ((req.kind === "write" || req.kind === "read") && req.fileName) {
                lines.push(`${req.kind}: \`${req.fileName}\``);
            } else {
                lines.push(`Type: ${req.kind || "unknown"}`);
            }

            const chatIds = getAllowedChatIds();
            const html = markdownToTelegramHtml(lines.join("\n"));
            for (const chatId of chatIds) {
                enqueue(() => callTelegram("sendMessage", {
                    chat_id: chatId,
                    text: html,
                    parse_mode: "HTML",
                    reply_markup: JSON.stringify({
                        inline_keyboard: [[
                            { text: "✅ Allow", callback_data: `perm_allow:${requestId}` },
                            { text: "❌ Deny", callback_data: `perm_deny:${requestId}` }
                        ]]
                    })
                }).catch(() => sendFormattedMessage(chatId, lines.join("\n"))));
            }
        }, 1500);

        pendingPermissions.set(requestId, timer);
    });

    sess.on("permission.completed", (event) => {
        const requestId = event.data.requestId;
        if (requestId === activePermissionRequestId) {
            activePermissionRequestId = null;
        }
        const timer = pendingPermissions.get(requestId);
        if (timer) {
            clearTimeout(timer);
            pendingPermissions.delete(requestId);
        }
    });

    // Forward CLI terminal input to Telegram (so mobile user can follow along)
    sess.on("user.message", (event) => {
        if (!connected) return;
        const content = event.data.content;
        if (!content || content.trim().length === 0) return;

        // Skip if this message originated from Telegram (avoid echo)
        if (lastTelegramPrompts.has(content)) {
            lastTelegramPrompts.delete(content);
            return;
        }

        // Show as "You (terminal):" in a distinct style
        const chatIds = getAllowedChatIds();
        const display = `💬 **You:** ${content}`;
        const chunks = chunkMessage(display);
        for (const chatId of chatIds) {
            for (const chunk of chunks) {
                enqueue(() => sendFormattedMessage(chatId, chunk));
            }
        }
    });

    // Deduplicate assistant messages (SDK may fire the event more than once)
    let lastMessageHash = null;

    sess.on("assistant.message", (event) => {
        if (!connected) return;
        if (event.data.parentToolCallId) return;

        const content = event.data.content;
        if (!content || content.trim().length === 0) return;

        // Skip if we just sent this exact message
        const hash = content.length + ":" + content.slice(0, 100);
        if (hash === lastMessageHash) return;
        lastMessageHash = hash;

        resetTypingDebounce();

        const chatIds = getAllowedChatIds();
        const chunks = chunkMessage(content);
        for (const chatId of chatIds) {
            for (const chunk of chunks) {
                enqueue(() => sendFormattedMessage(chatId, chunk));
            }
        }
    });

    sess.on("assistant.message_delta", (event) => {
        if (!connected) return;
        if (event.data.parentToolCallId) return;
        if (!event.data.deltaContent) return;
        resetTypingDebounce();
    });

    sess.on("session.error", (event) => {
        if (!connected) return;
        const errMsg = `Error: ${event.data.message || event.data.errorType || "Unknown error"}`;
        const chatIds = getAllowedChatIds();
        for (const chatId of chatIds) {
            enqueue(() => sendMessage(chatId, errMsg));
        }
    });

    sess.on("session.idle", () => {
        stopTyping();
        dismissBubble();
    });

    // Relay images and documents from tool results to Telegram
    const PHOTO_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

    sess.on("tool.execution_start", (event) => {
        if (!connected) return;
        resetTypingDebounce();
        bubbleActive = true;
        const toolCallId = event.data.toolCallId;
        const toolName = event.data.toolName || "unknown";
        const desc = describeToolCall(toolName, event.data.arguments);
        if (desc) {
            activeTools.set(toolCallId, { name: toolName, description: desc, args: event.data.arguments });
            scheduleBubbleUpdate();
        }

        // Forward ask_user prompts to Telegram
        if (toolName === "ask_user") {
            const args = event.data.arguments || {};
            const rendered = renderAskUserPrompt(args);
            const chatIds = getAllowedChatIds();
            const chunks = chunkMessage(rendered);
            for (const chatId of chatIds) {
                for (const chunk of chunks) {
                    enqueue(() => sendFormattedMessage(chatId, chunk));
                }
            }
        }

        // Forward task_complete summary to Telegram
        if (toolName === "task_complete") {
            const summary = event.data.arguments?.summary;
            if (summary) {
                const chatIds = getAllowedChatIds();
                const header = "✅ **Task Complete**\n\n" + summary;
                const chunks = chunkMessage(header);
                for (const chatId of chatIds) {
                    for (const chunk of chunks) {
                        enqueue(() => sendFormattedMessage(chatId, chunk));
                    }
                }
            }
        }
    });

    sess.on("tool.execution_complete", (event) => {
        if (!connected) return;
        resetTypingDebounce();
        const toolCallId = event.data.toolCallId;
        const completed = activeTools.get(toolCallId);
        if (completed?.description) {
            lastCompletedToolDesc = completed.description;
        }
        activeTools.delete(toolCallId);
        scheduleBubbleUpdate();

        // Diff rendering for edit/create tools
        if (completed?.name === "edit" && completed.args) {
            const path = completed.args.path || "unknown";
            const shortPath = path.split(/[/\\]/).slice(-2).join("/");
            const lines = [`📝 \`${shortPath}\``];
            if (completed.args.old_str && completed.args.new_str) {
                const oldLines = completed.args.old_str.split("\n").slice(0, 3);
                const newLines = completed.args.new_str.split("\n").slice(0, 3);
                lines.push("```");
                oldLines.forEach(l => lines.push(`- ${l}`));
                newLines.forEach(l => lines.push(`+ ${l}`));
                if (completed.args.old_str.split("\n").length > 3) lines.push("...");
                lines.push("```");
            }
            const chatIds = getAllowedChatIds();
            for (const chatId of chatIds) {
                enqueue(() => sendFormattedMessage(chatId, lines.join("\n")));
            }
        } else if (completed?.name === "create" && completed.args) {
            const path = completed.args.path || "unknown";
            const shortPath = path.split(/[/\\]/).slice(-2).join("/");
            const chatIds = getAllowedChatIds();
            for (const chatId of chatIds) {
                enqueue(() => sendFormattedMessage(chatId, `📄 Created: \`${shortPath}\``));
            }
        }

        const contents = event.data.result?.contents;
        if (!contents || !Array.isArray(contents)) return;

        const chatIds = getAllowedChatIds();
        for (const block of contents) {
            if (block.type === "image" && block.data && block.mimeType) {
                const bytes = Math.ceil(block.data.length * 3 / 4);
                if (bytes > MAX_PHOTO_BYTES) {
                    for (const chatId of chatIds) {
                        enqueue(() => sendMessage(chatId, "(Image too large for Telegram, >10MB)"));
                    }
                    continue;
                }
                for (const chatId of chatIds) {
                    if (PHOTO_MIMES.has(block.mimeType)) {
                        enqueue(() => sendPhoto(chatId, block.data, block.mimeType));
                    } else {
                        const ext = block.mimeType.split("/")[1] || "bin";
                        enqueue(() => sendDocument(chatId, block.data, block.mimeType, `image.${ext}`));
                    }
                }
            }
        }
    });
}

// ============================================================
// Section 11: ask_user Handler
// ============================================================

function createUserInputHandler() {
    return (request) => {
        return new Promise((resolve) => {
            let questionText = request.question || request.message || "Input needed:";

            // Render requestedSchema properties as numbered choices or field prompts
            if (request.requestedSchema?.properties) {
                const props = request.requestedSchema.properties;
                const lines = [questionText, ""];
                for (const [key, field] of Object.entries(props)) {
                    const label = field.title || key;
                    if (field.enum && field.enum.length > 0) {
                        // Enum field — show as numbered choices
                        const names = field.enumNames || field.enum;
                        lines.push(`${label}:`);
                        names.forEach((name, i) => {
                            const marker = field.default === field.enum[i] ? " ✓" : "";
                            lines.push(`  ${i + 1}) ${name}${marker}`);
                        });
                    } else if (field.oneOf && field.oneOf.length > 0) {
                        lines.push(`${label}:`);
                        field.oneOf.forEach((opt, i) => {
                            const marker = field.default === opt.const ? " ✓" : "";
                            lines.push(`  ${i + 1}) ${opt.title || opt.const}${marker}`);
                        });
                    } else if (field.type === "boolean") {
                        const def = field.default != null ? ` (default: ${field.default ? "yes" : "no"})` : "";
                        lines.push(`${label}: yes/no${def}`);
                    } else {
                        const def = field.default != null ? ` (default: ${field.default})` : "";
                        lines.push(`${label}${def}`);
                    }
                    if (field.description) lines.push(`  → ${field.description}`);
                }
                lines.push("", "Reply with your choice (number or text):");
                questionText = lines.join("\n");
            } else if (request.choices && request.choices.length > 0) {
                const choiceList = request.choices
                    .map((c, i) => `${i + 1}) ${c}`)
                    .join("\n");
                questionText = `${questionText}\n${choiceList}`;
            }

            const chatIds = getAllowedChatIds();
            const chunks = chunkMessage(questionText);
            for (const chatId of chatIds) {
                for (const chunk of chunks) {
                    enqueue(() => sendFormattedMessage(chatId, chunk));
                }
            }

            const timer = setTimeout(() => {
                if (awaitingInput && awaitingInput.timer === timer) {
                    awaitingInput = null;
                }
                resolve({ answer: "", wasFreeform: true });
            }, ASK_USER_TIMEOUT_MS);

            awaitingInput = {
                resolve: (rawText) => {
                    let answer = rawText;
                    let wasFreeform = true;

                    // Try to match against schema enum/oneOf choices
                    if (request.requestedSchema?.properties) {
                        const props = request.requestedSchema.properties;
                        for (const [, field] of Object.entries(props)) {
                            const options = field.enum || (field.oneOf ? field.oneOf.map(o => o.const) : null);
                            const labels = field.enumNames || (field.oneOf ? field.oneOf.map(o => o.title || o.const) : null);
                            if (options) {
                                const num = parseInt(rawText.trim(), 10);
                                if (!isNaN(num) && num >= 1 && num <= options.length) {
                                    answer = options[num - 1];
                                    wasFreeform = false;
                                    break;
                                }
                                const match = (labels || options).find(
                                    c => c.toLowerCase() === rawText.trim().toLowerCase()
                                );
                                if (match) {
                                    const idx = (labels || options).indexOf(match);
                                    answer = options[idx] ?? match;
                                    wasFreeform = false;
                                    break;
                                }
                            }
                        }
                    } else if (request.choices && request.choices.length > 0) {
                        const num = parseInt(rawText.trim(), 10);
                        if (!isNaN(num) && num >= 1 && num <= request.choices.length) {
                            answer = request.choices[num - 1];
                            wasFreeform = false;
                        } else {
                            const match = request.choices.find(
                                c => c.toLowerCase() === rawText.trim().toLowerCase()
                            );
                            if (match) {
                                answer = match;
                                wasFreeform = false;
                            }
                        }
                    }
                    resolve({ answer, wasFreeform });
                },
                timer,
            };
        });
    };
}

// ============================================================
// Section 11b: Slash Command Handlers
// ============================================================

let pendingSetupName = null;

async function handleSetup(name) {
    registry = loadJsonOrDefault(BOTS_REGISTRY_PATH, {});

    if (!name) {
        await session.log("Usage: /telegram setup <name>");
        return;
    }
    if (!/^[a-z0-9_-]+$/.test(name)) {
        await session.log("Bot name must be lowercase letters, numbers, hyphens, or underscores.");
        return;
    }
    if (registry[name]) {
        await session.log(`Bot '${name}' already registered. Remove it first.`);
        return;
    }

    pendingSetupName = name;
    await session.log(
        "Telegram Bridge Setup\n\n" +
        "Steps:\n" +
        "1. Open Telegram, search for @BotFather\n" +
        "2. Send /newbot and follow the prompts\n" +
        "3. Copy the bot token BotFather gives you\n" +
        "4. Paste it here"
    );
}

async function handleConnect(name, sessionId) {
    registry = loadJsonOrDefault(BOTS_REGISTRY_PATH, {});

    if (!name) {
        await listBots(sessionId);
        return;
    }
    if (!registry[name]) {
        await session.log(`No bot named '${name}'. Run /telegram setup ${name} first.`);
        return;
    }
    if (connected) {
        await session.log(`Already connected to '${currentBotName}'. Disconnect first.`);
        return;
    }

    // Check lock -- if another live session holds it, take over (Telegram 409 will release them)
    const lock = readLock(name);
    let tookOverFrom = null;
    if (lock && !isLockStale(lock) && lock.sessionId !== sessionId) {
        tookOverFrom = lock.sessionId;
    }

    // Validate token via getMe
    botToken = registry[name].token;
    try {
        botInfo = await getMe();
    } catch (err) {
        botToken = null;
        botInfo = null;
        if (err.status === 401) {
            await session.log(
                `Bot token is invalid or revoked. Re-register with \`/telegram remove ${name}\` then \`/telegram setup ${name}\`.`,
                { level: "error" }
            );
        } else {
            await session.log("Failed to reach Telegram API. Check your network and try again.", { level: "error" });
        }
        return;
    }

    // Claim lock and connect
    mkdirSync(botDir(name), { recursive: true });
    writeLock(name, sessionId);
    currentBotName = name;
    currentSessionId = sessionId;
    shutdownRequested = false;

    access = loadJsonOrDefault(ACCESS_PATH, { allowedUsers: [], pending: {} });
    state = loadJsonOrDefault(botStatePath(name), { offset: 0 });
    setupEventHandlers(session);

    connected = true;
    lastCompletedToolDesc = null;

    const chatIds = getAllowedChatIds();

    if (chatIds.length === 0) {
        await session.log(
            `Telegram bridge connected (@${botInfo.username}).\n\n` +
            `No paired users yet. To pair:\n` +
            `1. Open Telegram and send any message to @${botInfo.username}\n` +
            `2. The bot will reply that a pairing code has been generated\n` +
            `3. The pairing code will appear here in the Copilot CLI terminal\n` +
            `4. Send that code to @${botInfo.username} in Telegram to complete pairing`
        );
    } else {
        // Build session status message
        let branchName = "unknown";
        try {
            branchName = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8", timeout: 5000 }).trim();
        } catch {}
        const workDir = process.env.COPILOT_CWD || process.cwd();
        const shortSession = sessionId.slice(0, 8);
        const displayName = name;
        const botUsername = botInfo.username;
        const statusMsg =
            `🟢 Connected\n` +
            `Bot: ${displayName} (@${botUsername})\n` +
            `Branch: ${branchName}\n` +
            `Dir: ${workDir}\n` +
            `Session: ${shortSession}`;

        if (tookOverFrom) {
            await session.log(`Took over bot '${name}' from session ${tookOverFrom}. Telegram bridge connected (@${botInfo.username}).`);
        } else {
            await session.log(`Telegram bridge connected (@${botInfo.username}).`);
        }
        for (const chatId of chatIds) {
            enqueue(() => sendMessage(chatId, statusMsg));
        }
    }

    pollLoop().catch(err => {
        console.error("telegram-bridge: poll loop error:", err.message);
    });
}

async function handleDisconnect(sessionId) {
    if (!connected) {
        await session.log("Not connected. Nothing to disconnect.");
        return;
    }

    // 1. Stop poll loop
    shutdownRequested = true;
    if (abortController) abortController.abort();

    // 2. Save state before anything else
    if (state && currentBotName) {
        try { saveJsonAtomic(botStatePath(currentBotName), state); } catch {}
    }

    // 3. Goodbye messages (needs botToken) -- collect promises so we can await drain
    const chatIds = getAllowedChatIds();
    const goodbyePromises = [];
    for (const chatId of chatIds) {
        goodbyePromises.push(enqueue(() => sendMessage(chatId, "Copilot CLI session disconnected.").catch(() => {})));
    }
    await Promise.race([Promise.allSettled(goodbyePromises), sleep(3000)]);

    // 4. Stop typing and dismiss bubble (need botToken for API calls)
    stopTyping();
    await dismissBubble();

    // 5. Mark disconnected and release lock
    connected = false;
    eventHandlersRegistered = false;
    if (currentBotName) removeLock(currentBotName, sessionId);

    // 6. Clear all bot-specific state
    botToken = null;
    botInfo = null;
    currentBotName = null;
    currentSessionId = null;
    state = null;

    await session.log("Telegram bridge disconnected.");
}

function formatBotLines(registry) {
    const names = Object.keys(registry);
    const lines = [];
    for (const name of names) {
        const username = registry[name].username || "unknown";
        const lock = readLock(name);
        let status;
        if (connected && currentBotName === name) {
            status = "(connected, this session)";
        } else if (lock && !isLockStale(lock)) {
            status = `(in use by session ${lock.sessionId})`;
        } else {
            status = "(available)";
        }
        lines.push(`  ${name}  @${username}  ${status}`);
    }
    return lines;
}

async function handleStatus(sessionId) {
    registry = loadJsonOrDefault(BOTS_REGISTRY_PATH, {});
    const names = Object.keys(registry);

    if (names.length === 0) {
        await session.log("No bots registered. Use /telegram setup <name> to add one.");
        return;
    }

    const lines = ["Registered bots:", ...formatBotLines(registry)];

    const pairedCount = access?.allowedUsers?.length || 0;
    lines.push(`\nPaired users: ${pairedCount}`);

    await session.log(lines.join("\n"));
}

async function listBots(sessionId) {
    registry = loadJsonOrDefault(BOTS_REGISTRY_PATH, {});
    const names = Object.keys(registry);

    if (names.length === 0) {
        await session.log("No bots registered. Use /telegram setup <name> to add one.");
        return;
    }

    const lines = ["Available bots:", ...formatBotLines(registry)];

    lines.push("\nUse: /telegram connect <name>");
    await session.log(lines.join("\n"));
}

async function handleRemove(name, sessionId) {
    registry = loadJsonOrDefault(BOTS_REGISTRY_PATH, {});

    if (!name) {
        await session.log("Usage: /telegram remove <name>");
        return;
    }
    if (!registry[name]) {
        await session.log(`No bot named '${name}'.`);
        return;
    }

    const lock = readLock(name);
    if (lock && !isLockStale(lock)) {
        if (lock.sessionId === sessionId) {
            await session.log(`Bot '${name}' is connected to this session. Disconnect first.`);
        } else {
            await session.log(`Bot '${name}' is in use by session ${lock.sessionId}. Disconnect that session first.`);
        }
        return;
    }

    delete registry[name];
    saveJsonAtomic(BOTS_REGISTRY_PATH, registry, 0o600);
    try { rmSync(botDir(name), { recursive: true, force: true }); } catch {}

    await session.log(`Bot '${name}' removed.`);
}

// ============================================================
// Section 11c: Command Router
// ============================================================

// Route /telegram subcommands dispatched via SDK command protocol.
async function handleTelegramCommand(args, sessionId) {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || "help";
    const botName = parts[1] || "";

    switch (subcommand) {
        case "setup":
            await handleSetup(botName);
            break;
        case "connect":
            await handleConnect(botName, sessionId);
            break;
        case "disconnect":
            await handleDisconnect(sessionId);
            break;
        case "status":
            await handleStatus(sessionId);
            break;
        case "remove":
            await handleRemove(botName, sessionId);
            break;
        case "help":
            await session.log(
                "/telegram help — Telegram Bridge commands:\n" +
                "  setup <name>       Register a new bot (you'll be prompted for the token)\n" +
                "  connect <name>     Start polling with a registered bot\n" +
                "  disconnect         Stop the active polling loop\n" +
                "  status             Show registered bots and connection state\n" +
                "  remove <name>      Unregister a bot and delete its stored token"
            );
            break;
        default:
            await session.log("Unknown subcommand. Run /telegram help for usage.");
            break;
    }
}

// Build the /telegram command definition for use with joinSession's `commands` option.
// Passing commands directly to joinSession registers them atomically with the session,
// avoiding the race where the CLI resolves the command before a follow-up session.resume.
function buildTelegramCommand() {
    return {
        name: "telegram",
        description: "Telegram bridge: setup, connect, disconnect, status, remove",
        handler: async (context) => {
            await handleTelegramCommand(context.args, context.sessionId);
        },
    };
}

// ============================================================
// Section 12: Poll Loop
// ============================================================

async function pollLoop() {
    let errorDelay = ERROR_RETRY_BASE_MS;

    while (!shutdownRequested) {
        abortController = new AbortController();
        try {
            const updates = await getUpdates(state.offset, POLL_TIMEOUT);
            errorDelay = ERROR_RETRY_BASE_MS;

            for (const update of updates) {
                try {
                    await processUpdate(update);
                } catch (err) {
                    console.error("telegram-bridge: error processing update:", err.message);
                }
                state.offset = update.update_id + 1;
            }

            if (updates.length > 0 && currentBotName) {
                saveJsonAtomic(botStatePath(currentBotName), state);
            }
        } catch (err) {
            if (abortController.signal.aborted) break;

            if (err.status === 409) {
                // Save state before clearing
                if (state && currentBotName) {
                    try { saveJsonAtomic(botStatePath(currentBotName), state); } catch {}
                }

                // Stop typing and dismiss bubble (need botToken for API calls)
                stopTyping();
                try { await dismissBubble(); } catch {}

                connected = false;
                eventHandlersRegistered = false;
                if (currentBotName && currentSessionId) removeLock(currentBotName, currentSessionId);

                const lostBotName = currentBotName;
                botToken = null;
                botInfo = null;
                currentBotName = null;
                currentSessionId = null;
                state = null;

                await session.log(
                    `Telegram bridge released (another session took over). Type /telegram connect ${lostBotName || "<name>"} to reclaim.`,
                    { level: "warning" }
                );
                break;
            }

            console.error(`telegram-bridge: poll error (retry in ${errorDelay}ms):`, err.message);
            await sleep(errorDelay);
            errorDelay = Math.min(errorDelay * 2, ERROR_RETRY_MAX_MS);
        }
    }
}

// ============================================================
// Section 13: Lifecycle (startup + shutdown)
// ============================================================

async function main() {
    registry = loadJsonOrDefault(BOTS_REGISTRY_PATH, {});
    access = loadJsonOrDefault(ACCESS_PATH, { allowedUsers: [], pending: {} });
    cleanupTmpDir();

    session = await joinSession({
        onUserInputRequest: createUserInputHandler(),
        commands: [buildTelegramCommand()],
        hooks: {
            onUserPromptSubmitted: (input) => {
                if (!pendingSetupName) return;
                const prompt = input.prompt.trim();
                if (prompt.startsWith("/")) return;
                if (!prompt.match(/^\d+:[A-Za-z0-9_-]+$/)) return;

                const name = pendingSetupName;
                const candidateToken = prompt;
                pendingSetupName = null;

                // Fire async validation in background -- hook stays synchronous
                (async () => {
                    try {
                        const url = `${TELEGRAM_API}/bot${candidateToken}/getMe`;
                        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
                        if (!res.ok) {
                            if (res.status === 401) {
                                await session.log("Invalid token. Make sure you copied it correctly from BotFather.");
                            } else {
                                await session.log(`Telegram API returned HTTP ${res.status}. Try again later.`);
                            }
                            return;
                        }
                        const data = await res.json();
                        const username = data.result?.username || "unknown";

                        // Re-read registry (another session may have modified it)
                        registry = loadJsonOrDefault(BOTS_REGISTRY_PATH, {});
                        registry[name] = {
                            token: candidateToken,
                            username,
                            addedAt: new Date().toISOString(),
                        };
                        saveJsonAtomic(BOTS_REGISTRY_PATH, registry, 0o600);
                        mkdirSync(botDir(name), { recursive: true });

                        await session.log(`Bot registered as '${name}' (@${username}). Use /telegram connect ${name} to start.`);
                    } catch (err) {
                        if (err.name === "TimeoutError" || err.name === "AbortError") {
                            await session.log("Request timed out reaching Telegram API. Check your network and try again.");
                        } else {
                            await session.log(`Failed to validate token: ${err.message}`);
                        }
                    }
                })();

                return { modifiedPrompt: `[Telegram Bridge: validating bot token for '${name}'... Please wait.]` };
            },
        },
    });

    const botNames = Object.keys(registry);
    if (botNames.length === 0) {
        await session.log("Telegram bridge: no bots registered. Type /telegram setup <name> to add one.");
    } else {
        // Auto-connect: find a bot whose lock is stale or belongs to this session
        let autoBot = null;
        if (botNames.length === 1) {
            // Single bot: auto-connect unless another live session owns it
            const lock = readLock(botNames[0]);
            if (!lock || isLockStale(lock) || lock.sessionId === session.sessionId) {
                autoBot = botNames[0];
            }
        } else {
            // Multiple bots: auto-connect to first bot with no lock or a stale lock
            for (const name of botNames) {
                const lock = readLock(name);
                if (!lock || isLockStale(lock)) {
                    autoBot = name;
                    break;
                }
            }
        }

        if (autoBot) {
            await session.log(`Telegram bridge: auto-connecting to '${autoBot}'...`);
            try {
                await handleConnect(autoBot, session.sessionId);
            } catch (err) {
                console.error("telegram-bridge: auto-connect failed:", err.message);
            }
        } else {
            await session.log(`Telegram bridge: dormant (${botNames.length} bot(s) registered). Type /telegram connect <name> to start.`);
        }
    }
}

// SIGTERM handler
process.on("SIGTERM", async () => {
    shutdownRequested = true;
    if (abortController) abortController.abort();

    if (connected) {
        const lock = currentBotName ? readLock(currentBotName) : null;
        const weOwnLock = lock && lock.pid === process.pid;

        if (weOwnLock) {
            try {
                const chatIds = getAllowedChatIds();
                const promises = chatIds.map(chatId =>
                    enqueue(() => sendMessage(chatId, "Copilot CLI session ended.")).catch(() => {})
                );
                await Promise.race([
                    Promise.allSettled(promises),
                    sleep(3000),
                ]);
            } catch {}
            if (currentBotName) removeLock(currentBotName, currentSessionId);
        }
    }

    try {
        if (state && currentBotName) writeFileSync(botStatePath(currentBotName), JSON.stringify(state, null, 2) + "\n");
    } catch {}

    stopTyping();
    cleanupTmpDir();
    process.exit(0);
});

main().catch(err => {
    console.error("telegram-bridge: fatal error:", err);
    process.exit(1);
});
