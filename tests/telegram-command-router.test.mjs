import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleTelegramBridgeCommand } from "../telegram-command-router.mjs";

function createDeps(overrides = {}) {
    const sent = [];
    const calls = [];
    return {
        sent,
        calls,
        deps: {
            connected: true,
            renderHelp: () => "help text",
            getStatusHtml: () => "<b>Status</b>",
            getHealthHtml: () => "<b>Health</b>",
            sendMessage: async (chatId, text, parseMode) => sent.push({ chatId, text, parseMode }),
            stop: async () => calls.push("stop"),
            toggleCompact: async () => "Compact mode changed",
            disconnect: async () => calls.push("disconnect"),
            reconnect: async (chatId) => calls.push(`reconnect:${chatId}`),
            syncCommands: async () => calls.push("syncCommands"),
            resolveCommand: (args) => args === "help"
                ? { ok: true, prompt: "/help" }
                : { ok: false, error: "Unsupported command" },
            sendPrompt: async (prompt) => calls.push(`prompt:${prompt}`),
            markPromptForwarded: () => calls.push("markPromptForwarded"),
            ...overrides,
        },
    };
}

describe("Telegram command router", () => {
    it("routes help, status, and health through fake Telegram sends", async () => {
        const { deps, sent } = createDeps();

        await handleTelegramBridgeCommand({ name: "help", args: "" }, 123, deps);
        await handleTelegramBridgeCommand({ name: "status", args: "" }, 123, deps);
        await handleTelegramBridgeCommand({ name: "health", args: "" }, 123, deps);

        assert.deepEqual(sent, [
            { chatId: 123, text: "help text", parseMode: undefined },
            { chatId: 123, text: "<b>Status</b>", parseMode: "HTML" },
            { chatId: 123, text: "<b>Health</b>", parseMode: "HTML" },
        ]);
    });

    it("syncs the Telegram command menu through a fake API dependency", async () => {
        const { deps, calls, sent } = createDeps();

        await handleTelegramBridgeCommand({ name: "synccommands", args: "" }, 123, deps);

        assert.deepEqual(calls, ["syncCommands"]);
        assert.deepEqual(sent, [
            { chatId: 123, text: "Telegram command menu sync requested.", parseMode: undefined },
        ]);
    });

    it("forwards only allow-listed Copilot slash commands", async () => {
        const { deps, calls, sent } = createDeps();

        await handleTelegramBridgeCommand({ name: "command", args: "danger" }, 123, deps);
        await handleTelegramBridgeCommand({ name: "command", args: "help" }, 123, deps);

        assert.deepEqual(calls, [
            "markPromptForwarded",
            "prompt:/help",
        ]);
        assert.deepEqual(sent, [
            { chatId: 123, text: "Unsupported command", parseMode: undefined },
            { chatId: 123, text: "Forwarding /help to Copilot CLI.", parseMode: undefined },
        ]);
    });

    it("uses fake session-control dependencies for disconnect and reconnect", async () => {
        const { deps, calls } = createDeps();

        await handleTelegramBridgeCommand({ name: "disconnect", args: "" }, 123, deps);
        await handleTelegramBridgeCommand({ name: "reconnect", args: "" }, 123, deps);

        assert.deepEqual(calls, ["disconnect", "reconnect:123"]);
    });
});
