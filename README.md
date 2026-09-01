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
./release.sh --check                    # everything that runs offline
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

## Writing content

The contract every unit, project, drill and glossary file follows is in
[docs/AUTHORING.md](docs/AUTHORING.md). Most of it is enforced by `build.py`
rather than requested, which is the point: a rule nobody checks is a rule.
