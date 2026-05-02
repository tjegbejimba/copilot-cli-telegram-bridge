import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chunkMessage, escapeHtml, markdownToTelegramHtml } from "../telegram-format.mjs";

describe("telegram formatting", () => {
    it("escapes html text", () => {
        assert.equal(escapeHtml("<b>&</b>"), "&lt;b&gt;&amp;&lt;/b&gt;");
    });

    it("converts markdown tables to aligned preformatted text", () => {
        const html = markdownToTelegramHtml("| Name | Count |\n|---|---|\n| A | 2 |");

        assert.match(html, /^<pre>/);
        assert.match(html, /Name  Count/);
        assert.match(html, /A     2/);
    });

    it("preserves fenced code as escaped preformatted code", () => {
        assert.equal(
            markdownToTelegramHtml("```js\nif (a < b) {}\n```"),
            '<pre><code class="language-js">if (a &lt; b) {}</code></pre>'
        );
    });

    it("chunks long text on paragraph boundaries", () => {
        assert.deepEqual(chunkMessage("first\n\nsecond", 8), ["first", "second"]);
    });
});
