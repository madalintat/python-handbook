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

### `@expect` — the four verdict kinds

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
the reader see the error. It is never the corrected code — solutions exist in
this repository and are compiled by the build, and are deliberately never shown.

### What `--validate` actually enforces

For every exercise, against real ruff, real mypy and real CPython:

1. the starter alone produces the verdict its `@expect` lines claim;
2. every code either judge reports has an `@diagnose`;
3. the starter **fails its own hidden tests** — otherwise the exercise is
   already solved and nobody would notice;
4. a `silent` starter fails with `AssertionError` specifically, not by crashing;
5. the solution passes the tests and is clean under both static judges.

Rule 3 is the one that stops content rotting. Rule 4 is what keeps `silent`
meaning what it says.

### Notes on making the judges cooperate

- **mypy only checks annotated functions.** An unannotated `def f(x):` has an
  implicitly `Any` parameter and mypy will not look inside the body. If an
  exercise needs a mypy verdict, the starter must carry annotations — which is
  itself worth saying to the reader.
- **ruff runs `E,F,B,SIM,UP` with `E501` ignored.** Line length is a formatting
  opinion and not a teaching signal.
- Keep starters short. The longest one in unit 01 is nine lines.

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
