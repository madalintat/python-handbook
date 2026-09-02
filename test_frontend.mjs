/* Smallest thing that fails if the tokenizer breaks. Run: node test_frontend.mjs */
import assert from "node:assert/strict";
import { highlightPython as hl, esc, cutStarter, derive, toFocus, fromFocus, shownRowOf }
  from "./assets/workbench.js";

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
has('s = "hi"', "tk-str", "&quot;hi&quot;");
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
// and so must quotes: esc() feeds attribute values, where an unescaped quote
// closes the attribute and a crafted search URL runs script in the page
ok(esc(`"'`) === "&quot;&#39;", "esc() let a quote through");
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




/* Focus mode hides the code an earlier stage wrote, which means taking it out
   of the textarea, which means the only copy of it is the model below. Every
   check here is about the same thing: nothing the reader typed can be lost. */
{
  const starter = ["import os", "", "def carried():", "    return 1", "",
                   "def mine():", "    raise NotImplementedError", "",
                   "def also_carried():", "    return 2"].join("\n");
  const parts = cutStarter(starter, [[6, 7]]);
  ok(parts.length === 2, "the work has carried code on both sides of it");

  const segs = derive(starter, parts);
  ok(segs !== null, "the carried regions are found in the starter");
  ok(fromFocus(toFocus(segs), segs) === starter, "focus round trips untouched");

  const focus = toFocus(segs);
  ok(focus.split("\n").length < starter.split("\n").length, "focus is shorter");
  ok(focus.includes("def mine():"), "focus keeps the work");
  ok(!focus.includes("def carried():"), "focus hides what was carried");

  const whole = fromFocus(focus.replace("    raise NotImplementedError", "    return 42"), segs);
  ok(whole.includes("    return 42"), "an edit made in focus survives leaving it");
  ok(whole.includes("def carried():") && whole.includes("def also_carried():"),
     "and the carried code comes back");
  ok(whole.indexOf("def carried():") < whole.indexOf("return 42")
     && whole.indexOf("return 42") < whole.indexOf("def also_carried():"),
     "in the order it was in");

  const grown = fromFocus(
    focus.replace("    raise NotImplementedError", "    a = 1\n    b = 2"), segs);
  ok(grown.includes("    a = 1") && grown.includes("    b = 2"), "added lines survive");

  // a reader who deletes a fold line has merged two regions. that is allowed to
  // put text in the wrong place; it is not allowed to lose it.
  const mangled = focus.split("\n").filter(l => !/you already built/.test(l)).join("\n");
  const saved = fromFocus(mangled, segs);
  ok(saved.includes("def mine():"), "deleting a fold line loses no work");
  ok(saved.includes("def carried():"), "and still restores the carried code");

  // the split is re-derived, so a full-mode edit does not strand focus mode
  const again = derive(whole.replace("    return 42", "    return 43"), parts);
  ok(again !== null, "the split survives an edit made outside focus");
  ok(toFocus(again).includes("return 43"), "and picks up the new text");

  // rewriting carried code turns focus off rather than guessing
  ok(derive(starter.replace("def carried():", "def renamed():"), parts) === null,
     "a rewritten carried region gives up instead of guessing");

  /* Where a whole-file line is showing while focus is on. Everything that
     crosses this editor's edge speaks in whole-file lines: the judges, the
     build's work marks, the outline. Getting this wrong points a reader at the
     wrong row, or at no row, and says nothing about it. */
  {
    const segs2 = derive(starter, parts);
    const shown = toFocus(segs2);
    const at = (n) => shownRowOf(segs2, shown, n);
    ok(at(6) === 2, "the first work line is on row 2, under one fold");
    ok(at(7) === 3, "and the second is under it");
    ok(at(1) === 1 && at(5) === 1, "everything folded lands on its fold row");
    ok(at(9) === 4 && at(10) === 4, "and so does the fold after the work");

    /* Once the reader adds lines, both files get longer. The whole file is
       what the judges see, because they run code(), so line 9 of it is now the
       reader's third new line rather than the carried code that used to be
       there. Both sides move together, which is the property that makes an
       error on line 9 land on the row showing line 9. */
    const grown = shown.replace("    raise NotImplementedError",
                                "    a = 1\n    b = 2\n    c = 3");
    ok(shownRowOf(segs2, grown, 6) === 2, "the work still starts where it did");
    ok(shownRowOf(segs2, grown, 9) === 5, "the last line they typed is the last row");
    ok(shownRowOf(segs2, grown, 10) === 6,
       "and the fold below has moved down by exactly what was typed");
  }

  /* The marks have to survive an edit, or fixing one typo costs the reader the
     outline and the jump for good. They are located again rather than dropped. */
  {
    const edited = starter.replace("    raise NotImplementedError",
                                   "    a = 1\n    b = 2\n    return a + b");
    const segs3 = derive(edited, parts);
    ok(segs3 !== null, "the split is found again in edited text");
    const moved = [];
    let at = 1;
    for (const seg of segs3) {
      if (!seg.carried) for (let i = 0; i < seg.lines.length; i++) moved.push(at + i);
      at += seg.lines.length;
    }
    ok(moved.length === 4, "two lines of work became four");
    ok(moved[0] === 6, "and still start where they did");
    const lines = edited.split("\n");
    ok(moved.every(n => !lines[n - 1].startsWith("def carried")),
       "no mark landed on code an earlier stage wrote");
  }

  // several regions, each edit landing in its own slot
  const multi = ["a", "W1", "b", "b2", "W2", "c"].join("\n");
  const msegs = derive(multi, cutStarter(multi, [[2, 2], [5, 5]]));
  ok(fromFocus(toFocus(msegs), msegs) === multi, "many regions round trip");
  ok(fromFocus(toFocus(msegs).replace("W1", "X1").replace("W2", "X2"), msegs)
     === ["a", "X1", "b", "b2", "X2", "c"].join("\n"),
     "and each edit lands in its own region");
}

console.log(`tokenizer, renderer and focus mode: ${checks} checks clean`);