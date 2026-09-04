#!/usr/bin/env bash
#
# Every control, pressed. Theme, vim, wrap, the contents rail and sheet, search,
# the workbench buttons, the drills, and progress including erasing it.
#
# qa-views.sh checks that pages render at every width. This checks that the
# things on them do what they say, and that what should persist does.
#
# Needs: a server on 8848 (python3 -m http.server 8848) and the ego-browser CLI.
#
#   ./qa-controls.sh
set -uo pipefail
cd "$(dirname "$0")"
out=$(mktemp)
trap 'rm -f "$out"' EXIT
ego-browser nodejs <<'EOF' 2>&1 | tee "$out"
await useOrCreateTaskSpace('python handbook controls')
await gotoAndWait('http://127.0.0.1:8848/#/', { timeout: 30 })
await cdp('Page.reload', { ignoreCache: true })
await wait(4)

const problems = []
const ok = (cond, what) => {
  if (cond) cliLog('  ok    ' + what)
  else { problems.push(what); cliLog('  FAIL  ' + what) }
}
const go = async (hash, settle = 1) => {
  await js(`(() => { location.hash = ${JSON.stringify(hash)}; })()`)
  await wait(settle)
}
/* The router does not re-render a route it is already on, so a test that
   changes a stored preference and expects the page to pick it up has to leave
   and come back. Bouncing through the track does that. */
const remount = async (hash, settle = 1.2) => {
  await go('/track', 0.6)
  await go(hash, settle)
}
/* These take a template literal, so a backslash in a regular expression has to
   be doubled: `/\\d+/` here reaches the browser as /\d+/. Written singly it
   arrives as /d+/, which matches something and is the sort of bug that makes a
   check pass for the wrong reason. */
const q = async (expr) => js(`(() => { ${expr} })()`)
const until = async (expr, secs = 30) => {
  for (let i = 0; i < secs * 2; i++) {
    if (await q(`return !!(${expr})`)) return true
    await wait(0.5)
  }
  return false
}

const manifest = await js(`fetch('data/manifest.json').then(r => r.json())`)
const unit = manifest.track.find(u => u.hasEx).slug

cliLog('=== theme ===')
await go('/')
const t0 = await q(`return document.documentElement.dataset.theme || 'unset'`)
await q(`document.getElementById('theme').click(); return 1`)
const t1 = await q(`return document.documentElement.dataset.theme`)
ok(t1 !== t0, `theme toggles (${t0} -> ${t1})`)
ok(await q(`return localStorage.getItem('ph.theme') === document.documentElement.dataset.theme`),
   'theme is remembered')
await q(`document.getElementById('theme').click(); return 1`)

cliLog('=== search ===')
await go('/search/')
ok(await q(`return !!document.querySelector('main input, main .result, main')`), 'empty search renders')
await go('/search/dict')
const hits = await q(`return document.querySelectorAll('main a[href^="#/"]').length`)
ok(hits > 0, `search for "dict" returns ${hits} results`)
await go('/search/zzzznotathing')
ok(await q(`return (document.querySelector('main').textContent || '').trim().length > 10`),
   'a search with no results still says something')

// Typing draws the results in place and replaces the URL. It used to assign
// the hash per keystroke, so Back walked out through "dic", "di" and "d".
await go('/search/', 1)
const histBefore = await q(`return history.length`)
for (const ch of ['d', 'i', 'c']) {
  await q(`const b = document.getElementById('q'); b.focus();
           b.setSelectionRange(b.value.length, b.value.length);
           document.execCommand('insertText', false, ${JSON.stringify(ch)}); return 1`)
  await wait(0.4)
}
await wait(0.4)
ok(await q(`return history.length`) === histBefore, 'typing in search pushes no history entries')
ok(await q(`return location.hash === '#/search/dic' && document.querySelectorAll('#hits a').length > 0`),
   'the URL follows the typed query and the results appear in place')
ok(await q(`const b = document.getElementById('q'); return document.activeElement === b && b.value === 'dic'`),
   'the input keeps focus and its text while typing')

cliLog('=== contents rail and sheet ===')
await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
await go('/unit/' + unit, 1.5)
ok(await q(`return !!document.querySelector('.rail')`), 'the rail is present on a wide screen')
const railBefore = await q(`return document.querySelector('#railaside, .rail')?.getBoundingClientRect().width || 0`)
await q(`document.getElementById('railtoggle')?.click(); return 1`)
await wait(0.6)
const railAfter = await q(`return document.querySelector('#railaside, .rail')?.getBoundingClientRect().width || 0`)
ok(railAfter !== railBefore, `the rail collapses (${Math.round(railBefore)} -> ${Math.round(railAfter)})`)
ok(await q(`return /expand/i.test(document.getElementById('railtoggle').getAttribute('aria-label'))`),
   'a collapsed rail offers to expand')
await q(`document.getElementById('railtoggle')?.click(); return 1`)
await wait(0.5)

const sections = await q(`return [...document.querySelectorAll('.rail a[data-sec]')].map(a => a.getAttribute('href'))`)
if (sections.length) {
  await go(sections[sections.length - 1].slice(1), 1.2)
  ok(await q(`return scrollY > 50`), 'a deep link to a section scrolls to it')
}

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await go('/unit/' + unit, 1.5)
/* The sheet slides in, and the animation runs slower under emulation than the
   stylesheet asks for, so its resting position is polled rather than waited
   for. Measuring during the slide reported it below the fold and looked
   exactly like the bug this checks for. */
const sheetRested = () => until(`(() => {
  const s = document.getElementById('sheet');
  return s.classList.contains('open') && getComputedStyle(s).transform === 'none';
})()`, 10)
await q(`document.getElementById('sheetbtn').click(); return 1`)
ok(await sheetRested(), 'the contents sheet opens on a phone')
ok(await q(`return (document.getElementById('sheet-body').textContent || '').trim().length > 0`), 'the sheet has contents in it')
/* The sheet's own box has to clear the tab bar. A unit with more sections than
   fit scrolls inside the sheet, which is what the max-height is for, so the
   check is that the box clears the bar and that scrolling to the end brings
   the last link with it. Asserting every link fits without scrolling would
   fail on any long unit for the wrong reason. */
ok(await q(`const s = document.getElementById('sheet').getBoundingClientRect();
            const t = document.getElementById('tabbar').getBoundingClientRect().top;
            return s.bottom <= t + 1`),
   'the sheet sits above the tab bar rather than under it')
ok(await q(`const s = document.getElementById('sheet');
            s.scrollTop = s.scrollHeight;
            return 1`) && await (async () => { await wait(0.4); return q(`
            const t = document.getElementById('tabbar').getBoundingClientRect().top;
            const links = [...document.querySelectorAll('#sheet-body a')];
            return links[links.length - 1].getBoundingClientRect().bottom <= t + 1`) })(),
   'the last section is reachable, whatever the unit is')
ok(await q(`return document.getElementById('sheetbtn').getAttribute('aria-expanded') === 'true'`),
   'the sheet button says it is open')
await q(`document.getElementById('sheetbtn').click(); return 1`)
await wait(0.4)
ok(!await q(`return document.getElementById('sheet').classList.contains('open')`), 'the sheet closes again')
ok(await q(`return document.getElementById('sheetbtn').getAttribute('aria-expanded') === 'false'`),
   'and says so')

await q(`document.getElementById('sheetbtn').click(); return 1`)
await sheetRested()
await q(`document.querySelector('main h1').click(); return 1`)
await wait(0.4)
ok(!await q(`return document.getElementById('sheet').classList.contains('open')`), 'tapping outside the sheet closes it')
await q(`document.getElementById('sheetbtn').click(); return 1`)
await sheetRested()
await q(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1`)
await wait(0.3)
ok(!await q(`return document.getElementById('sheet').classList.contains('open')`), 'Escape closes the sheet')

// A link to the section already showing changes no hash and so fires no route,
// which is the case route()'s own close cannot cover.
await q(`document.getElementById('sheetbtn').click(); return 1`)
await sheetRested()
await q(`
  const links = [...document.querySelectorAll('#sheet-body a')];
  const same = links.find(a => a.getAttribute('href') === '#' + location.hash.slice(1));
  (same || links[0])?.click();
  return 1`)
await wait(0.6)
ok(!await q(`return document.getElementById('sheet').classList.contains('open')`),
   'tapping a link in the sheet closes it, including one to the section showing')

cliLog('=== a phone opens the work without jumping to it ===')
// The last stage of the biggest project, with vim mode left on: both the
// caret placement and vim's enable used to focus the editor at mount, which
// on a phone scrolls past the brief and raises the keyboard.
const project = manifest.projects.filter(p => p.hasBody).sort((a, b) => b.stages - a.stages)[0]
await q(`localStorage.setItem('ph.vim', '1'); return 1`)
await go('/track', 0.6)
await go(`/project/${project.slug}/${project.stages}`, 3)
ok(await until(`document.getElementById('run') && document.querySelector('textarea')`), 'the last stage mounts')
ok(await q(`return scrollY < 10 && document.activeElement !== document.querySelector('textarea')`),
   'the page stays at the brief and the keyboard stays down')
ok(await q(`return getComputedStyle(document.querySelector('kbd.runkey')).display === 'none'`),
   'no keyboard shortcut is advertised where there is no keyboard')
await q(`localStorage.setItem('ph.vim', '0'); return 1`)
let companions = 0
for (let i = 0; i < 20; i++) {
  await go(i % 2 ? '/track' : '/glossary', 0.3)
  if (await q(`return !!document.querySelector('.companion')`)) companions++
}
ok(companions === 0, 'the mascot stays off phones')
await cdp('Emulation.clearDeviceMetricsOverride')

cliLog('=== the workbench ===')
let onBench = 0
for (let i = 0; i < 20; i++) {
  await go(i % 2 ? `/work/${unit}/1` : `/work/${unit}/2`, 0.3)
  if (await q(`return !!document.querySelector('.companion')`)) onBench++
}
ok(onBench === 0, 'the mascot stays off the workbench, where the results appear')
await go(`/work/${unit}/1`, 1)
ok(await until(`document.getElementById('run') && document.querySelector('textarea')`),
   'the editor mounts')

const starter = await q(`return document.querySelector('textarea').value`)
await q(`
  const ta = document.querySelector('textarea');
  ta.focus(); ta.setSelectionRange(0, 0);
  document.execCommand('insertText', false, '# typed by the reader');
  return 1`)
await wait(0.5)
ok(await q(`return document.querySelector('textarea').value.startsWith('# typed by the reader')`), 'typing reaches the editor')
ok(await q(`return Object.keys(localStorage).some(k => k.startsWith('ph.code.'))`), 'edits are saved')

await q(`document.getElementById('resetcode').click(); return 1`)
await wait(0.5)
ok(await q(`return document.querySelector('textarea').value`) === starter, 'reset restores the starter, not the last edit')

await q(`localStorage.setItem('ph.wrap', '0'); return 1`)
await remount(`/work/${unit}/1`)
await until(`document.getElementById('wraptoggle')`)
const wrapBefore = await q(`return getComputedStyle(document.querySelector('textarea')).whiteSpace`)
await q(`document.getElementById('wraptoggle').click(); return 1`)
await wait(0.4)
ok(await q(`return getComputedStyle(document.querySelector('textarea')).whiteSpace !== ${JSON.stringify(wrapBefore)}
                  && document.getElementById('wraptoggle').getAttribute('aria-pressed') === 'true'`),
   'wrap toggles and says so')
await q(`document.getElementById('wraptoggle').click(); return 1`)

// start from a known state: this preference persists between runs
await q(`localStorage.setItem('ph.vim', '0'); return 1`)
await remount(`/work/${unit}/1`)
await until(`document.getElementById('vimbtn')`)
await q(`document.getElementById('vimbtn').click(); return 1`)
await wait(0.4)
ok(await q(`return document.getElementById('vimbtn').getAttribute('aria-pressed') === 'true'
                  && localStorage.getItem('ph.vim') === '1'`), 'vim mode turns on and is remembered')
await q(`
  const ta = document.querySelector('textarea');
  ta.focus();
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
  return 1`)
await wait(0.3)
ok(await q(`return document.querySelector('textarea').value`) === starter, 'in vim normal mode, j moves rather than typing a j')
await q(`document.getElementById('vimbtn').click(); return 1`)
await wait(0.3)
ok(await q(`return document.getElementById('vimbtn').getAttribute('aria-pressed') === 'false'
                  && localStorage.getItem('ph.vim') === '0'`), 'vim mode turns off again')

const hintsBefore = await q(`return document.querySelectorAll('.hint, #hintbox li').length`)
await q(`document.getElementById('hintbtn')?.click(); return 1`)
await wait(0.4)
ok(await q(`return document.querySelectorAll('.hint, #hintbox li').length`) > hintsBefore, 'a hint appears when asked for')

ok(!JSON.stringify(await js(`fetch('data/ex-${unit}.json').then(r => r.json())`)).includes('"solution"'),
   'no solutions are shipped to the browser')

cliLog('=== drills ===')
await go(`/drills/${unit}`, 1.5)
ok(await q(`return !!document.querySelector('.drill-q') && document.querySelectorAll('.opt').length >= 3`),
   'a drill renders with its options')

const first = await q(`return document.querySelector('.drill-q').textContent`)
await q(`document.querySelectorAll('.opt')[0].click(); return 1`)
await wait(0.5)
ok(await q(`return !!document.querySelector('#why .reading')`), 'answering shows why')
ok(await q(`return !!document.querySelector('.opt.right')`), 'the correct option is marked')
ok(await q(`return [...document.querySelectorAll('.opt')].every(o => o.disabled)`),
   'the options are locked once answered')

await q(`document.getElementById('nextq').click(); return 1`)
await wait(0.5)
ok(await q(`return document.querySelector('.drill-q').textContent`) !== first,
   'next moves to another question')

// walk the whole set and check the score screen and what it stores
const total = await q(`const m = /of (\\d+)/.exec(document.querySelector('#quiz .eyebrow')?.textContent || ''); return m ? Number(m[1]) : 0`)
ok(total > 0, `the drill set reports how many questions it has`)
for (let i = 0; i < total + 2; i++) {
  const done = await q(`return !document.querySelector('.opt')`)
  if (done) break
  await q(`document.querySelectorAll('.opt')[0].click(); return 1`)
  await wait(0.25)
  await q(`document.getElementById('nextq')?.click(); return 1`)
  await wait(0.25)
}
ok(await q(`return /\\d+ \\/ \\d+/.test(document.getElementById('quiz').textContent)`),
   'finishing the set shows a score')
ok(await q(`return !!JSON.parse(localStorage.getItem('ph.progress') || '{}').drills?.['${unit}']`),
   'finishing the set is recorded')

cliLog('=== progress ===')
await go('/unit/' + unit, 1.2)
await go('/progress', 1.2)
const prog = await q(`return document.querySelector('main').textContent.replace(/\\s+/g, ' ')`)
ok(/notes read/.test(prog) && /exercises passed/.test(prog) && /drill sets done/.test(prog),
   'progress reports notes, exercises and drills')
ok(prog.includes(`/${manifest.track.length}`), 'progress counts against the whole track')

await q(`localStorage.setItem('ph.theme', 'dark'); localStorage.setItem('ph.vim', '1'); return 1`)
await q(`
  const btn = [...document.querySelectorAll('button')].find(b => /erase/i.test(b.textContent));
  if (btn) { globalThis.__confirm = window.confirm; window.confirm = () => true; btn.click(); window.confirm = globalThis.__confirm; }
  return !!btn`)
await wait(0.8)
ok(await q(`return localStorage.getItem('ph.theme') === 'dark' && localStorage.getItem('ph.vim') === '1'`),
   'erasing progress keeps preferences')
ok(await q(`return !localStorage.getItem('ph.progress')`), 'erasing progress clears progress')

cliLog('=== keyboard ===')
await go('/track', 1)
await q(`
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
  return 1`)
await wait(0.6)
ok(await q(`return location.hash.startsWith('#/search')`), 'pressing / opens search')

cliLog(`\nCONTROLS: ${problems.length} problems`)
EOF

# The ego-browser CLI's own exit status says nothing about the run, so the
# verdict is this script's own summary line, and it exits on that. Keeping the
# format's owner and its reader in one file is what makes these usable in CI
# alone. The summary is found by its shape rather than by position: a clean run
# ends with a blank line and a failed one with a message from the CLI, and the
# per-unit lines are indented so they cannot stand in for the total.
summary=$(grep -E '^[A-Z][A-Z ]*:.*[0-9]+ problems$' "$out" | tail -1)
if [ -z "$summary" ]; then
  echo "the run printed no summary, so it did not finish" >&2
  exit 1
fi
printf '%s\n' "$summary" | grep -qE '(^|[^0-9])0 problems$'
