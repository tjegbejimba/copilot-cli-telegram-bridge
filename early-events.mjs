const CAPTURED_TYPES = new Set([
    "session.start",
    "session.resume",
    "session.error",
    "session.warning",
    "session.shutdown",
]);

export function createEarlyEventBuffer(options = {}) {
    const maxEvents = options.maxEvents ?? 20;
    const events = [];

    return {
        record(event) {
            const message = formatEarlyEvent(event);
            if (!message) return false;

            events.push(message);
            if (events.length > maxEvents) {
                events.shift();
            }
            return true;
        },

        flush() {
            return events.splice(0, events.length);
        },
    };
}

function formatEarlyEvent(event) {
    if (!event || !CAPTURED_TYPES.has(event.type)) return null;

    if (event.type === "session.error") {
        const errorType = event.data?.errorType || "Error";
        const message = event.data?.message || "Unknown error";
        return `❗ Early session error: ${errorType}: ${message}`;
    }

    if (event.type === "session.warning") {
        const message = event.data?.message || "Unknown warning";
        return `⚠️ Early session warning: ${message}`;
    }

    return `ℹ️ Early session event: ${event.type}`;
}
