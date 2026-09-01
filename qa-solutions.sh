#!/usr/bin/env bash
#
# Run every project SOLUTION through the judges IN THE BROWSER.
#
# qa-browser.sh runs starters, and a starter fails on its first stub, so a whole
# project's real code can pass offline having never executed a line inside
# Pyodide. That is the half of the two-runner invariant this covers, and it is
# the half where a divergence would actually live: threads, sleeps, event loops
# and recursion behave differently under WebAssembly.
#
# Solutions are not shipped to the browser, so they are written to a scratch
# file the local server hands over, and removed again on the way out.
#
#   ./qa-solutions.sh                 every project
#   ./qa-solutions.sh orm micrograd   only these
set -uo pipefail
cd "$(dirname "$0")"
for arg in "$@"; do
  case "$arg" in
    *[!A-Za-z0-9_-]*) echo "project filters may only contain letters, digits, - and _: $arg" >&2; exit 2;;
  esac
done

trap 'rm -f .qa-solutions.json' EXIT
python3 - <<'PY' || exit 1
import json, sys
sys.path.insert(0, ".")
import build
from pathlib import Path
out = {}
for p in sorted(Path("content/projects").glob("*.md")):
    d = build.parse_project(p)
    out[d["slug"]] = [{"n": s["n"], "title": s["title"], "solution": s["solution"]}
                      for s in d["stages"]]
Path(".qa-solutions.json").write_text(json.dumps(out))
PY

out=$(mktemp)
trap 'rm -f "$out" .qa-solutions.json' EXIT
sed "s|@@ONLY@@|$*|" <<'EOF' | ego-browser nodejs 2>&1 | tee "$out"
await useOrCreateTaskSpace('python handbook qa')
await gotoAndWait('http://127.0.0.1:8848/#/work/00-toolchain/1', { timeout: 30 })
await cdp('Page.reload', { ignoreCache: true })
await wait(5)
await js(String.raw`(() => {
  Object.keys(localStorage).filter(k => k.startsWith('ph.code.')).forEach(k => localStorage.removeItem(k));
  location.hash = '/track';
})()`)
await wait(2)
await js(String.raw`(() => { location.hash = '/work/00-toolchain/1'; })()`)
await wait(3)

await js(String.raw`(() => { globalThis.__phVerdict = null; document.querySelector('#run')?.click(); })()`)
let warm = false
for (let i = 0; i < 30 && !warm; i++) {
  await wait(10)
  warm = await js(String.raw`!!globalThis.__phVerdict`)
}
cliLog(warm ? 'judges warm' : 'WARNING: judges did not warm up in 300s')

/* Two short evaluates with a Node-side poll between them. One evaluate that
   mounted, ran and waited would exceed the CDP call limit on the slower
   stages, which is what the warm-up above already works around. */
const MOUNT = String.raw`(async (slug, stage) => {
  const until = async (fn, ms = 20000) => {
    const t0 = Date.now();
    for (;;) {
      try { if (fn()) return true; } catch {}
      if (Date.now() - t0 > ms) return false;
      await new Promise(r => setTimeout(r, 120));
    }
  };
  // seed the editor before the route mounts, the same path saved work takes
  localStorage.setItem('ph.code.project.' + slug + '.' + stage.n, stage.solution);
  location.hash = '/project/' + slug + '/' + stage.n;
  if (!await until(() =>
    document.querySelector('#run') &&
    document.querySelector('.wb-brief h1')?.textContent === stage.title)) {
    return 'did not mount';
  }
  if (!await until(() =>
    (document.querySelector('#ed textarea')?.value ?? '').includes(stage.head))) {
    return 'the editor did not take the solution';
  }
  globalThis.__phVerdict = null;
  document.querySelector('#run').click();
  return '';
})`;

const solutions = await js(`fetch('.qa-solutions.json', { cache: 'no-cache' }).then(r => r.json())`)
const only = '@@ONLY@@'.split(/\s+/).filter(Boolean)
const slugs = Object.keys(solutions).filter(s => !only.length || only.some(o => s.startsWith(o)))

if (!slugs.length) {
  cliLog(`no project matched ${JSON.stringify(only)}`)
  cliLog(`\nBROWSER SOLUTIONS: 0 stages, 1 problems`)
} else {
  let total = 0, bad = 0
  for (const slug of slugs) {
    let n = 0
    for (const stage of solutions[slug]) {
      const seed = { n: stage.n, title: stage.title, solution: stage.solution,
                     head: stage.solution.slice(0, 40) }
      total++; n++
      const problems = []
      const failed = await js(`(${MOUNT})(${JSON.stringify(slug)}, ${JSON.stringify(seed)})`)
      if (failed) {
        problems.push(failed)
      } else {
        // polled from here so each evaluate stays well inside its own limit
        let v = null
        for (let i = 0; i < 60 && !v; i++) {
          await wait(5)
          v = await js(String.raw`globalThis.__phVerdict`)
        }
        if (!v) problems.push('timed out after 300s')
        else {
          if (!v.ok) problems.push('the solution FAILED its own tests: ' + (v.raises || 'assertion'))
          if (v.ruff.length) problems.push('ruff: ' + v.ruff.map(d => d.code).join(' '))
          if (v.mypy.length) problems.push('mypy: ' + v.mypy.map(d => d.code).join(' '))
        }
      }
      for (const p of problems) { bad++; cliLog(`FAIL ${slug} #${stage.n} ${stage.title}\n       ${p}`) }
    }
    cliLog(`  ${slug}: ${n} stages`)
  }
  cliLog(`\nBROWSER SOLUTIONS: ${total} stages, ${bad} problems`)
}
await js(String.raw`(() => {
  Object.keys(localStorage).filter(k => k.startsWith('ph.code.')).forEach(k => localStorage.removeItem(k));
})()`)
await completeTaskSpace('python handbook qa', { keep: true })
EOF
grep -E '^BROWSER SOLUTIONS: .* 0 problems$' "$out" >/dev/null
