---
slug: 17-itertools
title: itertools and functools
---

Two standard library modules that mostly contain things you would otherwise write by hand, slightly wrong. `itertools` is about walking over sequences; `functools` is about functions. Neither needs learning cover to cover, and both repay knowing what is in them.

## `itertools`, by what it answers

**Take some of it.** `islice(it, n)` takes the first n from any iterable, including one you cannot slice, and stops the source there. `takewhile(pred, it)` takes from the front while a condition holds and stops at the first failure; `dropwhile` skips that same prefix and yields the rest. The distinction from `filter` is that these two stop looking, and `filter` checks every element.

**Join things.** `chain(a, b, c)` walks several iterables as one, and `chain.from_iterable(rows)` flattens one level, which is the lazy version of the double-`for` comprehension from unit 13.

**Group runs.** `groupby(it, key)` yields `(key, group)` for each **consecutive** run of equal keys. It does not sort, so the input must already be ordered by that key or you get a new group every time the value changes back. That is the single most common misuse of this module, and the fix is `sorted(rows, key=k)` first.

**Go on forever.** `count(start, step)` produces numbers without end, `cycle(it)` repeats an iterable forever, and `repeat(x, n)` gives you the same value n times. All three are useful only because something downstream stops.

**Combine.** `product`, `permutations`, `combinations` and `combinations_with_replacement` do what their names say. `product(a, b)` is nested loops flattened, which is one honest way out of unit 06's two-loop problem.

**Accumulate.** `accumulate(it)` yields the running total, and with a function argument, the running anything: `accumulate(prices, max)` is the running maximum.

**Pair up.** `pairwise(it)` yields overlapping neighbours, `(a, b)`, `(b, c)`, and it is what you want for differences between consecutive values. `batched(it, n)` yields non-overlapping tuples of n, added in 3.12, and it is the one people wrote by hand for years.

`tee(it, n)` deserves a warning. It gives you n independent iterators over one source, and it does so by buffering everything the slowest one has not reached. If the consumers move at different speeds it holds the difference in memory, so `tee` on a large source with one fast consumer is a memory leak with a friendly name.

## `groupby`, at length

It is worth one section of its own, because it is the most used and the most misused thing here.

```python
from itertools import groupby

rows = sorted(rows, key=lambda r: r["dept"])
for dept, group in groupby(rows, key=lambda r: r["dept"]):
    print(dept, len(list(group)))
```

Three properties catch people.

**It groups consecutive runs, not equal values.** Given `a a b b a`, it yields three groups, not two. If you wanted two, sort first with the same key. The key function must be the same one you sorted by, and a mismatch produces a result that looks almost right.

**The group is an iterator, and it shares the source.** Advancing to the next group consumes whatever is left of the current one, so you cannot keep the groups and look at them later:

```python
groups = list(groupby(rows, key=k))       # every group is now empty
groups = [(key, list(g)) for key, g in groupby(rows, key=k)]   # correct
```

That first line is the bug, and it produces empty groups rather than an error, which is unit 15's failure mode exactly.

**The key defaults to the element itself**, so `groupby(word)` on a string groups runs of identical characters, which is the neat way to write a run-length encoder.

When the input is not sorted and sorting it is too expensive, `groupby` is the wrong tool and a `defaultdict(list)` from unit 12 is the right one: one pass, no ordering requirement, and the groups are lists you can keep.

## Everything is lazy

Every one of these returns an iterator, which is unit 15 all over again: exhausted after one pass, no length, no indexing. A pipeline built from them touches only what is consumed.

The other consequence is that nothing happens until you ask. A chain of `map`, `filter` and `islice` that is never iterated does no work at all, which is a fine property until you write one for its side effects and wonder why nothing happened.

## `map` and `filter`, honestly

Both return iterators, and both do what a comprehension does.

```python
map(str.upper, names)              # (n.upper() for n in names)
filter(None, values)               # (v for v in values if v)
```

`map` is worth using when the function already exists and is named: `map(int, fields)` reads better than the comprehension. It stops paying the moment you need a lambda, because `map(lambda x: x * 2, xs)` is longer and slower than the comprehension that says the same thing.

`filter(None, values)` is the idiom for dropping falsy values, and it is genuinely shorter than the comprehension. `filter` with a lambda is the same trade as `map`.

`reduce` moved to `functools` in Python 3, deliberately, because most uses of it are `sum`, `min`, `max`, `any`, `all` or `math.prod` under a disguise. Reach for it when the operation is genuinely unusual, and write the loop when the loop is clearer, which is often.

## `functools`

**`cache` and `lru_cache`** memoise a function on its arguments. `@cache` is unbounded; `@lru_cache(maxsize=n)` keeps the n most recent. Two things to know: the arguments must be hashable, since they become a dict key, and the cache lives as long as the function does, so caching a method keeps every instance you ever passed alive.

**`partial`** fixes some arguments and returns a callable wanting the rest. It is the honest answer to the loop-variable capture problem from unit 08, and it is clearer than a lambda when what you are doing is genuinely applying arguments early.

**`wraps`** copies a wrapped function's name, docstring and signature onto the wrapper. Unit 26 makes the case; the short version is that a decorator without it produces functions all called `wrapper`, which ruins tracebacks and documentation.

**`total_ordering`** fills in the comparison methods from `__eq__` and `__lt__`, which unit 14 covered.

**`singledispatch`** turns a function into one that picks an implementation by the type of its first argument. It is the readable alternative to a tower of `isinstance` checks, and it is extensible: another module can register a case without editing yours.

**`reduce`**, as above.

## `cache`, and what it holds

`@cache` is one line and changes the complexity of a recursive function:

```python
from functools import cache

@cache
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
```

Without it that is exponential; with it, linear. The same applies to any repeated call with the same arguments, which is most of the accidentally quadratic code people write.

Three things to keep in mind before putting it on something real.

**Arguments must be hashable**, because they become a dict key. A function taking a list cannot be cached without converting first, and the conversion has to be exact: a tuple and a list of the same values are different keys.

**It never forgets.** `@cache` is unbounded, so a function called with many distinct arguments grows without limit. `@lru_cache(maxsize=1024)` keeps the most recent and is the safer default for anything driven by external input.

**It keeps its arguments alive.** Caching a method means every `self` ever passed is held by the cache for the life of the process, which is a memory leak that looks like a speedup. Cache a plain function that takes the values it needs, not a method.

`cache_clear()` and `cache_info()` are on the decorated function, and the second is worth checking when a cache is not doing what you assumed: it reports hits, misses and current size.

## Where these change code you have written

The three that most often replace something already in a codebase: `groupby` after a sort, in place of a hand-rolled loop with a "current key" variable; `pairwise`, in place of `zip(x, x[1:])` or an index loop; and `cache` on a recursive function, which is the difference between exponential and linear.

The one to be most careful with is `groupby`, because the hand-rolled version people replace usually did not need sorted input, and the replacement does.

## Functional style, and how far to take it

Python has the pieces of functional programming and is not a functional language, and the honest position is somewhere in the middle.

What works well: functions as values, passed and returned; small pure functions composed into a pipeline; `map` and `filter` where the function is already named; `partial` where arguments are genuinely being fixed early. All of these read well and are ordinary Python.

What works badly: deep chains of `lambda`, `reduce` in place of a loop, and anything requiring the reader to unpick three levels of composition to see what happens to one item. Python has no operator for composing functions, no pipeline syntax, and a `lambda` restricted to a single expression, so the language pushes back on that style rather than supporting it.

The practical test is whether a reader can point at the line where a value is transformed. In a comprehension or a loop, they can. In `reduce(lambda a, b: ..., map(g, filter(p, xs)), init)`, they are reading inside out, and the version with a name for each stage is both longer and faster to understand.

Two habits worth keeping from that world regardless of style: prefer functions that return new values to functions that mutate arguments, which unit 02 argued on different grounds; and keep the function you pass to `map`, `key` or `filter` free of side effects, because the order and number of calls is not yours to control.

## What to carry forward

`itertools` is lazy walking and `functools` is functions. `islice`, `chain`, `pairwise`, `batched` and `accumulate` are the ones you will actually reach for. `groupby` groups consecutive runs and therefore needs sorted input. `tee` buffers the difference between its consumers. `map` and `filter` earn their place with a named function and lose it with a lambda. `cache` needs hashable arguments and holds them forever. And `partial` and `singledispatch` each replace a shape you have probably written the long way.
