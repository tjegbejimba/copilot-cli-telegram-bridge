const TELEGRAM_MESSAGE_MAX = 4096;

export function chunkMessage(text, maxLen = TELEGRAM_MESSAGE_MAX) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLen) {
        let splitAt = remaining.lastIndexOf("\n\n", maxLen);
        if (splitAt <= 0) splitAt = remaining.lastIndexOf("\n", maxLen);
        if (splitAt <= 0) splitAt = maxLen;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).replace(/^\n+/, "");
    }
    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
}

export function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function markdownToTelegramHtml(md) {
    const holds = [];

    function hold(html) {
        const i = holds.length;
        holds.push(html);
        return `\x00${i}\x00`;
    }

    let t = md;

    // Markdown tables: detect lines starting with | and convert to clean aligned <pre>
    t = t.replace(/(?:^\|.+\|[ ]*$\n?)+/gm, (block) => {
        const lines = block.trimEnd().split("\n");
        const rows = lines.map(line =>
            line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim())
        );
        const dataRows = rows.filter(row => !row.every(c => /^[-:]+$/.test(c)));
        if (dataRows.length === 0) return hold(`<pre>${escapeHtml(block.trimEnd())}</pre>`);
        const colCount = Math.max(...dataRows.map(r => r.length));
        const widths = Array.from({ length: colCount }, (_, i) =>
            Math.max(...dataRows.map(r => (r[i] || "").length))
        );
        const formatted = dataRows.map((row, idx) => {
            const padded = row.map((cell, i) => (cell || "").padEnd(widths[i] || 0)).join("  ");
            if (idx === 0) {
                const sep = widths.map(w => "\u2500".repeat(w)).join("\u2500\u2500");
                return padded + "\n" + sep;
            }
            return padded;
        }).join("\n");
        return hold(`<pre>${escapeHtml(formatted)}</pre>`);
    });

    // Fenced code blocks: ```lang\ncode\n```
    t = t.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        code = code.replace(/\n$/, "");
        const cls = lang ? ` class="language-${lang}"` : "";
        return hold(`<pre><code${cls}>${escapeHtml(code)}</code></pre>`);
    });

    t = t.replace(/`([^`\n]+)`/g, (_, code) => {
        return hold(`<code>${escapeHtml(code)}</code>`);
    });

    t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
        const label = alt || "image";
        return hold(`<a href="${escapeHtml(url)}">[${escapeHtml(label)}]</a>`);
    });

    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
        return hold(`<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`);
    });

    t = escapeHtml(t);

    t = t.replace(/\*\*\*(.+?)\*\*\*/g, "<b><i>$1</i></b>");
    t = t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    t = t.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
    t = t.replace(/~~(.+?)~~/g, "<s>$1</s>");

    t = t.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

    t = t.replace(/(?:^&gt;[ ]?.*$\n?)+/gm, (block) => {
        const lines = block.trimEnd().split("\n");
        const content = lines.map(l => l.replace(/^&gt;[ ]?/, "")).join("\n");
        return `<blockquote>${content}</blockquote>\n`;
    });

    t = t.replace(/^-{3,}$/gm, "\u2500".repeat(20));
    t = t.replace(/^\*{3,}$/gm, "\u2500".repeat(20));
    t = t.replace(/^_{3,}$/gm, "\u2500".repeat(20));

    return t.replace(/\x00(\d+)\x00/g, (_, i) => holds[parseInt(i)]);
}
