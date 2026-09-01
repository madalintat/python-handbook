---
slug: 10-sequences
---

## The index that was one too far

`last_three` takes the final three elements by walking indices. The range covers one position too many, and this is the error the arithmetic produces rather than the one the docstring promises.

@expect raises:IndexError
@hint `range(a, b)` stops before `b`, and the last valid index is `len(values) - 1`.
@hint There is a slice that does this whole function, and it cannot go out of range at all.
@diagnose IndexError The loop asks for `values[len(values)]`, which is one past the end. This is the commonest off-by-one in Python and it comes from treating `range`'s stop as inclusive when it is not. Note the contrast the whole unit turns on: indexing raises when you are wrong, and a slice would not have. `values[-3:]` says the same thing in one expression, clamps rather than raising on a short list, and has no arithmetic in it to get wrong.

~~~starter
def last_three(values):
    """Return the last three elements, or all of them if there are fewer."""
    out = []
    for i in range(len(values) - 3, len(values) + 1):
        out.append(values[i])
    return out


print(last_three([1, 2, 3, 4, 5]))
~~~

~~~tests
assert last_three([1, 2, 3, 4, 5]) == [3, 4, 5]
assert last_three([1, 2]) == [1, 2], "a short list should give back what there is"
assert last_three([]) == []
~~~

~~~solution
def last_three(values):
    """Return the last three elements, or all of them if there are fewer."""
    return values[-3:]


print(last_three([1, 2, 3, 4, 5]))
~~~

## A slice that says nothing

`page` returns one page of results. The arithmetic is wrong by one page, and because slicing clamps rather than complaining, the function returns a plausible answer for every input the tests try.

@expect silent
@hint Work out which elements `page(rows, 1, 10)` should return, then which ones this returns.
@hint A slice never tells you the bounds were wrong. It just gives you what it found.
@diagnose silent Nothing raised, because a slice clamps its bounds to what exists and reports nothing about the ones that did not. Page one returns rows 10 to 19 instead of 0 to 9, and past the end you get an empty list rather than an error, which reads as "no more results" rather than "your arithmetic is off". This is the cost of the forgiveness that makes slicing safe: indexing tells you when you are wrong, and slicing hands you a quietly short answer. When a slice's bounds are computed, they are worth a test of their own.

~~~starter
def page(rows, number, size):
    """Return one page of rows. Page 1 is the first `size` rows."""
    return rows[number * size:number * size + size]
~~~

~~~tests
rows = list(range(25))
assert page(rows, 1, 10) == list(range(0, 10)), "page 1 should be the first ten rows"
assert page(rows, 2, 10) == list(range(10, 20))
assert page(rows, 3, 10) == list(range(20, 25))
assert page(rows, 4, 10) == []
~~~

~~~solution
def page(rows, number, size):
    """Return one page of rows. Page 1 is the first `size` rows."""
    start = (number - 1) * size
    return rows[start:start + size]
~~~

## Replacing a name is not replacing the contents

`refill` is meant to empty a shared list and put new items in it, so that everything holding that list sees the change. It rebinds instead, which unit 02 named and this exercise gives you the slicing form of.

@expect silent
@expect ruff:F841
@hint Assigning to a bare name rebinds it. Assigning to a slice of it does not.
@hint `items[:] = other` targets the whole sequence and replaces its contents.
@diagnose F841 ruff reports the local `items` as assigned and never used, which is its way of saying the assignment cannot have had an effect outside this function. The same rule caught the rebound parameter in unit 01 and the rebound global in unit 08. Whenever you see it, the question is whether you meant to rebind a name or to change an object.
@diagnose silent It runs, and the caller's list is untouched. `items = list(new)` binds the local name to a new list, so the function's own view changes and nothing else does. `items[:] = new` is a slice assignment: the target is the whole of the existing list, so its contents are replaced while the object stays the same, and every name bound to it sees the result. This is unit 02's rebinding-versus-mutation distinction wearing slice syntax, and it is the standard way to say "same list, different contents".

~~~starter
def refill(items, new):
    """Replace the contents of items with new, in place."""
    items = list(new)
~~~

~~~tests
shared = [1, 2, 3]
alias = shared
refill(shared, ["a", "b"])
assert shared == ["a", "b"], f"the caller's list is still {shared}"
assert alias is shared and alias == ["a", "b"], "every name should see the new contents"
~~~

~~~solution
def refill(items, new):
    """Replace the contents of items with new, in place."""
    items[:] = new
~~~

## Reversing, and what it returns

`backwards` reverses a list. It uses the method that reverses in place, and returns what that method gives back. Unit 02 met the same convention with sorting.

@expect raises:TypeError
@hint What does an in-place method return, by convention, throughout the standard library?
@hint There is a slice that reverses by copying, and a builtin that reverses without copying.
@diagnose TypeError `list.reverse()` reverses in place and returns `None`, so the caller gets `None` and the subscript in the test fails. The standard library returns `None` from every in-place operation precisely so that chaining off one is an immediate error rather than a silent wrong answer, which is the same rule that made `list.sort()` behave this way in unit 02. Three ways to reverse, and they differ in what they cost: `x.reverse()` mutates and returns nothing, `x[::-1]` returns a reversed copy, and `reversed(x)` returns an iterator that copies nothing at all.

~~~starter
def backwards(values):
    """Return a new list with the values in reverse order."""
    return values.reverse()


print(backwards([1, 2, 3])[0])
~~~

~~~tests
original = [1, 2, 3]
assert backwards(original) == [3, 2, 1]
assert original == [1, 2, 3], f"the caller's list was reversed in place: {original}"
~~~

~~~solution
def backwards(values):
    """Return a new list with the values in reverse order."""
    return values[::-1]


print(backwards([1, 2, 3])[0])
~~~

## Trimming both ends

`without_edges` drops the first and last elements. It computes the end bound with a length, and the arithmetic is right for a non-empty list and wrong for a short one, which is exactly where slicing's forgiveness stops helping.

@expect silent
@hint What does `values[1:len(values)]` select? Compare it with `values[1:-1]`.
@hint Try the function on a list of one element and on an empty one.
@diagnose silent It runs and keeps the last element, because `len(values)` as a stop selects everything to the end: the stop is exclusive, so it stops *before* index `len`, which is one past the last element already. The intent is `values[1:-1]`, where `-1` means "before the last one". Note what the clamping then buys you: on a one-element list `values[1:-1]` is empty and on an empty list it is empty too, both without a single bound check. That is the case for writing the slice rather than the arithmetic.

~~~starter
def without_edges(values):
    """Return the values with the first and last removed."""
    return values[1:len(values)]
~~~

~~~tests
assert without_edges([1, 2, 3, 4]) == [2, 3]
assert without_edges(["a", "b"]) == []
assert without_edges(["only"]) == []
assert without_edges([]) == []
~~~

~~~solution
def without_edges(values):
    """Return the values with the first and last removed."""
    return values[1:-1]
~~~

## The operator that took the string apart

`names_of` collects one name per row. It adds each name with `+=`, which on a list is `extend`, and `extend` walks whatever it is handed. A string is something you can walk.

@expect silent
@hint `+=` on a list is `extend`, not `append`. Ask what `extend` does with a string.
@hint Iterate a string and you get characters. That is exactly what `extend` sees.
@diagnose silent Nothing raised, and every name arrived as a pile of single letters. `out += name` on a list calls `extend`, which walks its argument and adds the elements one at a time; iterating a string yields its characters, so a three-letter name becomes three entries. `append` adds its argument as a single element, which is what this wants. The trap is that `extend` is perfectly happy with a string, so there is no error to see, only a list that is longer than it should be and full of letters. Unit 02 showed `+=` on a list mutating in place; this is the other half of the same operator, and it is why `append` and `extend` are two names rather than one.

~~~starter
def names_of(rows):
    """Return a list holding each row's name."""
    out = []
    for row in rows:
        out += row["name"]
    return out
~~~

~~~tests
assert names_of([{"name": "ada"}, {"name": "bob"}]) == ["ada", "bob"], "the names were taken apart into letters"
assert names_of([{"name": "x"}]) == ["x"]
assert names_of([]) == []
~~~

~~~solution
def names_of(rows):
    """Return a list holding each row's name."""
    out = []
    for row in rows:
        out.append(row["name"])
    return out
~~~

## Every other one, backwards

`alternate_reversed` should give every second element, starting from the end. The step and the direction are both in the slice, and the defaults change ends when the step is negative.

@expect silent
@hint With a negative step, `start` defaults to the end and `stop` to before the beginning.
@hint Reversing and then stepping is not the same as stepping and then reversing, unless the length is right.
@diagnose silent Nothing raised, and it takes every second element from the *front* and then reverses, which is a different set of elements whenever the length is even. A negative step walks backwards and flips which end the defaults refer to, so `values[::-2]` starts at the last element and steps back by two. The other spelling, `values[::-1][::2]`, reverses first and then steps, which lands on the same elements only when the reversal happens to align them. When a slice has both a step and a direction, it is worth writing out the first two indices it will visit and checking against the ones you meant.

~~~starter
def alternate_reversed(values):
    """Return every second element, starting from the last."""
    return values[::2][::-1]
~~~

~~~tests
assert alternate_reversed([1, 2, 3, 4, 5]) == [5, 3, 1]
assert alternate_reversed([1, 2, 3, 4]) == [4, 2], "with an even length the two spellings differ"
assert alternate_reversed([]) == []
~~~

~~~solution
def alternate_reversed(values):
    """Return every second element, starting from the last."""
    return values[::-2]
~~~

## A tuple's slice is not a copy

`snapshot` takes a defensive copy of a row so that later changes cannot affect it. For a list `x[:]` is a copy; for a tuple it is not, and the tests pass a tuple holding a list.

@expect silent
@hint What does `t[:]` return for a tuple? Check whether it is the same object.
@hint The tuple was never the mutable part. Look at what is inside it.
@diagnose silent It runs, and a later change to the row is visible in the snapshot. Two things combine here. `t[:]` on a tuple returns the original object rather than a copy, because copying an immutable value would achieve nothing, so `t[:] is t` is `True`. And even a real copy would not have helped: a tuple guarantees which objects its slots refer to and says nothing about those objects, so the list inside is shared either way. This is unit 02's shallow-copy lesson in its most misleading form, because the word "tuple" suggests a safety the tuple never offered. `copy.deepcopy` is the tool when independence is what you need.

~~~starter
def snapshot(row):
    """Return a copy of the row that later changes cannot affect."""
    return row[:]
~~~

~~~tests
cells = ["a", "b"]
row = (cells, 1)
saved = snapshot(row)
cells.append("c")
assert saved == (["a", "b"], 1), f"the snapshot changed too: {saved}"
~~~

~~~solution
import copy


def snapshot(row):
    """Return a copy of the row that later changes cannot affect."""
    return copy.deepcopy(row)
~~~
