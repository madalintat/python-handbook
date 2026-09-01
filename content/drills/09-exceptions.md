---
slug: 09-exceptions
---

## Which of these should you catch?
- ( ) A bug in your own code
- (x) A file that is not there
- ( ) A typo in a variable name
- ( ) An impossible branch being reached
> A recoverable error is a thing that goes wrong in normal operation. A bug is your program being wrong, and a traceback that stops the program is the most useful thing it can do.

## A bare `except:` catches
- ( ) Only `Exception` and its children
- (x) `BaseException`, including `KeyboardInterrupt` and `SystemExit`
- ( ) Only the exception named in the previous clause
- ( ) Nothing; it is a SyntaxError
> Which is why a program with one cannot be interrupted with Ctrl-C. ruff reports it as `E722`.

## Why are `KeyboardInterrupt` and `SystemExit` outside `Exception`?
- ( ) They are not real exceptions
- (x) So that `except Exception:` does not swallow them
- ( ) They are raised by the operating system
- ( ) For backwards compatibility only
> `GeneratorExit` is the third. Nothing you write belongs in that category.

## `except LookupError:` also catches
- (x) `KeyError` and `IndexError`
- ( ) `ValueError`
- ( ) `TypeError`
- ( ) `AttributeError`
> Catching a parent catches every child, which is a feature when you mean it and a trap when you have not looked at the tree.

## `ValueError` versus `TypeError`
- (x) The type was right and the value was not, versus the type was wrong
- ( ) They are interchangeable
- ( ) `ValueError` is for user input only
- ( ) `TypeError` is only raised by builtins
> `int("abc")` is a `ValueError`; `int([])` is a `TypeError`.

## What does the `else` clause of a `try` do?
- ( ) Runs when an exception was caught
- (x) Runs only when no exception happened
- ( ) Runs always, like `finally`
- ( ) Runs when the `except` clause re-raises
> It exists so the `try` can hold only the risky line, instead of quietly catching failures from everything else you put in there.

## A `return` inside `finally`
- ( ) Is a SyntaxError
- (x) Replaces whatever was leaving the block, including a propagating exception
- ( ) Runs after the exception propagates
- ( ) Is ignored
> ruff's `B012` exists for exactly this. There is no traceback afterwards, because the traceback was discarded.

## When does `finally` run?
- ( ) Only when an exception was raised
- ( ) Only when no exception was raised
- (x) On every way out of the block, including a `return`
- ( ) After the function returns to its caller
> Which is what makes it right for cleanup, and a `with` statement is usually the better way to say it.

## EAFP means
- (x) Try the operation and catch the failure
- () Check first, then act
- ( ) Assert your assumptions
- ( ) Catch everything and log it
> It is one operation rather than two, so nothing can change in between, and it is one lookup rather than two.

## When is LBYL the better choice?
- ( ) Always, because exceptions are slow
- (x) When the failure is expected often, or the check is much cheaper than the attempt
- ( ) When working with files
- ( ) Never
> Setting up a `try` is nearly free since 3.11. Raising is not, at roughly a microsecond, which matters only in a tight loop.

## `raise NewError(...) from exc` produces which message?
- (x) "The above exception was the direct cause of the following exception"
- ( ) "During handling of the above exception, another exception occurred"
- ( ) No chained message at all
- ( ) "Traceback (most recent call last)"
> The second is what implicit chaining prints, and it reads as a second bug appearing inside your handler rather than a deliberate translation.

## ruff's `B904` asks you to
- ( ) Avoid raising inside an `except` clause
- (x) Use `raise ... from err` or `from None` when raising inside an `except`
- ( ) Catch a narrower type
- ( ) Add a docstring to your exception
> Losing the original is losing the only evidence of what actually went wrong.

## To re-raise the exception you just caught, write
- (x) `raise`
- ( ) `raise exc`
- ( ) `raise exc from exc`
- ( ) `return exc`
> A bare `raise` re-raises the exception in flight. Naming it works too, but a bare `raise` is the form that says what you mean.

## A class must derive from what before it can be raised?
- ( ) `Error`
- ( ) `object`
- (x) `BaseException`
- ( ) Nothing; any class can be raised
> Derive from `Exception` in practice. `except` has the same requirement, which is a second way to meet this error.

## `ExceptionGroup` and `except*` exist for
- ( ) Replacing `try`/`except`
- (x) Carrying several failures at once, so more than one clause can handle a group
- ( ) Catching `BaseException` safely
- ( ) Retrying failed operations
> Added in 3.11, mostly for concurrency, where several tasks fail independently and reporting only the first loses information.
