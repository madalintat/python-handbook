---
slug: 09-exceptions
---

## The except that catches everything

`load_port` falls back to a default when the config is missing a port. Its handler catches rather more than a missing key, and ruff objects to the form on sight. The tests pass it something that is not a mapping at all.

@expect ruff:E722
@expect silent
@hint A bare `except:` names no type. Work out what it therefore catches.
@hint Catch the narrowest thing you can actually do something about.
@diagnose E722 ruff's `E722` is "do not use bare `except`". A bare clause catches `BaseException`, which sits above `Exception` and includes `KeyboardInterrupt` and `SystemExit`. A program that cannot be interrupted with Ctrl-C is a bad program, and those two types are deliberately outside `Exception` precisely so that a reasonable handler does not take them.
@diagnose silent It runs and returns the default for every failure, including the ones that mean your code is wrong. The tests hand it a list, so the subscript raises `TypeError`, and the handler quietly reports 8080 as though a port had been absent. That is a bug converted into a wrong answer with no evidence. Catch `KeyError`, which is the one thing this function can genuinely recover from, and let everything else through.

~~~starter
def load_port(config):
    """Return the configured port, defaulting to 8080 when it is absent."""
    try:
        return config["port"]
    except:
        return 8080
~~~

~~~tests
assert load_port({"port": 99}) == 99
assert load_port({}) == 8080
try:
    load_port(["not", "a", "mapping"])
except TypeError:
    pass
else:
    raise AssertionError("a TypeError was swallowed and reported as a missing port")
~~~

~~~solution
def load_port(config):
    """Return the configured port, defaulting to 8080 when it is absent."""
    try:
        return config["port"]
    except KeyError:
        return 8080
~~~

## Everything in the try

`first_number` reads a value and converts it. Both lines sit inside the `try` and the handler names both failures, so a caller who omits the key entirely is told their value was malformed.

@expect silent
@hint The `try` should hold only the line that can raise the exception you are catching.
@hint There is a clause that runs when nothing went wrong. That is where the rest belongs.
@diagnose silent Nothing raised, and a missing key is reported as a bad value. Only `int(raw)` can raise `ValueError`; the lookup raises `KeyError`, which is a different failure with a different remedy, and catching both in one clause makes them indistinguishable to the caller. The habit that prevents this is to put exactly the risky line in the `try` and everything else in `else`, which runs only when no exception happened. It reads as more ceremony for a moment, and then it stops you catching failures you never meant to.

~~~starter
def first_number(row, key):
    """Return row[key] as an integer, or None if the value is not a number."""
    try:
        raw = row[key]
        return int(raw)
    except (KeyError, ValueError):
        return None
~~~

~~~tests
assert first_number({"n": "42"}, "n") == 42
assert first_number({"n": "abc"}, "n") is None
try:
    first_number({}, "n")
except KeyError:
    pass
else:
    raise AssertionError("a missing key was reported as a bad value")
~~~

~~~solution
def first_number(row, key):
    """Return row[key] as an integer, or None if the value is not a number."""
    raw = row[key]
    try:
        return int(raw)
    except ValueError:
        return None
~~~

## The return that ate the exception

`read_setting` cleans up after itself and returns a tidy default. The `finally` clause contains a `return`, and a `return` in a `finally` beats everything else on its way out, including an exception that was propagating.

@expect silent
@expect ruff:B012
@expect ruff:SIM107
@hint `finally` runs on every exit from the block. What happens when it returns during one?
@hint Keep `finally` for cleanup, and let control flow leave from somewhere else.
@diagnose B012 ruff's `B012` is "`return` inside `finally` blocks cause exceptions to be swallowed". It is one of the few rules that describes a silent data-loss bug rather than a style preference, and it is worth having on for that reason alone.
@diagnose SIM107 ruff's `SIM107` is "don't use `return` in `try`/`except` and `finally`", which is the same finding stated as a shape: two exits from one block, and the one in `finally` always wins.
@diagnose silent It runs and every failure becomes an empty string with no traceback anywhere. A `return` inside `finally` replaces whatever was leaving the block, and if that was an exception, the exception is discarded outright. `break` and `continue` in a `finally` do the same. Nothing warns you, and there is no evidence left to find, which makes this one of the quietest ways to lose a bug in Python. Put the cleanup in `finally` and the value somewhere else, and where the cleanup is releasing a resource, prefer a `with` statement.

~~~starter
def read_setting(settings, key, log):
    """Return the setting, recording the lookup. Missing keys should raise."""
    try:
        return settings[key]
    finally:
        log.append(key)
        return ""
~~~

~~~tests
log: list[str] = []
assert read_setting({"a": "yes"}, "a", log) == "yes"
assert log == ["a"]
try:
    read_setting({}, "b", log)
except KeyError:
    pass
else:
    raise AssertionError("the KeyError was swallowed by the finally clause")
assert log == ["a", "b"], "cleanup should still run on the failing path"
~~~

~~~solution
def read_setting(settings, key, log):
    """Return the setting, recording the lookup. Missing keys should raise."""
    try:
        return settings[key]
    finally:
        log.append(key)
~~~

## Translating an exception without losing it

`parse_config` turns a low-level failure into one of its own, which is the right instinct. It drops the original on the way, and ruff has a rule saying so.

@expect ruff:B904
@hint Raising inside an `except` can say what caused it. There is a keyword for that.
@hint Compare the two chained-exception messages Python prints, and decide which one describes what you are doing.
@diagnose B904 ruff's `B904` is "within an `except` clause, raise exceptions with `raise ... from err` or `raise ... from None`". Without `from`, Python still chains, but it prints "During handling of the above exception, another exception occurred", which reads as a second bug appearing inside your handler. `from exc` prints "The above exception was the direct cause of the following exception", which says this was a deliberate translation. The difference is entirely in what the next person reads at three in the morning.

~~~starter
class ConfigError(Exception):
    """Raised when configuration is missing or malformed."""


def parse_config(raw):
    """Return the host from a config mapping."""
    try:
        return raw["host"]
    except KeyError:
        raise ConfigError("no host configured")


print(parse_config({"host": "db"}))
~~~

~~~tests
assert parse_config({"host": "db"}) == "db"
try:
    parse_config({})
except ConfigError as exc:
    assert isinstance(exc.__cause__, KeyError), "the original KeyError was not kept as the cause"
else:
    raise AssertionError("a missing host should raise ConfigError")
~~~

~~~solution
class ConfigError(Exception):
    """Raised when configuration is missing or malformed."""


def parse_config(raw):
    """Return the host from a config mapping."""
    try:
        return raw["host"]
    except KeyError as exc:
        raise ConfigError("no host configured") from exc


print(parse_config({"host": "db"}))
~~~

## The clause that can never run

`describe` reports what went wrong, with a specific message for a bad value and a general one for everything else. The two clauses are in an order that makes one of them unreachable, and Python is perfectly happy to compile it.

@expect silent
@hint The first matching clause wins, and `ValueError` is a kind of `Exception`.
@hint Which of these two clauses could ever be reached second?
@diagnose silent It runs and every failure gets the general message, because `except` clauses are tried in order and the first match wins. `ValueError` derives from `Exception`, so the broad clause always matches first and the specific one below it is dead code that Python will never warn you about. Specific types must come before general ones, which is the same rule as `LookupError` covering `KeyError`, seen from the other side. The habit is to read a chain of `except` clauses from the top and ask, at each one, whether anything below could still be reached.

~~~starter
def describe(operation):
    """Run the operation and describe any failure."""
    try:
        return operation()
    except Exception:
        return "something went wrong"
    except ValueError:
        return "bad value"
~~~

~~~tests
def bad_value():
    raise ValueError("nope")


def other():
    raise KeyError("nope")


assert describe(lambda: 42) == 42
assert describe(bad_value) == "bad value", "the specific clause never ran"
assert describe(other) == "something went wrong"
~~~

~~~solution
def describe(operation):
    """Run the operation and describe any failure."""
    try:
        return operation()
    except ValueError:
        return "bad value"
    except Exception:
        return "something went wrong"
~~~

## An exception that cannot be raised

`ValidationError` looks like an exception and is not one. Read what the interpreter says about what may follow `raise`.

@expect raises:TypeError
@expect mypy:misc
@hint What must a class derive from before Python will let you raise it?
@hint The message names the one requirement exactly.
@diagnose misc mypy reports "exception type must be derived from BaseException" without running anything. All three judges agree here, which is a fair sign the requirement is a real part of the language rather than an accident of one implementation.
@diagnose TypeError Both `raise` and `except` accept only classes deriving from `BaseException`, and the interpreter says so: "catching classes that do not inherit from BaseException is not allowed". A class deriving from nothing is an ordinary object, however exception-shaped its name. Derive from `Exception` rather than `BaseException`: the four types below `BaseException` and outside `Exception` are `SystemExit`, `KeyboardInterrupt` and `GeneratorExit`, deliberately placed there so an ordinary `except Exception:` does not swallow them. Nothing you write belongs in that category.

~~~starter
class ValidationError:
    """Raised when a value fails validation."""


def check_age(age):
    """Return the age, rejecting anything negative."""
    if age < 0:
        raise ValidationError(f"negative age: {age}")
    return age


try:
    check_age(-1)
except ValidationError:
    print("rejected")
~~~

~~~tests
assert check_age(30) == 30
try:
    check_age(-1)
except ValidationError as exc:
    assert "negative age" in str(exc)
else:
    raise AssertionError("a negative age should be rejected")
~~~

~~~solution
class ValidationError(Exception):
    """Raised when a value fails validation."""


def check_age(age):
    """Return the age, rejecting anything negative."""
    if age < 0:
        raise ValidationError(f"negative age: {age}")
    return age


try:
    check_age(-1)
except ValidationError:
    print("rejected")
~~~

## Catching a parent by accident

`safe_get` means to recover from a missing key. It catches `LookupError`, which is the parent of both `KeyError` and `IndexError`, so it also recovers from an index bug several calls deeper that it knows nothing about.

@expect silent
@hint `LookupError` has two children. Work out which of them this function did not mean to catch.
@hint Catch the narrowest type you can actually act on.
@diagnose silent Nothing raised, and a genuine `IndexError` from the lookup function is reported as a missing key. `LookupError` is the parent of `KeyError` and `IndexError`, so catching it catches both. Catching a parent catches every child, which is a feature when you mean it and a trap when you have not looked at the tree. The same shape appears with `OSError`, which covers the whole filesystem and network family, and with `ArithmeticError`. Name the exact type you can recover from, which here is `KeyError`.

~~~starter
def safe_get(lookup, key, default):
    """Return lookup(key), or the default if the key is not there."""
    try:
        return lookup(key)
    except LookupError:
        return default
~~~

~~~tests
table = {"a": 1}
assert safe_get(lambda k: table[k], "a", 0) == 1
assert safe_get(lambda k: table[k], "z", 0) == 0


def buggy(key):
    rows = []
    return rows[0]


try:
    safe_get(buggy, "a", 0)
except IndexError:
    pass
else:
    raise AssertionError("an IndexError bug was reported as a missing key")
~~~

~~~solution
def safe_get(lookup, key, default):
    """Return lookup(key), or the default if the key is not there."""
    try:
        return lookup(key)
    except KeyError:
        return default
~~~

## Reporting every failure, not the first

`validate_all` checks a batch of rows and reports what was wrong. It collects every failure and then raises one of them, so a caller fixing a hundred-row import learns about one row per attempt.

@expect silent
@hint The function already has every error in a list. Ask what it does with the rest.
@hint Since 3.11 there is an exception type whose whole purpose is carrying several at once.
@diagnose silent It runs and reports the first failure, discarding the others it went to the trouble of collecting. `ExceptionGroup`, added in 3.11, exists for exactly this: it carries a list of exceptions as one raisable object, so a caller sees every problem at once and a hundred-row import takes one pass rather than a hundred. Handlers use `except*`, which takes the matching exceptions out of a group and lets the rest keep propagating, so more than one clause can run for a single group. This is mostly for concurrency, where several tasks fail independently, and unit 34 is where it earns its keep.

~~~starter
def validate_all(rows):
    """Check every row, reporting all the failures rather than just the first."""
    errors = []
    for row in rows:
        if not isinstance(row, int):
            errors.append(TypeError(f"not a number: {row!r}"))
        elif row < 0:
            errors.append(ValueError(f"negative: {row}"))
    if errors:
        raise errors[0]
    return len(rows)
~~~

~~~tests
assert validate_all([1, 2, 3]) == 3

try:
    validate_all([1, "x", -2])
except ExceptionGroup as group:
    kinds = sorted(type(e).__name__ for e in group.exceptions)
    assert kinds == ["TypeError", "ValueError"], f"only got {kinds}"
except (TypeError, ValueError):
    raise AssertionError("only the first failure was reported") from None
else:
    raise AssertionError("invalid rows should be reported")
~~~

~~~solution
def validate_all(rows):
    """Check every row, reporting all the failures rather than just the first."""
    errors = []
    for row in rows:
        if not isinstance(row, int):
            errors.append(TypeError(f"not a number: {row!r}"))
        elif row < 0:
            errors.append(ValueError(f"negative: {row}"))
    if errors:
        raise ExceptionGroup("some rows are invalid", errors)
    return len(rows)
~~~
