import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { createBotStorage } from "../bot-storage.mjs";

const tmpRoots = [];

function createTempRoot() {
    const root = mkdtempSync(join(tmpdir(), "telegram-bridge-storage-"));
    tmpRoots.push(root);
    return root;
}

afterEach(() => {
    for (const root of tmpRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe("bot storage", () => {
    it("persists bot affinity per working directory", () => {
        const extensionDir = createTempRoot();
        const cwd = join(extensionDir, "repo");
        const storage = createBotStorage({ extensionDir, getCwd: () => cwd });

        storage.setAffinity("work-bot");

        assert.equal(storage.getAffinity(), "work-bot");
    });

    it("tracks lock freshness and only removes locks owned by the session", () => {
        const extensionDir = createTempRoot();
        const storage = createBotStorage({
            extensionDir,
            processId: 12345,
            isProcessAlive: pid => pid === 12345,
        });
        mkdirSync(storage.botDir("work-bot"), { recursive: true });

        storage.writeLock("work-bot", "session-a");
        const lock = storage.readLock("work-bot");

        assert.equal(storage.isLockStale(lock), false);

        storage.removeLock("work-bot", "session-b");
        assert.equal(storage.readLock("work-bot")?.sessionId, "session-a");

        storage.removeLock("work-bot", "session-a");
        assert.equal(storage.readLock("work-bot"), null);
        assert.equal(
            createBotStorage({ extensionDir, isProcessAlive: () => false }).isLockStale(lock),
            true
        );
    });
});
