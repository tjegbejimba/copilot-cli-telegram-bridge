import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { loadJsonOrDefault, saveJsonAtomic } from "./bot-storage.mjs";

export const DEFAULT_BRIDGE_HEALTH = Object.freeze({
    state: "healthy",
    consecutiveFailures: 0,
    lastError: null,
    lastDegradedAt: null,
    lastRecoveredAt: null,
});

export function loadBridgeHealth(filePath) {
    return normalizeBridgeHealth(loadJsonOrDefault(filePath, DEFAULT_BRIDGE_HEALTH));
}

export function saveBridgeHealth(filePath, health) {
    mkdirSync(dirname(filePath), { recursive: true });
    saveJsonAtomic(filePath, normalizeBridgeHealth(health));
}

function normalizeBridgeHealth(health) {
    const value = health && typeof health === "object" ? health : {};
    return {
        state: typeof value.state === "string" ? value.state : DEFAULT_BRIDGE_HEALTH.state,
        consecutiveFailures: Number.isInteger(value.consecutiveFailures)
            ? Math.max(0, value.consecutiveFailures)
            : DEFAULT_BRIDGE_HEALTH.consecutiveFailures,
        lastError: typeof value.lastError === "string" ? value.lastError : null,
        lastDegradedAt: typeof value.lastDegradedAt === "string" ? value.lastDegradedAt : null,
        lastRecoveredAt: typeof value.lastRecoveredAt === "string" ? value.lastRecoveredAt : null,
    };
}
