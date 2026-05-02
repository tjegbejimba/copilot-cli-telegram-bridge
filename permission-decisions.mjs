export function parsePermissionCallbackData(data) {
    if (typeof data !== "string") return null;

    if (data.startsWith("perm:")) {
        const parts = data.split(":");
        const action = parts[1];
        const requestId = parts.slice(2).join(":");
        if (!action || !requestId) return null;
        return { action, requestId };
    }

    if (data.startsWith("perm_")) {
        const [legacyAction, requestId] = data.split(":");
        if (!requestId) return null;
        return {
            action: legacyAction === "perm_allow" ? "once" : "reject",
            requestId,
        };
    }

    return null;
}

export function getPermissionActions(request, options = {}) {
    const actions = [{ id: "once", label: "✅ Allow once" }];

    if (buildSessionApproval(request)) {
        actions.push({ id: "session", label: "✅ Allow session" });
    }

    if (options.locationKey && buildLocationApproval(request)) {
        actions.push({ id: "location", label: "✅ Allow here" });
    }

    actions.push({ id: "reject", label: "❌ Deny" });
    return actions;
}

export function buildPermissionDecision(action, request, options = {}) {
    if (action === "once") {
        return { kind: "approve-once" };
    }

    if (action === "reject") {
        return options.feedback ? { kind: "reject", feedback: options.feedback } : { kind: "reject" };
    }

    if (action === "session") {
        const approval = buildSessionApproval(request);
        return approval ? { kind: "approve-for-session", approval } : null;
    }

    if (action === "location") {
        const approval = buildLocationApproval(request);
        if (!approval || !options.locationKey) return null;
        return { kind: "approve-for-location", approval, locationKey: options.locationKey };
    }

    return null;
}

function buildSessionApproval(request) {
    if (!request || typeof request.kind !== "string") return null;

    switch (request.kind) {
        case "shell": {
            if (request.canOfferSessionApproval !== true) return null;
            const commandIdentifiers = uniqueCommandIdentifiers(request.commands);
            return commandIdentifiers.length > 0
                ? { kind: "commands", commandIdentifiers }
                : null;
        }
        case "write":
            return request.canOfferSessionApproval === true ? { kind: "write" } : null;
        case "read":
            return { kind: "read" };
        case "mcp":
            return typeof request.serverName === "string"
                ? { kind: "mcp", serverName: request.serverName, toolName: request.toolName ?? null }
                : null;
        case "memory":
            return { kind: "memory" };
        case "custom-tool":
            return typeof request.toolName === "string"
                ? { kind: "custom-tool", toolName: request.toolName }
                : null;
        default:
            return null;
    }
}

function buildLocationApproval(request) {
    return buildSessionApproval(request);
}

function uniqueCommandIdentifiers(commands) {
    if (!Array.isArray(commands)) return [];

    const seen = new Set();
    const identifiers = [];
    for (const command of commands) {
        const identifier = command?.identifier;
        if (typeof identifier !== "string" || identifier.length === 0 || seen.has(identifier)) {
            continue;
        }
        seen.add(identifier);
        identifiers.push(identifier);
    }
    return identifiers;
}
