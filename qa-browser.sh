#!/usr/bin/env bash
#
# Run every exercise through the judges IN THE BROWSER and compare the verdict
# against the @expect its prose is written for.
#
# build.py --validate answers the same question offline, against the same three
# tools, but through a different path: a subprocess rather than WebAssembly,
# one concatenated file rather than two compiled units. This is what checks that
# the two agree, which is the thing the whole book rests on.
#
# Needs: a server on 8848 (python3 -m http.server 8848) and the ego-browser CLI.
# It reads globalThis.__phVerdict, which assets/workbench.js sets after each run.
#
#   ./qa-browser.sh                 every unit
#   ./qa-browser.sh 18 19-attributes  only units whose slug starts with one of these
set -uo pipefail
cd "$(dirname "$0")"
# ego's node runtime does not inherit this shell's environment, so the filter is
# substituted into the script before it is piped in.
sed "s|@@ONLY@@|$*|" <<'EOF' | ego-browser nodejs
await useOrCreateTaskSpace('python handbook qa')
await gotoAndWait('http://127.0.0.1:8848/#/work/00-toolchain/1', { timeout: 30 })
await cdp('Page.reload', { ignoreCache: true })
await wait(5)
// Anything typed into an editor by hand is saved per exercise, and the router
// does not remount a route it is already on, so clear the saved code and leave
// the work view, then come back to it, before the sweep starts on it.
await js(String.raw`(() => {
  Object.keys(localStorage).filter(k => k.startsWith('ph.code.')).forEach(k => localStorage.removeItem(k));
  location.hash = '/track';
})()`)
await wait(2)
await js(String.raw`(() => { location.hash = '/work/00-toolchain/1'; })()`)
await wait(3)

/* Warm the interpreter before the per-unit sweeps. Installing mypy from PyPI
   takes longer than one Runtime.evaluate is allowed to run, so doing it inside
   a sweep times the whole sweep out. Polling from here keeps each evaluate short. */
await js(String.raw`(() => { globalThis.__phVerdict = null; document.querySelector('#run')?.click(); })()`)
let warm = false
for (let i = 0; i < 30 && !warm; i++) {
  await wait(10)
  warm = await js(String.raw`!!globalThis.__phVerdict`)
}
cliLog(warm ? 'judges warm' : 'WARNING: judges did not warm up in 300s')

const HARNESS = String.raw`(async (slug, n) => {
  const until = async (fn, ms = 90000) => {
    const t0 = Date.now();
    for (;;) {
      try { if (fn()) return true; } catch {}
      if (Date.now() - t0 > ms) return false;
      await new Promise(r => setTimeout(r, 120));
    }
  };
  // saved editor content persists per exercise, so clear it or the run judges
  // whatever was last typed rather than the starter
  Object.keys(localStorage).filter(k => k.startsWith('ph.code.')).forEach(k => localStorage.removeItem(k));
  const list = await fetch('data/ex-' + slug + '.json').then(r => r.json());
  const out = [];
  for (const ex of list.filter(e => e.n === n)) {
    location.hash = '/work/' + slug + '/' + ex.n;
    const mounted = await until(() =>
      document.querySelector('#run') &&
      document.querySelector('.wb-brief h1')?.textContent === ex.title, 20000);
    if (!mounted) { out.push({ n: ex.n, title: ex.title, error: 'did not mount' }); continue; }
    globalThis.__phVerdict = null;
    document.querySelector('#run').click();
    const done = await until(() => globalThis.__phVerdict);
    if (!done) { out.push({ n: ex.n, title: ex.title, error: 'timed out' }); continue; }
    const v = globalThis.__phVerdict;

    const want = { ruff: [], mypy: [], raises: null, silent: false };
    for (const e of ex.expects) {
      if (e.judge === 'ruff') want.ruff.push(e.code);
      else if (e.judge === 'mypy') want.mypy.push(e.code);
      else if (e.judge === 'raises') want.raises = e.code;
      else if (e.judge === 'silent') want.silent = true;
    }
    const gotRuff = v.ruff.map(d => d.code).sort();
    const gotMypy = v.mypy.map(d => d.code).sort();
    const problems = [];
    for (const c of want.ruff.sort()) if (!gotRuff.includes(c)) problems.push('ruff missing ' + c);
    for (const c of gotRuff) if (!ex.diagnose[c]) problems.push('ruff ' + c + ' has no diagnose');
    for (const c of want.mypy.sort()) if (!gotMypy.includes(c)) problems.push('mypy missing ' + c);
    for (const c of gotMypy) if (!ex.diagnose[c]) problems.push('mypy ' + c + ' has no diagnose');
    if (want.raises && v.raises !== want.raises) problems.push('want raise ' + want.raises + ', got ' + (v.raises || 'none'));
    if (want.silent && v.raises && v.raises !== 'AssertionError') problems.push('expected silent, raised ' + v.raises);
    if (v.ok) problems.push('the starter PASSED its own tests');
    const readings = [...document.querySelectorAll('.reading h4')].map(e => e.textContent);
    if (!readings.length) problems.push('no reading shown');
    out.push({ n: ex.n, title: ex.title, ruff: gotRuff, mypy: gotMypy, raises: v.raises, readings, problems });
  }
  return out;
})`;

const manifest = await js(`fetch('data/manifest.json').then(r => r.json())`)
const only = '@@ONLY@@'.split(/\s+/).filter(Boolean)
const slugs = manifest.track.filter(u => u.hasEx).map(u => u.slug)
  .filter(s => !only.length || only.some(o => s.startsWith(o)))
if (!slugs.length) { cliLog('no unit matched ' + JSON.stringify(only)); }
let total = 0, bad = 0
for (const slug of slugs) {
  // One exercise per evaluate. A whole unit in one call can exceed the CDP
  // timeout on a slow judge, and then the sweep reports nothing at all rather
  // than the one exercise that was slow.
  const count = (await js(`fetch('data/ex-${slug}.json').then(r => r.json()).then(l => l.length)`))
  const rows = []
  for (let n = 1; n <= count; n++) {
    rows.push(...await js(HARNESS + `(${JSON.stringify(slug)}, ${n})`))
  }
  for (const r of rows) {
    total++
    const probs = r.error ? [r.error] : r.problems
    if (probs.length) { bad++; cliLog(`FAIL ${slug} #${r.n} ${r.title}`); probs.forEach(p => cliLog('       ' + p)) }
  }
  cliLog(`  ${slug}: ${rows.length} exercises, ${rows.filter(r => (r.problems||[r.error]).length).length} problems`)
}
cliLog(`\nBROWSER STARTERS: ${total} exercises, ${bad} problems`)
EOF
