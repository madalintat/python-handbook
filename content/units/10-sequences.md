---
slug: 10-sequences
title: Sequences and slicing
---

A **sequence** is an ordered collection you can index by position, ask the length of, and iterate. `list`, `tuple`, `str`, `bytes`, `range` and `bytearray` are all sequences, and they share an interface: `len`, `x[i]`, `x[i:j]`, `in`, `+`, `*`, `.index`, `.count`, and iteration.

Learning the shared part once is worth more than learning any of the types individually, because a slice behaves the same way on a string as on a list, and the two mistakes people make are the same in both.

## What every sequence agrees on

The shared interface is worth listing once, because a function written against it works on all of them.

`len(x)` gives the count. `x[i]` reads by position. `x[i:j]` takes a run. `item in x` searches, scanning from the front and returning as soon as it matches. `x + y` concatenates two of the same type, and `x * n` repeats. `x.index(item)` gives the first position or raises `ValueError`, and `x.count(item)` tallies. Iteration and unpacking work, as do `min`, `max`, `sorted` and `reversed`.

Mutable sequences add the operations that change things: `append`, `extend`, `insert`, `remove`, `pop`, `clear`, `sort`, `reverse`, and assignment to an index or a slice. Immutable ones do not have any of these, which is exactly what makes them safe to share.

`in` deserves a note about cost. On a list or a tuple it is a linear scan, so a membership test inside a loop over the same list is quadratic and one of the commonest reasons Python code is unexpectedly slow. On a set or a dict it is a hash lookup and effectively constant, which is unit 12's argument for reaching for a set the moment you find yourself asking "is this one of them?" repeatedly.

## `range` is a sequence, not a list

`range` implements the whole interface without storing anything:

```python
r = range(0, 1_000_000, 3)
len(r)        # 333334
r[100]        # 300
r[10:20]      # range(30, 60, 3)
999 in r      # True, computed rather than searched
```

Every one of those is arithmetic. Slicing a range gives another range, indexing computes a value, and membership solves a small equation rather than scanning, so `999_999_999 in range(1_000_000_000)` is instant while the same test on a list of that length would not fit in memory to begin with.

The consequence worth carrying: `list(range(n))` is only needed when you genuinely want the list. Iterating, indexing, slicing and testing membership all work directly, and wrapping a range in `list` to do any of those is a habit worth dropping.

## Indexing, forwards and backwards

Indices start at zero, so the valid ones are `0` to `len(x) - 1`, and `x[len(x)]` is the `IndexError` everybody meets.

Negative indices count from the end, with `-1` being the last element:

```python
letters = ["a", "b", "c", "d"]
letters[0]     # 'a'
letters[-1]    # 'd'
letters[-2]    # 'c'
```

This is not a special case bolted on. `x[-1]` is `x[len(x) - 1]`, computed for you, which is why it fails with `IndexError` on an empty sequence exactly as `x[0]` does. Reaching for the last element of something possibly empty needs the same care either way.

## A slice is an object

`x[1:4]` looks like syntax and is a method call: Python builds a `slice` object and passes it to `__getitem__`. You can build one yourself, and store it:

```python
first_three = slice(0, 3)
letters[first_three]     # ['a', 'b', 'c']
```

The full form is `start:stop:step`, and each part may be omitted. `start` defaults to the beginning, `stop` to the end, `step` to one.

**The stop is exclusive.** `x[1:4]` gives you elements 1, 2 and 3. This is the same convention as `range`, and two useful properties fall out of it: the length of a slice is `stop - start`, and `x[:n] + x[n:]` reconstructs the original for any `n`, with no off-by-one to think about.

## Slices never raise

The single most useful difference between indexing and slicing:

```python
letters[10]      # IndexError
letters[10:20]   # [] — no error at all
letters[1:100]   # ['b', 'c', 'd'] — clamped
```

A slice clamps its bounds to what exists. That makes `x[:3]` safe on a list of one element, and it makes an empty result the normal way a slice says "there was nothing there". It also means a slice will never tell you your index was wrong, so a bug in the arithmetic produces a quietly short answer rather than a complaint.

## Steps, and the reversal idiom

The third part takes every nth element, and a negative step walks backwards:

```python
letters[::2]      # ['a', 'c']
letters[::-1]     # ['d', 'c', 'b', 'a']
```

`x[::-1]` is the idiomatic reversal, and it works on strings too, where it is the standard way to reverse one. Note that it copies; `list.reverse()` reverses in place and returns `None`, and `reversed(x)` gives you an iterator without copying at all.

Negative steps make the defaults change ends: with `step` negative, `start` defaults to the end and `stop` to before the beginning. Which is why `x[3:0:-1]` gives you three elements and not four, the stop being exclusive in that direction too, and why writing an explicit backwards slice is worth checking rather than trusting.

## Slice assignment

On a mutable sequence, a slice is also a target, and it can change the length:

```python
nums = [0, 1, 2, 3, 4]
nums[1:3] = ["x"]           # [0, 'x', 3, 4]
nums[1:1] = ["a", "b"]      # insert without removing
del nums[1:3]               # delete a range
```

The replacement does not have to be the same length, which makes slice assignment the general way to splice a list. An extended slice, one with a step, is stricter: `nums[::2] = [...]` requires exactly as many values as the slice selects, because there is no sensible way to stretch a stepped selection.

And the idiom worth recognising:

```python
items[:] = other
```

This replaces the **contents** of `items` while keeping the same object, so every other name bound to that list sees the new contents. Compare with `items = other`, which rebinds one name and leaves everybody else looking at the old list. Unit 02's distinction, in slicing form.

## Unpacking is the other way to take a sequence apart

Unit 05 met the syntax; here is where it earns its place, because it often replaces slicing entirely.

```python
first, *rest = row
*most, last = row
name, _, score = row
```

Each of these says what it wants structurally, and each fails loudly with `ValueError` if the shape is wrong. The slicing equivalents, `row[0]` with `row[1:]`, do not: given a shorter row than expected they hand back something plausible and wrong.

That is the general trade. Slicing is forgiving, which is what you want when the length genuinely varies and a short result is a reasonable answer. Unpacking is strict, which is what you want when the shape is part of the contract and a surprise means the data is wrong. Choosing the forgiving tool for a strict job is how a malformed row becomes a wrong number three functions later instead of an exception at the boundary.

For the common case of taking a fixed number of items off the front of something that might be shorter, `itertools.islice` is the honest tool, and unit 17 covers it.

## Copying, one level

`x[:]` is a shallow copy, which unit 02 covered: the outer sequence is new, everything inside is shared. For a list of numbers or strings that is a complete copy in practice, because the contents cannot be changed. For a list of lists it is not.

For tuples and strings, `x[:]` returns the original object rather than a copy, because copying an immutable value would be pointless. `t[:] is t` is `True` for a tuple, and `False` for a list, which is occasionally a surprise and never a problem.

## Concatenation costs

`a + b` builds a new sequence with every element of both, so building a list by repeated concatenation in a loop is quadratic:

```python
out = []
for item in source:
    out = out + [item]      # copies the whole list every time
```

`out.append(item)` is amortised constant, and a comprehension is better still. The same trap is worse for strings, because they are immutable and every `+=` in a loop builds a whole new string; `"".join(parts)` is the fix, and unit 11 makes the case properly.

`x * n` repeats, and repeats **references**, which is the multiplication trap from unit 02: `[[0]] * 3` is three names for one list.

## Reading a slice you did not write

Slices are dense, and a line like `data[1:-1:2]` is genuinely hard to read cold. Three habits make them tractable.

Read the parts in order and say them aloud: start here, stop before there, take every nth. `data[1:-1]` is "everything except the first and last", which is a common idiom for trimming a header and a footer, or the quotes off a string.

When a bound is computed, name it. `body = lines[header_end:footer_start]` says what the two numbers mean, and survives someone changing the header format. A bare `lines[3:-2]` does not.

And when you find yourself writing three slices of the same sequence to answer one question, the answer is usually a different shape: a loop, a comprehension, or a small function with a name. Slicing is for taking a run out of a sequence, and it stops paying the moment the logic is really about what the elements are rather than where they sit.

## Two errors worth recognising on sight

`IndexError: list index out of range` means a position that does not exist. The position is nearly always computed, so the useful question is not "which index" but "what made it that". An off-by-one from `range(len(x) + 1)`, an index kept from before the list shrank, or an empty list where `x[0]` assumed at least one element.

`TypeError: list indices must be integers or slices, not str` means you indexed a sequence with a key. Usually the value is a dict somewhere else in the flow and a list here, or the reverse, and the real bug is a function returning two different shapes on two different paths.

Neither has anything to do with slicing, which raises almost nothing. That asymmetry is the practical summary of this unit: the operation that can tell you something is wrong is indexing, and the one that quietly gives you less than you asked for is slicing.

## What to carry forward

Sequences share one interface, so learning slicing once covers strings, lists and tuples together. Indices raise and slices clamp, which makes a slice safe and a wrong slice silent. `start:stop:step` with an exclusive stop, so `x[:n] + x[n:]` is always the original. `x[::-1]` reverses by copying. Slice assignment can change a list's length, and `x[:] = y` replaces contents in place where `x = y` rebinds a name. And repeated concatenation is quadratic; append or join instead.
