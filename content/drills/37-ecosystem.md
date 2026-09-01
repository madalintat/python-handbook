---
slug: 37-ecosystem
---

## The expensive mistake in Python is
- (x) Writing a function that already exists, worse
- ( ) Writing a slow function
- ( ) Using too many dependencies
- ( ) Not using type hints
> Which is why the reflex worth building is asking "has somebody solved this" before typing.

## `pathlib` against `os.path`
- (x) The operations are methods on the path object, and `/` joins
- ( ) It is faster
- ( ) It validates the path exists
- ( ) It is required on Windows
> Wrong when an API demands a string, where `str(path)` is the answer.

## A regular expression is the wrong tool for
- (x) Anything nested: HTML, JSON, source code
- ( ) Line-oriented text
- ( ) Validating a format
- ( ) Splitting on a separator
> It has no memory of how deep it is, so every attempt works on your examples and fails on somebody else's.

## `subprocess.run` should be given
- (x) A list, so no shell is involved and no quoting can go wrong
- ( ) A string, for readability
- ( ) A string with `shell=True`
- ( ) Either; they are equivalent
> Add `check=True` so a non-zero exit raises rather than being ignored.

## `datetime.now()`
- (x) Gives a naive object with no timezone, which means different things in different places
- ( ) Gives a UTC timestamp
- ( ) Gives a local aware timestamp
- ( ) Is deprecated
> Store and compute in UTC with aware objects; convert at the edges with `zoneinfo`.

## For money, use
- (x) `decimal.Decimal`, constructed from a string
- ( ) `float`, rounded at the end
- ( ) `float`, with `round` at each step
- ( ) `Fraction`
> `Decimal(0.1)` faithfully preserves the error that was already there. Integers of the smallest unit also work.

## For tokens, passwords and keys, use
- (x) `secrets`, which draws from the operating system's cryptographic source
- ( ) `random`, seeded from the clock
- ( ) `uuid4`
- ( ) `hash`
> `random` is a Mersenne Twister: a few outputs are enough to recover the state and predict the rest.

## Building a URL by concatenating values
- (x) Lets a value containing `&` or a space become part of the URL's structure
- ( ) Is fine if the values are validated
- ( ) Is faster than `urlencode`
- ( ) Escapes automatically
> The same principle as SQL, shell commands and HTML: concatenation hopes the values contain nothing meaningful.

## `logging.getLogger(__name__)` is preferable to `print` because
- (x) It has levels and structure, and is configured by whoever runs the program
- ( ) It is faster
- ( ) It writes to a file
- ( ) `print` is deprecated
> Wrong when the program is a script whose output is the point.

## `sqlite3` in the standard library
- (x) Is a real database, and is the right answer more often than people expect
- ( ) Is a toy for tests
- ( ) Requires a server
- ( ) Is deprecated in favour of SQLAlchemy
> No process to run, one file, and real SQL.

## `pandas` against `polars`
- (x) `pandas` has fifteen years of answers written down; `polars` is faster with a more consistent API
- ( ) They are interchangeable
- ( ) `polars` is a `pandas` wrapper
- ( ) `pandas` is deprecated
> On a new project handling real volume, `polars`. When you need an answer that already exists, `pandas`.

## The number of dependencies that matters is
- (x) The transitive one, because each brings its own release schedule and advisories
- ( ) The direct one
- ( ) The one in `pyproject.toml`
- ( ) The one you import
> You discover this the first time two of them disagree about a third.

## Write it yourself rather than take a dependency when
- (x) The whole problem fits in your head
- ( ) The package is large
- ( ) You have time
- ( ) The licence is inconvenient
> A retry loop fits. A timezone database does not.

## When evaluating a package, read the issue tracker because
- (x) The tutorial says what it does well and the issues say what it does badly
- ( ) It shows how active the project is
- ( ) It is faster than the docs
- ( ) It lists the API
> Sort by most commented. You need both halves to decide whether it fits.

## `rich` is the wrong choice when
- (x) The output is being piped somewhere; check `sys.stdout.isatty()`
- ( ) The terminal is small
- ( ) You need colour
- ( ) The program is a script
> Its tables, progress bars and tracebacks are for a person looking at a terminal.
