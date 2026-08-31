/* The workbench: a Python tokenizer, three judges, and the reading of their verdict.

   Everything here runs in the browser. Nothing the learner writes is sent anywhere. */

import Vim from "./vim.js";

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/";
const RUFF = "https://cdn.jsdelivr.net/npm/@astral-sh/ruff-wasm-web@0.16.5/";
const RUFF_SELECT = ["E", "F", "B", "SIM", "UP"];

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

const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

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
const cached = (key, make) => {
  memo[key] ||= make().catch(err => { memo[key] = null; throw err; });
  return memo[key];
};

async function getRuff() {
  return cached("ruff", async () => {
    const mod = await import(`${RUFF}ruff_wasm.js`);
    await mod.default(`${RUFF}ruff_wasm_bg.wasm`);
    const settings = {
      "line-length": 88,
      "indent-width": 4,
      lint: { select: RUFF_SELECT, ignore: ["E501"] },
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
    const { loadPyodide } = await import(`${PYODIDE}pyodide.mjs`);
    const py = await loadPyodide({ indexURL: PYODIDE });
    py.runPython(RUNNER);
    return py;
  });
}

// Lives inside Pyodide. Runs the snippet and its hidden tests in one namespace so
// a failing assert and a failing snippet come back through the same channel.
const RUNNER = `
import io, json, sys, traceback

def _ph_run(src, tests):
    # The reader's file is run the way "python your_code.py" runs it, so
    # __name__ is "__main__". Some exercises need to know what would happen on
    # an import instead, so the hidden tests get _ph_import() to find out.
    def _ph_import():
        mod = {"__name__": "your_code"}
        exec(compile(src, "your_code.py", "exec"), mod)
        return mod

    ns = {"__name__": "__main__", "_ph_import": _ph_import}
    buf = io.StringIO()
    real, sys.stdout = sys.stdout, buf
    try:
        exec(compile(src, "your_code.py", "exec"), ns)
        exec(compile(tests, "hidden_tests.py", "exec"), ns)
        return json.dumps({"ok": True, "out": buf.getvalue(), "exc": None, "msg": "", "tb": ""})
    except BaseException as e:
        tb = "".join(traceback.format_exception(type(e), e, e.__traceback__.tb_next))
        return json.dumps({"ok": False, "out": buf.getvalue(),
                           "exc": type(e).__name__, "msg": str(e), "tb": tb})
    finally:
        sys.stdout = real
`;

async function judgeRun(src, tests, say) {
  const py = await getPyodide(say);
  const fn = py.globals.get("_ph_run");
  try { return JSON.parse(fn(src, tests)); }
  finally { fn.destroy?.(); }
}

async function getMypy(say) {
  return cached("mypy", async () => {
    const py = await getPyodide(say);
    say?.("fetching mypy…");
    // micropip does not resolve mypy's transitive dependencies here, so name them all.
    // typing-extensions ships inside the Pyodide distribution: take it from there
    // rather than paying for another PyPI round trip.
    await py.loadPackage(["micropip", "typing-extensions"]);
    const micropip = py.pyimport("micropip");
    await micropip.install(["mypy_extensions", "pathspec", "tomli", "mypy"]);
    py.runPython(`
from mypy import api as _mypy_api

def _ph_mypy(src):
    with open("/tmp/check.py", "w") as f:
        f.write(src)
    out, _err, _code = _mypy_api.run([
        "--no-error-summary", "--hide-error-context", "--no-color-output",
        "--cache-dir", "/tmp/mypycache", "/tmp/check.py",
    ])
    return out
`);
    return py;
  });
}

async function judgeMypy(src, say) {
  const py = await getMypy(say);
  const fn = py.globals.get("_ph_mypy");
  let raw;
  try { raw = fn(src); } finally { fn.destroy?.(); }
  const out = [];
  for (const line of String(raw).split("\n")) {
    const m = line.match(/^.*?:(\d+):(?:\d+:)?\s*error:\s*(.*?)\s*\[([a-z-]+)\]\s*$/);
    if (m) out.push({ line: Number(m[1]), message: m[2], code: m[3] });
  }
  return out;
}

/* ------------------------------------------------------------------ the editor */

const TAB = "    ";
const flag = k => { try { return localStorage.getItem(k) === "1"; } catch { return false; } };
const setFlag = (k, on) => { try { localStorage.setItem(k, on ? "1" : "0"); } catch {} };
const WRAP_KEY = "ph.wrap";

/* A textarea with transparent text laid exactly over a highlighted <pre>. The
   caret and the selection are the textarea's; every visible glyph is the pre's.
   They stay aligned only while they agree on font, size, line-height, padding,
   tab-size and wrapping — all asserted in the stylesheet, not here. The one
   metric CSS cannot settle is width, because a textarea cannot size itself to
   its longest line, so that gets pushed across after each paint. */
function buildEditor(host, initial, onRun) {
  host.innerHTML = `
    <div class="ed-toolbar">
      <span class="mono faint">your_code.py</span>
      <span class="sp"></span>
      <button class="btn ghost sm" id="vimbtn" aria-pressed="false"
              title="Vim keybindings: motions, operators, counts, text objects, visual, undo">vim</button>
      <button class="btn ghost sm" id="wraptoggle" aria-pressed="false" title="Soft wrap long lines">wrap</button>
      <button class="btn ghost sm" id="resetcode" title="Restore the starter">reset</button>
    </div>
    <div class="editor${flag(WRAP_KEY) ? " softwrap" : ""}" id="ed">
      <div class="gutter"></div>
      <div class="stack">
        <pre class="hl" aria-hidden="true"></pre>
        <textarea spellcheck="false" autocapitalize="off" autocomplete="off"
                  autocorrect="off" wrap="off" aria-label="Python source"></textarea>
      </div>
      <div class="vimbadge" hidden></div>
    </div>`;

  const ed = host.querySelector("#ed");
  const gutterEl = host.querySelector(".gutter");
  const pre = host.querySelector("pre.hl");
  const ta = host.querySelector("textarea");
  const badge = host.querySelector(".vimbadge");

  let errLines = [];
  let lastHl = null, lastLines = -1, lastErrs = "";
  let relTo = null;          // cursor line for vim's relative numbering, or null

  ta.value = initial;

  function paint() {
    const v = ta.value;
    // Only re-highlight when the text actually changed. paint() runs on every
    // keystroke AND every consumed vim key, and most vim keys are motions that
    // change nothing at all.
    if (v !== lastHl) {
      // A trailing newline collapses inside a <pre>, so the last line loses its
      // row and everything below the caret drifts up by one. One space fixes it.
      pre.innerHTML = highlightPython(v) + (v.endsWith("\n") ? " " : "");
      lastHl = v;
    }
    const n = v.split("\n").length;
    const errs = errLines.join(",") + "|" + relTo;
    if (n !== lastLines || errs !== lastErrs) {
      let g = "";
      for (let i = 1; i <= n; i++) {
        const cls = (errLines.includes(i) ? " err" : "")
          + (relTo !== null && i === relTo + 1 ? " cur" : "");
        const label = relTo === null || i === relTo + 1 ? i : Math.abs(i - 1 - relTo);
        g += `<div class="gl${cls}">${label}</div>`;
      }
      gutterEl.innerHTML = g;
      lastLines = n;
      lastErrs = errs;
    }
    // Reading scrollWidth straight after an innerHTML write forces a synchronous
    // layout; deferring keeps that off the keystroke's critical path.
    requestAnimationFrame(() => { ta.style.width = pre.scrollWidth + "px"; });
  }

  /* Vim mode intercepts keys before the handlers below, so Tab and Enter are
     ordinary in insert mode and Vim's in normal mode. */
  const vim = Vim.attach(ta, { paint, onRun, badge, gutter(line) { relTo = line; } });

  ta.addEventListener("input", paint);
  ta.addEventListener("scroll", () => { pre.parentElement.scrollLeft = ta.scrollLeft; });

  ta.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onRun?.(); return; }
    if (e.key !== "Tab") return;
    e.preventDefault();
    const { selectionStart: a, selectionEnd: b, value: v } = ta;

    if (e.shiftKey || a !== b) {
      // Indent or dedent every line the selection touches; the two differ only
      // in the per-line map.
      const from = v.lastIndexOf("\n", a - 1) + 1;
      const to = v.indexOf("\n", b) === -1 ? v.length : v.indexOf("\n", b);
      const block = v.slice(from, to).split("\n");
      const out = block.map(l => e.shiftKey ? l.replace(/^ {1,4}/, "") : TAB + l);
      const delta = out.join("\n").length - v.slice(from, to).length;
      ta.value = v.slice(0, from) + out.join("\n") + v.slice(to);
      ta.setSelectionRange(from, to + delta);
    } else {
      ta.value = v.slice(0, a) + TAB + v.slice(b);
      ta.setSelectionRange(a + TAB.length, a + TAB.length);
    }
    paint();
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
  wrapBtn.onclick = () => { setFlag(WRAP_KEY, !flag(WRAP_KEY)); paintWrap(); paint(); };
  paintWrap();

  paint();
  return {
    ta,
    paint,
    el: ed,
    reset: () => { ta.value = initial; vim.sync(); paint(); },
    setErrorLines(lines) { errLines = lines; paint(); },
  };
}

/* ------------------------------------------------------------------ the verdict */

const row = (who, cls, text) =>
  `<div class="verdict-row ${cls}"><i class="lamp"></i><span class="who">${who}</span><span class="what">${esc(text)}</span></div>`;

export function mountWorkbench(host, ctx) {
  const { exercise: ex, storageKey, onPass, next } = ctx;

  let saved = "";
  try { saved = localStorage.getItem(storageKey) || ""; } catch {}

  host.innerHTML = `<div id="edhost"></div>
    <div class="wb-actions">
      <button class="btn" id="run">Run <kbd class="runkey">\u2318\u23ce</kbd></button>
      <span id="wbstatus" class="mono faint" style="font-size:var(--t-micro)"></span>
      <span style="margin-left:auto" id="passslot"></span>
    </div>
    <div id="verdict"></div>
    <div id="reading"></div>`;

  const editor = buildEditor(host.querySelector("#edhost"), saved || ex.starter, () => run());
  const status = host.querySelector("#wbstatus");
  const verdict = host.querySelector("#verdict");
  const reading = host.querySelector("#reading");

  editor.ta.addEventListener("input", () => {
    try { localStorage.setItem(storageKey, editor.ta.value); } catch {}
  });
  host.querySelector("#resetcode").onclick = () => {
    editor.reset();
    try { localStorage.removeItem(storageKey); } catch {}
  };

  const say = t => (status.textContent = t || "");

  async function run() {
    const btn = host.querySelector("#run");
    if (btn.disabled) return;
    btn.disabled = true;
    editor.el.classList.add("running");
    editor.el.classList.remove("passed");
    reading.innerHTML = "";
    editor.setErrorLines([]);
    const src = editor.ta.value;

    verdict.innerHTML = `<div class="verdict">
      ${row("ruff", "is-wait", "checking…")}
      ${row("mypy", "is-wait", "waiting for CPython to load…")}
      ${row("cpython", "is-wait", "starting…")}</div>`;
    const rows = [...verdict.querySelectorAll(".verdict-row")];
    const set = (n, cls, text) => {
      rows[n].className = `verdict-row ${cls}`;
      rows[n].querySelector(".what").textContent = text;
    };

    // ruff answers in about a millisecond, so it goes first and alone
    let ruff = [];
    try {
      ruff = await judgeRuff(src);
      set(0, ruff.length ? "is-warn" : "is-ok",
        ruff.length ? ruff.map(d => `${d.code} line ${d.line}: ${d.message}`).join(" · ") : "clean");
    } catch (e) { set(0, "", `unavailable (${e.message})`); }

    // CPython is the truth and takes the longest, so it starts next
    let exec = null;
    try {
      exec = await judgeRun(src, ex.tests, say);
      say("");
      if (exec.exc) set(2, "is-bad", `${exec.exc}: ${exec.msg}`);
      else set(2, "is-ok", exec.out.trim() ? `passed · stdout: ${exec.out.trim().split("\n").slice(-1)[0]}` : "passed");
    } catch (e) { set(2, "is-bad", `could not run: ${e.message}`); }

    let mypy = [];
    try {
      set(1, "is-wait", "checking…");
      mypy = await judgeMypy(src, say);
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

    editor.el.classList.remove("running");
    if (exec?.ok) editor.el.classList.add("passed");
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
  const keys = [];
  if (run && run.exc) keys.push(run.exc === "AssertionError" ? "silent" : run.exc);
  ruff.forEach(d => keys.push(d.code));
  mypy.forEach(d => keys.push(d.code));
  if (passed && !ruff.length && !mypy.length) keys.length = 0;

  const seen = new Set();
  for (const k of keys) {
    if (seen.has(k) || !ex.diagnose[k]) continue;
    seen.add(k);
    const heading = k !== "silent" ? k
      : (ruff.length || mypy.length) ? "Nothing raised" : "Every judge was happy";
    parts.push(`<div class="reading"><h4>${heading}</h4>
      <p>${inlineLite(ex.diagnose[k])}</p></div>`);
  }

  if (run && run.exc && run.tb) {
    parts.push(`<div class="verdict" style="margin-top:.9rem"><pre class="raw" style="border:0">${esc(run.tb.trim())}</pre></div>`);
  }

  if (passed) {
    const stamp = `<span class="stamp">passed${ruff.length || mypy.length ? " · with notes" : ""}</span>`;
    host.querySelector("#passslot").innerHTML = stamp;
    onPass?.();
    parts.unshift(`<div class="reading"><h4>${ruff.length || mypy.length ? "Correct, but not clean" : "Green"}</h4>
      <p>${ruff.length || mypy.length
        ? "The hidden tests pass, so the behaviour is right. The static judges still have something to say — read them, because on a real codebase that is the difference between code that works today and code that works next year."
        : "The tests pass and both static judges are clean. That is the whole traffic light green at once."}</p>
      ${next ? `<p><a class="btn sm" href="${next}">Next →</a></p>` : ""}</div>`);
  }

  // A complaint with no prose beside it is worse than no complaint, so say so
  // rather than leaving the learner with three coloured rows and silence.
  if (!parts.length && (run?.exc || ruff.length || mypy.length)) {
    parts.push(`<div class="reading"><h4>Not one of this exercise's errors</h4>
      <p>The judges are objecting to something the exercise does not have a written
      reading for — usually a typo, or a change further from the starter than the
      exercise expects. Read their messages above; they are the real ones, not a
      simplification. <b>reset</b> restores the starter if you want to begin again.</p></div>`);
  }

  reading.innerHTML = parts.join("");
}

const inlineLite = s => esc(s)
  .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
