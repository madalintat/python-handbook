# Audit, September 2026

A full pass over the frontend: correctness, security, mobile, accessibility,
and the flows a reader actually takes. Every finding below was confirmed by
running the page, not by reading the code; every fix lands with a check that
fails if it regresses, in the spirit of "enforce it or lose it".

## Todo

Marked before each commit. `[x]` done, `[~]` in progress, `[ ]` not started.

- [x] Plan and this document
- [x] `esc()` escapes quotes: a search query or stage title with a `"` in it
      broke out of an attribute, which is a reflected script injection via URL
- [ ] Search: results render in place, typing no longer pushes a history entry
      per keystroke, the caret no longer jumps, a malformed query cannot crash
      the page, and a match inside an HTML entity cannot corrupt the markup
- [ ] Router: a slow fetch from the route you left cannot overwrite the route
      you are on
- [ ] Streak counts days in the reader's timezone, not UTC
- [ ] Workbench: one page-hide flush instead of a leaked listener per mount;
      opening a project stage on a phone no longer scrolls past the brief and
      pops the keyboard; the run shortcut names the right key on the right
      platform and is hidden where there is no keyboard; a long brief scrolls
      inside its sticky column instead of being cut off
- [ ] Phone chrome: the contents sheet sits above the tab bar, closes on tap
      outside and on Escape, and says whether it is open; the mascot stays off
      phones and off the workbench; the browser chrome takes the page colour
- [ ] Accessibility: verdicts, readings and drill answers are announced;
      navigations and the exercise strip are labelled; the rail toggle says
      what it will do; answering a drill moves focus to Next
- [ ] Contrast: every text colour meets WCAG AA against every ground it is
      used on, in both themes, and a test proves it
- [ ] Browser QA covers the new behaviour: history, sheet, companion, focus
- [ ] README and release.sh know about the new check

## Findings

### Security

**Reflected script injection.** `esc()` escaped `&`, `<` and `>` and nothing
else, and two templates put its output inside a double-quoted attribute: the
search box's `value` and a project stage's `title`. A link such as
`#/search/%22%20autofocus%20onfocus%3Dalert(1)%20x%3D%22` ran script in the
page's origin, where every saved snippet and the reader's progress live. One
function, one fix: `esc` escapes `"` and `'` too.

### Correctness

**Search filled the history.** Each debounced keystroke assigned
`location.hash`, which pushes a history entry, so Back after typing "dict"
walked through "dic", "di", "d". The same assignment re-rendered the whole
page, rebuilding the input and moving the caret to the end. Results now render
in place and the URL is updated with `replaceState`.

**Route race.** Every view awaits a fetch before writing to `main`. Leave a
route while its fetch is in flight and the old view writes over the new one
when it lands. `load()` now rejects with a sentinel when a newer route has
started since it was called, and the router ignores that sentinel.

**Streak by UTC.** "Today" was `toISOString().slice(0, 10)`, so for a reader
east of Greenwich the day rolled over in the small hours of the morning and a
session at 1am counted for yesterday.

**Search crashed on a malformed query.** `decodeURIComponent` throws on a
bare `%`, and nothing caught it.

**Search marks inside entities.** Highlighting ran a replace over already
escaped text, so searching for "amp" turned `&amp;` into `&<mark>amp</mark>;`.

**A listener per mount.** Every workbench added a `beforeunload` listener and
none removed it, so a session's worth of exercises left a session's worth of
closures each saving a detached editor on exit.

### Mobile

**A project stage opened 1,600 pixels down with the keyboard up.** Placing the
caret on the stage's work called `focus()`, which on a phone scrolls the page
to the editor and raises the keyboard before the reader has seen the brief.
Measured: `scrollY` 1632 and the textarea active on mount at 390px wide.

**The contents sheet was under the tab bar.** The sheet's bottom was at the
viewport's bottom and the tab bar was drawn over it, so the last link of every
unit's contents was 34 pixels under the bar. Measured on the unit page at
390x844: last link bottom 822, tab bar top 788.

**The mascot covered the Run button.** On a phone the companion's bubble sat
exactly over the run row and the first verdict, for eleven seconds, on about a
fifth of route changes.

**No way to dismiss the sheet.** Tapping outside it did nothing and Escape did
nothing; the only ways out were the button that opened it or a link.

**The run shortcut said ⌘⏎ everywhere**, including on a phone with no
keyboard and on Windows where the key is Ctrl.

**A long brief was cut off on desktop.** The brief column is sticky; a brief
taller than the viewport stuck at the top and its lower paragraphs were
unreachable until the results column had been scrolled past.

### Accessibility

**Contrast.** Measured against the page background in the light theme:
`--ink-4` 2.41:1, used for the eyebrow, card metadata, rail links, footer,
stat labels and code comments; `--ink-3` 4.20:1, used for most secondary text;
`--gold` 2.98:1, the brand colour, used as text; `--ember` 4.04, `--moss`
3.88, `--warn` 3.07. White on the gold primary button was 3.56:1. In the dark
theme `--ink-4` was 2.93:1. WCAG AA asks 4.5:1 for text this size. The palette
is retuned so every ink and accent clears 4.5:1 on every ground it is used on,
and `test_contrast.mjs` reads the stylesheet and fails if any pair drops.

**Nothing was announced.** The verdict rows, the reading and a drill's "why"
appeared silently to a screen reader. They are live regions now. The exercise
strip was eight unlabelled links reading "1" to "8". The two navigations had
no names. The rail toggle said "Collapse" whether or not it was collapsed.
Answering a drill disabled the button that had focus, dropping focus to the
document.

### Verified clean

`./release.sh --check` passes, `qa-views.sh` reports no overflow at seven
widths in both themes, the judges run and agree in the browser, hidden
solutions are not shipped, progress erasure keeps preferences. None of that
changes here.
