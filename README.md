# The Python Handbook

> Learn Python by finding out what it actually did.

Rust stops you. Python agrees with you and then does something else — and that
is the whole difficulty of the language. So this handbook runs your code past
**three judges that disagree with each other**, and treats the disagreement as
the lesson.

| Judge | Speed | Answers with | Runs |
| --- | --- | --- | --- |
| **ruff** 0.16 | ~1 ms | lint codes (`B006`, `F841`) | WebAssembly, in your tab |
| **mypy** 2.3 | ~100 ms | type codes (`attr-defined`) | Pyodide, in your tab |
| **CPython** 3.14 | ~1 s | the truth | Pyodide, in your tab |

Nothing you write leaves your browser. There is no server, no account and no
backend to pay for.

## The fourth verdict

A compiler-based book has pass and fail. This one has four, and the last is the
reason it exists:

```
@expect ruff:B006          the linter objects
@expect mypy:arg-type      the type checker objects
@expect raises:TypeError   it crashes
@expect silent             every judge is happy and it is still wrong
```

`silent` is mutable default arguments, late-binding closures, `is` on large
integers, a shallow copy that shares its rows. Python's most expensive bugs are
invisible to every static tool, so the exercise passes ruff, passes mypy, runs
clean — and the hidden tests fail anyway.

## Running it

It is a static site. No npm, no bundler, no framework.

```sh
python3 build.py            # content/ -> data/
python3 -m http.server 8848 # then open http://127.0.0.1:8848
```

## Checking it

```sh
./release.sh --check         # parsing, tokenizer, vim mode, staleness
./release.sh --check --net   # the above, plus every starter and solution
                             # run past all three real judges
```

`--net` is the one that matters. It asserts that each starter still produces the
verdict its prose describes, that every code a judge emits has an explanation
written for it, and that each starter still **fails its own hidden tests** — the
check that stops an exercise quietly becoming already-solved when the tools
change their diagnostics.

## Layout

```
content/       markdown you write
  units/       the notes
  ex/          eight exercises per unit
  drills/      fifteen drills per unit
  gloss/       glossary terms
  projects/    multi-stage builds
build.py       markdown -> JSON, plus the validator and the TRACK manifest
data/          generated JSON, committed on purpose
index.html     the shell
assets/app.css every token and every rule
assets/app.js  routing, views, progress, search
assets/workbench.js  the tokenizer, the three judges, the verdict
assets/vim.js  the editor's vim mode
```

`data/` is committed so the site serves from any static host with no build step,
and `release.sh` fails if it disagrees with `content/`.

## Writing for it

`docs/AUTHORING.md` is the contract. The short version: eight exercises and
fifteen drills per unit, a note between 1,400 and 2,600 words, hints and never
solutions, and every judge complaint explained in prose keyed to the exact code.

## Credits

Vim mode is ported from [the Rust Handbook](https://github.com/madalintat/rust-handbook)
(MIT), whose shape this project follows throughout.
