---
slug: 37-ecosystem
title: The ecosystem, mapped
---

A map rather than a tutorial. The aim is that when you meet a problem you know what the answer is called, because the expensive mistake in Python is not writing a function badly; it is writing one that already exists, worse.

Each entry gets the case where it is the wrong choice, because that is the part documentation leaves out.

## The standard library you will actually use

**`pathlib`** for anything involving a path. `Path("data") / "rows.csv"` reads better than `os.path.join`, and the methods are on the object: `.exists()`, `.read_text()`, `.glob("*.py")`, `.parent`, `.suffix`. Prefer it to `os.path` in new code. *Wrong when* an API demands a string, where `str(path)` is the answer, and in a hot loop, where the objects cost more than strings.

**`re`** for regular expressions. Compile with `re.compile` when reusing a pattern, use named groups `(?P<name>...)` so the result reads, and use verbose mode with comments for anything long. *Wrong when* the thing you are parsing has structure: HTML, JSON, source code. A regex that parses nested anything is a bug with good intentions.

**`json`**, **`csv`**, **`tomllib`**, **`sqlite3`**, all in the box. `sqlite3` in particular is a real database in the standard library and is the right answer far more often than people expect.

**`datetime`**, and one rule that prevents most date bugs: store and compute in UTC, convert at the edges, and use timezone-aware objects. `datetime.now()` gives you a naive one, which is a value that means different things in different places; `datetime.now(UTC)` does not. **`zoneinfo`** provides the timezones.

**`collections`** for `defaultdict`, `Counter` and `deque`, all of which units 12 and 13 covered.

**`itertools`** and **`functools`**, which unit 17 covered.

**`subprocess`** for running a command. `subprocess.run([...], capture_output=True, text=True, check=True)` is the incantation worth memorising: a **list** rather than a string, so no shell is involved and no quoting can go wrong, and `check=True` so a failure raises rather than being ignored. *Wrong when* `shell=True` looks convenient, which is where command injection lives.

**`logging`** rather than `print`. It has levels, it has structure, and it can be configured by whoever runs the program rather than by whoever wrote it. `logging.getLogger(__name__)` at module level is the whole setup. *Wrong when* the program is a script whose output is the point.

**`argparse`** for command-line arguments, and it is enough for most tools. *Wrong when* the tool has subcommands with their own options, where the configuration starts to outweigh the code.

## The packages worth knowing

**`requests`** for HTTP, and **`httpx`** if you need async or HTTP/2, with an almost identical API. *Wrong when* you are making thousands of concurrent requests, which is unit 34's subject.

**`pydantic`** for validating data from outside the program, which unit 23 argued for at the boundary and against within it.

**`rich`** for terminal output: tables, progress bars, syntax highlighting, and tracebacks that are genuinely easier to read. *Wrong when* the output is being piped somewhere, so check `sys.stdout.isatty()`.

**`typer`** or **`click`** for a CLI with subcommands, where `argparse` starts to hurt. `typer` builds the interface from your type annotations, which is unit 24 paying off somewhere unexpected.

**`FastAPI`** for an HTTP API: pydantic at the edge, async underneath, and documentation generated from the annotations. **`Django`** when you want the whole thing, an ORM and an admin and authentication, and **`Flask`** when you want almost nothing.

**`SQLAlchemy`** for talking to a database, either as an ORM or as a query builder. It is large, and the reason to learn it is that it is the one everybody uses. *Wrong when* the queries are simple and few, where `sqlite3` or a driver plus SQL is less to carry.

**`polars`** and **`pandas`** for tabular data. `pandas` is the one with fifteen years of examples and every answer already written down; `polars` is faster, has a more consistent API, and is what to reach for on a new project that will handle real volume.

**`numpy`** underneath most of the numerical world. If you are looping over numbers in Python, this is usually the answer, and unit 35 said why.

**`pytest`**, **`ruff`**, **`mypy`** and **`uv`**, which this book has been using throughout.

## The corners of the standard library worth a visit

Six modules that solve a problem people routinely solve worse by hand.

**`dataclasses`**, **`enum`**, **`typing`**, from units 23 and 24.

**`contextlib`**, from unit 22: `contextmanager`, `suppress`, `closing` and `ExitStack`, the last for when the number of context managers is known only at run time.

**`textwrap`** for `dedent`, which is how a triple-quoted string inside an indented block stops carrying its indentation.

**`secrets`** rather than `random` for anything security-related: tokens, passwords, keys. `random` is fast, reproducible and predictable, which are the three properties you do not want here.

**`decimal`** for money. Unit 05 explained why binary floating point cannot represent `0.1`, and money is exactly the case where that matters and where nobody accepts the answer being off by a hundredth of a penny.

**`shutil`** for copying, moving and removing trees, and `shutil.which` for finding an executable, which is the correct way to ask whether a command exists.

**`urllib.parse`** for building and taking apart URLs. String concatenation and manual escaping is how a query parameter containing an ampersand becomes somebody's afternoon.

## Reading a library you have not used

The order that gets you working fastest is not the order the documentation presents.

Start with the **README's first example**, because it shows the shape the author intends. Then look for the **"how do I" or cookbook** page, which is closer to what you actually want than the tutorial. Then the **API reference for the two or three objects** you touched, and stop.

Read the **changelog** before pinning a version, especially the last major release, because that is where the thing that will surprise you is written down.

And read the **issue tracker**, sorted by most commented. The tutorial says what the library does well and the issues say what it does badly, and you need both to decide whether it fits.

## How to choose one

Four questions, and they take a couple of minutes.

**Is it maintained?** Look at the date of the last release and whether issues get answers. A package with no release in three years is a decision to maintain it yourself.

**How many dependencies does it bring?** Each one is somebody else's release schedule and somebody else's security advisories.

**Could I write this in fifty lines?** Sometimes yes, and then you should, because a dependency is forever and fifty lines is an afternoon. A left-pad is not worth a supply chain.

**Is it the one everybody uses?** This is not fashion. The popular option has more answers online, more people who can read your code, and more eyes on its bugs, and those are real engineering properties.

## Dependencies as a liability

Every package you add is code you now ship, maintain around and are exposed by, and that is worth pricing rather than assuming.

A dependency brings its own dependencies, and the number that matters is the **transitive** one. A package with forty of them has forty release schedules and forty sets of security advisories, and you will discover this the first time two of them disagree about a third.

It also brings a **supply chain**. Installing a package runs its code on your machine, and typosquatting on a popular name is a live and ongoing attack. Read the name you typed, and prefer the one everybody uses partly because more people are looking at it.

The counterweight is that writing it yourself is also a liability, and usually a worse one for anything with edge cases: dates, timezones, HTTP, TLS, character encodings, anything cryptographic. The rule that resolves the two: **write it yourself when the whole problem fits in your head, and take the dependency when it does not.** A retry loop fits. A timezone database does not.

## What to do when you do not know the name

Search for the problem rather than the solution: "python parse ISO datetime" finds the answer faster than guessing at module names. Read the standard library index once, slowly, not to memorise it but so that later you have a feeling that something exists. And when you find a promising package, read its README and its issue tracker before its tutorial, because the issues tell you what it is bad at.

The skill this unit is aiming at is not knowledge of these libraries. It is the reflex of asking "has somebody solved this" before starting to type, which is worth more over a career than any particular one of them.
