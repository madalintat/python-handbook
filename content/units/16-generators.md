---
slug: 16-generators
title: Generators
---

Unit 15 built an iterator by hand: a class, two methods, and state kept on the instance. A generator does the same job in a function, and the state is the function's own execution, paused where it left off.

## `yield` changes what a function is

A function containing `yield` anywhere in its body is not a normal function. **Calling it runs none of the body.** It returns a generator object, and the body begins only when something asks for the first value.

```python
def countdown(n):
    print("starting")
    while n > 0:
        yield n
        n -= 1

g = countdown(3)      # prints nothing
next(g)               # prints "starting", returns 3
```

That "prints nothing" is the whole idea. `yield` suspends the function, handing a value out and keeping everything else exactly where it was: the local variables, the position in the loop, the point inside a `try`. The next `next()` resumes from that line.

A generator is an iterator, so it has `__iter__` returning itself and `__next__`, and everything unit 15 said applies. It is exhausted after one pass, it has no length, and it is always truthy.

## Where the state actually lives

A paused generator is a real object holding a real frame, and you can look at it:

```python
g = countdown(3)
next(g)
g.gi_frame.f_locals      # {'n': 3}
g.gi_running             # False
import inspect
inspect.getgeneratorstate(g)     # 'GEN_SUSPENDED'
```

The four states are worth knowing by name because they explain the errors. `GEN_CREATED` is before the first `next`, which is why calling `send` with anything other than `None` on a fresh generator raises: there is no paused `yield` for the value to become. `GEN_SUSPENDED` is paused at a `yield`. `GEN_RUNNING` is executing, and asking a running generator for a value from inside itself raises `ValueError`. `GEN_CLOSED` is finished, and every further `next` raises `StopIteration`.

That frame is also the memory cost. A generator is not free: it holds its locals for as long as it is alive, so a million paused generators is a million frames. The saving is against materialising the *values*, not against having none.

## Generator expressions and generator functions

Unit 13 met `(f(x) for x in items)`, which is a generator too, and the two forms divide cleanly.

A generator **expression** is for a transformation you can write in one line: map, filter, or both. It is an expression, so it goes inline as an argument, and `sum(x * 2 for x in items)` is the idiomatic use.

A generator **function** is for anything with structure: a loop with a condition, state between items, a `try`, more than one `yield`, or a name worth having. Anything that needs a comment inside it wants to be a function.

The rewrite between them is mechanical, and the point at which to reach for the function form is the point at which the expression needs a second `for` or a nested conditional. That is roughly where a comprehension stops being readable too, which is not a coincidence: they compile to nearly the same thing.

## The same iterator, far shorter

Compare with unit 15's class:

```python
class Countdown:
    def __init__(self, start): self.n = start
    def __iter__(self): return self
    def __next__(self):
        if self.n <= 0: raise StopIteration
        self.n -= 1
        return self.n + 1

def countdown(start):
    while start > 0:
        yield start
        start -= 1
```

Nine lines become three, and the second version reads as the logic rather than as a state machine. That is the argument for generators: the awkward part of writing an iterator is turning a loop inside out so it can be resumed, and `yield` does that for you.

## Reusable, if you want it

A generator function called twice gives two independent generators, which is how you make a class walkable more than once:

```python
class Deck:
    def __init__(self, cards):
        self.cards = list(cards)

    def __iter__(self):
        for card in self.cards:
            yield card
```

Each `for` over a `Deck` calls `__iter__`, which returns a **new** generator. That is the reusable shape from unit 15, written as a generator, and it is the usual way to make a class iterable.

## `return` ends it

A bare `return` inside a generator stops it, raising `StopIteration`. A `return value` attaches the value to the exception rather than yielding it, so a `for` loop never sees it; it is available as `exc.value` and is mostly used by `yield from`. If you were expecting `return` to produce a final item, it does not, and that is a common surprise.

## `yield from`

Delegating to another iterable:

```python
def flatten(rows):
    for row in rows:
        yield from row
```

`yield from row` yields every value of `row`, and it is more than shorthand for a loop: it forwards `send`, `throw` and `close` to the inner generator and passes back its return value. For plain iteration the loop and the delegation are equivalent, and `yield from` says the intent more plainly.

## Generators are pipelines

Because each stage is lazy, generators chain without materialising anything in between:

```python
lines = (line.rstrip("\n") for line in open(path, encoding="utf-8"))
records = (parse(line) for line in lines if line)
recent = (r for r in records if r.date >= cutoff)

for record in recent:
    ...
```

Nothing is read until the `for` runs, and then one line moves through the whole chain at a time. Memory stays flat whatever the file size, and if the loop stops early the rest of the file is never read.

That last property is what people forget to protect: one `sorted()`, one list comprehension, one `len()` anywhere in the chain forces the whole thing through and gives all of it back.

## The StopIteration trap

Before Python 3.7 this was one of the nastiest bugs in the language, and knowing what changed explains an error message you will meet.

If a `StopIteration` is raised inside a generator, from a bare `next()` on an exhausted inner iterator, it used to escape and be caught by whatever was iterating the outer generator, which read it as "this generator is finished". So the outer loop stopped early, silently, with no traceback and nothing to find.

PEP 479 fixed it: a `StopIteration` that would escape a generator is now converted into a `RuntimeError` with the message "generator raised StopIteration". So the failure is loud, and it points at the generator rather than at the loop that stopped early.

The lesson survives the fix. Inside a generator, `next(inner)` without a default is a bare edge: either give it a default, or catch `StopIteration` and decide what the generator should do about it, which is nearly always to `return`.

```python
def pairs(source):
    for first in source:
        second = next(source, None)     # not a bare next()
        yield first, second
```

## When a generator is the wrong answer

Three cases, all of them the trade from unit 15 in a different light.

**When the caller needs it twice, or its length, or an index.** Every one of those forces a list, and building the list inside the function is kinder than making every caller do it.

**When the values are already in memory.** A generator over a list you already hold saves nothing and costs a layer of indirection, plus the exhaustion hazard for whoever receives it. Return the list.

**When the laziness delays an error past the place that can handle it.** A generator that validates its input raises on the first `next`, which may be in an entirely different function, long after the call that looked like it should have failed. If the validation should happen at call time, do it in a normal function that returns a generator, so the check runs eagerly and the yielding happens in an inner function.

## The two-way part

A generator can also receive. `send(value)` resumes it and makes the paused `yield` expression evaluate to that value:

```python
def running_total():
    total = 0
    while True:
        n = yield total
        total += n

acc = running_total()
next(acc)          # prime it: run to the first yield
acc.send(10)       # 10
acc.send(5)        # 15
```

`throw` raises an exception at the paused point, and `close` raises `GeneratorExit` there, which is what lets a `finally` in a generator run when it is discarded.

This is the machinery `async`/`await` was built on, and it is worth having seen once for that reason. In ordinary code it is rare, and a class is usually clearer when a thing genuinely needs to receive.

## Cleanup, and where it happens

A `try`/`finally` around a `yield` works, and the `finally` runs when the generator is closed or garbage collected:

```python
def read_lines(path):
    f = open(path, encoding="utf-8")
    try:
        yield from f
    finally:
        f.close()
```

The caveat is *when*. If nothing consumes the generator to the end and nothing closes it, the `finally` waits for the collector. In CPython that is usually immediate, since refcounting drops it as soon as the name goes away, but it is not a guarantee and it is not true on other implementations. When the resource matters, a `with` inside the generator says it better.

## Reading a generator's control flow

The hardest thing about a generator is that its code does not run in the order it is written, and there are two habits that make it tractable.

Read it as a normal function first, ignoring that `yield` pauses. The loops, the conditions and the order of the yields are exactly what they look like, and that is the logic.

Then, for each `yield`, ask what the caller does between one value and the next. Anything can happen there: the caller can stop consuming, raise, or wait an hour. Code after a `yield` runs at a time you do not control, which is what makes a `finally` in a generator worth thinking about and a lock across a `yield` a bad idea.

The debugging version of the same thing: a generator that seems not to run has usually not been consumed, and a `print` before the first `yield` tells you which. If it never appears, nothing ever asked for a value, and the bug is at the call site rather than in the generator.

## What to carry forward

A function with `yield` returns a generator and runs nothing until asked. `yield` suspends and resumes with all local state intact, which is why a generator is the short way to write an iterator. Calling the function again gives a fresh one, which is how a class becomes reusably iterable. `return` ends a generator rather than yielding. `yield from` delegates and forwards. Chained generators are a pipeline that holds one item at a time, until something in the middle builds a list. And `send`, `throw` and `close` make it two-way, which is where `async` came from.
