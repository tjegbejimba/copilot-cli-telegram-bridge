export async function handleTelegramBridgeCommand(command, chatId, deps) {
    switch (command.name) {
        case "help":
            await deps.sendMessage(chatId, deps.renderHelp());
            return;
        case "status":
            await deps.sendMessage(chatId, deps.getStatusHtml(), "HTML");
            return;
        case "health":
            await deps.sendMessage(chatId, deps.getHealthHtml(), "HTML");
            return;
        case "stop":
            await deps.stop();
            await deps.sendMessage(chatId, "⏹️ Stop requested.");
            return;
        case "compact": {
            const message = await deps.toggleCompact();
            await deps.sendMessage(chatId, message);
            return;
        }
        case "disconnect":
            if (!isConnected(deps)) {
                await deps.sendMessage(chatId, "Telegram bridge is not connected.");
            } else {
                await deps.disconnect();
            }
            return;
        case "reconnect":
            await deps.reconnect(chatId);
            return;
        case "command": {
            const result = deps.resolveCommand(command.args);
            if (!result.ok) {
                await deps.sendMessage(chatId, result.error);
                return;
            }
            deps.markPromptForwarded();
            await deps.sendMessage(chatId, `Forwarding ${result.prompt} to Copilot CLI.`);
            await deps.sendPrompt(result.prompt);
            return;
        }
        case "synccommands":
            await deps.syncCommands();
            await deps.sendMessage(chatId, "Telegram command menu sync requested.");
            return;
        default:
            await deps.sendMessage(chatId, `Unknown command /${command.name}. Use /help for Telegram bridge commands.`);
            return;
    }
}

function isConnected(deps) {
    return typeof deps.connected === "function" ? deps.connected() : Boolean(deps.connected);
}
