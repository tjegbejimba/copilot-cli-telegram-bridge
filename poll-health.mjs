export function createPollHealthTracker(options = {}) {
    const threshold = options.threshold ?? 3;
    let consecutiveFailures = 0;
    let degraded = false;
    let degradedAt = null;

    return {
        recordFailure({ now = Date.now() } = {}) {
            consecutiveFailures++;

            if (!degraded && consecutiveFailures >= threshold) {
                degraded = true;
                degradedAt = now;
                return {
                    type: "degraded",
                    failures: consecutiveFailures,
                    degradedAt,
                };
            }

            return null;
        },

        recordSuccess({ now = Date.now() } = {}) {
            if (!degraded) {
                consecutiveFailures = 0;
                return null;
            }

            const event = {
                type: "recovered",
                failures: consecutiveFailures,
                degradedMs: now - degradedAt,
            };

            consecutiveFailures = 0;
            degraded = false;
            degradedAt = null;
            return event;
        },
    };
}
