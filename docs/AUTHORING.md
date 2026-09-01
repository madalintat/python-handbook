# Authoring

The contract every unit, project and glossary file follows. Most of it is
enforced by `build.py`, so this document describes the rules rather than
requesting them. An exercise is finished when

    python3 build.py --check content/ex/<slug>.md

prints `N clean`, and the whole book is honest when `./release.sh --check --net`
passes.

## The three files a unit needs

```
content/units/<slug>.md    the note
content/ex/<slug>.md       exactly 8 exercises
content/drills/<slug>.md   exactly 15 drills
```

`<slug>` must appear in the `TRACK` list in `build.py`. The manifest is the
table of contents; nothing renders that is not in it.

## The note

Front matter is `slug` and `title`. The body is markdown with `## ` sections.

- **1,400 to 2,600 prose words.** Code blocks and inline code do not count.
- **At least three `## ` sections.** They become the contents rail, so they have
  to be a real outline, not decoration.
- Open with the reader's existing wrong model, not with a definition. The unit
  is worth writing only if there is something they currently believe that is
  false.
- One idea per section, and the section title says which.
- End with a short "what to carry forward" that the next unit can lean on.

## The exercises

Eight per unit, each a `## ` heading, and each with three fenced blocks:

````
## The copy that never happened

Prompt prose. At least fifteen words, addressed to the reader, describing what
to look at rather than what to type.

@expect silent
@hint One line that makes them look at the right place.
@diagnose silent Prose explaining this exact verdict.

~~~starter
code that fails
~~~

~~~tests
assert something, "message the reader will actually read"
~~~

~~~solution
code that passes
~~~
````

### `@expect`, the four verdict kinds

| Directive | Means |
| --- | --- |
| `@expect ruff:B006` | ruff reports this code |
| `@expect mypy:arg-type` | mypy reports this code |
| `@expect raises:TypeError` | running the starter raises this exception |
| `@expect silent` | the starter runs without raising, and is still wrong |

`silent` is the one a compiler-based book cannot have, and it is the most
valuable kind here. Use it whenever the defect is invisible to both static
judges.

An exercise may declare several. Exercise 5 of unit 01 declares both
`raises:AttributeError` and `mypy:attr-defined` precisely because the two judges
finding the same defect at different distances *is* the lesson.

### `@diagnose`

One per code that can appear, keyed by the code itself (`silent` for the silent
verdict). This is the single most valuable thing in the book: the reader gets
the judge's real output and, beside it, a written reading of that specific
complaint.

`--validate` fails if a judge produces a code with no `@diagnose`, so the prose
cannot fall behind the tools.

### `@hint`

At least one, as many as the exercise deserves. A hint is a sentence that makes
the reader see the error. It is never the corrected code. Solutions exist in
this repository and are compiled by the build, and are deliberately never shown.

### Hidden tests must not depend on luck

String hashing is randomised per process, so the order of a set of strings
changes between runs. A test that asserts anything about that order passes or
fails by chance, which is worse than a test that is simply wrong: it goes green
often enough to be committed and then fails in someone else's run.

Two exercises have been caught by this. Both were fixed the same way: assert on
something the language guarantees. Small integers hash to themselves, so a set of
them has a stable order; dictionaries preserve insertion order by specification;
sorting is stable. If a test needs an order, it should come from one of those and
not from a set.

`--validate` runs every case twice under different hash seeds and fails an
exercise whose verdict differs between them. That catches the obvious cases and
cannot prove their absence, so the rule above is the real defence.

### What `--validate` actually enforces

For every exercise, against real ruff, real mypy and real CPython:

1. the starter alone produces the verdict its `@expect` lines claim;
2. every code either judge reports has an `@diagnose`;
3. the starter **fails its own hidden tests**, otherwise the exercise is
   already solved and nobody would notice;
4. a `silent` starter fails with `AssertionError` specifically, not by crashing;
5. the solution passes the tests and is clean under both static judges;
6. neither verdict changes when the hash seed does.

Rule 3 is the one that stops content rotting. Rule 4 is what keeps `silent`
meaning what it says.

### Notes on making the judges cooperate

- **mypy only checks annotated functions.** An unannotated `def f(x):` has an
  implicitly `Any` parameter and mypy will not look inside the body. If an
  exercise needs a mypy verdict, the starter must carry annotations, which is
  itself worth saying to the reader.
- **ruff runs `E,F,B,SIM,UP` with `E501` ignored.** Line length is a formatting
  opinion and not a teaching signal.
- Keep starters short. The longest one in unit 01 is nine lines.

## The vocabulary gate

An exercise must be solvable with what the reader has already met. Relying on the
author to remember the ordering across 39 units does not work, so `build.py`
enforces it.

Each unit declares what its note introduces, in `INTRODUCES`. `build.py --check`
on an exercise file parses every starter and solution and refuses any construct
belonging to a later unit:

```
VOCABULARY  01-names #6 One level deep: solution uses comprehension before the reader has met it
```

`BASELINE` is what the book assumes on page one, `def`, `for`, `if`, calls,
attribute access, f-strings, annotations, the four container literals. Everything
else has to be introduced somewhere before it can be used.

Two rules follow when you hit a violation:

**Do not weaken the gate to make an exercise pass.** Either rewrite the solution
using what is available, or move the feature to the unit whose note genuinely
teaches it. The second is legitimate, a note that shows `sorted()` while
explaining in-place versus returning has introduced `sorted`, and `INTRODUCES`
should say so.

**The hidden tests are not gated.** The reader never writes them, so they may use
anything.

Where the idiomatic solution needs a later tool, say so in the `@diagnose` prose
and point forward: "unit 12 shows the one-line version". That turns a limitation
into a thread the reader can follow.

## One runner, two judges

`assets/runner.py` is the single definition of what running a reader's code
means: it compiles the code as `your_code.py` and the hidden tests as
`hidden_tests.py`, executes both in one namespace, and reports what happened.

The browser runs that file inside Pyodide and calls `run_json`. `build.py
--validate` runs the same file in a subprocess. Nothing about the two paths is
written twice, which matters because anything that differed between them, the
filenames a traceback names, the line numbers it reports, how an exception is
spelled, would mean the validator was not judging the artefact the reader runs.

That equivalence is checked rather than assumed. `--validate` judges four
snippets alongside the exercises whose exceptions could be named differently by
the two paths (a builtin, a qualified name, a user-defined class, a nested
module), and `./qa-browser.sh` compares every exercise's browser verdict against
the `@expect` its prose is written for.

The division of labour follows the workbench exactly: **ruff and mypy see the
code alone**, which is what a reader has in the editor, and **CPython sees the
code with its hidden tests**, which is what pressing Run does. A solution that
is "ruff clean" is therefore a claim about the file the reader ends up with.

## What the browser cannot do

`build.py --validate` runs CPython in a subprocess and the workbench runs it in
Pyodide, and a handful of things differ. An exercise that relies on one of these
passes offline and fails, or worse silently disagrees, in the browser.

**No threads.** `threading.Thread.start()` raises `RuntimeError: can't start new
thread`, and so do `ThreadPoolExecutor` and `asyncio.to_thread`. Unit 33 teaches
concurrency by interleaving generators for this reason, which turns a race that
happens one run in a thousand into one that happens every time.

**`time.sleep` is not blocking.** Pyodide implements it by suspending the
WebAssembly stack, so a coroutine that calls `time.sleep` yields to the event
loop where CPython's would block. An exercise about blocking the loop has to
block with ordinary synchronous work, not with `sleep`. This one cost an
afternoon: the starter passed its own tests in the browser and failed offline,
which is exactly the disagreement the two-runner design exists to catch.

**`asyncio` needs the suspending call path.** `judgeRun` calls Python through
`callPromising` when the browser has JSPI, which is what lets `asyncio.run`
work at all. Browsers without it fall back to an ordinary call, where a running
event loop raises. Nothing in the book's exercises depends on which path ran,
and unit 34's exercises are written to be true either way.

**`multiprocessing` does not run.** `cpu_count()` answers; nothing else does.

**One interpreter, many runs.** The browser keeps a single Pyodide for the
session where the offline judge forks a process per case, so anything a run
leaves behind would be invisible offline and permanent in the tab. `runner.py`
restores `sys.modules` after every run for this reason, which is what makes an
exercise that shadows a standard library module safe. Anything else global that
an exercise changes, a `locale`, a `decimal` context, `sys.setrecursionlimit`,
is still yours to put back.

Anything uncertain: write it, run `./qa-browser.sh <unit>`, and believe the
browser.

## `_ph_import`, for exercises about import time

The reader's code runs the way `python your_code.py` runs it, so `__name__` is
`"__main__"`. When an exercise is about what happens on *import* instead, the
hidden tests can call `_ph_import()`, which re-executes the reader's code with
`__name__` set to `"your_code"` and returns the resulting namespace:

```python
imported = _ph_import()
assert imported["LOG"] == [], "importing the module already did the work"
```

It lives in `assets/runner.py`, so both paths have it for free. Unit 00's `__main__` guard
exercise is the reason it exists: without it, the guard can only be described,
never demonstrated.

## The projects

A project is `content/projects/<slug>.md`, one `## ` heading per stage, and the
number of stages has to match what `PROJECTS` declares. The slug has to be in
`PROJECTS` too; the manifest is the list, and a file is how a project stops
being "not written yet".

A stage is an exercise with the question turned around. An exercise asks what
some code already does, so it carries `@expect` and `@diagnose`. A stage asks
you to make code do something, so it carries one `@goal` and the same three
blocks:

```
## Stage title

At least 60 words of brief: what to build, and the reason it is built this way
rather than the obvious way. Same prose rules as everywhere else.

@goal One line. What this stage must do, shown beside every failure.

~~~starter
# the previous stages' code, plus a stub for this one
~~~

~~~tests
# acceptance tests for everything built so far
~~~

~~~solution
# the reference implementation through this stage
~~~
```

`build.py --validate` enforces four things per stage, and they are what make a
stage worth attempting:

1. **The starter fails its tests.** There is work to do.
2. **The solution passes them.**
3. **The solution is clean** under ruff and mypy. The reference implementation
   is code the reader is invited to compare against, so it has to be worth
   comparing against.
4. **Stage N+1's starter passes stage N's tests.** This is the one that matters
   most: it turns "built in stages that accumulate" from a promise into a
   checked claim, so a reader can start at stage 3 knowing 1 and 2 already work.
   Break carried-forward code and the build names the stage and the assertion.

Every stage also runs under two hash seeds, like every exercise, and the
solution is stripped from the shipped JSON.

Write the tests against the whole artefact so far, not only the new part. That
is what makes the continuity check meaningful, and it is what a reader wants:
the thing either works or it does not.

## The drills

Exactly fifteen, each a `## ` question, three or more options, exactly one
marked `(x)`, and a `> ` line explaining why.

```
## What does `del x` remove?
- ( ) The object `x` refers to
- (x) The name `x` from its namespace
- ( ) Both, always
> `del` unbinds a name. The object is destroyed only if that was the last reference.
```

The explanation is shown whether the reader was right or wrong, so write it as
teaching rather than as a verdict.

## The glossary

`content/gloss/*.md`, one `## Term` per entry, at least eight words of
definition. `[[other-term]]` links to another entry. Terms are cheap and worth
writing as you go: anything a note uses as though the reader already knows it
belongs here.

## Generated pages

Two pages have no source file and must not be written by hand:

- **`#/errors`** is built from every `@diagnose` in the book.
- **`#/search`** is built from notes, sections, exercise prose and glossary
  terms.

Both are regenerated by `python3 build.py`, which is why `data/` is committed
and why `release.sh` fails when it is stale.

## Prose rules

- Second person. The reader is doing something, not being lectured.
- Name the thing, then say what it costs. Never introduce a feature without the
  case where it is the wrong answer.
- No exclamation marks, no "simply", no "just", no "obviously". If it were
  obvious the unit would not exist.
- Prefer the specific to the general: `257 is 257` beats "identity comparisons
  can be surprising".
- British spelling, Oxford commas off.

`build.py` enforces the mechanical half of these on every build, over prose only,
with fenced blocks and inline code excluded: no em or en dashes, no curly quotes,
no exclamation marks, no "simply", no "obviously", no "just" used as a minimiser.
A rule nobody checks is a rule followed unevenly, which is unit 32's argument
applied to this book's own text.

It also checks every reference to another unit. A note that says "unit 21
explained" when unit 21 comes later is telling the reader to have read something
they have not, and there are several hundred of these.
