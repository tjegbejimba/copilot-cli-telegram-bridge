import { escapeHtml } from "./telegram-format.mjs";

export function formatBridgeStatus({
    connected,
    botName,
    botUsername,
    sessionId,
    connectedAtMs,
    compactMode,
    cwd,
    stats = {},
    polling = {},
}) {
    const botDisplay = botName
        ? `${escapeHtml(botName)}${botUsername ? ` (@${escapeHtml(botUsername)})` : ""}`
        : "none";
    const pollingState = polling.state || "healthy";
    const pollingLines = [
        `<b>Polling:</b> ${capitalize(pollingState)}`,
    ];
    if (polling.lastError) {
        pollingLines.push(`<b>Last polling error:</b> <code>${escapeHtml(polling.lastError)}</code>`);
    }
    return [
        "<b>Telegram Bridge Status</b>",
        "",
        `<b>Connected:</b> ${connected ? "Yes" : "No"}`,
        `<b>Bot:</b> ${botDisplay}`,
        `<b>Session ID:</b> <code>${escapeHtml(sessionId || "N/A")}</code>`,
        `<b>Uptime:</b> ${formatDuration(connectedAtMs ? Date.now() - connectedAtMs : null)}`,
        `<b>Compact mode:</b> ${compactMode ? "ON" : "OFF"}`,
        `<b>Working dir:</b> <code>${escapeHtml(cwd || "unknown")}</code>`,
        ...pollingLines,
        "",
        "<b>Stats this session:</b>",
        `Tool calls: ${stats.toolCalls || 0}`,
        `Files edited: ${stats.filesEdited || 0}`,
        `Files created: ${stats.filesCreated || 0}`,
    ].join("\n");
}

export function formatBridgeHealth({
    connected,
    botName,
    polling = {},
}) {
    const state = polling.state || "healthy";
    const lines = [
        "<b>Telegram Bridge Health</b>",
        "",
        `<b>Connected:</b> ${connected ? "Yes" : "No"}`,
        `<b>Bot:</b> ${botName ? escapeHtml(botName) : "none"}`,
        `<b>Polling:</b> ${capitalize(state)}`,
        `<b>Consecutive failures:</b> ${polling.consecutiveFailures || 0}`,
    ];
    if (polling.lastError) {
        lines.push(`<b>Last error:</b> <code>${escapeHtml(polling.lastError)}</code>`);
    }
    if (polling.lastDegradedAt) {
        lines.push(`<b>Last degraded:</b> ${escapeHtml(polling.lastDegradedAt)}`);
    }
    if (polling.lastRecoveredAt) {
        lines.push(`<b>Last recovered:</b> ${escapeHtml(polling.lastRecoveredAt)}`);
    }
    return lines.join("\n");
}

function formatDuration(ms) {
    if (ms == null) return "N/A";
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function capitalize(value) {
    return value ? value[0].toUpperCase() + value.slice(1) : "";
}
