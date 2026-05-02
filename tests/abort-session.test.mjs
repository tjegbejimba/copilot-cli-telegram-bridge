import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { abortCurrentTurn } from "../abort-session.mjs";

describe("abortCurrentTurn", () => {
    it("uses session.abort to stop the current turn", async () => {
        let aborted = false;
        const session = {
            abort: async () => {
                aborted = true;
            },
        };

        await abortCurrentTurn(session);

        assert.equal(aborted, true);
    });

    it("fails clearly when the SDK abort API is unavailable", async () => {
        await assert.rejects(
            () => abortCurrentTurn({}),
            /session\.abort is not available/
        );
    });
});
