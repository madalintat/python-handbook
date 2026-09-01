---
slug: 38-tracebacks
title: Reading the traceback
---

The last unit, and the most immediately useful. A traceback is a precise account of what happened, and most people skim it. Reading one properly is a skill that pays back every day you write Python, and it takes about a page to learn.

## What the shape means

```
Traceback (most recent call last):
  File "app.py", line 42, in main
    result = process(rows)
             ~~~~~~~^^^^^^
  File "app.py", line 18, in process
    return total(row["amount"] for row in rows)
                 ~~~^^^^^^^^^^
KeyError: 'amount'
```

Three things, and the order matters.

**"Most recent call last"** means the bottom is where it broke and the top is where the program started. Read the **last line first**: it names the exception and its message, which is usually the whole answer.

**Then read the frames from the bottom up**, until you reach one in code you wrote. The bottom frame is often inside a library, and the library is usually not wrong; the frame above it, where your code called in with something unexpected, is where the mistake is.

**The `~~~^^^` markers** are fine-grained error locations, and they are the underrated part. They point at the exact sub-expression that failed, which in a line with three subscripts and two calls is the difference between knowing and guessing.

## The three lines that answer most questions

The exception type tells you the category. `KeyError` is a missing dict key; `AttributeError` is usually a `None` where an object was expected; `TypeError` is usually the wrong number or kind of arguments.

The message tells you the specific value, and Python has become good at this. `KeyError: 'amount'` names the key. `AttributeError: 'NoneType' object has no attribute 'name'` tells you the object was `None`, which is a different problem from a misspelled attribute. And since 3.10, a misspelled name is met with `Did you mean: 'names'?`, which resolves an entire class of bug at a glance.

The deepest frame in your own code tells you where. That is the line to open.

## The exceptions you will meet, and what they usually mean

The type narrows the search before you read anything else. Ten cover almost everything.

**`AttributeError: 'NoneType' object has no attribute 'x'`** is the most common single traceback in Python, and it almost never means the attribute is misspelled. It means a function returned `None` where you expected an object, and the function to look at is the one that produced the value, not the line that used it. Unit 24's `X | None` is the permanent fix.

**`KeyError`** is a missing dict key, and the message names it. **`IndexError`** is a list index past the end, usually an empty list you assumed had something in it.

**`TypeError`** splits into two. "takes 2 positional arguments but 3 were given" is a signature problem, and unit 18 covered the `self` version. "unsupported operand type(s)" means a value is not the kind of thing you thought several lines earlier, which is where to look.

**`ValueError`** means the type was right and the value was not: `int("abc")`, unpacking the wrong number of items.

**`ImportError`** and **`ModuleNotFoundError`** are unit 29's, and the two questions there answer them.

**`RecursionError`** is either genuine depth or, far more often, an accident: a property whose getter reads itself, a `__setattr__` that assigns through itself, a `__getattr__` that touches a missing attribute. Units 19 and 20 made those exercises because the traceback, thousands of identical frames, tells you the shape but not the cause.

**`UnboundLocalError`** means a name is assigned somewhere in the function, so Python made it local, and it was read before that assignment ran. Unit 08 explained it; the message says "referenced before assignment" and the fix is usually `global` or `nonlocal`, or more often a different name.

**`StopIteration` appearing where you did not expect it** means a generator was exhausted, and unit 16 covered what that means inside another generator.

## Chained exceptions

Two phrases separate two different situations, and they are worth telling apart.

**"The above exception was the direct cause of the following exception"** means somebody wrote `raise X from Y`, deliberately, to say that Y caused X. Both are meant to be there, and the first one is usually the interesting one.

**"During handling of the above exception, another exception occurred"** means something failed **inside an `except` block**. That is often two bugs: the original failure, and a handler that could not cope with it. Unit 32's `B904` rule exists to make you choose between them.

The first traceback in a chain is the original failure. Read it first.

## Exception groups

Unit 34's `TaskGroup` produces an `ExceptionGroup`, printed as a tree:

```
  + Exception Group Traceback (most recent call last):
  ...
  +-+---------------- 1 ----------------
    | ValueError: bad row 3
    +---------------- 2 ----------------
    | TimeoutError
    +------------------------------------
```

Each numbered section is one failure with its own traceback. It looks unfamiliar for a week and then reads better than the alternative, because several things genuinely did fail and any other format would have thrown some of them away.

## Making the traceback tell you more

Three habits, in order of how much they pay.

**Raise with the value in the message.** `raise ValueError(f"unknown status {status!r}")` costs nothing at the point you write it and saves the whole diagnosis later. The `!r` matters, because `unknown status ` with nothing after it means the value was an empty string, and you cannot tell that from `unknown status ''`.

**Do not catch what you cannot handle.** A bare `except:` that logs and continues turns a precise report into a line of text with no traceback attached. If you must catch broadly, log with `exc_info=True` or `logging.exception`, which preserves it.

**Add context, keep the cause.** `raise ConfigError("could not read settings") from exc` gives the reader both halves: what the program was doing and what actually went wrong.

## When the traceback is not where the bug is

Three cases where the honest answer is that the traceback points at the symptom.

**A value that arrived from somewhere else.** The frame that raised is where the bad value was *used*; the bug is where it was *made*, which may be a long way off. This is what makes `None` errors tiring, and the way to shorten it is to check at the boundary: raise where the value is produced, so the traceback points at the origin.

**An exception raised from a callback.** A handler, a comparison function passed to `sort`, a coroutine in a task group. The traceback shows the library calling your function, which is correct and unhelpful, and the interesting frame is the one that registered it, which is not in the traceback at all.

**Anything mutated by something else.** A list that is not what you think, a dict a different thread changed, a module-level container something appended to at import. Nothing about the traceback says so, and the tell is that the value is impossible rather than merely wrong.

For all three the technique is the same: stop reading and start printing. `print(f"{value=}")` uses the `=` form so you get the name and the value together, and it is faster than reasoning about the traceback for one more minute.

## The tools

`traceback.print_exc()` prints the current one, and `traceback.format_exc()` returns it as a string when you need it somewhere other than stderr.

`python -X dev` turns on development mode, which surfaces warnings that are otherwise hidden, including the "coroutine was never awaited" of unit 34.

`breakpoint()` drops into `pdb` at that line: `p` to print an expression, `l` for the surrounding source, `u` and `d` to move up and down the stack, `c` to continue. Moving **up** to the caller is the one people forget, and it is usually where the bad value came from.

For a program already running, `faulthandler.enable()` prints a traceback on a hard crash or a signal, which is how you find out where a hang is. `py-spy dump --pid N` does the same from outside the process, without stopping it, which is the one to reach for in production.

## The method

When something breaks, in order:

Read the last line. Read the fine-grained markers. Find the deepest frame in your own code. Look at the values in it, with `print` or `breakpoint()`. Ask where the bad value came from, and go up one frame. Repeat.

That is the whole of it, and it converges fast, because a traceback is not a hint. It is a record of exactly what happened.

## The end of the track

That is thirty-nine units. What you have now is not a memory of Python's features; it is the ability to work out what the language is doing, which is a different and more durable thing.

The projects are where it becomes yours. They are the same subject from the other direction: no starter with a bug in it, no hidden tests, just a thing that does not exist yet and the machinery to build it. Start with a mini project to get used to working without a scaffold, then take a core one that sounds interesting.

And the honest last piece of advice: read other people's Python. The standard library is right there, it is readable, and it was written by people arguing carefully about exactly the questions this book has been about.
