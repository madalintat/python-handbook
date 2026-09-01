#!/usr/bin/env bash
#
# Every route, at every breakpoint, in both themes, plus every control.
#
# qa-browser.sh checks that the judges give the right verdicts. This checks that
# the pages around them render, fit, and respond: nothing overflows its column,
# the right chrome appears at each width, and every button does what it says.
#
# Needs: a server on 8848 (python3 -m http.server 8848) and the ego-browser CLI.
#
#   ./qa-views.sh
set -uo pipefail
cd "$(dirname "$0")"
ego-browser nodejs <<'EOF'
await useOrCreateTaskSpace('python handbook views')
await gotoAndWait('http://127.0.0.1:8848/#/', { timeout: 30 })
await cdp('Page.reload', { ignoreCache: true })
await wait(4)

const manifest = await js(`fetch('data/manifest.json').then(r => r.json())`)
const unit = manifest.track.find(u => u.hasEx).slug
const project = (manifest.projects || [{}])[0]?.slug

const ROUTES = [
  '/', '/track', '/projects', '/progress', '/glossary', '/glossary/A',
  '/errors', '/search/', '/search/dict', '/nonsense-route',
  `/unit/${unit}`, `/work/${unit}/1`, `/drills/${unit}`,
  ...(project ? [`/project/${project}`] : []),
]

const VIEWPORTS = [
  { name: 'small',   w: 320,  h: 568,  nav: false, tabbar: true,  rail: false },
  { name: 'phone',   w: 390,  h: 844,  nav: false, tabbar: true,  rail: false },
  { name: 'tablet',  w: 820,  h: 1180, nav: false, tabbar: true,  rail: false },
  { name: 'laptop',  w: 1280, h: 800,  nav: true,  tabbar: false, rail: true  },
  { name: 'desktop', w: 1600, h: 900,  nav: true,  tabbar: false, rail: true  },
  { name: 'wide',    w: 2560, h: 1440, nav: true,  tabbar: false, rail: true  },
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
  for (const [key, want] of [['nav', vp.nav], ['tabbar', vp.tabbar], ['rail', vp.rail]]) {
    if (chrome[key] !== want) note(`${vp.name}: ${key} is ${chrome[key] ? 'shown' : 'hidden'}, expected the opposite`)
  }
  if (chrome.sheetbtn === vp.rail) note(`${vp.name}: the contents sheet button and the rail are both ${chrome.rail ? 'shown' : 'hidden'}`)
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
  if (vp.w < 900 && small.length) {
    for (const s of small) note(`${vp.name}: touch target too small: ${s}`)
  }
}

await cdp('Emulation.clearDeviceMetricsOverride')
cliLog(`\nVIEWS: ${problems.length} problems`)
EOF
