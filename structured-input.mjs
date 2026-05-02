export function buildStructuredPrompt(request, options = {}) {
    const promptId = options.promptId;
    const message = request.question || request.message || "Input needed:";
    const lines = [message];
    const fields = getSchemaFields(request);

    if (fields.length > 0) {
        lines.push("");
        for (const field of fields) {
            lines.push(renderField(field));
            if (field.description) {
                lines.push(`  → ${field.description}`);
            }
        }
    } else if (Array.isArray(request.choices) && request.choices.length > 0) {
        lines.push("");
        request.choices.forEach((choice, index) => {
            lines.push(`${index + 1}) ${choice}`);
        });
    }

    const choices = getInlineChoices(request);
    const inlineKeyboard = promptId && choices.length > 0
        ? [choices.map((choice, index) => ({
            text: choice.label,
            callback_data: `input:${promptId}:${index}`,
        }))]
        : null;

    if (!inlineKeyboard) {
        lines.push("", "Reply with your choice or answer:");
    }

    return {
        text: lines.join("\n"),
        inlineKeyboard,
        choices,
    };
}

export function parseStructuredInputCallbackData(data) {
    if (typeof data !== "string" || !data.startsWith("input:")) return null;
    const [, promptId, rawIndex] = data.split(":");
    const choiceIndex = Number.parseInt(rawIndex, 10);
    if (!promptId || !Number.isInteger(choiceIndex)) return null;
    return { promptId, choiceIndex };
}

export function resolveUserInputResponse(request, input) {
    const choice = resolveChoiceValue(request, input);
    if (choice.matched) {
        return { answer: String(choice.value), wasFreeform: false };
    }

    return { answer: String(input ?? ""), wasFreeform: true };
}

export function resolveElicitationResponse(request, input) {
    const content = {};
    const fields = getSchemaFields(request);

    if (fields.length === 0) {
        return { action: "accept", content };
    }

    const choice = resolveChoiceValue(request, input);
    if (choice.matched && choice.fieldKey) {
        content[choice.fieldKey] = choice.value;
        return { action: "accept", content };
    }

    const firstField = fields[0];
    content[firstField.key] = coerceValue(input, firstField);
    return { action: "accept", content };
}

export function getInlineChoices(request) {
    const fields = getSchemaFields(request);
    if (fields.length === 1) {
        const field = fields[0];
        const choices = getFieldChoices(field);
        if (choices.length > 0) return choices;
    }

    if (Array.isArray(request.choices) && request.choices.length > 0) {
        return request.choices.map(choice => ({ label: String(choice), value: String(choice) }));
    }

    return [];
}

function getSchemaFields(request) {
    const properties = request.requestedSchema?.properties;
    if (!properties || typeof properties !== "object") return [];

    return Object.entries(properties).map(([key, field]) => ({
        key,
        ...field,
        label: field.title || key,
    }));
}

function renderField(field) {
    const choices = getFieldChoices(field);
    if (choices.length > 0) {
        const lines = [`${field.label}:`];
        choices.forEach((choice, index) => {
            const marker = field.default === choice.value ? " ✓" : "";
            lines.push(`  ${index + 1}) ${choice.label}${marker}`);
        });
        return lines.join("\n");
    }

    const typeLabel = field.type === "boolean" ? "yes/no" : field.type || "value";
    const defaultText = field.default != null ? ` (default: ${field.default})` : "";
    return `${field.label}: ${typeLabel}${defaultText}`;
}

function getFieldChoices(field) {
    if (Array.isArray(field.enum) && field.enum.length > 0) {
        const labels = field.enumNames || field.enum;
        return field.enum.map((value, index) => ({
            label: String(labels[index] ?? value),
            value,
            fieldKey: field.key,
        }));
    }

    if (Array.isArray(field.oneOf) && field.oneOf.length > 0) {
        return field.oneOf.map(option => ({
            label: String(option.title ?? option.const),
            value: option.const,
            fieldKey: field.key,
        }));
    }

    if (field.type === "boolean") {
        return [
            { label: "Yes", value: true, fieldKey: field.key },
            { label: "No", value: false, fieldKey: field.key },
        ];
    }

    return [];
}

function resolveChoiceValue(request, input) {
    const choices = getInlineChoices(request);
    if (choices.length === 0) return { matched: false };

    const raw = String(input ?? "").trim();
    const number = Number.parseInt(raw, 10);
    if (Number.isInteger(number) && number >= 1 && number <= choices.length) {
        return { matched: true, ...choices[number - 1] };
    }

    const match = choices.find(choice =>
        String(choice.label).toLowerCase() === raw.toLowerCase() ||
        String(choice.value).toLowerCase() === raw.toLowerCase()
    );
    return match ? { matched: true, ...match } : { matched: false };
}

function coerceValue(input, field) {
    if (field.type === "boolean") {
        const raw = String(input ?? "").trim().toLowerCase();
        if (["yes", "y", "true", "1"].includes(raw)) return true;
        if (["no", "n", "false", "0"].includes(raw)) return false;
        return Boolean(input);
    }

    if (field.type === "integer") {
        return Number.parseInt(input, 10);
    }

    if (field.type === "number") {
        return Number(input);
    }

    return String(input ?? "");
}
