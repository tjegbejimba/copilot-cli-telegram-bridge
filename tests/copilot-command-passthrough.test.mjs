import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveCopilotCommandPassthrough } from "../copilot-command-passthrough.mjs";

describe("Copilot command pass-through", () => {
    it("allows explicitly safe slash commands", () => {
        assert.deepEqual(resolveCopilotCommandPassthrough("help models"), {
            ok: true,
            prompt: "/help models",
        });
    });

    it("rejects unsupported commands instead of forwarding them", () => {
        const result = resolveCopilotCommandPassthrough("/danger now");

        assert.equal(result.ok, false);
        assert.match(result.error, /not allow-listed/);
    });
});
