export const TELEGRAM_BRIDGE_COMMANDS = [
    {
        name: "help",
        description: "Show Telegram bridge commands",
        cliUsage: "help",
        safety: "read",
        menu: true,
    },
    {
        name: "status",
        description: "Show bridge connection status",
        cliUsage: "status",
        safety: "read",
        menu: true,
    },
    {
        name: "health",
        description: "Show polling and connection health",
        cliUsage: "status",
        safety: "read",
        menu: true,
    },
    {
        name: "stop",
        description: "Stop the current Copilot turn",
        safety: "session-control",
        menu: true,
    },
    {
        name: "compact",
        description: "Toggle compact Telegram updates",
        safety: "session-control",
        menu: true,
    },
    {
        name: "disconnect",
        description: "Disconnect this Telegram bridge session",
        cliUsage: "disconnect",
        safety: "session-control",
        menu: true,
    },
    {
        name: "reconnect",
        description: "Reconnect this session to the current bot",
        cliUsage: "connect <name>",
        safety: "session-control",
        menu: true,
    },
    {
        name: "command",
        description: "Run an allow-listed Copilot slash command",
        safety: "passthrough",
        menu: true,
    },
    {
        name: "synccommands",
        description: "Refresh the Telegram command menu",
        safety: "session-control",
        menu: true,
    },
];

export const CLI_TELEGRAM_SUBCOMMANDS = [
    {
        name: "setup",
        args: "<name>",
        description: "Register a new bot and prompt for the token",
    },
    {
        name: "connect",
        args: "<name>",
        description: "Start polling with a registered bot",
    },
    {
        name: "disconnect",
        description: "Stop the active polling loop",
    },
    {
        name: "status",
        description: "Show registered bots and connection state",
    },
    {
        name: "synccommands",
        description: "Refresh the active bot's Telegram command menu",
    },
    {
        name: "remove",
        args: "<name>",
        description: "Unregister a bot and delete its stored token",
    },
    {
        name: "help",
        description: "Show CLI Telegram bridge commands",
    },
];

export function getTelegramCommandMenu(commands = TELEGRAM_BRIDGE_COMMANDS) {
    return commands
        .filter(command => command.menu !== false)
        .map(command => ({
            command: command.name,
            description: command.description,
        }));
}

export function parseTelegramCommand(text) {
    const trimmed = (text || "").trim();
    const match = trimmed.match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]*))?$/);
    if (!match) return null;
    return {
        name: match[1].toLowerCase(),
        args: (match[2] || "").trim(),
    };
}

export function renderTelegramHelp(commands = TELEGRAM_BRIDGE_COMMANDS) {
    const lines = ["Telegram Bridge commands:", ""];
    for (const command of commands.filter(command => command.menu !== false)) {
        lines.push(`/${command.name} - ${command.description}`);
    }
    return lines.join("\n");
}

export function renderBotFatherCommandList(commands = TELEGRAM_BRIDGE_COMMANDS) {
    return commands
        .filter(command => command.menu !== false)
        .map(command => `${command.name} - ${command.description}`)
        .join("\n");
}

export function renderCliHelp(commands = CLI_TELEGRAM_SUBCOMMANDS) {
    const lines = ["/telegram help - Telegram Bridge commands:", ""];
    for (const command of commands) {
        const usage = command.args ? `${command.name} ${command.args}` : command.name;
        lines.push(`  ${usage.padEnd(18)} ${command.description}`);
    }
    return lines.join("\n");
}

export function getCliCommandDescription() {
    const names = CLI_TELEGRAM_SUBCOMMANDS
        .filter(command => command.name !== "help")
        .map(command => command.name);
    return `Telegram bridge: ${names.join(", ")}`;
}
