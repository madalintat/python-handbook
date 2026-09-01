---
slug: 17-itertools
---

## groupby groups runs, not values

`count_by_dept` groups rows by department and counts each one. `groupby` groups **consecutive** runs of equal keys, and the input is not sorted by that key.

@expect silent
@hint `groupby` never sorts. Work out what it does with `a a b a`.
@hint The key you sort by must be the key you group by.
@diagnose silent Nothing raised, and a department that appears in two places produced two groups, so the later one overwrote the earlier in the result. `groupby` walks its input once and starts a new group every time the key changes, which means it groups runs rather than values. Sorting by the same key first turns runs into groups. When sorting is too expensive, or the input arrives in an order you must keep, `groupby` is the wrong tool and a `defaultdict(list)` from unit 12 is the right one: one pass, no ordering requirement, and the groups are real lists.

~~~starter
from itertools import groupby


def count_by_dept(rows):
    """Return how many rows each department has."""
    out = {}
    for dept, group in groupby(rows, key=lambda r: r["dept"]):
        out[dept] = len(list(group))
    return out
~~~

~~~tests
rows = [{"dept": "a"}, {"dept": "b"}, {"dept": "a"}]
out = count_by_dept(rows)
assert out == {"a": 2, "b": 1}, f"got {out}"
assert count_by_dept([]) == {}
~~~

~~~solution
from itertools import groupby


def count_by_dept(rows):
    """Return how many rows each department has."""
    out = {}
    ordered = sorted(rows, key=lambda r: r["dept"])
    for dept, group in groupby(ordered, key=lambda r: r["dept"]):
        out[dept] = len(list(group))
    return out
~~~

## The groups that emptied themselves

`collect_groups` builds a list of the groups so it can look at them afterwards. Each group is an iterator sharing the source, so moving to the next one consumes the last.

@expect silent
@hint The group `groupby` yields is an iterator over the same underlying source.
@hint Materialise each group before advancing to the next.
@diagnose silent Nothing raised, and every group came back empty except possibly the last. `groupby` does not buffer: the group it hands you is a view onto the shared source, and advancing to the next group consumes whatever is left of the current one. So `list(groupby(...))` gives you the keys and a set of exhausted iterators, which is unit 15's failure mode in a shape that looks nothing like iteration. Convert as you go: `[(key, list(g)) for key, g in groupby(...)]` reads each group fully before moving on, which is the only ordering that works.

~~~starter
from itertools import groupby


def collect_groups(values):
    """Return (value, run) pairs for each run of equal values."""
    return [(key, list(group)) for key, group in list(groupby(values))]
~~~

~~~tests
out = collect_groups([1, 1, 2, 3, 3, 3])
assert out == [(1, [1, 1]), (2, [2]), (3, [3, 3, 3])], f"got {out}"
assert collect_groups([]) == []
~~~

~~~solution
from itertools import groupby


def collect_groups(values):
    """Return (value, run) pairs for each run of equal values."""
    return [(key, list(group)) for key, group in groupby(values)]
~~~

## Filtering where you meant to stop

`until_negative` should take values from the front until it meets a negative one. It filters instead, which examines every value and keeps the positives from anywhere in the sequence.

@expect silent
@hint `filter` checks every element. Something else stops at the first failure.
@hint `takewhile` takes from the front while a condition holds, and gives up there.
@diagnose silent It runs and keeps positive values from beyond the first negative one, which is a different question from the one asked. `filter` examines the whole input and selects; `takewhile` takes from the front while the condition holds and stops looking the moment it fails. The distinction matters twice over: the results differ whenever the condition is not monotone, and `takewhile` reads no further than it had to, which is what lets it work on an unbounded source. Its counterpart `dropwhile` skips that same leading run and yields everything after it.

~~~starter
def until_negative(values):
    """Return the leading values, stopping at the first negative one."""
    return list(filter(lambda n: n >= 0, values))
~~~

~~~tests
assert until_negative([1, 2, -1, 3]) == [1, 2]
assert until_negative([-1, 1]) == []
assert until_negative([1, 2]) == [1, 2]
~~~

~~~solution
from itertools import takewhile


def until_negative(values):
    """Return the leading values, stopping at the first negative one."""
    return list(takewhile(lambda n: n >= 0, values))
~~~

## Pairing a sequence with itself

`deltas` reports the difference between each pair of neighbours. It builds the offset copy by slicing, which needs a real sequence and quietly gives nothing for an iterator.

@expect raises:TypeError
@hint `values[1:]` needs something sliceable. What does an iterator do when you try?
@hint There is an `itertools` function that yields overlapping neighbours.
@diagnose TypeError An iterator cannot be sliced, and the error says so. `zip(x, x[1:])` is the old idiom for neighbours and it quietly requires a sequence, so a function written that way works for a list and refuses a generator. Materialising to make it work is possible and throws away the laziness that made the iterator worth having. `itertools.pairwise`, added in 3.10, yields `(a, b)`, `(b, c)` from any iterable, in one pass, holding one value. It is the tool for differences, for detecting changes, and for any window of two.

~~~starter
def deltas(values):
    """Return the difference between each pair of neighbouring values."""
    return [b - a for a, b in zip(values, values[1:], strict=False)]


print(deltas(iter([1, 4, 9])))
~~~

~~~tests
assert deltas([1, 4, 9]) == [3, 5]
assert deltas([5]) == []
assert deltas([]) == []
assert deltas(iter([1, 4, 9])) == [3, 5], "it should work on an iterator too"
~~~

~~~solution
from itertools import pairwise


def deltas(values):
    """Return the difference between each pair of neighbouring values."""
    return [b - a for a, b in pairwise(values)]


print(deltas(iter([1, 4, 9])))
~~~

## A cache that cannot key its argument

`total_of` memoises a function that takes a list. The cache uses the arguments as a dict key, and a list cannot be one.

@expect raises:TypeError
@expect mypy:arg-type
@hint The cache stores results in a dict keyed by the arguments. What must a key be?
@hint Convert to something immutable before it reaches the cached function.
@diagnose arg-type mypy reports it before anything runs: the decorated function's parameter is declared as needing to be hashable, and `list` is not. Hashability is one of the few properties a type checker can genuinely verify, because it is a property of the type rather than of the value.
@diagnose TypeError `@cache` keys its dictionary on the arguments, so every argument must be hashable, and a list is not, for the reason unit 04 gave: its hash would change as it changed. The fix is to make the cached function take something immutable, usually a tuple, and to do the conversion in a thin wrapper so callers are not burdened with it. Note that the conversion has to be exact: a tuple and a list of the same values are different keys, so a wrapper that sometimes converts and sometimes does not will cache the same work twice.

~~~starter
from functools import cache


@cache
def total_of(values):
    """Return the sum of the values, computed at most once per input."""
    return sum(values)


print(total_of([1, 2, 3]))
~~~

~~~tests
assert total_of([1, 2, 3]) == 6
assert total_of([1, 2, 3]) == 6
assert total_of([]) == 0
~~~

~~~solution
from functools import cache


@cache
def _total(values):
    return sum(values)


def total_of(values):
    """Return the sum of the values, computed at most once per input."""
    return _total(tuple(values))


print(total_of([1, 2, 3]))
~~~

## reduce where a builtin was waiting

`largest` finds the biggest value by folding a comparison over the sequence. There is a builtin for this, and the hand-rolled fold gets the empty case wrong.

@expect raises:TypeError
@hint `reduce` with no initial value on an empty sequence has nothing to return.
@hint `max` takes the same `key` argument and a `default`.
@diagnose TypeError `reduce` with no initial value raises on an empty sequence, because there is nothing to start from and nothing to return. Passing an initial value fixes that and introduces a different problem: the initial value has to be a member of the same set, so a numeric identity like `0` would silently be the answer for a sequence of negatives. `max` handles both, taking `default=` for the empty case and `key=` for anything more complex than the values themselves. Most uses of `reduce` are a builtin in disguise: `sum`, `min`, `max`, `any`, `all` or `math.prod`. Keep it for genuinely unusual operations, and prefer a loop when the loop is clearer.

~~~starter
from functools import reduce


def largest(values):
    """Return the largest value, or None for an empty sequence."""
    return reduce(lambda a, b: a if a > b else b, values)


print(largest([]))
~~~

~~~tests
assert largest([3, 9, 2]) == 9
assert largest([5]) == 5
assert largest([]) is None
~~~

~~~solution
def largest(values):
    """Return the largest value, or None for an empty sequence."""
    return max(values, default=None)


print(largest([]))
~~~

## Taking the first few from a stream

`preview` takes the first few values from a source. It builds the whole thing to slice it, which reads everything and defeats the point of a lazy source.

@expect silent
@hint `list(source)[:n]` reads all of it before taking any.
@hint `islice` takes n values from any iterable and stops the source there.
@diagnose silent Nothing raised, and the whole source was consumed to return three values, which the test measures. `list(source)[:n]` is the shape to recognise: materialising in order to slice reads everything, and on an unbounded source it never returns at all. `itertools.islice(source, n)` takes n values from any iterable, sliceable or not, and stops asking. It also accepts start and step, so it is the general slicing tool for things that cannot be sliced, with the one caveat that it consumes what it skips rather than jumping.

~~~starter
def preview(source, count):
    """Return the first `count` values from the source."""
    return list(source)[:count]
~~~

~~~tests
read = []


def counted(n):
    for i in range(n):
        read.append(i)
        yield i


assert preview(counted(10000), 3) == [0, 1, 2]
assert len(read) < 50, f"read {len(read)} values to return three"
assert preview(iter([1]), 5) == [1]
~~~

~~~solution
from itertools import islice


def preview(source, count):
    """Return the first `count` values from the source."""
    return list(islice(source, count))
~~~

## Flattening lazily

`all_items` should walk every item across several batches without building anything. It concatenates the batches into one list first, which reads them all before yielding anything.

@expect silent
@hint Concatenating with `+` builds a new list holding everything.
@hint `chain` walks several iterables as one, and `chain.from_iterable` flattens one level.
@diagnose silent Nothing raised, and every batch was read before the first item came out, which the test measures. Adding lists together materialises all of them, so a function that looks like a lazy walk holds the entire input at once and does the work of the last batch even when the caller stops after the first item. `itertools.chain(a, b)` walks several iterables in turn as one, and `chain.from_iterable(batches)` does the same for an iterable of iterables, which is the lazy version of unit 13's double-`for` comprehension. Both hold one item at a time and read each batch only when they reach it.

~~~starter
def all_items(batches):
    """Yield every item across the batches, reading each batch only when reached."""
    combined = []
    for batch in batches:
        combined = combined + list(batch)
    return iter(combined)
~~~

~~~tests
read = []


def counted(name, values):
    read.append(name)
    yield from values


batches = [counted("a", [1, 2]), counted("b", [3, 4])]
first = next(all_items(batches))
assert first == 1
assert read == ["a"], f"read {read}: the later batches should not have been touched yet"
assert list(all_items([[1], [2, 3]])) == [1, 2, 3]
~~~

~~~solution
from itertools import chain


def all_items(batches):
    """Yield every item across the batches, reading each batch only when reached."""
    return chain.from_iterable(batches)
~~~
