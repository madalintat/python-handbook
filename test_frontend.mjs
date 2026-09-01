/* Smallest thing that fails if the tokenizer breaks. Run: node test_frontend.mjs */
import assert from "node:assert/strict";
import { highlightPython as hl } from "./assets/workbench.js";

const has = (src, cls, text) =>
  assert.ok(hl(src).includes(`<span class="${cls}">${text}</span>`),
    `expected ${cls}:${text} in ${JSON.stringify(hl(src))}`);

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
assert.ok(!hl('s = "# no"').includes("tk-com"), "# inside a string became a comment");
// a keyword inside a string is not a keyword
assert.ok(!hl('s = "def"').includes("tk-kw"), "keyword inside a string was highlighted");
// html in source must be escaped, never emitted raw
assert.ok(!hl("x = '<script>'").includes("<script>"), "source html was not escaped");
// triple-quoted strings survive newlines
assert.ok(hl('"""a\nb"""').includes('tk-str'), "triple-quoted string not tokenized");
// round trip: stripping tags must give back the source (plus the escaping)
const src = "def f(x):\n    # hi\n    return x + 1\n";
const back = hl(src).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
assert.equal(back, src, "tokenizer lost or duplicated characters");

/* The note renderer. app.js only touches the DOM inside start(), which index.html
   calls and this file does not, so importing it here is enough. */
import { md } from "./assets/app.js";

const renders = (src, want, why) =>
  assert.ok(md(src).includes(want), `${why}\n  wanted ${want}\n  in ${md(src)}`);

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

console.log("tokenizer + renderer: 23 checks clean");
