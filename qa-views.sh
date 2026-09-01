#!/usr/bin/env bash
#
# Every route, at every breakpoint, in both themes.
#
# qa-browser.sh checks that the judges give the right verdicts and qa-controls.sh
# presses the buttons. This one checks that the pages render and fit: nothing
# overflows its column, and the right chrome appears at each width.
#
# Needs: a server on 8848 (python3 -m http.server 8848) and the ego-browser CLI.
#
#   ./qa-views.sh
set -uo pipefail
cd "$(dirname "$0")"
out=$(mktemp)
trap 'rm -f "$out"' EXIT
ego-browser nodejs <<'EOF' 2>&1 | tee "$out"
await useOrCreateTaskSpace('python handbook views')
await gotoAndWait('http://127.0.0.1:8848/#/', { timeout: 30 })
await cdp('Page.reload', { ignoreCache: true })
await wait(4)

const manifest = await js(`fetch('data/manifest.json').then(r => r.json())`)
const unit = manifest.track.find(u => u.hasEx).slug
const project = manifest.projects?.[0]?.slug

const ROUTES = [
  '/', '/track', '/projects', '/progress', '/glossary', '/glossary/A',
  '/errors', '/search/', '/search/dict', '/nonsense-route',
  `/unit/${unit}`, `/work/${unit}/1`, `/drills/${unit}`,
  ...(project ? [`/project/${project}`] : []),
]

/* The two breakpoints in app.css: the nav gives way to the tab bar at 900, and
   the contents rail goes at 1060. Deriving the expectations from those rather
   than writing three booleans per row keeps them consistent with each other and
   with the stylesheet, and means the 901-1060 band, where the two differ, is
   actually covered. */
const NAV_AT = 900, RAIL_AT = 1060
const chromeFor = w => ({ nav: w > NAV_AT, tabbar: w <= NAV_AT, rail: w > RAIL_AT })

const VIEWPORTS = [
  { name: 'small',   w: 320,  h: 568  },
  { name: 'phone',   w: 390,  h: 844  },
  { name: 'tablet',  w: 820,  h: 1180 },
  { name: 'between', w: 1000, h: 800  },
  { name: 'laptop',  w: 1280, h: 800  },
  { name: 'desktop', w: 1600, h: 900  },
  { name: 'wide',    w: 2560, h: 1440 },
]

const problems = []
const note = (what) => { problems.push(what); cliLog('  FAIL  ' + what) }

/* Anything wider than the viewport that is not inside its own scroller is a
   page the reader has to pan sideways to read. Code blocks and tables are
   allowed to scroll; they must do it in a box of their own. */
const MEASURE = String.raw`(() => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  const scrolls = el => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('main *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 && !scrolls(el)) {
      bad.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
      if (bad.length > 2) break;
    }
  }
  return {
    overflow: [...new Set(bad)],
    bodyScrollsX: document.documentElement.scrollWidth > vw + 1,
    empty: (document.querySelector('main')?.textContent || '').trim().length < 20,
  };
})`

for (const vp of VIEWPORTS) {
  cliLog(`\n=== ${vp.name} ${vp.w}x${vp.h} ===`)
  await cdp('Emulation.setDeviceMetricsOverride',
    { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 900 })

  for (const theme of ['light', 'dark']) {
    await js(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(theme)}; })()`)
    for (const route of ROUTES) {
      await js(`(() => { location.hash = ${JSON.stringify(route)}; })()`)
      await wait(0.7)
      const m = await js(MEASURE + '()')
      const where = `${vp.name}/${theme}${route}`
      if (m.empty) note(`${where}: nothing rendered`)
      if (m.bodyScrollsX) note(`${where}: the page scrolls sideways`)
      for (const el of m.overflow) note(`${where}: ${el} overflows with no scroller of its own`)
    }
    cliLog(`  ${theme}: ${ROUTES.length} routes checked`)
  }

  // the chrome each width is supposed to show
  await js(`(() => { location.hash = ${JSON.stringify('/unit/' + unit)}; })()`)
  await wait(1)
  const chrome = await js(String.raw`(() => {
    const shown = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
    return {
      nav: shown(document.getElementById('nav')),
      tabbar: shown(document.getElementById('tabbar')),
      rail: shown(document.querySelector('.rail')),
      sheetbtn: shown(document.getElementById('sheetbtn')),
      search: shown(document.getElementById('navsearch')) || shown(document.getElementById('searchbtn')),
    };
  })()`)
  const want = chromeFor(vp.w)
  for (const key of ['nav', 'tabbar', 'rail']) {
    if (chrome[key] !== want[key]) note(`${vp.name}: ${key} is ${chrome[key] ? 'shown' : 'hidden'}, expected the opposite`)
  }
  if (chrome.sheetbtn === chrome.rail) note(`${vp.name}: the contents sheet button and the rail are both ${chrome.rail ? 'shown' : 'hidden'}`)
  if (!chrome.search) note(`${vp.name}: no way to reach search`)

  // every control a finger has to hit
  const small = await js(String.raw`(() => {
    const MIN = 40;
    const out = [];
    for (const el of document.querySelectorAll('button, a.icon-btn, .tabbar a, [role=button]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < MIN || r.width < MIN) out.push(
        (el.id || el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return out;
  })()`)
  if (want.tabbar && small.length) {
    for (const s of small) note(`${vp.name}: touch target too small: ${s}`)
  }
}

await cdp('Emulation.clearDeviceMetricsOverride')
cliLog(`\nVIEWS: ${problems.length} problems`)
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
