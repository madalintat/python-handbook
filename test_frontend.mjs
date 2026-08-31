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

console.log("tokenizer: 14 checks clean");
