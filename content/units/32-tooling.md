---
slug: 32-tooling
title: Tooling and practice
---

Unit 00 set up `ruff`, `mypy` and `pytest` and asked you to take them on trust. This unit is the argument, and the practices that make them worth having: what each tool is actually for, how they fit together, and what a project looks like when the machinery is doing the work instead of the people.

## The four tools, and their jobs

**`ruff`** is a linter and a formatter. As a linter it finds patterns that are wrong or suspicious, hundreds of rules ported from `flake8`, `pylint`, `isort`, `bugbear` and others, in one tool that runs in milliseconds. As a formatter it replaces `black`, producing the same output.

**`mypy`** checks types, which units 24 and 25 covered.

**`pytest`** runs tests, which unit 31 covered.

**`uv`** manages environments, dependencies and Python versions themselves.

They overlap almost not at all, which is why running all four is normal rather than excessive. A linter cannot know a type is wrong, a type checker cannot know a test fails, and neither can tell you that a function is unused.

## Configuring `ruff`

The default rule set is small and safe. The useful configuration is choosing which families to add:

```toml
[tool.ruff.lint]
select = ["E", "F", "B", "SIM", "UP", "I"]
ignore = ["E501"]
```

`E` and `F` are the `pyflakes` and `pycodestyle` basics: undefined names, unused imports, obvious mistakes. `B` is `bugbear`, which is the family most worth adding, because its rules are about behaviour rather than style: the mutable default from unit 02, the loop variable captured in a closure from unit 08, the bare `except`.

`SIM` suggests simpler forms of things you wrote the long way. `UP` rewrites code to use newer syntax, which is how a codebase stops accumulating `typing.List` and `%`-formatting. `I` sorts imports, which is one fewer thing to think about and one fewer thing to disagree about in review.

`E501`, the line-length rule, is worth ignoring when the formatter is already handling line length, because the two disagree about strings and comments the formatter cannot break.

## Living with a linter

Two habits make the difference between a linter that helps and one people fight.

**Fix, do not suppress.** `ruff check --fix` applies the safe fixes automatically, and for most of the rules above that is the whole interaction. When a rule genuinely does not apply, `# noqa: B008` silences that one code on that one line, and the code must be named for the same reason unit 25 gave for `type: ignore`: a bare `# noqa` silences the real problem that appears on that line next year. `ruff` will tell you about unused suppressions if you ask it to, which is how they get removed.

**Turn a rule off at the project level or not at all.** A rule that produces a suppression in twenty files is a rule you have decided against, and saying so once in `pyproject.toml` is honest, greppable and reviewable. Twenty `noqa` comments are the same decision made invisibly.

The corollary is that adopting a new rule family is a project decision with a cost, and the way to do it is one family at a time, fixing what it finds, rather than selecting everything and drowning.

## Formatting is not a matter of taste

`ruff format` reformats to one canonical style. The argument for it has nothing to do with which style is better.

A formatter ends every discussion about formatting, permanently, which is worth more than any particular choice it makes. It makes diffs smaller, because nobody reformats a file while editing it. And it removes a class of review comment that costs attention and produces nothing.

Adopt it on the whole repository in one commit, add that commit to `.git-blame-ignore-revs`, and stop thinking about it.

## Pre-commit

`pre-commit` runs the tools before a commit is made:

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.16.5
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
```

The value is that a formatting problem never reaches CI, never reaches a reviewer, and never becomes a conversation. The cost is a moment on each commit and the occasional need for `--no-verify` when you are committing something deliberately broken.

Keep hooks fast. A pre-commit that takes thirty seconds gets bypassed, and a hook everybody bypasses is worse than no hook, because it produces the belief that the check is running.

The rule that follows: **the same checks run in CI**. Pre-commit is a convenience that catches things early; CI is what actually enforces them, because it is the one that cannot be skipped.

## CI, and what it is for

A minimum that pays for itself on any project with more than one person:

```yaml
- run: uv sync
- run: uv run ruff check .
- run: uv run ruff format --check .
- run: uv run mypy src/
- run: uv run pytest
```

Four commands, and between them they answer "is this branch in a state somebody could merge". Two properties matter more than what is in the list.

It must be **fast**, because a check that takes twenty minutes stops being read and starts being waited out. And it must be **trusted**, meaning a red build is always a real problem. One flaky test teaches everybody to re-run the job without looking, and from that moment the suite is decorative. Fix or delete a flaky test the day you find it.

## Making the machine do the work

The thread running through this whole phase, and through the way this book was built, is that a rule a tool enforces is a rule people do not have to remember.

A convention in a style guide is followed unevenly. The same convention as a lint rule is followed exactly, forever, without anybody spending attention on it. That transfer is available far more often than people use it: a project-specific rule can be a `ruff` custom rule, a fifteen-line AST script from unit 28, or a test.

This book's own build is an example. The vocabulary gate refuses an exercise that uses a construct the reader has not met. Every emitted diagnostic code must have an explanation, or the build fails. Every exercise runs under two hash seeds, so an accidental dependence on set ordering fails immediately rather than intermittently. None of those are things an author can be relied on to remember, and all of them are cheap to check.

The question worth asking whenever the same review comment appears twice is: could this be a check? It usually can.

## The tools not in unit 00

Four more are worth knowing about by name, so you recognise them when you meet them.

**`tox` and `nox`** run your test suite across several Python versions in isolated environments, which is what a library needs before claiming to support them. `nox` configures in Python rather than in an ini file, which most people find easier.

**`coverage`**, usually through `pytest-cov`, which unit 31 covered and cautioned about.

**`bandit`** and **`pip-audit`** look for security problems: the first for suspicious patterns in your code, the second for known vulnerabilities in your dependencies. `pip-audit` in CI is close to free and occasionally tells you something urgent.

**`hypothesis`** generates test inputs rather than taking the ones you thought of, and shrinks a failure to the smallest input that still reproduces it. It is the tool that finds the empty list, the duplicate, the Unicode character you had not considered, and it is worth reaching for on anything with a clear invariant: a round trip that must be exact, a sort that must be stable, a parser that must never crash.

## What good practice actually looks like

Small commits with messages that say why. A branch that is short-lived, because a long one is a merge conflict accumulating interest. Tests with the change rather than after it. And a `README` that says how to run the thing, which is the single highest-value document in most repositories and the one most often missing. Four lines cover it: how to install, how to run, how to test, and what the project is for. A new person, or you in eight months, needs exactly those and can read the code for the rest.

None of that is about Python. It is about the fact that the expensive part of software is not writing it, and every practice here is a trade of a little effort now against a lot of confusion later.

The tools in this unit are the cheapest version of that trade available. Four config sections and a CI file, once, and they keep working while you think about something else.

One last thing, because it is the practice that survives when the others are inconvenient. When you fix a bug, ask whether a check could have caught it, and add that check. Not always a test: sometimes a lint rule, sometimes a type annotation that makes the mistake unrepresentable, sometimes an assertion at a boundary. Bugs cluster, and the second occurrence of one you have already seen is the most avoidable failure there is.
