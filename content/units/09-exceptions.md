---
slug: 09-exceptions
title: Exceptions
---

Python uses exceptions for two different jobs, and almost every bad `try` block comes from confusing them. A **recoverable error** is a thing that can go wrong in normal operation: a file that is not there, a network that is down, input a user typed badly. A **bug** is your program being wrong. The first is something you catch; the second is something you let crash, because a traceback that stops the program is the most useful thing a bug can do.

Choosing wrongly in either direction hurts. Catching a bug hides it and turns a five-minute fix into an afternoon. Letting a recoverable error crash makes a program that cannot cope with an ordinary Tuesday.

## The shape

```python
try:
    data = load(path)
except FileNotFoundError:
    data = default()
except PermissionError as exc:
    log.warning("cannot read %s: %s", path, exc)
    raise
else:
    log.info("loaded %d rows", len(data))
finally:
    timer.stop()
```

`try` holds the code that might fail. Each `except` names what it handles, and the first matching clause wins, so specific types must come before general ones. `as exc` binds the exception object, and that name is deleted at the end of the clause to avoid holding the traceback alive.

`else` runs only when no exception happened. It exists so the `try` can hold just the line that might fail: anything you put in `try` that cannot raise the exception you are catching is code whose failures you are silently catching by accident.

`finally` runs on the way out no matter what, including when an exception is propagating and including when the block returns. It is for releasing something, and a `with` statement is usually the better way to say the same thing.

## What `finally` does to a `return`

`finally` runs on every way out of the block, and that includes the ways you did not think of. If the `try` block returns, `finally` still runs before the value leaves. If an exception is propagating, `finally` runs before it continues upward.

The trap is that a `return` inside `finally` wins over everything else, including an exception:

```python
def read(path):
    try:
        return open(path).read()
    finally:
        return ""            # swallows every exception, silently
```

The exception is discarded and the caller gets an empty string. `break` and `continue` in a `finally` do the same thing. No linter catches every form of it, and the failure is invisible: there is no traceback, because the traceback was thrown away.

Keep `finally` for cleanup and let control flow leave from somewhere else. Better still, when the cleanup is releasing something, use a `with` statement, which is what unit 22 shows you how to write for your own types.

## What an exception costs

Two numbers, because "exceptions are slow" is repeated more often than it is checked.

Setting up a `try` block is close to free. Since 3.11 the happy path costs essentially nothing, because the handler is recorded in a table rather than pushed onto the stack, so wrapping code in `try` that never raises does not slow it down.

Raising and catching is not free: it builds an exception object, captures a traceback, and unwinds. It is on the order of a microsecond, which is irrelevant once per request and expensive once per element in a tight loop over a million items.

That is the whole guidance. Use exceptions for the exceptional and the occasional, which is most code. When a loop expects to fail on most iterations, a check is faster, and that is one of the few places LBYL genuinely wins on speed rather than taste.

## The hierarchy is the vocabulary

Everything raisable derives from `BaseException`. Almost everything you should catch derives from `Exception`, which sits below it.

The four that do not are `SystemExit`, `KeyboardInterrupt`, `GeneratorExit` and `BaseException` itself. They are deliberately outside `Exception` so that `except Exception:` does not swallow them, because catching Ctrl-C or a deliberate exit is nearly always wrong.

Below `Exception`, the shape matters when you choose what to catch:

`LookupError` covers `IndexError` and `KeyError`. `ArithmeticError` covers `ZeroDivisionError` and `OverflowError`. `OSError` covers the filesystem and network family, including `FileNotFoundError`, `PermissionError`, `TimeoutError` and `ConnectionError`. `ValueError` means the type was right and the value was not; `TypeError` means the type was wrong.

Catching a parent catches every child, which is a feature when you mean it and a mistake when you have not looked.

## Two failures worth naming

**A bare `except:`** catches `BaseException`, so it takes Ctrl-C and `SystemExit` with it. A program that cannot be interrupted is a bad program, and ruff reports the bare form as `E722`.

**`except Exception:` with nothing in the body**, or a body that returns a default, is the one that costs real time. It converts every bug in the block into a wrong answer with no evidence, and the report you eventually get is that something is occasionally empty. If you truly want to continue, log the exception with its traceback first, and catch the narrowest type that covers the case you meant.

The rule that avoids both: **catch what you can do something about.** If the handler cannot do anything except hide the problem, do not write it.

## EAFP

Python prefers trying the operation to checking first.

```python
try:                          # EAFP
    return config["port"]
except KeyError:
    return 8080

if "port" in config:          # LBYL
    return config["port"]
return 8080
```

The first is idiomatic, and not only for style. The second does two lookups instead of one, and between the check and the use, in threaded or async code, the world can change. That gap is a real race in file code: `os.path.exists(p)` followed by `open(p)` can still raise, because the file can be deleted in between.

LBYL still wins when the failure is expected often, since exceptions are cheap to set up and expensive to raise, and when the check is meaningfully cheaper than the attempt.

## `raise ... from`

When you catch one exception and raise another, Python records the link, and the two ways of doing that mean different things.

```python
except KeyError as exc:
    raise ConfigError("port missing") from exc      # explicit cause
```

produces "The above exception was the direct cause of the following exception", which says: this is a deliberate translation. Without `from`, Python still chains implicitly and says "During handling of the above exception, another exception occurred", which reads as an accident, and is what a second bug inside a handler looks like.

`from None` suppresses the chain entirely, for the case where the original is noise the caller cannot use.

ruff's `B904` asks for one of these on every `raise` inside an `except`, because losing the original is losing the only evidence of what actually went wrong.

The related mistake is re-raising with `raise exc` instead of a bare `raise`. Both propagate the same object, but a bare `raise` keeps the traceback intact, while `raise exc` restarts it from this line, throwing away the frames that tell you where the problem began.

## Where to catch

Deciding *what* to catch is the previous sections. Deciding *where* is the part that shapes a codebase.

The useful rule is to catch at the layer that can decide what to do about it. A function that parses one row cannot know whether a malformed row should abort the import, be skipped with a warning, or be written to a rejects file. That decision belongs to whatever is running the import, so the parser should raise and say precisely what was wrong.

Two consequences. Low-level code raises specific exceptions and catches almost nothing. High-level code, the request handler or the command-line entry point, catches broadly, because it is the only layer that knows the whole program should keep going rather than stop.

That top-level handler is the one legitimate use of a wide `except Exception:` — and even there it must log the traceback rather than swallow it, or you have simply moved the silence to a more expensive place.

The other half of the rule is to let a bug through. If the exception means your code is wrong rather than the world being awkward, the handler that catches it is turning a loud, locatable failure into a quiet, unlocatable one.

## Your own exceptions

Deriving from `Exception` is the whole requirement. A class that derives from nothing cannot be raised at all, and Python says so.

```python
class ConfigError(Exception):
    """Raised when configuration is missing or malformed."""
```

Give a library one base exception of its own and derive the specific ones from it, so callers can catch everything from your code with one clause or one case precisely. Do not carry state on it unless a handler needs to read that state, and remember that the message is the interface: it is what a stranger will see at three in the morning.

## Groups, since 3.11

When several things fail at once, raising the first and discarding the rest loses information. `ExceptionGroup` carries them all, and `except*` handles them by type without unpacking by hand:

```python
try:
    async with asyncio.TaskGroup() as group:
        ...
except* ConnectionError as errors:
    for err in errors.exceptions:
        log.warning("connection failed: %s", err)
```

Each `except*` clause takes the matching exceptions out of the group and the rest keep propagating, so more than one clause can run for a single group. This exists mostly for concurrency, where several tasks fail independently, and unit 34 is where it earns its place.

## What to carry forward

A recoverable error is a value you catch and a bug is a traceback you let happen. Catch the narrowest type you can act on, put only the risky line inside `try`, and use `else` for the rest. Never write a bare `except:`, and never write a silent `except Exception:`. Use `raise ... from` when you translate an exception and a bare `raise` when you re-raise one. Derive your own exceptions from `Exception`, and give a library a base of its own.
