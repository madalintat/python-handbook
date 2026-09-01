---
slug: 30-packaging
title: Packaging and environments
---

Two questions, and almost all confusion here is one of them wearing the other's clothes. **Which Python is running?** and **what can it import?** Everything below is machinery for answering those.

## Environments

A virtual environment is a directory with its own `site-packages` and its own `python`. That is the whole idea: installing into it changes what one interpreter can import and nothing else.

```
python -m venv .venv
source .venv/bin/activate       # .venv\Scripts\activate on Windows
```

Activating puts the environment's `bin` first on `PATH`, so `python` and `pip` mean that environment's. Nothing magic happens: `which python` tells you whether it worked, and `sys.executable` inside a program tells you the truth even when `PATH` is lying.

`python -m pip install x` is worth preferring to `pip install x`, because it installs into the interpreter you named rather than into whichever `pip` the shell found. That one habit prevents most "but I installed it" conversations.

Unit 00 set this project up with `uv`, which does the same job faster and manages the Python versions too. `uv venv`, `uv pip install`, `uv run`. The concepts are identical.

## `pyproject.toml`

One file describes the project. It replaced `setup.py`, `setup.cfg`, `requirements.txt` and several others, and it is the thing to write.

```toml
[project]
name = "myapp"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["httpx>=0.27", "rich"]

[project.optional-dependencies]
dev = ["pytest", "mypy", "ruff"]

[project.scripts]
myapp = "myapp.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

`[project]` is standardised, so every tool reads the same fields. `[build-system]` names the backend that turns your source into a distribution; `hatchling` is a good default, `setuptools` is what most existing projects use, and the choice matters less than it seems.

`[project.scripts]` is how a package becomes a command: installing it creates an executable called `myapp` that imports `myapp.cli` and calls `main`. That is the entire mechanism behind every command-line tool you have installed with pip.

## Dependencies, and how tight to hold them

A version specifier says what you accept. `>=0.27` accepts anything newer, `==0.27.1` accepts one, `~=0.27.1` accepts patch releases of 0.27, and `>=0.27,<0.28` says the same thing at more length.

The rule depends on what you are building, and it is the one packaging decision that is genuinely consequential.

**A library** should specify loosely. Every pin you add is a constraint on everybody who depends on you, and two libraries pinning incompatible versions of a third is a conflict the application cannot solve. Set a lower bound where you need a feature, an upper bound only where you know something breaks.

**An application** should pin exactly, and in a lock file rather than in `pyproject.toml`. `uv.lock`, `poetry.lock` or `requirements.txt` from `pip freeze` records every package and every transitive dependency at an exact version, so a deployment is reproducible and a change to it is a change somebody reviewed.

The distinction is worth stating once more, because getting it backwards causes real pain: `pyproject.toml` says what you *can* work with, and the lock file says what you *did* work with.

## Reading `pyproject.toml` yourself

`tomllib` has been in the standard library since 3.11, and reading the file is occasionally useful: a script that checks dependency pins, a test that asserts the version matches a tag, a tool that lists what a project needs.

```python
import tomllib

with open("pyproject.toml", "rb") as f:
    config = tomllib.load(f)

config["project"]["dependencies"]
```

The `"rb"` is not optional and is the first thing everybody gets wrong. `tomllib.load` requires a **binary** file object, because TOML is defined as UTF-8 and the module decodes it itself rather than trusting whatever encoding the platform would have picked. Passing a text file gives `TypeError: File must be opened in binary mode`. `tomllib.loads` takes a string, so reading the text yourself and parsing that is the other way round and is fine.

There is no `tomllib.dump`. The standard library reads TOML and does not write it, deliberately, because round-tripping a config file without destroying its comments and formatting is a much harder problem than parsing one. If you need to write TOML, `tomli-w` writes it plainly and `tomlkit` preserves formatting.

## Versions

Python's version scheme is defined, and comparing versions as strings is wrong in a way that bites quietly: `"1.10" < "1.9"` is `True`, because `"1"` sorts before `"9"`. Versions compare **component by component, numerically**.

A version is `major.minor.patch`, optionally with a pre-release suffix (`1.0.0rc1`), a post-release (`1.0.0.post1`) or a development release (`1.0.0.dev1`). Pre-releases sort *before* the release they lead to, which is the part people get backwards.

Semantic versioning is the convention most projects follow: patch for a fix, minor for a compatible addition, major for a break. It is a promise rather than a rule, and a library that follows it is much easier to depend on loosely, which is the connection back to the previous section.

`0.x` is the exception everybody forgets: under semver, anything may break in a `0.x` release, which is why an upper bound on a `0.x` dependency is more defensible than on a `1.x` one.

## Lock files, and what they are for

A lock file records the exact resolved set: every direct dependency, every transitive one, each at one version, usually with a hash. It exists to make two installations identical.

Three things follow that are worth having straight. It is **committed**, because a lock file nobody shares locks nothing. It is **generated**, never edited, because the resolver's job is to find a set that satisfies every constraint at once and hand-editing breaks that guarantee silently. And a change to it is a **reviewable event**: a diff showing a transitive dependency jumping two major versions is exactly the sort of thing a person should see before it reaches production.

A library does not commit one, or rather, commits one for its own development and does not ship it, because a library's dependents do their own resolving and a shipped lock file would be ignored anyway.

## What gets built

Two artefacts, and it is worth knowing which is which.

A **wheel** (`.whl`) is a built distribution: a zip of the files, ready to unpack into `site-packages`. Installing one is copying. This is what pip wants.

An **sdist** (`.tar.gz`) is the source. Installing one runs the build backend on the user's machine, which is slower and needs a working toolchain if there is anything to compile.

`python -m build` produces both. `twine upload dist/*` publishes them, and testing on TestPyPI first is a cheap habit, because a version number on PyPI can never be reused.

The wheel is where the src layout from unit 29 earns its keep: a wheel built from a flat layout can silently omit a subpackage that worked in development, because development was importing the source tree rather than the built artefact.

## Reading what is installed

`importlib.metadata` is the standard-library way to ask:

```python
from importlib.metadata import version, requires, entry_points

version("httpx")        # '0.27.2'
requires("myapp")       # the dependency specifiers
entry_points(group="console_scripts")
```

Preferring this to a hand-maintained `__version__` attribute means one version number, in `pyproject.toml`, rather than two that drift apart.

## What goes wrong, and what it means

Four failures cover most of it, and each has a one-line diagnosis.

**"I installed it and it is not there."** Two environments. `sys.executable` in the failing program, and `which python` in the shell that installed it, and compare.

**"It works here and not in CI."** Something is installed locally that is not declared. A fresh environment from the lock file, or `uv run --isolated`, reproduces it immediately, and the fix is to add the missing dependency rather than to change CI.

**"pip cannot find a version that satisfies the requirement."** Two of your dependencies want incompatible versions of a third, or the package has no wheel for your Python version. The error names the constraints; reading them rather than trying older versions at random is much faster.

**"It imports in development and not once installed."** The flat layout, importing the source tree. Unit 29's src layout is the permanent fix.

## Publishing, briefly

The mechanical part is short: `python -m build`, then `twine upload dist/*`, with an API token from PyPI. Two things are worth knowing before the first time.

A version number on PyPI **can never be reused**, even after deleting the release. A bad `0.1.0` costs you `0.1.1`, so publishing to TestPyPI first is a cheap habit.

And the name is claimed on first upload, which is worth doing early if you care about it, and worth checking before you name anything.

Trusted publishing, where a CI workflow uploads without a stored token, is the current recommendation for anything with a repository behind it, and removes the long-lived credential that is otherwise sitting in your settings.

## The short list

Use a virtual environment, one per project, always. Write a `pyproject.toml`. Depend loosely if you are a library and lock exactly if you are an application. Use the src layout. Publish wheels.

And when something cannot be imported, ask the two questions at the top before anything else, because `sys.executable` and `module.__file__` answer nine of ten packaging problems in one line each.

The reason this unit is worth the attention despite being nobody's favourite subject is that packaging problems are the ones that cost a whole afternoon and teach nothing. Half a page of understanding, applied once, converts them into a question with a one-line answer, which is a better return than almost anything else in this book.
