# The Python Handbook

Thirty-nine units, 312 exercises and fifteen projects, from `id()` and
rebinding through to a GPT you train and sample from. It runs entirely in a
browser: the code you write is judged by real ruff, real mypy and real CPython,
all three compiled to WebAssembly, with no server and no account.

Unit 32 argues that a README says four things. These are them.

## What it is for

Learning Python properly, past the part where the tutorials stop. The units go
in order and each one assumes the ones before it, which is checked rather than
hoped for: the build refuses an exercise that uses a construct from later in
the track.

The projects are the other half. A project is one artefact built over four,
eight or twelve stages that accumulate, so stage six's starter is stage five's
solution, and that is a checked claim rather than a promise.

| tier | projects | stages each |
|------|----------|-------------|
| mini | 4 | 4 |
| core | 10 | 8 |
| deep | 1 | 12 |

Bloom filter, LRU cache, retry decorator, regex engine, n-gram model,
micrograd, BPE tokenizer, JSON parser, test framework, ORM, async crawler,
key-value store, a CLI packaged to a wheel, a web framework, and a GPT.

## How to run it

```sh
python3 -m http.server 8848     # then open http://127.0.0.1:8848/
```

There is no build step for a reader and nothing to install. The page fetches
`data/`, which is committed, and the judges from a CDN.

## How to build it

```sh
python3 build.py                # content/ -> data/, and every gate
```

`data/` is committed on purpose, so the site is servable from a checkout and so
a content change that forgets to rebuild is caught.

## How to test it

In increasing order of what they cost and what they prove:

```sh
./release.sh --check                    # everything that runs offline: the build
                                        # and its gates, the tokenizer, the note
                                        # renderer, focus mode against every real
                                        # stage, vim mode, and every text colour
                                        # against every ground it sits on
./release.sh --check --net              # plus all three judges, on every
                                        # starter and solution, under two hash seeds
./release.sh --check --net --browser    # plus the same code judged in a real
                                        # browser, every route at every width in
                                        # both themes, and every control pressed
```

The browser pass needs a server on 8848 and the `ego-browser` CLI. Its scripts
also run on their own:

```sh
./qa-browser.sh [unit ...]      # every starter, judged by the browser's own copies
./qa-solutions.sh [project ...] # every project solution, executed inside Pyodide
./qa-views.sh                   # every route, at six widths, in both themes
./qa-controls.sh                # every control pressed, and what it remembers
```

The two that matter most are `qa-browser.sh`, which is the only thing that
catches the offline and browser paths drifting apart, and `qa-solutions.sh`,
which is the only thing that runs a project's real code where the reader runs
it. Between them they have caught four genuine divergences.

## What building this taught us

General enough to be worth carrying to the next thing, in rough order of how
much they cost to learn.

**Enforce it or lose it.** Every rule this book depends on is a build failure
rather than a paragraph in a style guide: what a unit is allowed to assume,
that a project stage extends rather than restarts, that every reported error
has prose explaining it, that no note points forward. A rule nobody checks is a
rule, briefly. `build.py` refusing the content is what keeps 39 units honest
about each other.

**Derive, never annotate.** The editor needs to know which lines of a stage are
the reader's work. That is the difference between this starter and the previous
solution, which the file already contains, so the build computes it. Anything
hand-maintained about content drifts from the content, silently, starting the
day it is written.

**One definition, used twice.** The same code runs offline in a subprocess and
in the browser under WebAssembly, and `assets/runner.py` is one file used by
both. Two definitions of "what running this means" would agree for about a
week. Two QA scripts then check that the two paths actually reach the same
verdict, which has caught four genuine divergences.

**A gate that cannot fire is not a gate.** One check confirmed the browser had
loaded the right code by comparing the first forty characters, which are
identical between starter and solution in 98 of 108 stages. Ask of every check:
what input would make this fail? If there isn't one, it is decoration.

**A check nobody runs rots.** A sweep was written, found a real bug, and was
then left out of the one command that runs every check. If it is not in
`release.sh`, it does not exist.

**Measure best of N, never once.** A refactor here looked like a ten percent
regression on a single sample and was nothing on best of three. Noise only ever
makes things slower, so the minimum is the honest number.

**A benchmark shorter than your clock measures your clock.** A timing assertion
passed offline and failed in the browser, because `perf_counter` there is
`performance.now()`, which browsers deliberately blunt. Scale the work until
the timer can see it, which is what `timeit` does and why.

**Count work, not seconds.** Where a test wants to say something is cheap,
count seeks or calls or appends. A seek count is the same on every machine and
in every runtime; a duration is a statement about the machine that ran it.

**Do not collect garbage you can avoid creating.** The autograd engine made
every node part of a reference cycle, because the closure that pushes a
gradient back held the value that held the closure. Turning the collector off
was a 28x speed-up and a memory leak; passing the gradient as an argument
removed the cycles for the cost of one parameter and beat the workaround on
every axis.

**A colour nobody measured is a colour that fails.** Six of this book's inks
and accents were below the contrast ratio text needs, including the one used
for every card's metadata, every rail link and every code comment, at 2.4 to
1. Nobody noticed by looking, because the page reads well to somebody with the
eyesight it was designed on. `test_contrast.mjs` reads the two `:root` blocks
and checks every pair the stylesheet actually draws, which is the only way a
palette stays legible while it keeps being tuned.

**Measuring during an animation measures the animation.** Two checks in this
session failed on a page that was correct: the contents sheet was measured
mid-slide and reported below the fold, exactly as the bug it was written for
would look. Anything that moves has to be polled to its resting position, not
waited for by a number somebody guessed.

**Two documents holding the same rules is one document and a bug.** This README
was a near-duplicate of the authoring contract until it was noticed, which is
exactly how long that kind of thing survives.

**A number in prose is a number that will be wrong.** Comments here quoted the
shape of one project stage to explain why the editor works as it does. They
went stale inside a single session, because a change to how the work is worked
out moved them and nothing was watching. Any figure worth writing down is worth
a check that fails when it changes, and the check should name the files to fix.

**Check the cheap thing first.** Two of the hot-path fixes in this repository
are the same shape: compute the expensive answer only after a free comparison
says it might have changed. It is easy to write the guard the other way round
and never notice, because the code is correct, only wasteful.

## Writing content

The contract every unit, project, drill and glossary file follows is in
[docs/AUTHORING.md](docs/AUTHORING.md). Most of it is enforced by `build.py`
rather than requested, which is the point: a rule nobody checks is a rule.
