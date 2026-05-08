const DEFAULT_KEEPALIVE_INTERVAL_MS = 60000;

export function createExtensionKeepAlive({
    intervalMs = DEFAULT_KEEPALIVE_INTERVAL_MS,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
} = {}) {
    let handle = null;

    return {
        start() {
            if (handle) return;
            handle = setIntervalFn(() => {}, intervalMs);
        },

        stop() {
            if (!handle) return;
            clearIntervalFn(handle);
            handle = null;
        },
    };
}
