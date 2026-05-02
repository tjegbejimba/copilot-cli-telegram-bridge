import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createEarlyEventBuffer } from "../early-events.mjs";

describe("early event buffer", () => {
    it("captures early lifecycle events before Telegram connects", () => {
        const buffer = createEarlyEventBuffer();

        buffer.record({ type: "session.start", data: { source: "resume" } });
        buffer.record({ type: "assistant.message", data: { content: "too noisy" } });

        assert.deepEqual(buffer.flush(), [
            "ℹ️ Early session event: session.start",
        ]);
    });

    it("captures early errors with useful detail", () => {
        const buffer = createEarlyEventBuffer();

        buffer.record({ type: "session.error", data: { errorType: "Boom", message: "Failed" } });

        assert.deepEqual(buffer.flush(), [
            "❗ Early session error: Boom: Failed",
        ]);
    });
});
