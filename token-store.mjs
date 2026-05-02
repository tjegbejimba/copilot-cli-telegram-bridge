import { execFileSync } from "node:child_process";

export function createBotRecord({ token, ...metadata }, protector = defaultProtector()) {
    return {
        ...metadata,
        tokenProtected: {
            kind: protector.kind,
            value: protector.protect(token),
        },
    };
}

export function loadBotToken(record, protector = defaultProtector()) {
    if (!record || typeof record !== "object") {
        throw new Error("Bot registry record is missing");
    }

    if (typeof record.token === "string") {
        const { token, ...metadata } = record;
        return {
            token,
            migrated: true,
            record: createBotRecord({ ...metadata, token }, protector),
        };
    }

    if (record.tokenProtected?.kind && typeof record.tokenProtected.value === "string") {
        return {
            token: protector.unprotect(record.tokenProtected.value, record.tokenProtected.kind),
            migrated: false,
            record,
        };
    }

    throw new Error("Bot registry record does not contain a token");
}

function defaultProtector() {
    if (process.platform !== "win32") {
        return {
            kind: "plain",
            protect: (secret) => secret,
            unprotect: (secret) => secret,
        };
    }

    return {
        kind: "dpapi-user",
        protect: protectWithDpapi,
        unprotect: unprotectWithDpapi,
    };
}

function protectWithDpapi(secret) {
    const script = [
        "Add-Type -AssemblyName System.Security",
        "$plain = [Console]::In.ReadToEnd()",
        "$bytes = [Text.Encoding]::UTF8.GetBytes($plain)",
        "$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "[Convert]::ToBase64String($protected)",
    ].join("; ");
    return runPowerShell(script, secret);
}

function unprotectWithDpapi(ciphertext, kind) {
    if (kind !== "dpapi-user") {
        throw new Error(`Unsupported token protection kind: ${kind}`);
    }

    const script = [
        "Add-Type -AssemblyName System.Security",
        "$cipher = [Console]::In.ReadToEnd()",
        "$protected = [Convert]::FromBase64String($cipher)",
        "$bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "[Text.Encoding]::UTF8.GetString($bytes)",
    ].join("; ");
    return runPowerShell(script, ciphertext);
}

function runPowerShell(script, input) {
    return execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
            input,
            encoding: "utf8",
            timeout: 10000,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
        }
    ).trim();
}
