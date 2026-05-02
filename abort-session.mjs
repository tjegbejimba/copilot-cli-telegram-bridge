export async function abortCurrentTurn(session, options = {}) {
    if (!session || typeof session.abort !== "function") {
        throw new Error("session.abort is not available");
    }

    const timeoutMs = options.timeoutMs ?? 10000;
    const abortAction = session.abort();
    const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("abort timed out")), timeoutMs);
    });

    return Promise.race([abortAction, timeout]);
}
