import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTelegramApi } from "../telegram-api.mjs";

describe("telegram api", () => {
    it("sends JSON requests with the current bot token", async () => {
        const requests = [];
        const api = createTelegramApi({
            getBotToken: () => "123:abc",
            fetchFn: async (url, options) => {
                requests.push({ url, options });
                return Response.json({ ok: true, result: { message_id: 7 } });
            },
        });

        const result = await api.sendMessage(42, "hello", "HTML");

        assert.deepEqual(result, { message_id: 7 });
        assert.equal(requests[0].url, "https://api.telegram.org/bot123:abc/sendMessage");
        assert.deepEqual(JSON.parse(requests[0].options.body), {
            chat_id: 42,
            text: "hello",
            parse_mode: "HTML",
        });
    });

    it("surfaces Telegram polling conflicts with status 409", async () => {
        const api = createTelegramApi({
            getBotToken: () => "123:abc",
            fetchFn: async () => new Response("conflict", { status: 409 }),
        });

        await assert.rejects(
            () => api.getUpdates(10, 30),
            err => err.status === 409 && /another process/.test(err.message)
        );
    });

    it("falls back to plain text when Telegram rejects generated HTML", async () => {
        const requests = [];
        const api = createTelegramApi({
            getBotToken: () => "123:abc",
            markdownToTelegramHtml: () => "<bad>",
            fetchFn: async (url, options) => {
                requests.push({ url, body: JSON.parse(options.body) });
                if (requests.length === 1) {
                    return new Response("can't parse entities", { status: 400 });
                }
                return Response.json({ ok: true, result: { message_id: 8 } });
            },
        });

        const result = await api.sendFormattedMessage(42, "**hello**");

        assert.deepEqual(result, { message_id: 8 });
        assert.deepEqual(requests.map(request => request.body.text), ["<bad>", "**hello**"]);
    });

    it("registers Telegram command menu entries", async () => {
        const requests = [];
        const api = createTelegramApi({
            getBotToken: () => "123:abc",
            fetchFn: async (url, options) => {
                requests.push({ url, body: JSON.parse(options.body) });
                return Response.json({ ok: true, result: true });
            },
        });

        await api.setMyCommands([{ command: "status", description: "Show status" }]);

        assert.equal(requests[0].url, "https://api.telegram.org/bot123:abc/setMyCommands");
        assert.deepEqual(requests[0].body, {
            commands: [{ command: "status", description: "Show status" }],
        });
    });
});
