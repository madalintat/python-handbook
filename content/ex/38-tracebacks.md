---
slug: 38-tracebacks
---

## An error message with nothing in it

`parse_status` refuses an unknown status and does not say which one. The message is where the diagnosis happens, and this one carries no information at all.

@expect silent
@hint What does the person reading this traceback need to know that it does not tell them?
@hint `!r` in an f-string, and unit 22 said why the `r` matters.
@diagnose silent It raises, and the message says nothing about what was wrong. An exception message is read by somebody who cannot see the value, so putting the value in it costs one f-string at the point you write it and saves the entire diagnosis later. The `!r` matters more than it looks: `unknown status ` with nothing after it means the value was an empty string, and there is no way to tell that from the plain form, whereas `unknown status ''` says it exactly. The same applies to whitespace, to a string that looks like a number, and to `None` against `"None"`.

~~~starter
VALID = {"pending", "active", "closed"}


def parse_status(status):
    """Check a status against the allowed set."""
    if status not in VALID:
        raise ValueError("invalid status")
    return status
~~~

~~~tests
assert parse_status("active") == "active"

try:
    parse_status("")
except ValueError as exc:
    assert "''" in str(exc), f"the message was {str(exc)!r}"
else:
    raise AssertionError("an empty status was accepted")

try:
    parse_status("activ")
except ValueError as exc:
    assert "'activ'" in str(exc), f"the message was {str(exc)!r}"
~~~

~~~solution
VALID = {"pending", "active", "closed"}


def parse_status(status):
    """Check a status against the allowed set."""
    if status not in VALID:
        raise ValueError(f"unknown status {status!r}, expected one of {sorted(VALID)}")
    return status
~~~

## A handler that threw the traceback away

`load_all` catches everything and returns a placeholder. The exception, its message and its traceback are gone, and the caller is told nothing failed.

@expect silent
@hint What does the caller learn from this function when something goes wrong?
@hint Catch what you can handle, and keep the rest.
@diagnose silent It runs, and a row that failed to parse came back as a placeholder indistinguishable from a row that parsed to one. A bare `except Exception` that returns a default converts a precise report, the type, the message and every frame, into nothing at all, and the failure surfaces much later as a wrong number. Two rules keep this honest. Catch the exception you know how to handle, not every one. And when you must catch broadly, keep the information: `logging.exception(...)` records the traceback, and re-raising after logging is usually right, because a function that cannot do its job should say so rather than returning something plausible.

~~~starter
import logging

logger = logging.getLogger(__name__)


def parse_row(row):
    """Read a row's amount."""
    return int(row["amount"])


def load_all(rows):
    """Every row's amount. Rows that cannot be read are reported."""
    out = []
    for row in rows:
        try:
            out.append(parse_row(row))
        except Exception:
            out.append(0)
    return out
~~~

~~~tests
good = [{"amount": "3"}, {"amount": "4"}]
assert load_all(good) == [3, 4]

try:
    load_all([{"amount": "3"}, {"nothing": "here"}])
except KeyError as exc:
    assert "amount" in str(exc)
else:
    raise AssertionError("a row that could not be read was reported as 0")
~~~

~~~solution
import logging

logger = logging.getLogger(__name__)


def parse_row(row):
    """Read a row's amount."""
    return int(row["amount"])


def load_all(rows):
    """Every row's amount. Rows that cannot be read are reported."""
    out = []
    for row in rows:
        try:
            out.append(parse_row(row))
        except KeyError:
            logger.exception("row has no amount: %r", row)
            raise
    return out
~~~

## Two exceptions where one was the story

`read_config` fails, and its handler fails too. The second traceback buries the first, and only one of them is the actual problem.

@expect raises:UnboundLocalError
@hint Read the last line, then look for what the handler assumed.
@hint "During handling of the above exception, another exception occurred."
@diagnose UnboundLocalError The handler ran and broke on its own account, so the traceback shows two exceptions joined by "During handling of the above exception, another exception occurred". That phrase is the one to recognise: it means something failed **inside an `except` block**, and it is usually two bugs rather than one. Here the handler refers to `config`, which the failed call never assigned, so the name is local, unassigned and read, which is unit 08's `UnboundLocalError` exactly. The first traceback in a chain is the original failure and is the one to read first. Compare it with the other phrase, "the above exception was the direct cause of the following exception", which means somebody wrote `raise X from Y` deliberately and both are meant to be there.

~~~starter
DEFAULTS = {"timeout": 30}


def read_file(path):
    raise FileNotFoundError(path)


def read_config(path):
    """The configuration, falling back to the defaults."""
    try:
        config = read_file(path)
    except FileNotFoundError:
        return {**DEFAULTS, **config}
    return config


print(read_config("missing.toml"))
~~~

~~~tests
assert read_config("missing.toml") == {"timeout": 30}
~~~

~~~solution
DEFAULTS = {"timeout": 30}


def read_file(path):
    raise FileNotFoundError(path)


def read_config(path):
    """The configuration, falling back to the defaults."""
    try:
        config = read_file(path)
    except FileNotFoundError:
        return dict(DEFAULTS)
    return {**DEFAULTS, **config}


print(read_config("missing.toml"))
~~~

## Context added, cause discarded

`load` wraps a parse failure in a domain exception. It says what the program was doing and loses what actually went wrong.

@expect ruff:B904
@expect silent
@hint Unit 32's rule. There are two forms, and one of them keeps the original.
@hint `raise X from exc`.
@diagnose B904 ruff's `B904` asks you to raise with `from err` or `from None` inside an `except` clause, so that the choice is deliberate rather than accidental. It is the same rule unit 32 introduced, and it appears again here because reading the resulting traceback is the other half of the point.
@diagnose silent Nothing raised, and the new exception's `__cause__` was `None`, so the traceback says a configuration is invalid without saying which character on which line. Adding context is good practice; discarding the cause while doing it is what turns a five-second diagnosis into an afternoon. `raise X from exc` records the original, and the traceback then shows both with "the above exception was the direct cause of the following exception". `from None` is the deliberate opposite, right when the original is noise the caller cannot act on. Note that Python sets `__context__` automatically inside an `except` block, so the original is often still printed; `from` sets `__cause__`, which is the explicit claim that one caused the other and is what tooling reads.

~~~starter
import json


class ConfigError(Exception):
    """The configuration could not be read."""


def load(text):
    """Parse a configuration document."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise ConfigError("the configuration is not valid JSON")
~~~

~~~tests
assert load('{"a": 1}') == {"a": 1}

try:
    load("{bad")
except ConfigError as exc:
    assert exc.__cause__ is not None, "the parse error was discarded"
    assert "line 1" in str(exc.__cause__)
else:
    raise AssertionError("a bad document should raise")
~~~

~~~solution
import json


class ConfigError(Exception):
    """The configuration could not be read."""


def load(text):
    """Parse a configuration document."""
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ConfigError("the configuration is not valid JSON") from exc
~~~

## The frame that raised, and the frame that was wrong

`average` divides by the length. The traceback points at the division, and the mistake is in the function that produced an empty list.

@expect raises:ZeroDivisionError
@hint The deepest frame is where it broke. Where did the value come from?
@hint Check at the boundary, so the traceback points at the origin.
@diagnose ZeroDivisionError The traceback ends at the division, which is where the bad value was **used**, and the mistake is in `scores_for`, which returned an empty list for an unknown name rather than saying so. This is the commonest reason a traceback is unhelpful: the frame that raised is not the frame that is wrong, and the distance between them is however far the value travelled. Shortening that distance is the fix, and it is done by checking at the boundary: raise where the value is produced, with the input in the message, and the traceback then points at the origin instead of the symptom. It is the same argument as unit 24's `X | None`, made with an exception rather than a type.

~~~starter
SCORES = {"ada": [9, 8], "bob": [5]}


def scores_for(name):
    """The scores recorded for this person."""
    return SCORES.get(name, [])


def average(name):
    """This person's mean score."""
    scores = scores_for(name)
    return sum(scores) / len(scores)


print(average("nobody"))
~~~

~~~tests
assert average("ada") == 8.5
assert average("bob") == 5.0

try:
    average("nobody")
except KeyError as exc:
    assert "nobody" in str(exc), f"the error should name the input: {exc}"
else:
    raise AssertionError("an unknown name should say so")
~~~

~~~solution
SCORES = {"ada": [9, 8], "bob": [5]}


def scores_for(name):
    """The scores recorded for this person."""
    if name not in SCORES:
        raise KeyError(f"no scores recorded for {name!r}")
    return SCORES[name]


def average(name):
    """This person's mean score."""
    scores = scores_for(name)
    return sum(scores) / len(scores)


try:
    print(average("nobody"))
except KeyError as exc:
    print(exc)
~~~

## A name read before the line that makes it local

`summarise` assigns `total` inside a branch, which makes it local to the whole function, and reads it on a path where that branch did not run.

@expect raises:UnboundLocalError
@hint The message says "referenced before assignment". What made the name local?
@hint Unit 08. Assignment anywhere in a function decides the whole function.
@diagnose UnboundLocalError `total` is assigned somewhere in the function, so Python made it local for the whole function, including the lines above the assignment. Reading it on a path where the branch did not run finds a local with no value, which is what `UnboundLocalError` means and why its message says "referenced before assignment" rather than "not defined". The distinction from `NameError` is exactly this: `NameError` means nowhere has it, and `UnboundLocalError` means here has it and has not filled it in yet. The fix is almost never `global`; it is to give the name a value on every path, which usually means initialising it before the branch.

~~~starter
def summarise(rows):
    """A one-line summary of these rows."""
    if rows:
        total = sum(rows)
    return f"{len(rows)} rows totalling {total}"
~~~

~~~tests
assert summarise([1, 2, 3]) == "3 rows totalling 6"
assert summarise([]) == "0 rows totalling 0"
~~~

~~~solution
def summarise(rows):
    """A one-line summary of these rows."""
    total = sum(rows)
    return f"{len(rows)} rows totalling {total}"
~~~

## Thousands of identical frames

`Temperature.celsius` reads the attribute it is the property for. The traceback is a wall of the same two lines, which tells you the shape and not the cause.

@expect raises:RecursionError
@hint The traceback repeats. Which two frames, and why do they call each other?
@hint Units 19 and 20 both had this. The storage needs a different name.
@diagnose RecursionError Thousands of identical frames means an accidental cycle, and reading the traceback tells you the shape while the *code* tells you the cause: the getter for `celsius` reads `self.celsius`, which is the property, which calls the getter. Almost every `RecursionError` in real code is one of a small set: a property that reads itself, a `__setattr__` that assigns through itself, a `__getattr__` that touches a missing attribute, or a descriptor whose `__set__` calls `setattr` on the name it handles. Units 19 and 20 made each of those an exercise for this reason. The fix is always the same: the storage needs a name of its own, conventionally with a leading underscore, so that the code handling access is not reaching for the thing it handles.

~~~starter
class Temperature:
    def __init__(self, celsius):
        self._celsius = celsius

    @property
    def celsius(self):
        return self.celsius

    @property
    def fahrenheit(self):
        return self.celsius * 9 / 5 + 32


print(Temperature(100).fahrenheit)
~~~

~~~tests
t = Temperature(100)
assert t.celsius == 100
assert t.fahrenheit == 212.0
assert Temperature(0).fahrenheit == 32.0
~~~

~~~solution
class Temperature:
    def __init__(self, celsius):
        self._celsius = celsius

    @property
    def celsius(self):
        return self._celsius

    @property
    def fahrenheit(self):
        return self.celsius * 9 / 5 + 32


print(Temperature(100).fahrenheit)
~~~

## Several failures, and a report that keeps one

`validate_all` checks every row and raises on the first problem. When four rows are wrong, the caller fixes one and runs it again.

@expect silent
@hint What does the caller learn from one exception about four bad rows?
@hint Unit 34's group, which is not only for tasks.
@diagnose silent It raises on the first bad row, so a caller with four problems finds them one run at a time. `ExceptionGroup` exists for exactly this: collect the failures, and raise them together with `raise ExceptionGroup("...", errors)`. The traceback prints each one as a numbered section with its own frames, and `except*` matches by type inside the group. It is not only for `asyncio`; validation, batch processing and anything with independent items all have the same shape. The judgement is whether the failures are genuinely independent: if the second was caused by the first, one exception is the honest report, and a group would be four descriptions of one bug.

~~~starter
def check(row):
    """Raise if this row is not valid."""
    if "amount" not in row:
        raise KeyError(f"row {row!r} has no amount")


def validate_all(rows):
    """Check every row, reporting every problem."""
    for row in rows:
        check(row)
    return len(rows)
~~~

~~~tests
assert validate_all([{"amount": 1}, {"amount": 2}]) == 2

try:
    validate_all([{"amount": 1}, {}, {"a": 2}, {}])
except* KeyError as group:
    assert len(group.exceptions) == 3, f"reported {len(group.exceptions)} of 3 bad rows"
else:
    raise AssertionError("three bad rows should have been reported")
~~~

~~~solution
def check(row):
    """Raise if this row is not valid."""
    if "amount" not in row:
        raise KeyError(f"row {row!r} has no amount")


def validate_all(rows):
    """Check every row, reporting every problem."""
    errors = []
    for row in rows:
        try:
            check(row)
        except KeyError as exc:
            errors.append(exc)
    if errors:
        raise ExceptionGroup(f"{len(errors)} rows are invalid", errors)
    return len(rows)
~~~
