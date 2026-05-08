function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultDroppedErrorLogger(err, context) {
    const label = context ? `${context} ` : "";
    console.warn(`telegram-bridge: dropped ${label}send: ${err.message}`);
}

export function createSendQueue({
    paceMs = 0,
    sleepFn = defaultSleep,
    onDroppedError = defaultDroppedErrorLogger,
} = {}) {
    const queue = [];
    const idleResolvers = [];
    let running = false;

    function enqueue(fn) {
        const promise = new Promise((resolve, reject) => {
            queue.push({ fn, resolve, reject });
            if (!running) {
                drainQueue();
            }
        });
        return promise;
    }

    function enqueueDetached(fn, context) {
        enqueue(fn).catch(err => onDroppedError(err, context));
    }

    function onIdle() {
        if (!running && queue.length === 0) {
            return Promise.resolve();
        }
        return new Promise(resolve => idleResolvers.push(resolve));
    }

    function resolveIdleIfNeeded() {
        if (running || queue.length > 0) return;
        const resolvers = idleResolvers.splice(0, idleResolvers.length);
        for (const resolve of resolvers) {
            resolve();
        }
    }

    async function drainQueue() {
        running = true;
        try {
            while (queue.length > 0) {
                const { fn, resolve, reject } = queue.shift();
                try {
                    const result = await fn();
                    resolve(result);
                } catch (err) {
                    if (err.status === 429) {
                        queue.unshift({ fn, resolve, reject });
                        await sleepFn((err.retryAfter || 5) * 1000);
                        continue;
                    }
                    reject(err);
                }
                if (queue.length > 0 && paceMs > 0) {
                    await sleepFn(paceMs);
                }
            }
        } finally {
            running = false;
            resolveIdleIfNeeded();
        }
    }

    return {
        enqueue,
        enqueueDetached,
        onIdle,
    };
}
