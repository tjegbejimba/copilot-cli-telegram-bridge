import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildStructuredPrompt,
    parseStructuredInputCallbackData,
    resolveElicitationResponse,
    resolveUserInputResponse,
} from "../structured-input.mjs";

describe("structured input", () => {
    it("renders a single enum field as inline choices", () => {
        const prompt = buildStructuredPrompt({
            question: "Pick one",
            requestedSchema: {
                properties: {
                    database: {
                        type: "string",
                        title: "Database",
                        enum: ["postgres", "sqlite"],
                        enumNames: ["PostgreSQL", "SQLite"],
                    },
                },
            },
        }, { promptId: "p1" });

        assert.match(prompt.text, /Pick one/);
        assert.match(prompt.text, /Database/);
        assert.deepEqual(prompt.inlineKeyboard, [[
            { text: "PostgreSQL", callback_data: "input:p1:0" },
            { text: "SQLite", callback_data: "input:p1:1" },
        ]]);
        assert.deepEqual(prompt.choices.map(choice => choice.value), ["postgres", "sqlite"]);
    });

    it("renders a boolean field as yes/no inline choices", () => {
        const prompt = buildStructuredPrompt({
            message: "Continue?",
            requestedSchema: {
                properties: {
                    proceed: {
                        type: "boolean",
                        title: "Proceed",
                    },
                },
            },
        }, { promptId: "p2" });

        assert.deepEqual(prompt.inlineKeyboard, [[
            { text: "Yes", callback_data: "input:p2:0" },
            { text: "No", callback_data: "input:p2:1" },
        ]]);
        assert.deepEqual(prompt.choices.map(choice => choice.value), [true, false]);
    });

    it("resolves user input choices by number", () => {
        assert.deepEqual(
            resolveUserInputResponse({ question: "Pick", choices: ["red", "blue"] }, "2"),
            { answer: "blue", wasFreeform: false }
        );
    });

    it("resolves elicitation content for schema fields", () => {
        assert.deepEqual(
            resolveElicitationResponse({
                message: "Pick",
                requestedSchema: {
                    properties: {
                        enabled: { type: "boolean" },
                    },
                },
            }, true),
            { action: "accept", content: { enabled: true } }
        );
    });

    it("parses structured input callback data", () => {
        assert.deepEqual(parseStructuredInputCallbackData("input:p1:3"), {
            promptId: "p1",
            choiceIndex: 3,
        });
    });
});
