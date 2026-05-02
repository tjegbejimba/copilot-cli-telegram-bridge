import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatBridgeHealth, formatBridgeStatus } from "../telegram-command-responses.mjs";

describe("telegram command responses", () => {
    it("formats bridge status as Telegram HTML", () => {
        const html = formatBridgeStatus({
            connected: true,
            botName: "work",
            botUsername: "work_bot",
            sessionId: "session-123456",
            connectedAtMs: Date.now() - 65_000,
            compactMode: false,
            cwd: "C:\\repo",
            stats: {
                toolCalls: 3,
                filesEdited: 2,
                filesCreated: 1,
            },
            polling: {
                state: "retrying",
                lastError: "timeout",
            },
        });

        assert.match(html, /<b>Connected:<\/b> Yes/);
        assert.match(html, /<b>Bot:<\/b> work \(@work_bot\)/);
        assert.match(html, /<b>Polling:<\/b> Retrying/);
        assert.match(html, /timeout/);
        assert.match(html, /<code>C:\\repo<\/code>/);
    });

    it("formats bridge health with degraded polling details", () => {
        const html = formatBridgeHealth({
            connected: true,
            botName: "work",
            polling: {
                state: "degraded",
                consecutiveFailures: 4,
                lastError: "network timeout",
            },
        });

        assert.match(html, /<b>Polling:<\/b> Degraded/);
        assert.match(html, /<b>Consecutive failures:<\/b> 4/);
        assert.match(html, /network timeout/);
    });
});
