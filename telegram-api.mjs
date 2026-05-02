const DEFAULT_TELEGRAM_API = "https://api.telegram.org";
const DEFAULT_POLL_TIMEOUT_SECONDS = 30;
const DEFAULT_API_TIMEOUT_MS = 30000;

export function createTelegramApi({
    getBotToken,
    getAbortSignal = () => null,
    fetchFn = fetch,
    telegramApi = DEFAULT_TELEGRAM_API,
    pollTimeoutSeconds = DEFAULT_POLL_TIMEOUT_SECONDS,
    apiTimeoutMs = DEFAULT_API_TIMEOUT_MS,
    markdownToTelegramHtml = text => text,
}) {
    async function callTelegram(method, params = {}) {
        const url = `${telegramApi}/bot${getBotToken()}/${method}`;
        const timeoutMs = method === "getUpdates"
            ? (pollTimeoutSeconds + 10) * 1000
            : apiTimeoutMs;
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const abortSignal = getAbortSignal();
        const signal = method === "getUpdates" && abortSignal
            ? AbortSignal.any([abortSignal, timeoutSignal])
            : timeoutSignal;
        const res = await fetchFn(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
            signal,
        });
        if (res.status === 409) {
            const err = new Error("Conflict: another process is polling this bot");
            err.status = 409;
            throw err;
        }
        if (res.status === 429) {
            const body = await res.json().catch(() => ({}));
            const err = new Error("Rate limited");
            err.status = 429;
            err.retryAfter = body?.parameters?.retry_after || 5;
            throw err;
        }
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            const err = new Error(`Telegram API ${method} failed: ${res.status} ${body}`);
            err.status = res.status;
            throw err;
        }
        const json = await res.json();
        if (!json.ok) throw new Error(`Telegram API ${method} returned ok=false: ${JSON.stringify(json)}`);
        return json.result;
    }

    function getMe() { return callTelegram("getMe"); }

    function getUpdates(offset, timeout) {
        return callTelegram("getUpdates", { offset, timeout, allowed_updates: ["message", "edited_message", "callback_query"] });
    }

    function sendMessage(chatId, text, parseMode) {
        const params = { chat_id: chatId, text };
        if (parseMode) params.parse_mode = parseMode;
        return callTelegram("sendMessage", params);
    }

    async function sendFormattedMessage(chatId, markdown) {
        const html = markdownToTelegramHtml(markdown);
        try {
            return await callTelegram("sendMessage", {
                chat_id: chatId, text: html, parse_mode: "HTML",
            });
        } catch (err) {
            if (err.message && /can.t parse|entit/i.test(err.message)) {
                return callTelegram("sendMessage", { chat_id: chatId, text: markdown });
            }
            throw err;
        }
    }

    function sendChatAction(chatId, action = "typing") {
        return callTelegram("sendChatAction", { chat_id: chatId, action });
    }

    function editMessageText(chatId, messageId, text, parseMode) {
        const params = { chat_id: chatId, message_id: messageId, text };
        if (parseMode) params.parse_mode = parseMode;
        return callTelegram("editMessageText", params);
    }

    function deleteMessage(chatId, messageId) {
        return callTelegram("deleteMessage", { chat_id: chatId, message_id: messageId });
    }

    function setMessageReaction(chatId, messageId, emoji) {
        return callTelegram("setMessageReaction", {
            chat_id: chatId, message_id: messageId,
            reaction: [{ type: "emoji", emoji }],
        });
    }

    function getFile(fileId) {
        return callTelegram("getFile", { file_id: fileId });
    }

    function setMyCommands(commands) {
        return callTelegram("setMyCommands", { commands });
    }

    return {
        callTelegram,
        getMe,
        getUpdates,
        sendMessage,
        sendFormattedMessage,
        sendChatAction,
        editMessageText,
        deleteMessage,
        setMessageReaction,
        getFile,
        setMyCommands,
    };
}
