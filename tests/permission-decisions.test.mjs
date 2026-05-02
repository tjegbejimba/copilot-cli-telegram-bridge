import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildPermissionDecision,
    getPermissionActions,
    parsePermissionCallbackData,
} from "../permission-decisions.mjs";

describe("permission decisions", () => {
    it("builds an SDK approve-once decision", () => {
        assert.deepEqual(
            buildPermissionDecision("once", { kind: "write", canOfferSessionApproval: true }),
            { kind: "approve-once" }
        );
    });

    it("builds an SDK reject decision", () => {
        assert.deepEqual(
            buildPermissionDecision("reject", { kind: "shell" }),
            { kind: "reject" }
        );
    });

    it("builds a session command approval for shell requests that support it", () => {
        const decision = buildPermissionDecision("session", {
            kind: "shell",
            canOfferSessionApproval: true,
            commands: [
                { identifier: "git", readOnly: true },
                { identifier: "npm", readOnly: false },
            ],
        });

        assert.deepEqual(decision, {
            kind: "approve-for-session",
            approval: {
                kind: "commands",
                commandIdentifiers: ["git", "npm"],
            },
        });
    });

    it("does not build session approval for permission kinds the SDK cannot persist", () => {
        assert.equal(
            buildPermissionDecision("session", { kind: "url", url: "https://example.com" }),
            null
        );
    });

    it("builds a location-scoped approval when a location key is available", () => {
        const decision = buildPermissionDecision(
            "location",
            { kind: "write", canOfferSessionApproval: true },
            { locationKey: "C:\\Repo" }
        );

        assert.deepEqual(decision, {
            kind: "approve-for-location",
            approval: { kind: "write" },
            locationKey: "C:\\Repo",
        });
    });

    it("only offers session approval when a valid session approval can be built", () => {
        assert.deepEqual(
            getPermissionActions({
                kind: "write",
                canOfferSessionApproval: true,
                fileName: "extension.mjs",
            }).map(action => action.id),
            ["once", "session", "reject"]
        );

        assert.deepEqual(
            getPermissionActions({
                kind: "url",
                url: "https://example.com",
            }).map(action => action.id),
            ["once", "reject"]
        );
    });

    it("parses modern permission callback data", () => {
        assert.deepEqual(parsePermissionCallbackData("perm:session:req-123"), {
            action: "session",
            requestId: "req-123",
        });
    });
});
