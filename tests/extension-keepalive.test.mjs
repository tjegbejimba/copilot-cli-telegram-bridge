import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createExtensionKeepAlive } from "../extension-keepalive.mjs";

describe("extension keepalive", () => {
    it("starts one referenced timer and clears it on stop", () => {
        const intervals = [];
        const cleared = [];
        const keepAlive = createExtensionKeepAlive({
            setIntervalFn: (fn, ms) => {
                const handle = { fn, ms };
                intervals.push(handle);
                return handle;
            },
            clearIntervalFn: handle => cleared.push(handle),
        });

        keepAlive.start();
        keepAlive.start();
        keepAlive.stop();
        keepAlive.stop();

        assert.equal(intervals.length, 1);
        assert.equal(intervals[0].ms, 60000);
        assert.deepEqual(cleared, [intervals[0]]);
    });
});
