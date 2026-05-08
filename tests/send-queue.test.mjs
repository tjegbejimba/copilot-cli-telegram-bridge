import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSendQueue } from "../send-queue.mjs";

describe("send queue", () => {
    it("surfaces terminal send failures to awaited callers", async () => {
        const queue = createSendQueue({ sleepFn: async () => {} });
        const error = new Error("message too long");
        error.status = 400;

        await assert.rejects(
            () => queue.enqueue(async () => { throw error; }),
            err => err === error
        );
    });

    it("logs detached terminal send failures instead of leaving an unhandled rejection", async () => {
        const dropped = [];
        const queue = createSendQueue({
            sleepFn: async () => {},
            onDroppedError: (err, context) => dropped.push({ err, context }),
        });
        const error = new Error("message too long");
        error.status = 400;

        queue.enqueueDetached(async () => { throw error; }, "terminal echo");
        await queue.onIdle();

        assert.deepEqual(dropped, [{ err: error, context: "terminal echo" }]);
    });

    it("retries rate-limited sends without treating them as dropped detached errors", async () => {
        const dropped = [];
        const sleeps = [];
        const queue = createSendQueue({
            sleepFn: async (ms) => sleeps.push(ms),
            onDroppedError: (err, context) => dropped.push({ err, context }),
        });
        let attempts = 0;

        queue.enqueueDetached(async () => {
            attempts++;
            if (attempts === 1) {
                const error = new Error("rate limited");
                error.status = 429;
                error.retryAfter = 2;
                throw error;
            }
            return "sent";
        }, "rate limited send");
        await queue.onIdle();

        assert.equal(attempts, 2);
        assert.deepEqual(sleeps, [2000]);
        assert.deepEqual(dropped, []);
    });

    it("preserves FIFO ordering", async () => {
        const calls = [];
        const queue = createSendQueue({ sleepFn: async () => {} });

        const first = queue.enqueue(async () => calls.push("first"));
        const second = queue.enqueue(async () => calls.push("second"));
        await Promise.all([first, second]);

        assert.deepEqual(calls, ["first", "second"]);
    });
});
