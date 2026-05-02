export function classifyPollingConflict({ lock, currentSessionId, lockIsStale }) {
    if (!lock) return "retry";
    if (lock.sessionId === currentSessionId) return "retry";
    return lockIsStale ? "retry" : "release";
}
