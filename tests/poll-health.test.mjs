import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPollHealthTracker } from "../poll-health.mjs";

describe("poll health tracker", () => {
    it("enters degraded state only after sustained failures", () => {
        const tracker = createPollHealthTracker({ threshold: 3 });

        assert.equal(tracker.recordFailure({ now: 1000 }), null);
        assert.equal(tracker.recordFailure({ now: 2000 }), null);

        assert.deepEqual(tracker.recordFailure({ now: 3000 }), {
            type: "degraded",
            failures: 3,
            degradedAt: 3000,
        });
    });

    it("reports recovery after degraded polling succeeds", () => {
        const tracker = createPollHealthTracker({ threshold: 2 });
        tracker.recordFailure({ now: 1000 });
        tracker.recordFailure({ now: 2000 });

        assert.deepEqual(tracker.recordSuccess({ now: 7000 }), {
            type: "recovered",
            failures: 2,
            degradedMs: 5000,
        });

        assert.equal(tracker.recordSuccess({ now: 8000 }), null);
    });
});
