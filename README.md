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

### What `--validate` actually enforces

For every exercise, against real ruff, real mypy and real CPython:

1. the starter alone produces the verdict its `@expect` lines claim;
2. every code either judge reports has an `@diagnose`;
3. the starter **fails its own hidden tests**, otherwise the exercise is
   already solved and nobody would notice;
4. a `silent` starter fails with `AssertionError` specifically, not by crashing;
5. the solution passes the tests and is clean under both static judges.

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

## `_ph_import`, for exercises about import time

The reader's code runs the way `python your_code.py` runs it, so `__name__` is
`"__main__"`. When an exercise is about what happens on *import* instead, the
hidden tests can call `_ph_import()`, which re-executes the reader's code with
`__name__` set to `"your_code"` and returns the resulting namespace:

```python
imported = _ph_import()
assert imported["LOG"] == [], "importing the module already did the work"
```

Both the browser runner and `--validate` provide it. Unit 00's `__main__` guard
exercise is the reason it exists: without it, the guard can only be described,
never demonstrated.

## Checking a change

In increasing order of what they cost and what they prove:

```sh
python3 build.py                    # parses everything, runs every gate
./release.sh --check --net          # the above, plus all three judges offline
./release.sh --check --net --browser  # the above, plus everything in a browser
```

`build.py` alone refuses a note outside its word budget, a unit missing one of
its three parts, an exercise using a construct from later in the track, a
`@diagnose` that no `@expect` accounts for, a reference to a unit that comes
later, and prose that breaks the house style. `--net` runs ruff, mypy and
CPython over every starter and solution, each under two hash seeds.

`--browser` needs a server on 8848 and the `ego-browser` CLI, and runs three
scripts that can also be run on their own:

```sh
./qa-browser.sh [unit ...]   # every starter, judged by the browser's own copies
./qa-solutions.sh [slug ...] # every project solution, run in the browser
./qa-views.sh                # every route, at six widths, in both themes
./qa-controls.sh             # every control pressed, and what it remembers
```

`qa-browser.sh` is the one that matters most: it checks that the browser reaches
the same verdict the offline run did, which is the only way to catch the two
paths drifting apart, and it has caught three genuine divergences so far.

`qa-solutions.sh` covers the half it cannot. A starter fails on its first stub,
so a project's real code can pass every offline check having never executed a
line inside Pyodide, and that is exactly where a divergence lives: event loops,
clocks, recursion limits and the cycle collector all behave differently under
WebAssembly. It found one that no offline run could have: a benchmark measuring
a clock the browser deliberately blunts.
`qa-views.sh` checks that nothing overflows its column and that the right chrome
appears at each width. `qa-controls.sh` presses every button and checks what
survives a reload.

## The projects

`content/projects/<slug>.md`, one `## ` heading per stage, and the slug plus
the number of stages declared in `PROJECTS` in `build.py`. A mini is four
stages, a core is eight, a deep one is twelve, and a file whose stage count
does not match what it declared is refused.

Each stage is a brief, exactly one `@goal`, and the same three blocks an
exercise has:

```
## Saying that something is gone

You cannot erase from an append-only file...

@goal `delete` writes a tombstone, and a reopened store still knows about it.

~~~starter
...
~~~
~~~tests
...
~~~
~~~solution
...
~~~
```

The brief is at least sixty words, because a stage that can be explained in one
line is a step rather than a stage. The `@goal` is one sentence naming what
will be true when the stage is done, and it is what the workbench shows beside
a failure instead of the verdict list an exercise gets.

### A stage extends; it never restarts

This is the rule the whole format rests on, and it is checked rather than
trusted. For every stage:

1. the starter **fails** its own tests, or there is nothing to do
2. the solution **passes** them, and is ruff and mypy clean
3. **stage N+1's starter passes stage N's tests**

The third is the one that bites. It means a starter may only stub out what its
own stage is about: stubbing a function an earlier stage's tests run through
breaks the chain, and `--validate` says which stage and which test. It also
means a stage may improve earlier code freely, as long as everything earlier
still passes. Several projects here do exactly that, and the refactor is part
of the lesson.

A stage may not weaken an earlier stage's tests to make its own starter pass.

### Writing one

The reliable order is to write the solution first, run its tests, and only then
cut the starter out of it. A starter written first tends to describe a design
the solution then drifts away from.

Check a project on its own while writing it:

```sh
python3 build.py --check content/projects/<slug>.md   # parses and gates prose
python3 build.py --validate                           # runs every stage of everything
```

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
