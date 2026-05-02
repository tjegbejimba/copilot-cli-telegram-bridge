export const SAFE_COPILOT_COMMANDS = new Set([
    "help",
    "clear",
    "model",
    "agents",
    "extensions",
]);

export function resolveCopilotCommandPassthrough(input) {
    const normalized = normalizeCommand(input);
    if (!normalized) {
        return {
            ok: false,
            error: `Usage: /command <${[...SAFE_COPILOT_COMMANDS].join("|")}> [args]`,
        };
    }

    const commandName = normalized.slice(1).split(/\s+/, 1)[0].toLowerCase();
    if (!SAFE_COPILOT_COMMANDS.has(commandName)) {
        return {
            ok: false,
            error: `/${commandName} is not allow-listed for Telegram pass-through.`,
        };
    }

    return { ok: true, prompt: normalized };
}

function normalizeCommand(input) {
    const trimmed = (input || "").trim();
    if (!trimmed) return "";
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
