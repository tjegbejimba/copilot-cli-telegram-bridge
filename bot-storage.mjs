import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function loadJsonOrDefault(filePath, defaultValue) {
    try {
        return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (err) {
        if (err.code === "ENOENT") return structuredClone(defaultValue);
        if (err instanceof SyntaxError) {
            console.warn(`telegram-bridge: corrupted JSON in ${filePath}, using defaults`);
            return structuredClone(defaultValue);
        }
        throw err;
    }
}

export function saveJsonAtomic(filePath, data, mode) {
    const tmp = filePath + ".tmp";
    const opts = mode != null ? { mode } : undefined;
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", opts);
    renameSync(tmp, filePath);
}

export function createBotStorage({
    extensionDir,
    getCwd = () => process.env.COPILOT_CWD || process.cwd(),
    processId = process.pid,
    isProcessAlive = defaultIsProcessAlive,
}) {
    const botsDir = join(extensionDir, "bots");
    const affinityPath = join(extensionDir, "affinity.json");

    function botDir(name) { return join(botsDir, name); }
    function botStatePath(name) { return join(botDir(name), "state.json"); }
    function botLockPath(name) { return join(botDir(name), "lock.json"); }

    function getAffinity() {
        const map = loadJsonOrDefault(affinityPath, {});
        return map[getCwd()] || null;
    }

    function setAffinity(botName) {
        const map = loadJsonOrDefault(affinityPath, {});
        map[getCwd()] = botName;
        saveJsonAtomic(affinityPath, map);
    }

    function readLock(name) {
        const data = loadJsonOrDefault(botLockPath(name), null);
        if (!data || !data.pid || !data.sessionId) return null;
        return data;
    }

    function writeLock(name, sessionId) {
        saveJsonAtomic(botLockPath(name), {
            pid: processId,
            sessionId,
            connectedAt: new Date().toISOString(),
        });
    }

    function removeLock(name, sessionId) {
        const lock = readLock(name);
        if (lock && lock.sessionId === sessionId) {
            try { rmSync(botLockPath(name), { force: true }); } catch {}
        }
    }

    function isLockStale(lock) {
        if (!lock) return true;
        return !isProcessAlive(lock.pid);
    }

    return {
        affinityPath,
        botsDir,
        botDir,
        botStatePath,
        botLockPath,
        getAffinity,
        setAffinity,
        readLock,
        writeLock,
        removeLock,
        isLockStale,
    };
}

function defaultIsProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
