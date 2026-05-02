import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    createBotRecord,
    loadBotToken,
} from "../token-store.mjs";

describe("token store", () => {
    const fakeCrypto = {
        protect: (secret) => `protected:${secret}`,
        unprotect: (ciphertext) => ciphertext.replace(/^protected:/, ""),
        kind: "test-protected",
    };

    it("creates bot records without a plaintext token field", () => {
        const record = createBotRecord({
            token: "123:abc",
            username: "mybot",
            addedAt: "now",
        }, fakeCrypto);

        assert.equal("token" in record, false);
        assert.deepEqual(record.tokenProtected, {
            kind: "test-protected",
            value: "protected:123:abc",
        });
    });

    it("loads and migrates a legacy plaintext token record", () => {
        const loaded = loadBotToken({
            token: "123:abc",
            username: "mybot",
        }, fakeCrypto);

        assert.equal(loaded.token, "123:abc");
        assert.equal(loaded.migrated, true);
        assert.equal("token" in loaded.record, false);
        assert.equal(loaded.record.tokenProtected.value, "protected:123:abc");
    });

    it("loads protected token records", () => {
        const loaded = loadBotToken({
            username: "mybot",
            tokenProtected: {
                kind: "test-protected",
                value: "protected:123:abc",
            },
        }, fakeCrypto);

        assert.equal(loaded.token, "123:abc");
        assert.equal(loaded.migrated, false);
    });
});
