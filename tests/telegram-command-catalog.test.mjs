import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    getTelegramCommandMenu,
    parseTelegramCommand,
    renderBotFatherCommandList,
    renderTelegramHelp,
} from "../telegram-command-catalog.mjs";

describe("telegram command catalog", () => {
    it("exposes discoverable Telegram command menu entries", () => {
        assert.deepEqual(
            getTelegramCommandMenu().map(command => command.command),
            ["help", "status", "health", "stop", "compact", "disconnect", "reconnect", "command", "synccommands"]
        );
    });

    it("parses Telegram slash commands with bot mentions and arguments", () => {
        assert.deepEqual(parseTelegramCommand("/status@my_bot verbose"), {
            name: "status",
            args: "verbose",
        });
    });

    it("renders Telegram help from the command catalog", () => {
        const help = renderTelegramHelp();

        assert.match(help, /\/status - Show bridge connection status/);
        assert.match(help, /\/command - Run an allow-listed Copilot slash command/);
    });

    it("renders a BotFather-compatible manual command list", () => {
        const commands = renderBotFatherCommandList();

        assert.match(commands, /^help - Show Telegram bridge commands/m);
        assert.match(commands, /^synccommands - Refresh the Telegram command menu/m);
        assert.doesNotMatch(commands, /^\//m);
    });
});
