---
slug: 38-tracebacks
---

## "Most recent call last" means
- (x) The bottom is where it broke and the top is where the program started
- ( ) The bottom is where the program started
- ( ) The frames are in an unspecified order
- ( ) Only the last frame matters
> Read the last line first, then the frames from the bottom up.

## The `~~~^^^` markers under a line
- (x) Point at the exact sub-expression that failed
- ( ) Underline the whole statement
- ( ) Mark a syntax error
- ( ) Show where a variable was assigned
> In a line with three subscripts and two calls, that is the difference between knowing and guessing.

## The frame to open is
- (x) The deepest one in code you wrote
- ( ) The bottom one
- ( ) The top one
- ( ) The one in the library
> The library is usually not wrong. The frame above it, where your code called in, usually is.

## `AttributeError: 'NoneType' object has no attribute 'x'` almost always means
- (x) A function returned `None` where an object was expected
- ( ) The attribute is misspelled
- ( ) The object was deleted
- ( ) The class has no such attribute
> Look at the function that produced the value, not the line that used it.

## "During handling of the above exception, another exception occurred" means
- (x) Something failed inside an `except` block, which is usually two bugs
- ( ) Somebody wrote `raise X from Y`
- ( ) The exception was re-raised
- ( ) The handler succeeded
> The other phrase, "was the direct cause of", means the chaining was deliberate.

## In a chain of tracebacks, read
- (x) The first one, which is the original failure
- ( ) The last one
- ( ) Only the final exception line
- ( ) Them in the order printed
> The later ones are usually about a handler that could not cope.

## `raise X from exc` against a bare `raise X` inside an `except`
- (x) `from exc` sets `__cause__`, so the traceback shows both and tooling can read the link
- ( ) They are identical
- ( ) `from exc` replaces the original
- ( ) A bare `raise X` keeps more information
> `from None` is the deliberate opposite, for when the original is noise.

## An exception message should contain
- (x) The offending value, with `!r`
- ( ) The type of the error
- ( ) A suggested fix
- ( ) The line number
> `unknown status ''` says the value was an empty string; `unknown status ` cannot.

## A bare `except Exception` that returns a default
- (x) Converts a precise report into nothing, and the failure surfaces later as a wrong number
- ( ) Is defensive programming
- ( ) Preserves the traceback
- ( ) Is required for robustness
> If you must catch broadly, `logging.exception` keeps the traceback.

## `UnboundLocalError` differs from `NameError` in that
- (x) The name is local, because it is assigned somewhere in the function, and was read first
- ( ) The name does not exist anywhere
- ( ) It only happens in classes
- ( ) It is raised at compile time
> The fix is almost never `global`; it is to give the name a value on every path.

## Thousands of identical frames means
- (x) An accidental cycle: a property reading itself, a `__setattr__` assigning through itself
- ( ) Deep recursion in an algorithm
- ( ) A memory problem
- ( ) A corrupted stack
> The traceback tells you the shape; the code tells you the cause. The storage needs its own name.

## An `ExceptionGroup` is printed as
- (x) A tree, with each failure numbered and carrying its own traceback
- ( ) The first exception only
- ( ) A list of messages
- ( ) One combined traceback
> `except*` matches by type inside one. It is not only for `asyncio`.

## When the traceback points at the symptom rather than the bug
- (x) Check at the boundary, so the value is refused where it is produced
- ( ) Add a broader `except`
- ( ) Read further up the stack
- ( ) Add more logging everywhere
> The distance between the two frames is however far the bad value travelled.

## In `pdb`, the command people forget is
- (x) `u`, to move up to the caller, which is usually where the bad value came from
- ( ) `c`, to continue
- ( ) `p`, to print
- ( ) `l`, to list source
> `breakpoint()` is how you get there, and `print(f"{value=}")` is often faster still.

## To find where a running program is stuck
- (x) `faulthandler.enable()` from inside, or `py-spy dump --pid N` from outside
- ( ) `gdb`
- ( ) `traceback.print_exc()`
- ( ) A profiler
> `py-spy` does not stop the process, which is what you want in production.
