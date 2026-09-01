/* Smallest thing that fails if the tokenizer breaks. Run: node test_frontend.mjs */
import assert from "node:assert/strict";
import { highlightPython as hl } from "./assets/workbench.js";

let checks = 0;
const has = (src, cls, text) => {
  checks++;
  ok(hl(src).includes(`<span class="${cls}">${text}</span>`),
    `expected ${cls}:${text} in ${JSON.stringify(hl(src))}`);
};
const ok = (cond, why) => { checks++; assert.ok(cond, why); };

has("def foo():", "tk-kw", "def");
has("def foo():", "tk-def", " foo");
has("x = 42", "tk-num", "42");
has('s = "hi"', "tk-str", '"hi"');
has("# note", "tk-com", "# note");
has("@cache", "tk-dec", "@cache");
has("print(x)", "tk-bi", "print");
has("self.x", "tk-self", "self");
has("if a is b:", "tk-kw", "is");

// a # inside a string is not a comment
ok(!hl('s = "# no"').includes("tk-com"), "# inside a string became a comment");
// a keyword inside a string is not a keyword
ok(!hl('s = "def"').includes("tk-kw"), "keyword inside a string was highlighted");
// html in source must be escaped, never emitted raw
ok(!hl("x = '<script>'").includes("<script>"), "source html was not escaped");
// triple-quoted strings survive newlines
ok(hl('"""a\nb"""').includes('tk-str'), "triple-quoted string not tokenized");
// round trip: stripping tags must give back the source (plus the escaping)
const src = "def f(x):\n    # hi\n    return x + 1\n";
const back = hl(src).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
ok(back === src, "tokenizer lost or duplicated characters");

/* The note renderer. app.js only touches the DOM inside start(), which index.html
   calls and this file does not, so importing it here is enough. */
import { md } from "./assets/app.js";

const renders = (src, want, why) => {
  checks++;
  assert.ok(md(src).includes(want), `${why}\n  wanted ${want}\n  in ${md(src)}`);
};

renders("- a\n- b\n", "<ul><li>a</li><li>b</li></ul>", "bulleted list");
renders("1. a\n2. b\n", "<ol><li>a</li><li>b</li></ol>", "numbered list");
// a numbered list following a bulleted one is a second list, not more items
renders("- a\n1. b\n", "<ul><li>a</li></ul>", "list kinds must not merge");
renders("- a\n1. b\n", "<ol><li>b</li></ol>", "list kinds must not merge");
renders("## Head\n", "<h2", "heading");
renders("| a | b |\n| - | - |\n| 1 | 2 |\n", "<table>", "table");
renders("```py\nx = 1\n```\n", "tk-num", "fenced code is highlighted");
renders("plain words\n", "<p>plain words</p>", "paragraph");
// a numbered line inside a paragraph still ends it, so the list is not swallowed
renders("words\n1. a\n", "<ol><li>a</li></ol>", "numbered list ends a paragraph");

/* build.py's UNSUPPORTED_MARKDOWN refuses these constructs because md() cannot
   draw them. That is a contract across two languages, and this is the half that
   proves the renderer really cannot: for each one, the element it exists to
   produce must not appear. Teach md() one of them and forget to lift the ban,
   and this fails.

   `![alt](x.png)` is the instructive case: md() emits `!<a href="x.png">alt</a>`,
   a stray exclamation mark followed by a link, which is worse than raw source
   and is the reason the ban is there. */
const CANNOT_RENDER = [
  ["blockquote", "> quoted\n", "<blockquote"],
  ["image", "![alt](x.png)\n", "<img"],
  ["heading deeper than ####", "##### deep\n", "<h5"],
  ["setext heading", "Title\n=====\n", "<h1"],
  ["html block", "<div>raw</div>\n", "<div>"],
  ["footnote", "[^1]: a note\n", "<sup"],
];
for (const [name, src, element] of CANNOT_RENDER) {
  checks++;
  assert.ok(!md(src).includes(element),
    `md() now renders ${name} as ${element}; build.py still refuses it in UNSUPPORTED_MARKDOWN`);
}

console.log(`tokenizer + renderer: ${checks} checks clean`);
