---
slug: 06-control-flow
title: Control flow
---

Python's control flow is small: `if`, `while`, `for`, `break`, `continue`, and since 3.10, `match`. What makes it worth a unit is that two of those do something other than what their names suggest, and one of them is the newest feature in the language and the least used.

## `for` is not a counter loop

A `for` statement does not count. It asks an object for an iterator and pulls items from it until it is exhausted:

```python
for item in things:
    ...
```

is roughly

```python
it = iter(things)
while True:
    try:
        item = next(it)
    except StopIteration:
        break
    ...
```

This is why `for` works on lists, strings, dicts, files, generators, database cursors and anything you write with `__iter__`, and why there is no index anywhere in it. Unit 15 takes the protocol apart; the consequence to absorb now is that **`for i in range(len(things))` is almost always the wrong shape**. If you want the items, iterate the items. If you want both, `enumerate` gives you them in pairs:

```python
for index, item in enumerate(things):
```

and if you want two sequences together, `zip` does that, stopping at the shorter one unless you pass `strict=True` to make a mismatch an error.

Iterating a dictionary gives you its **keys**, not its values and not its pairs. `for k in scores` is `for k in scores.keys()`, and `.values()` and `.items()` are how you ask for the other two.

## `zip`, `enumerate`, and the arguments worth knowing

Both take a keyword argument that most people never discover, and both are worth setting deliberately.

`enumerate(things, start=1)` counts from one, which is what you want for anything a human reads, line numbers, ranked results, step counts. The default of zero is right for indices and wrong for prose.

`zip(a, b, strict=True)` raises when the two inputs are different lengths. The default silently stops at the shorter one, which is occasionally what you want and is far more often a bug that hides a data problem: two lists that were supposed to correspond, one of them short, and the extra rows quietly dropped with nothing to show for it. Added in 3.10, and worth making a habit.

`zip` also transposes, because zipping the unpacked rows of a matrix gives you its columns:

```python
rows = [(1, 2), (3, 4)]
cols = list(zip(*rows))      # [(1, 3), (2, 4)]
```

## Ranges are lazy and exclusive

`range` is not a list. It is an object that computes values on demand, so `range(1_000_000_000)` costs nothing until you iterate it, and it supports `in`, indexing and slicing without ever materialising anything.

Its stop value is exclusive, which is the same convention as slicing and is what makes `range(len(x))` cover exactly the valid indices and `range(a, b)` have `b - a` elements. Two consequences follow: adding one to the stop to "include the end" is how off-by-one index errors happen, and `range(0)` is empty rather than an error, so a loop over it does not run.

## `break`, `continue`, and the `else` nobody expects

`break` leaves the innermost enclosing loop. `continue` skips to the next iteration of the innermost enclosing loop. Neither takes a label, and Python has no labelled break, which matters as soon as you have two loops and want out of both.

And then there is the loop `else`, which is the most misread piece of syntax in the language:

```python
for item in items:
    if matches(item):
        break
else:
    print("no match found")
```

The `else` runs **when the loop finished without breaking**. Not when the loop body never ran, and not when the collection was empty. An empty collection completes without breaking, so the `else` runs.

Read it as "if we got all the way through without finding anything", and it is genuinely useful for search loops, because it removes the `found = False` flag that would otherwise be needed. Read it as "if the loop did not run", which is what the keyword suggests, and you will get it wrong every time. Many experienced Python programmers avoid it for that reason alone, and that is a defensible position.

`while ... else` follows the same rule: the `else` runs when the condition became false, and is skipped when a `break` got you out.

## Getting out of two loops

There is no `break 2`. The three honest options:

Put the loops in a function and `return`, which is usually clearest and has the pleasant side effect of naming the thing you were searching for.

Use a flag, which is explicit and verbose.

Or restructure so there is only one loop, `itertools.product` turns nested iteration into a single loop over pairs:

```python
for row, col in itertools.product(range(h), range(w)):
```

## `while` and the loop you cannot leave

`while` tests its condition before every pass, including the first, so a `while` whose condition starts false never runs at all. Python has no do-while; the idiom is `while True` with a `break` at the point where the answer becomes known:

```python
while True:
    line = source.readline()
    if not line:
        break
    handle(line)
```

That reads better than it looks, because it puts the exit condition exactly where the information arrives rather than forcing it to the top before the value exists. It is also the shape the walrus operator was designed to compress.

The failure mode of `while` is the loop whose condition can never become false, and it has two common causes. The first is forgetting to advance: reading from a source without consuming it, or comparing against a variable nothing updates. The second is subtler, a `continue` placed above the line that advances the counter, so every pass through that branch skips the increment. `for` avoids both by taking responsibility for advancing, which is one reason to prefer it whenever the number of iterations is knowable.

## `match` is not a switch

Python 3.10 added `match`, and describing it as a switch statement undersells it enough to be misleading. It matches **structure**, not just values, and it binds names while it does so.

```python
match command:
    case ["move", direction]:
        walk(direction)
    case ["drop", *items]:
        drop(items)
    case {"action": "quit"}:
        return
    case Point(x=0, y=0):
        origin()
    case _:
        unknown()
```

Each `case` is a **pattern**, and patterns come in kinds: literal patterns (`case 0:`), sequence patterns (`case [a, b]:`), mapping patterns (`case {"k": v}:`), class patterns (`case Point(x=0):`), and the wildcard `_`.

Sequence patterns match lists and tuples and any other sequence, but deliberately **not** strings or bytes, because matching a string as a sequence of characters is almost never what anyone means.

Mapping patterns match on a subset: `case {"action": "quit"}` matches a dictionary that has that key with that value, whatever else it also contains.

## The trap in `match`

A bare name in a pattern is a **capture**, not a comparison:

```python
RED = "red"

match colour:
    case RED:          # matches ANYTHING, and rebinds RED to it
        ...
```

This is the single mistake everyone makes. A pattern is not an expression; a name appearing alone in one is a place to store what was matched, in the same way `case [a, b]` binds `a` and `b`. So `case RED:` matches every possible value and quietly overwrites your constant.

Python's fix is that a **dotted** name is a value pattern rather than a capture:

```python
case Colour.RED:       # compares against the value
case constants.RED:    # also compares
```

So constants used in patterns need to live on a class, an enum or a module. An `Enum` is the tidy answer, and it is one of the better reasons to reach for one.

Guards handle the rest, an `if` attached to a case, evaluated only after the pattern matched:

```python
case [x, y] if x == y:
```

## Comparing `match` with what it replaces

A chain of `elif` comparisons and a `match` are not the same tool with different syntax, and the difference is what the pattern can express.

`elif` compares values. To pull apart a structure it needs separate code: check the type, check the length, then index into it, then bind the pieces to names, four steps that can each be wrong and none of which state the shape you were expecting.

A pattern states the shape and does all four at once. `case ["move", direction]:` says: a sequence, of length two, whose first element equals `"move"`, and bind the second to `direction`. If any part fails the case does not match and the next one is tried. That is worth having when the data really is structured, parsed commands, JSON documents, ASTs, message envelopes.

When you are comparing one value against a handful of constants, `elif` remains perfectly good and a dictionary lookup is often better still:

```python
handler = {"start": on_start, "stop": on_stop}.get(command, on_unknown)
handler()
```

The honest guidance is that `match` earns its place when you are destructuring, and adds ceremony when you are not.

## `_` means two different things

In a pattern, `_` is the wildcard: it matches anything and, uniquely among names, binds nothing. `case _:` is the default case and belongs last, since cases are tried in order and everything after a wildcard is unreachable.

Everywhere else in Python, `_` is an ordinary name that convention reserves for a value you are deliberately discarding:

```python
for _ in range(3):
    tick()

first, _, third = row
```

The name really is bound in those cases. It is only inside a `match` pattern that it is special. And in the REPL, `_` is separately bound to the last result, which is why using it as a throwaway in an interactive session occasionally surprises you.

## Loops that should not be loops

Three shapes worth replacing on sight, because the replacement says what you meant:

A loop that builds a list from another list is a comprehension. A loop whose only job is to decide whether something exists is `any()` or `all()`, both of which short-circuit. And a loop that accumulates a total is `sum()`, or `math.prod`, or `functools.reduce` when the operation is unusual.

```python
if any(row.failed for row in rows):
```

The version with a `for`, a flag and a `break` is four lines that a reader has to execute mentally to understand.

## What to carry forward

`for` iterates whatever an object's iterator produces and never counts, so `range(len(x))` is a smell and `enumerate` and `zip` are the fixes. Iterating a dict gives keys. `break` and `continue` affect only the innermost loop and there is no label; use a function and `return` to escape two. The loop `else` runs when no `break` happened, which is not what the word suggests. And in `match`, a bare name captures rather than compares, so constants must be dotted.
