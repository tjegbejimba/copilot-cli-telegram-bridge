import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyPollingConflict } from "../reconnect-policy.mjs";

describe("classifyPollingConflict", () => {
    it("retries when the current session still owns the bot lock", () => {
        const decision = classifyPollingConflict({
            lock: { pid: 1234, sessionId: "current-session" },
            currentSessionId: "current-session",
            lockIsStale: false,
        });

        assert.equal(decision, "retry");
    });

    it("retries when the lock is stale", () => {
        const decision = classifyPollingConflict({
            lock: { pid: 1234, sessionId: "old-session" },
            currentSessionId: "current-session",
            lockIsStale: true,
        });

        assert.equal(decision, "retry");
    });

    it("releases when a live different session owns the bot lock", () => {
        const decision = classifyPollingConflict({
            lock: { pid: 1234, sessionId: "other-session" },
            currentSessionId: "current-session",
            lockIsStale: false,
        });

        assert.equal(decision, "release");
    });
});
