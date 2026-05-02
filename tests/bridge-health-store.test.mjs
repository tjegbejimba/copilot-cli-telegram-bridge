import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
    DEFAULT_BRIDGE_HEALTH,
    loadBridgeHealth,
    saveBridgeHealth,
} from "../bridge-health-store.mjs";

const tmpRoots = [];

function createTempRoot() {
    const root = mkdtempSync(join(tmpdir(), "telegram-bridge-health-"));
    tmpRoots.push(root);
    return root;
}

afterEach(() => {
    for (const root of tmpRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe("bridge health store", () => {
    it("defaults to healthy state when no persisted health exists", () => {
        const path = join(createTempRoot(), "health.json");

        assert.deepEqual(loadBridgeHealth(path), DEFAULT_BRIDGE_HEALTH);
    });

    it("persists and reloads the last polling health state", () => {
        const path = join(createTempRoot(), "health.json");
        const health = {
            state: "degraded",
            consecutiveFailures: 4,
            lastError: "network timeout",
            lastDegradedAt: "2026-01-01T00:00:00.000Z",
            lastRecoveredAt: null,
        };

        saveBridgeHealth(path, health);

        assert.deepEqual(loadBridgeHealth(path), health);
    });

    it("normalizes partial persisted health without preserving unknown fields", () => {
        const path = join(createTempRoot(), "health.json");

        saveBridgeHealth(path, {
            state: "released",
            lastError: "taken over",
            ignored: true,
        });

        assert.deepEqual(loadBridgeHealth(path), {
            ...DEFAULT_BRIDGE_HEALTH,
            state: "released",
            lastError: "taken over",
        });
    });
});
