/* The workbench: a Python tokenizer, three judges, and the reading of their verdict.

   Everything here runs in the browser. Nothing the learner writes is sent anywhere. */

import Vim from "./vim.js";

// The three judges are described once, by build.py, and shipped as
// data/judges.json. Fetching it rather than restating it here is what stops the
// browser calling something clean that --validate would have failed.
export const judges = () => cached("judges", () => fetch("data/judges.json").then(r => r.json()));

/* ------------------------------------------------------------------ tokenizer */

const KEYWORDS = new Set(("False None True and as assert async await break class continue def del elif " +
  "else except finally for from global if import in is lambda nonlocal not or pass raise return try " +
  "while with yield match case").split(" "));

const BUILTINS = new Set(("abs aiter all any ascii bin bool bytearray bytes callable chr classmethod compile " +
  "complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr " +
  "hash help hex id input int isinstance issubclass iter len list locals map max memoryview min next object " +
  "oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum " +
  "super tuple type vars zip Exception ValueError TypeError KeyError IndexError AttributeError NameError " +
  "RuntimeError StopIteration AssertionError ZeroDivisionError UnboundLocalError").split(" "));

// Quotes too, not only the three that matter in text: this one function feeds
// attribute values as well (a search query into `value`, a stage title into
// `title`), and a quote that passes through unescaped closes the attribute and
// opens the page to whatever follows it in the URL.
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = s => s.replace(/[&<>"']/g, c => ESC[c]);

// Markdown-ish inline formatting, used by the notes, the exercise prompts and
// the diagnose readings. One definition: a second copy drifts.
export const inline = s => esc(s)
  .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

// order matters: comments and triple-quoted strings must win over everything after them
const TOKEN = new RegExp([
  /(?<com>#[^\n]*)/,
  /(?<tstr>[rbfuRBFU]{0,2}(?<tq>"""|''')[\s\S]*?\k<tq>)/,
  /(?<str>[rbfuRBFU]{0,2}(?<q>"|')(?:\\.|(?!\k<q>)[^\\\n])*\k<q>)/,
  /(?<dec>^[ \t]*@[\w.]+)/,
  /(?<defn>\b(?:def|class)\s+\w+)/,
  /(?<num>\b(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*\.?[\d_]*(?:[eE][-+]?\d+)?)\b)/,
  /(?<word>\b[A-Za-z_]\w*\b)/,
].map(r => r.source).join("|"), "gm");

export function highlightPython(src) {
  let out = "", last = 0;
  for (const m of src.matchAll(TOKEN)) {
    out += esc(src.slice(last, m.index));
    const g = m.groups;
    const t = m[0];
    if (g.com) out += `<span class="tk-com">${esc(t)}</span>`;
    else if (g.tstr || g.str) out += `<span class="tk-str">${esc(t)}</span>`;
    else if (g.dec) out += `<span class="tk-dec">${esc(t)}</span>`;
    else if (g.num) out += `<span class="tk-num">${esc(t)}</span>`;
    else if (g.defn) {
      const [kw, name] = [t.slice(0, t.search(/\s/)), t.slice(t.search(/\s/))];
      out += `<span class="tk-kw">${kw}</span><span class="tk-def">${esc(name)}</span>`;
    } else if (g.word) {
      if (KEYWORDS.has(t)) out += `<span class="tk-kw">${t}</span>`;
      else if (t === "self" || t === "cls") out += `<span class="tk-self">${t}</span>`;
      else if (BUILTINS.has(t)) out += `<span class="tk-bi">${t}</span>`;
      else out += esc(t);
    } else out += esc(t);
    last = m.index + t.length;
  }
  return out + esc(src.slice(last));
}

/* ------------------------------------------------------------------ judge 1: ruff */

// Memoise the success, never the failure. `p ||= f()` caches a rejected promise
// forever, which turns one flaky CDN fetch into a judge that is dead for the session.
const memo = {};
export const cached = (key, make) => {
  memo[key] ||= make().catch(err => { memo[key] = null; throw err; });
  return memo[key];
};

// Dropping a resolved entry so the next call rebuilds it. Here rather than at
// the call site, because `memo` is this function's and the keys are its own.
cached.forget = (...keys) => { for (const k of keys) memo[k] = null; };

/* A Pyodide that resolved and later died is still cached, and every call after
   that reports "already fatally failed" for the life of the tab. runner.py keeps
   ordinary runaway recursion from getting here, but a big enough allocation
   still can, so drop the interpreter and let the next run build a fresh one
   instead of leaving the page permanently unable to judge anything. */
const forgetIfFatal = err => {
  if (/fatally failed|call stack size exceeded|memory access out of bounds/i.test(err?.message || "")) {
    // "mypy" is installed into the same interpreter "py" holds, so it dies with it
    cached.forget("py", "mypy");
  }
};

async function getRuff() {
  return cached("ruff", async () => {
    const { ruff } = await judges();
    const mod = await import(`${ruff.cdn}ruff_wasm.js`);
    await mod.default(`${ruff.cdn}ruff_wasm_bg.wasm`);
    const settings = {
      "line-length": ruff.lineLength,
      "indent-width": 4,
      "target-version": ruff.targetVersion,
      lint: { select: ruff.select, ignore: ruff.ignore },
    };
    // 0.16 takes a position encoding; older builds take one argument. Try both.
    try { return new mod.Workspace(settings, mod.PositionEncoding.Utf32); }
    catch { return new mod.Workspace(settings); }
  });
}

async function judgeRuff(src) {
  const ws = await getRuff();
  return (ws.check(src) || [])
    .filter(d => d.code)
    .map(d => ({ code: d.code, message: d.message, line: d.start_location?.row ?? 0 }));
}

/* ------------------------------------------------------------------ judges 2 and 3: pyodide */

async function getPyodide(say) {
  return cached("py", async () => {
    say?.("fetching CPython…");
    const { cpython } = await judges();
    // assets/runner.py is the one definition of what running the reader's code
    // means. build.py --validate executes the same file in a subprocess, so the
    // filenames, the line numbers and the exception names cannot drift apart.
    const [{ loadPyodide }, runner] = await Promise.all([
      import(`${cpython.cdn}pyodide.mjs`),
      // no-cache, not no-store: revalidate every load, and take the 304 when
      // nothing changed. This one file defines what a verdict means, and it has
      // to match the build.py that produced the exercises. A stale copy from the
      // browser cache would judge the reader's code by an older set of rules.
      fetch("assets/runner.py", { cache: "no-cache" }).then(r => r.text()),
    ]);
    const py = await loadPyodide({ indexURL: cpython.cdn });
    py.runPython(runner);
    return py;
  });
}

/* Anything the reader writes that drives an event loop -- asyncio.run, and so
   run_until_complete under it -- has to suspend the WebAssembly stack and hand
   control back to the browser. That only works when Python was entered through
   a call that can suspend, which is what callPromising does; a plain call gets
   "Cannot stack switch because the Python entrypoint was a synchronous
   function".

   It needs JSPI, and the method exists whether or not the engine has it: what
   varies is whether the call works. So the first run tries it and remembers the
   answer, and a browser without JSPI spends one failed call and then takes the
   ordinary path for the rest of the session. Everything except a running event
   loop behaves identically on both, and nothing in the book's own exercises
   depends on which path ran.

   Re-running after a failed promising call is safe because run_json catches
   every exception itself and returns JSON: a throw out of the call means the
   call could not proceed, not that the reader's code ran and failed. */
let canSuspend = true;

async function judgeRun(src, tests, say) {
  const py = await getPyodide(say);
  const fn = py.globals.get("run_json");
  try {
    if (canSuspend) {
      try {
        return JSON.parse(await fn.callPromising(src, tests));
      } catch (err) {
        if (err instanceof SyntaxError) throw err;   // run_json returned, JSON.parse did not
        canSuspend = false;
      }
    }
    return JSON.parse(fn(src, tests));
  }
  catch (err) { forgetIfFatal(err); throw err; }
  finally { try { fn.destroy?.(); } catch {} }
}

async function getMypy(say) {
  return cached("mypy", async () => {
    const py = await getPyodide(say);
    say?.("fetching mypy…");
    const { mypy } = await judges();
    await py.loadPackage(mypy.preload);
    const micropip = py.pyimport("micropip");
    await micropip.install(mypy.install);
    py.globals.set("_ph_mypy_flags", mypy.flags);
    py.runPython(`
from mypy import api as _mypy_api

_PH_MYPY_FLAGS = list(_ph_mypy_flags) + ["--cache-dir", "/tmp/mypycache"]

def _ph_mypy(src):
    with open("/tmp/check.py", "w") as f:
        f.write(src)
    out, _err, _code = _mypy_api.run([*_PH_MYPY_FLAGS, "/tmp/check.py"])
    return out
`);
    return py;
  });
}

async function judgeMypy(src, say) {
  const py = await getMypy(say);
  const fn = py.globals.get("_ph_mypy");
  let raw;
  try { raw = fn(src); }
  catch (err) { forgetIfFatal(err); throw err; }
  finally { try { fn.destroy?.(); } catch {} }
  const out = [];
  for (const line of String(raw).split("\n")) {
    const m = line.match(/^.*?:(\d+):(?:\d+:)?\s*error:\s*(.*?)\s*\[([a-z-]+)\]\s*$/);
    if (m) out.push({ line: Number(m[1]), message: m[2], code: m[3] });
  }
  return out;
}

/* ------------------------------------------------------------------ the editor */

const TAB = "    ";
export const flag = k => { try { return localStorage.getItem(k) === "1"; } catch { return false; } };
export const setFlag = (k, on) => { try { localStorage.setItem(k, on ? "1" : "0"); } catch {} };
/* ---------------------------------------------------------------- focus mode

   A stage's later starters are mostly the reader's own earlier work: stage
   twelve of the GPT is 994 lines of which 13 are the thing to write. Focus mode
   shows those 19 and collapses the rest into a row that says how much is
   behind it.

   The whole difficulty is that a textarea holds text, not a document, so
   hiding a region means the text is no longer in the textarea. Everything here
   exists to make that lossless:

   - the carried regions are kept, exactly, as arrays of lines
   - leaving focus mode puts them back in their original order
   - the split is re-derived by finding those carried regions in the current
     text, so edits made in either mode survive the other
   - if a carried region cannot be found, because the reader rewrote it, focus
     mode switches itself off rather than guessing. Nothing is ever dropped. */

export const FOLD = /^# ⋯ \d+ lines? you already built ⋯$/;

function findLines(hay, needle, from) {
  if (!needle.length) return from;
  outer: for (let i = from; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/* The starter, cut at the run boundaries the build worked out. Fixed for the
   life of the editor: it is what "carried" means for this stage. */
/* Work lines grouped into runs. Lines within three of each other are one
   region, because a blank line or two between stubs is not a reason to stop.

   Exported because `test_focus.mjs` needs the same rule, and a second copy of
   it there would let the threshold change here while the test went on proving
   the old one. That is the lesson runner.py taught this project already. */
export function groupRuns(work) {
  const runs = [];
  for (const line of [...work].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && line - last[1] <= 3) last[1] = line;
    else runs.push([line, line]);
  }
  return runs;
}

export function cutStarter(starter, runs) {
  const lines = starter.split("\n");
  const parts = [];
  let at = 1;
  for (const [a, b] of runs) {
    if (a > at) parts.push(lines.slice(at - 1, a - 1));
    at = b + 1;
  }
  if (at <= lines.length) parts.push(lines.slice(at - 1));
  return parts.filter(p => p.length);
}

/* The current text, split into what is carried and what is the reader's, by
   locating the carried regions inside it. Returns null when one has been
   rewritten, which is the signal to stop offering focus mode. */
export function derive(text, carriedParts) {
  const lines = text.split("\n");
  const segs = [];
  let at = 0;
  for (const part of carriedParts) {
    const found = findLines(lines, part, at);
    if (found < 0) return null;
    if (found > at) segs.push({ carried: false, lines: lines.slice(at, found) });
    segs.push({ carried: true, lines: part });
    at = found + part.length;
  }
  if (at < lines.length) segs.push({ carried: false, lines: lines.slice(at) });
  return segs;
}

/* Where a line of the whole file is showing, while focus mode is on.

   Worked out from the buffer each time rather than cached. The reader types in
   focus mode, which is the point of it, and every line they add moves
   everything below, so a map taken when focus was entered is wrong by the
   first keystroke. A line inside a folded region lands on the row that stands
   for it, which is where a reader would look for it. */
export function shownRowOf(segs, text, full) {
  const pieces = splitOnFolds(text);
  let atFull = 1, atShown = 1, piece = 0;
  for (const seg of segs) {
    if (seg.carried) {
      if (full < atFull + seg.lines.length) return atShown;
      atFull += seg.lines.length;
      atShown += 1;
      piece += 1;
    } else {
      const held = (pieces[piece] ?? []).length;
      if (full < atFull + held) return atShown + (full - atFull);
      atFull += held;
      atShown += held;
    }
  }
  return atShown;
}

export /* The buffer cut at the fold rows: one piece of the reader's text per gap. */
function splitOnFolds(text) {
  const pieces = [[]];
  for (const line of text.split("\n")) {
    if (FOLD.test(line)) pieces.push([]);
    else pieces[pieces.length - 1].push(line);
  }
  return pieces;
}

function foldLine(n) {
  return `# ⋯ ${n} line${n === 1 ? "" : "s"} you already built ⋯`;
}

/* Focus text: the reader's regions, with one comment line standing in for each
   carried region. A comment, so that a reader who copies it out has not copied
   out something that will not parse. */
export function toFocus(segs) {
  return segs.map(s => s.carried ? foldLine(s.lines.length) : s.lines.join("\n")).join("\n");
}

/* Focus text back to whole text.

   The fold lines are the boundaries, so the pieces between them line up with
   the reader's regions: a carried segment consumed one fold line and so ends a
   piece, a work segment consumed a piece and does not. When the count does not
   match, because a reader deleted a fold line, the pieces are handed to the
   work slots in order and anything left over goes on the end. Misplaced is
   recoverable; dropped is not. */
export function fromFocus(text, segs) {
  const pieces = splitOnFolds(text);
  const folds = segs.filter(s => s.carried).length;
  const intact = pieces.length === folds + 1;

  const out = [];
  const used = new Set();
  let at = 0, nth = 0;
  for (const seg of segs) {
    if (seg.carried) { out.push(...seg.lines); at++; continue; }
    const index = intact ? at : nth;
    out.push(...(pieces[index] ?? []));
    used.add(index);
    nth++;
  }
  for (let i = 0; i < pieces.length; i++) {
    if (!used.has(i) && pieces[i].length) out.push(...pieces[i]);
  }
  return out.join("\n");
}

const WRAP_KEY = "ph.wrap";

/* A textarea with transparent text laid exactly over a highlighted <pre>. The
   caret and the selection are the textarea's; every visible glyph is the pre's.
   They stay aligned only while they agree on font, size, line-height, padding,
   tab-size and wrapping, all asserted in the stylesheet, not here. The one
   metric CSS cannot settle is width, because a textarea cannot size itself to
   its longest line, so that gets pushed across after each paint. */
function buildEditor(host, initial, onRun, starter = initial, opts = {}) {
  host.innerHTML = `
    <div class="ed-toolbar">
      <span class="mono faint">your_code.py</span>
      <span class="sp"></span>
      <button class="btn ghost sm" id="vimbtn" aria-pressed="false"
              title="Vim keybindings: motions, operators, counts, text objects, visual, undo">vim</button>
      <button class="btn ghost sm" id="wraptoggle" aria-pressed="false" title="Soft wrap long lines">wrap</button>
      <button class="btn ghost sm" id="focusbtn" hidden aria-pressed="false"
              title="Hide the code you already wrote and show only this stage's work">focus</button>
      <button class="btn ghost sm" id="nextwork" hidden
              title="Jump to the next thing this stage asks you to write (F2)">yours</button>
      <button class="btn ghost sm" id="resetcode" title="Restore the starter">reset</button>
    </div>
    <div class="ed-shell" id="edshell">
    <div class="editor${flag(WRAP_KEY) ? " softwrap" : ""}" id="ed">
      <div class="gutter"></div>
      <div class="stack">
        <pre class="hl" aria-hidden="true"></pre>
        <textarea spellcheck="false" autocapitalize="off" autocomplete="off"
                  autocorrect="off" wrap="off" aria-label="Python source"></textarea>
      </div>
      <div class="vimbadge" hidden></div>
    </div>
    </div>`;

  const ed = host.querySelector("#ed");
  const shell = host.querySelector("#edshell");
  const gutterEl = host.querySelector(".gutter");
  const pre = host.querySelector("pre.hl");
  const ta = host.querySelector("textarea");
  const badge = host.querySelector(".vimbadge");

  let errLines = new Set();
  // The lines this stage asks for, worked out by the build from the difference
  // between this starter and the previous stage's solution. By the last stage
  // of a long project there are a dozen of them in a thousand line file.
  const workLines = new Set(opts.work || []);
  let shownWork = workLines;             // the same rows, where they are now
  // Declared here with the rest of the editor's state, not beside the focus
  // mode code that owns it, because paint() reads it through shownRow on its
  // first call and a `let` further down is a dead zone until then.
  let segs = null;                       // non-null exactly while focused
  let lastHl = null, lastLines = -1, lastMarks = "";
  let relTo = null;          // cursor line for vim's relative numbering, or null

  ta.value = initial;

  function paint() {
    const v = ta.value;
    const textChanged = v !== lastHl;
    // Only re-highlight when the text actually changed. paint() runs on every
    // keystroke AND every consumed vim key, and most vim keys are motions that
    // change nothing at all.
    if (textChanged) {
      // A trailing newline collapses inside a <pre>, so the last line loses its
      // row and everything below the caret drifts up by one. One space fixes it.
      pre.innerHTML = highlightPython(v) + (v.endsWith("\n") ? " " : "");
      lastHl = v;
    }
    // The line count can only have changed if the text did.
    const n = textChanged ? v.split("\n").length : lastLines;
    const linesMoved = n !== lastLines;
    if (linesMoved) {
      gutterEl.innerHTML = '<div class="gl"></div>'.repeat(n);
      lastLines = n;
      lastMarks = null;          // the loop below fills in every label and mark
    }
    // Only when the line count moved, and read from the flag rather than from
    // lastLines, which the block above has already brought up to date. Typing
    // inside a line cannot change which row a fold sits on, and this is one
    // shownRowOf scan per work line.
    if (linesMoved || shownWork === null) {
      shownWork = segs ? new Set([...workLines].map(shownRow)) : workLines;
    }
    const marks = [...errLines].join(",") + "|" + relTo + "|" + [...shownWork].join(",");
    if (marks !== lastMarks) {
      // Only the marks moved. Vim calls paint() on every motion key, so
      // re-parsing the gutter's HTML for a cursor move was the bulk of the cost
      // of pressing j. Walk the existing nodes instead.
      const rows = gutterEl.children;
      for (let i = 1; i <= n; i++) {
        const el = rows[i - 1];
        if (!el) break;
        const cur = relTo !== null && i === relTo + 1;
        const cls = "gl" + (errLines.has(i) ? " err" : "")
                  + (shownWork.has(i) ? " work" : "") + (cur ? " cur" : "");
        if (el.className !== cls) el.className = cls;   // assigning invalidates style even when equal
        const label = relTo === null || cur ? i : Math.abs(i - 1 - relTo);
        if (el.textContent !== String(label)) el.textContent = label;
      }
      lastMarks = marks;
    }
    // Reading scrollWidth straight after writing the highlight forces a
    // synchronous layout, so it is deferred; and it only needs doing when the
    // text changed or the wrap mode did, not on every motion key. Leaving the
    // wrap case out means the textarea keeps a pixel width it cannot fold at,
    // inside a container that now clips.
    if (textChanged) {
      const wrapping = ed.classList.contains("softwrap");
      requestAnimationFrame(() => { ta.style.width = wrapping ? "" : pre.scrollWidth + "px"; });
    }
    reveal();
  }

  /* The editor is a capped pane now, so it is what scrolls rather than the
     page, and nothing scrolls it to follow the caret. A textarea does that for
     itself when it is the scroller; here it is not, and without this every vim
     motion past the last visible line moves a caret nobody can see.

     Only when the caret has actually changed line, so that a reader who has
     scrolled away to look at something is not dragged back on a repaint. */
  let lastCaretLine = -1, lastCaretAt = -1;
  function reveal() {
    // paint() calls this, and so does keyup, and for ordinary typing both fire
    // for the same key. Reading selectionStart is free; slicing a thousand line
    // buffer to count newlines is twelve microseconds, so the cheap check comes
    // first, the way `if (textChanged)` does eight lines up.
    if (ta.selectionStart === lastCaretAt) return;
    lastCaretAt = ta.selectionStart;
    const line = ta.value.slice(0, ta.selectionStart).split("\n").length - 1;
    if (line === lastCaretLine) return;
    lastCaretLine = line;
    if (ed.scrollHeight <= ed.clientHeight) return;
    // A wrapped line is several rows, so line times height is not where the
    // caret is, and the further down the file the further out it is. The
    // browser still scrolls a focused textarea into view on its own; what it
    // will not do is the arithmetic below.
    if (ed.classList.contains("softwrap")) return;
    const height = parseFloat(getComputedStyle(ta).lineHeight) || 26;
    const margin = height * 2;                      // keep two lines of context
    const top = line * height;
    if (top - margin < ed.scrollTop) {
      ed.scrollTop = Math.max(0, top - margin);
    } else if (top + height + margin > ed.scrollTop + ed.clientHeight) {
      ed.scrollTop = top + height + margin - ed.clientHeight;
    }
  }

  /* Vim mode intercepts keys before the handlers below, so Tab and Enter are
     ordinary in insert mode and Vim's in normal mode. */
  const vim = Vim.attach(ta, { paint, onRun, badge, gutter(line) { relTo = line; } });

  ta.addEventListener("input", paint);
  ta.addEventListener("keyup", reveal);
  ta.addEventListener("click", reveal);
  ta.addEventListener("scroll", () => { pre.parentElement.scrollLeft = ta.scrollLeft; });

  /* Replace [from, to) with text, then leave the selection where asked.

     Assigning to ta.value from script clears the textarea's native undo stack
     in every browser. Enter happens on every line, so doing that here would
     quietly cost the reader Ctrl+Z. execCommand("insertText") edits through the
     browser's own undo machinery and fires an input event on the way. */
  const replaceRange = (from, to, text, selFrom, selTo = selFrom) => {
    ta.setSelectionRange(from, to);
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch { ok = false; }
    if (!ok) ta.value = ta.value.slice(0, from) + text + ta.value.slice(to);
    // vim keeps its own copy of the buffer and a script edit fires no input
    // event it would see. sync() re-reads and, when vim is on, repaints the
    // cursor, so the selection we actually want is set after it, not before.
    vim.sync();
    paint();
    ta.setSelectionRange(selFrom, selTo);
  };

  /* Does this line open a block? A colon only counts when it is real code and
     every bracket on the line is closed, so that `# TODO: later` and a dict
     broken across lines do not earn an indent they would choke on. */
  const opensBlock = line => {
    const code = line.replace(/(['"])(?:\\.|(?!\1).)*\1/g, "").replace(/#.*$/, "");
    const depth = (code.match(/[([{]/g) || []).length - (code.match(/[)\]}]/g) || []).length;
    return depth <= 0 && /:\s*$/.test(code);
  };

  ta.addEventListener("keydown", e => {
    if (e.defaultPrevented) return;      // vim consumed it in normal or visual mode
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onRun?.(); return; }

    const { selectionStart: a, selectionEnd: b, value: v } = ta;
    const lineStart = Vim._t.lineStart(v, a);
    const plain = !e.metaKey && !e.altKey && !e.ctrlKey;

    // Enter carries the current line's indentation down, and adds a level after
    // a line that opens a block. Python is the one language where getting this
    // wrong is a syntax error rather than a formatting annoyance.
    if (e.key === "Enter" && a === b && plain) {
      e.preventDefault();
      const line = v.slice(lineStart, a);
      const indent = /^[ \t]*/.exec(line)[0];
      const insert = "\n" + indent + (opensBlock(line) ? TAB : "");
      replaceRange(a, b, insert, a + insert.length);
      return;
    }

    // Backspace inside leading whitespace goes back to the previous tab stop.
    // Only a bare Backspace: cmd and alt mean delete-to-line-start and
    // delete-word, and swallowing those would be worse than not helping at all.
    if (e.key === "Backspace" && a === b && a > lineStart && plain) {
      const before = v.slice(lineStart, a);
      if (/^ +$/.test(before)) {
        e.preventDefault();
        const back = ((before.length - 1) % TAB.length) + 1;
        replaceRange(a - back, a, "", a - back);
        return;
      }
    }

    if (e.key !== "Tab" || !plain) return;
    e.preventDefault();

    if (e.shiftKey || a !== b) {
      // Indent or dedent every line the selection touches; the two differ only
      // in the per-line map. The block stays selected so a second Tab indents
      // again rather than typing spaces into the first line.
      const from = Vim._t.lineStart(v, a);
      const to = Vim._t.lineEnd(v, b);
      const block = v.slice(from, to).split("\n");
      const out = block.map(l => e.shiftKey ? l.replace(/^ {1,4}/, "") : TAB + l).join("\n");
      replaceRange(from, to, out, from, from + out.length);
    } else {
      replaceRange(a, b, TAB, a + TAB.length);
    }
  });

  const vimBtn = host.querySelector("#vimbtn");
  const paintVim = () => {
    const on = vim.isOn();
    vimBtn.classList.toggle("on", on);
    vimBtn.setAttribute("aria-pressed", String(on));
  };
  vimBtn.onclick = () => { vim.toggle(); paintVim(); ta.focus(); };
  if (Vim.isOn()) vim.enable();
  paintVim();

  const wrapBtn = host.querySelector("#wraptoggle");
  const paintWrap = () => {
    const on = flag(WRAP_KEY);
    ed.classList.toggle("softwrap", on);
    wrapBtn.classList.toggle("on", on);
    wrapBtn.setAttribute("aria-pressed", String(on));
  };
  wrapBtn.onclick = () => {
    setFlag(WRAP_KEY, !flag(WRAP_KEY));
    paintWrap();
    lastHl = null;    // no text changed, but the width must be recomputed
    paint();
  };
  paintWrap();

  paint();
  /* The work is rarely one block: nearly half of all stages scatter it, and one
     spreads it over eleven places. So this walks the runs rather than the
     lines, and wraps round at the end. */
  const runs = groupRuns(workLines);
  let atRun = -1;

  /* `focus` is false on a phone at mount: focusing a textarea there scrolls
     the page to it and raises the keyboard, which on a project stage meant
     opening sixteen hundred pixels past the brief with the brief unread. The
     caret still goes to the work, so the first tap on the editor lands there.
     preventScroll for the rest: the editor pane scrolls itself in reveal(),
     and the page has no business moving. */
  function goToLine(line, focus = true) {
    // whole-file in, buffer row out: the outline and the work runs both point
    // at the file, and in focus mode the buffer is a shorter thing
    const row = shownRow(line);
    const lines = ta.value.split("\n");
    const at = lines.slice(0, Math.max(0, row - 1)).join("\n").length + (row > 1 ? 1 : 0);
    if (focus) ta.focus({ preventScroll: true });
    ta.setSelectionRange(at, at);
    lastCaretLine = lastCaretAt = -1;   // force the reveal even onto the same line
    reveal();
    paint();
  }

  function goToWork(step = 1, focus = true) {
    if (!runs.length) return;
    atRun = (atRun + step + runs.length) % runs.length;
    goToLine(runs[atRun][0], focus);
  }

  /* Focus mode. The carried regions come out of the textarea and go into
     `segs`, which is the only copy of them, so every path back out of here
     writes them again. `code()` is what everything else must read: the whole
     file, whichever mode the editor happens to be in. */
  const carriedParts = runs.length ? cutStarter(starter, runs) : [];
  /* Every line number that crosses this editor's edge is a line of the whole
     file: the judges count them there, the build's work marks are there, the
     outline points there. Focus mode shows a shorter file, so they are
     translated here.

     Worked out from the buffer each time rather than cached when focus was
     entered. The reader types in focus mode, which is the entire point of it,
     and every line they add moves everything below. A map taken once is wrong
     by the first keystroke. */
  const shownRow = (full) => segs ? shownRowOf(segs, ta.value, full) : full;

  function code() {
    return segs ? fromFocus(ta.value, segs) : ta.value;
  }

  function setFocus(on) {
    if (on === !!segs) return true;
    if (on) {
      const found = derive(ta.value, carriedParts);
      if (!found) return false;          // a carried region was rewritten
      segs = found;
      ta.value = toFocus(segs);
    } else {
      ta.value = fromFocus(ta.value, segs);
      segs = null;
    }
    shownWork = null;                    // recomputed on the next paint
    vim.sync();
    lastCaretLine = lastCaretAt = -1;
    paint();
    ed.scrollTop = 0;
    return true;
  }

  const focusBtn = host.querySelector("#focusbtn");
  if (runs.length && carriedParts.length) {
    focusBtn.hidden = false;
    focusBtn.addEventListener("click", () => {
      const wanted = !segs;
      if (!setFocus(wanted)) {
        // The reader has rewritten code an earlier stage wrote. That is allowed,
        // and it means this editor can no longer say which lines are theirs.
        focusBtn.hidden = true;
        return;
      }
      focusBtn.setAttribute("aria-pressed", String(!!segs));
      focusBtn.classList.toggle("on", !!segs);
    });
  }

  const nextBtn = host.querySelector("#nextwork");
  if (runs.length) {
    nextBtn.hidden = false;
    nextBtn.textContent = runs.length > 1 ? `yours (${runs.length})` : "yours";
    nextBtn.addEventListener("click", () => goToWork(1));
  }

  return {
    goToWork,
    goToLine,
    code,
    setFocus,
    get focused() { return !!segs; },
    runs,
    ta,
    paint,
    el: ed,
    // The ring and the pass flash draw here. .editor clips, because it
    // scrolls, and a box that clips cannot show anything outside itself.
    shell,
    // Back to the exercise's starter, NOT to whatever the editor happened to
    // open with: after an edit and a reload those are the same value, and reset
    // would hand back the edit it was asked to discard.
    reset: () => {
      segs = null;                       // whole file again, whatever mode we were in
      shownWork = null;
      focusBtn.setAttribute("aria-pressed", "false");
      focusBtn.classList.remove("on");
      ta.value = starter;
      vim.sync();
      paint();
    },
    // The judges count lines in the whole file. In focus mode the editor is
    // showing a shorter one, so a line has to be moved to where it now sits,
    // and a line inside a collapsed region lands on the row that stands for it.
    setErrorLines(lines) {
      errLines = new Set(lines.map(shownRow));
      paint();
    },
  };
}

/* ------------------------------------------------------------------ the verdict */

const row = (who, cls, text) =>
  `<div class="verdict-row ${cls}"><i class="lamp"></i><span class="who">${who}</span><span class="what">${esc(text)}</span></div>`;

/* What the file holds, as a strip above it.

   A stage carries every earlier stage with it, so the honest answer to "what
   is in this thousand line file" is a list of names, not a thousand lines. The
   ones this stage asks for are marked, and clicking any of them goes there, so
   the shape of the thing is readable without scrolling through it at all. */
function renderOutline(host, outline, editor) {
  if (!outline || outline.length < 4) return;          // a short file is its own outline
  const mine = outline.filter(m => m.mine).length;
  host.className = "wb-outline";
  host.innerHTML = `
    <button class="ol-head" aria-expanded="false">
      <span class="ol-caret">▸</span>
      <span>${outline.length} things in this file</span>
      ${mine ? `<span class="ol-mine">${mine} yours</span>` : ""}
    </button>
    <div class="ol-list" hidden>${outline.map(m => `
      <button class="ol-item${m.mine ? " mine" : ""}" data-line="${m.line}">
        <span class="ol-kind">${m.kind}</span>
        <span class="ol-name">${m.name}</span>
        <span class="ol-lines">${m.lines}</span>
      </button>`).join("")}</div>`;

  const head = host.querySelector(".ol-head");
  const list = host.querySelector(".ol-list");
  head.addEventListener("click", () => {
    const open = list.hidden;
    list.hidden = !open;
    head.setAttribute("aria-expanded", String(open));
    host.querySelector(".ol-caret").textContent = open ? "▾" : "▸";
  });
  list.addEventListener("click", (e) => {
    const item = e.target.closest(".ol-item");
    if (item) editor.goToLine(Number(item.dataset.line));
  });
}

/* Which lines are the reader's work, in the buffer they are actually looking
   at. Straight from the build when nothing has been edited, and located again
   when something has. Empty when the question cannot be answered, which is
   what turns every one of these aids off at once. */
function workMarks(ex, saved) {
  if (!ex.work || !ex.work.length) return [];
  if (!saved || saved === ex.starter) return ex.work;
  const segs = derive(saved, cutStarter(ex.starter, groupRuns(ex.work)));
  if (!segs) return [];
  const lines = [];
  let at = 1;
  for (const seg of segs) {
    if (!seg.carried) for (let i = 0; i < seg.lines.length; i++) lines.push(at + i);
    at += seg.lines.length;
  }
  return lines;
}

/* One flush on the way out of the page, pointing at whichever editor is
   mounted. Each mount used to add its own beforeunload listener and nothing
   removed them, so a session's worth of exercises left a session's worth of
   closures each saving a detached editor. pagehide rather than beforeunload:
   it is the one that fires on a phone when the tab is put away. */
let flush = null;
let flushWired = false;

export function mountWorkbench(host, ctx) {
  const { exercise: ex, storageKey, onPass, next } = ctx;

  let saved = "";
  try { saved = localStorage.getItem(storageKey) || ""; } catch {}

  // Coarse pointer or the single-column layout, which app.css puts at 1060px:
  // either one means the editor is somewhere the page must not jump to.
  const touch = matchMedia("(pointer: coarse), (max-width: 1060px)").matches;
  // The shortcut named for the keyboard in front of the reader. The CSS hides
  // it entirely where there is no keyboard.
  const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
  const runKey = mac ? "\u2318\u23ce" : "Ctrl \u23ce";
  host.innerHTML = `<div id="outline"></div>
    <div id="edhost"></div>
    <div class="wb-actions">
      <button class="btn" id="run" aria-keyshortcuts="${mac ? "Meta" : "Control"}+Enter">Run <kbd class="runkey" aria-hidden="true">${runKey}</kbd></button>
      <span id="wbstatus" class="mono faint" style="font-size:var(--t-micro)"></span>
      <span style="margin-left:auto" id="passslot"></span>
    </div>
    <div id="verdict" aria-live="polite"></div>
    <div id="reading" aria-live="polite"></div>`;

  /* The build's work marks are line numbers in the starter, so an edit moves
     them. Rather than dropping the marks at the first keystroke, they are moved:
     `derive` locates the carried regions in whatever the reader has now, and
     what is between them is their work, wherever it has ended up.

     It gives up only when a carried region has been rewritten, which is the one
     case where the question has no answer, and is the same condition focus mode
     already uses. Fixing one typo should not cost a reader the outline. */
  const marks = workMarks(ex, saved);
  const editor = buildEditor(host.querySelector("#edhost"), saved || ex.starter,
                             () => run(), ex.starter, { work: marks });
  // Open on the work rather than on line one. A reader who lands on the top of
  // a thousand line file has to go looking for the thirteen lines that are the
  // point of the stage.
  if (editor.runs.length) requestAnimationFrame(() => editor.goToWork(1, !touch));
  renderOutline(host.querySelector("#outline"), marks.length ? ex.outline : null, editor);

  // On the host rather than on document: a route change replaces this subtree,
  // so the listener goes with it. There is no teardown hook here to remove one
  // from document, and a listener that outlives its editor would walk the work
  // of a stage the reader has left.
  host.addEventListener("keydown", (e) => {
    if (e.key === "F2" && editor.runs.length) {
      e.preventDefault();
      editor.goToWork(e.shiftKey ? -1 : 1);
    }
  });

  const status = host.querySelector("#wbstatus");
  const verdict = host.querySelector("#verdict");
  const reading = host.querySelector("#reading");

  // localStorage is synchronous and disk-backed, so writing on every keystroke
  // is the one blocking call on the typing path. Save shortly after typing
  // stops, and flush before anything that could lose the buffer.
  let saveTimer = null;
  // code(), never ta.value: in focus mode the textarea holds the reader's
  // regions and nothing else, and saving that would lose the rest of the file.
  const save = () => { try { localStorage.setItem(storageKey, editor.code()); } catch {} };
  editor.ta.addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  });
  editor.ta.addEventListener("blur", () => { clearTimeout(saveTimer); save(); });
  flush = save;
  if (!flushWired) {
    addEventListener("pagehide", () => flush?.());
    flushWired = true;
  }
  host.querySelector("#resetcode").onclick = () => {
    editor.reset();
    try { localStorage.removeItem(storageKey); } catch {}
  };

  const say = t => (status.textContent = t || "");

  async function run() {
    const btn = host.querySelector("#run");
    if (btn.disabled) return;
    btn.disabled = true;
    editor.shell.classList.add("running");
    editor.shell.classList.remove("passed");
    reading.innerHTML = "";
    editor.setErrorLines([]);
    const src = editor.code();

    verdict.innerHTML = `<div class="verdict">
      ${row("ruff", "is-wait", "checking…")}
      ${row("mypy", "is-wait", "waiting for CPython to load…")}
      ${row("cpython", "is-wait", "starting…")}</div>`;
    const rows = [...verdict.querySelectorAll(".verdict-row")];
    const set = (n, cls, text) => {
      rows[n].className = `verdict-row ${cls}`;
      rows[n].querySelector(".what").textContent = text;
    };

    // Start all three at once. They are independent downloads on a cold cache,
    // and awaiting them in series turned a max into a sum. They are still
    // *displayed* in this order, which is what the reader cares about.
    // settle() attaches a handler immediately, so a judge that fails while we
    // are waiting on another one is not an unhandled rejection.
    const settle = p => p.then(value => ({ value }), error => ({ error }));
    const pRuff = settle(judgeRuff(src));
    const pRun = settle(judgeRun(src, ex.tests, say));
    const pMypy = settle(judgeMypy(src, say));
    const take = async p => { const r = await p; if (r.error) throw r.error; return r.value; };

    let ruff = [];
    try {
      ruff = await take(pRuff);
      set(0, ruff.length ? "is-warn" : "is-ok",
        ruff.length ? ruff.map(d => `${d.code} line ${d.line}: ${d.message}`).join(" · ") : "clean");
    } catch (e) { set(0, "", `unavailable (${e.message})`); }

    // CPython is the truth and takes the longest, so it starts next
    let exec = null;
    try {
      exec = await take(pRun);
      say("");
      if (exec.exc) set(2, "is-bad", `${exec.exc}: ${exec.msg}`);
      else set(2, "is-ok", exec.out.trim() ? `passed · stdout: ${exec.out.trim().split("\n").slice(-1)[0]}` : "passed");
    } catch (e) { set(2, "is-bad", `could not run: ${e.message}`); }

    let mypy = [];
    try {
      set(1, "is-wait", "checking…");
      mypy = await take(pMypy);
      say("");
      set(1, mypy.length ? "is-warn" : "is-ok",
        mypy.length ? mypy.map(d => `${d.code} line ${d.line}: ${d.message}`).join(" · ") : "clean");
    } catch (e) { set(1, "", `unavailable (${e.message})`); }

    // every line a judge pointed at, marked in the gutter
    const lines = new Set();
    ruff.forEach(d => lines.add(d.line));
    mypy.forEach(d => lines.add(d.line));
    for (const m of (exec?.tb || "").matchAll(/your_code\.py", line (\d+)/g)) lines.add(Number(m[1]));
    editor.setErrorLines([...lines].filter(Boolean));

    // Read by ./qa-browser.sh, which compares this against the verdict
    // build.py --validate reaches offline through a different path. Nothing in
    // the page itself uses it.
    globalThis.__phVerdict = { ruff, mypy, raises: exec?.exc || "", ok: !!exec?.ok };

    editor.shell.classList.remove("running");
    if (exec?.ok) editor.shell.classList.add("passed");
    renderReading({ ex, ruff, mypy, run: exec, reading, host, onPass, next });
    btn.disabled = false;
  }

  host.querySelector("#run").onclick = run;
}

function renderReading({ ex, ruff, mypy, run, reading, host, onPass, next }) {
  const passed = run && run.ok;
  const parts = [];

  // pick the diagnose entry that matches what actually happened, in order of
  // how loudly it failed: an exception first, then the static judges, then silence.
  // An AssertionError normally means the hidden tests failed, which is what the
  // `silent` verdict describes. But an exercise can legitimately expect the
  // reader's own code to raise one, and then AssertionError is the key.
  const notes = ruff.length > 0 || mypy.length > 0;   // did either static judge speak

  if (ex.goal) {
    // A project stage has one thing to do rather than a verdict to recognise,
    // so until it does it, restating the goal beside the failure is the only
    // reading worth having.
    if (!passed) {
      parts.push(`<div class="reading"><h4>This stage</h4>
        <p>${inline(ex.goal)}</p></div>`);
    }
  } else {
    const declaresSilent = ex.expects.some(e => e.judge === "silent");
    const keys = [];
    if (run && run.exc) {
      keys.push(run.exc === "AssertionError" && declaresSilent ? "silent" : run.exc);
    }
    ruff.forEach(d => keys.push(d.code));
    mypy.forEach(d => keys.push(d.code));
    for (const k of new Set(keys)) {
      if (!ex.diagnose[k]) continue;
      const heading = k !== "silent" ? k
        : notes ? "Nothing raised" : "Every judge was happy";
      parts.push(`<div class="reading"><h4>${heading}</h4>
        <p>${inline(ex.diagnose[k])}</p></div>`);
    }
  }

  // A complaint with no prose beside it is worse than no complaint. This has to
  // be decided before the traceback goes in, because the traceback is evidence
  // rather than explanation, and counting it would suppress the very message a
  // reader with an unexplained error needs.
  if (!ex.goal && !parts.length && (run?.exc || ruff.length || mypy.length)) {
    parts.push(`<div class="reading"><h4>Not one of this exercise's errors</h4>
      <p>The judges are objecting to something the exercise does not have a written
      reading for, usually a typo or a change further from the starter than the
      exercise expects. Read their messages above; they are the real ones, not a
      simplification. <b>reset</b> restores the starter if you want to begin again.</p></div>`);
  }

  if (run && run.exc && run.tb) {
    parts.push(`<div class="verdict" style="margin-top:.9rem"><pre class="raw" style="border:0">${esc(run.tb.trim())}</pre></div>`);
  }

  if (passed) {
    const stamp = `<span class="stamp">passed${notes ? " · with notes" : ""}</span>`;
    host.querySelector("#passslot").innerHTML = stamp;
    onPass?.();
    parts.unshift(`<div class="reading"><h4>${notes ? "Correct, but not clean" : "Green"}</h4>
      <p>${notes
        ? "The hidden tests pass, so the behaviour is right. The static judges still have something to say, and they are worth reading: on a real codebase that is the difference between code that works today and code that still works next year."
        : "The tests pass and both static judges are clean. That is the whole traffic light green at once."}</p>
      ${next ? `<p><a class="btn sm" href="${next}">Next →</a></p>` : ""}</div>`);
  }

  reading.innerHTML = parts.join("");
}

