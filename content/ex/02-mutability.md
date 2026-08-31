---
slug: 02-mutability
---

## One row, three times

`blank_grid` builds a grid of zeroes. Set a single cell and print the whole thing. Count how many list objects the expression actually created, which is not the number of rows you asked for.

@expect silent
@hint `[x] * 3` does not evaluate `x` three times. It evaluates it once and repeats the reference.
@hint A comprehension evaluates its expression on every iteration. That is the difference you need.
@diagnose silent Nothing raised. `[[0] * width] * height` built one row and then made a list holding that same row `height` times, so every row in the grid is the same object and writing to one writes to all of them. The inner `[0] * width` is fine, because integers are immutable and cannot be changed through any of the references. Use a comprehension, which runs its expression once per iteration and so produces genuinely separate rows.

~~~starter
def blank_grid(width, height):
    """Return a height x width grid of zeroes, with independent rows."""
    return [[0] * width] * height
~~~

~~~tests
grid = blank_grid(3, 3)
assert grid == [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
grid[0][0] = 9
assert grid[1][0] == 0, f"writing to row 0 changed row 1: {grid}"
assert grid[0] is not grid[1], "two rows are the same object"
~~~

~~~solution
def blank_grid(width, height):
    """Return a height x width grid of zeroes, with independent rows."""
    return [[0] * width for _ in range(height)]
~~~

## The augmented assignment that mutated

`with_extra` is meant to leave the caller's list alone and return a longer one. It uses `+=`, which for a list is not the operation the syntax suggests. Run it and check what happened to the list that was passed in.

@expect silent
@hint `+=` asks the object whether it can extend itself in place. A list says yes.
@hint For a tuple the same line would be harmless. Ask why the type changes the meaning.
@diagnose silent It ran and returned the right value, and it damaged the caller on the way. `items += extra` calls the list's `__iadd__`, which extends the existing list in place and returns it, so this is `items.extend(extra)` wearing different clothes, and every name bound to that list sees the new elements. A tuple has no `__iadd__`, so the identical line there would fall back to `items = items + extra`, build a new object and rebind. Same syntax, opposite effect, decided entirely by the type.

~~~starter
def with_extra(items, extra):
    """Return a new list of items followed by extra, leaving items untouched."""
    items += extra
    return items
~~~

~~~tests
original = [1, 2]
out = with_extra(original, [3, 4])
assert out == [1, 2, 3, 4], f"wrong result: {out}"
assert original == [1, 2], f"the caller's list was extended: {original}"
~~~

~~~solution
def with_extra(items, extra):
    """Return a new list of items followed by extra, leaving items untouched."""
    return items + list(extra)
~~~

## One list for every key

`empty_buckets` builds a dictionary mapping each key to its own empty list. Append to one bucket and then look at the others. `dict.fromkeys` takes its default the same way `[x] * n` takes its element.

@expect silent
@hint `dict.fromkeys(keys, [])` evaluates that `[]` once, before the dictionary exists.
@hint Build the dictionary with a loop, so the `[]` is written out once per key.
@diagnose silent Runs clean, and every key in the dictionary is pointing at one list. `dict.fromkeys(keys, value)` is handed a single already-constructed value and stores that same object against every key. It has no way to make copies, and would not know how deep to copy if it tried. This is `[x] * n` in dictionary form, and the fix is the same shape: write the `[]` somewhere that runs once per key, which for now means a loop. Unit 12 shows the one-line version.

~~~starter
def empty_buckets(keys):
    """Return a dict giving each key its own empty list."""
    return dict.fromkeys(keys, [])
~~~

~~~tests
buckets = empty_buckets(["a", "b"])
assert buckets == {"a": [], "b": []}
buckets["a"].append(1)
assert buckets["b"] == [], f"appending to a leaked into b: {buckets}"
~~~

~~~solution
def empty_buckets(keys):
    """Return a dict giving each key its own empty list."""
    buckets = {}
    for key in keys:
        buckets[key] = []
    return buckets
~~~

## Copying one level down

`snapshot` is supposed to record a dictionary of lists so that later changes to the original cannot affect the record. `dict(config)` really does build a new dictionary. The tests change a list inside the original.

@expect silent
@hint `dict(x)` copies the mapping. What does it put in the new mapping's values?
@hint The values are references. Copying a reference does not copy what it refers to.
@diagnose silent No error, because `dict(config)` genuinely copied. It made a new dictionary object, and adding a key to it would not touch the original. What it copied were the references stored against each key, so both dictionaries point at the same lists. That is a shallow copy, and it is what every slice, `list()`, `dict()`, `set()` and `copy.copy` gives you. For independence all the way down, `copy.deepcopy` rebuilds every mutable object it finds.

~~~starter
def snapshot(config):
    """Return a record of config that later edits to config cannot affect."""
    return dict(config)
~~~

~~~tests
config = {"hosts": ["a"], "aliases": ["x"]}
saved = snapshot(config)
config["hosts"].append("b")
config["extra"] = ["new"]
assert saved == {"hosts": ["a"], "aliases": ["x"]}, f"the snapshot changed too: {saved}"
~~~

~~~solution
import copy


def snapshot(config):
    """Return a record of config that later edits to config cannot affect."""
    return copy.deepcopy(config)
~~~

## A tuple promises less than you think

`relabel` takes a row that is a tuple and replaces its first field. Two judges object, and one of them does so without running anything. Note precisely what the tuple was guaranteeing and what it was not.

@expect raises:TypeError
@expect mypy:index
@hint A tuple guarantees which objects its slots refer to. It does not guarantee anything about those objects.
@hint You cannot change a tuple. You can build a different one.
@diagnose TypeError Tuples implement no `__setitem__`, so assigning to a slot fails at runtime. The tuple's promise is that slot zero will always refer to that same object, not that the object is itself unchangeable. Which is why `row[0].append(x)` on a tuple containing a list works perfectly well.
@diagnose index mypy reports this before anything runs, because the annotation says the parameter is a tuple and mypy knows tuples do not support indexed assignment. Same defect, found statically, on a line that never had to execute.

~~~starter
def relabel(row: tuple[str, int], name: str) -> tuple[str, int]:
    """Return the row with its first field replaced by name."""
    row[0] = name
    return row


print(relabel(("a", 1), "b"))
~~~

~~~tests
row = ("a", 1)
out = relabel(row, "b")
assert out == ("b", 1), f"wrong result: {out}"
assert row == ("a", 1), f"the original row changed: {row}"
~~~

~~~solution
def relabel(row: tuple[str, int], name: str) -> tuple[str, int]:
    """Return the row with its first field replaced by name."""
    return (name, *row[1:])


print(relabel(("a", 1), "b"))
~~~

## Editing the thing you are looping over

`drop_negatives` removes every negative score from a dictionary. A list would let you do this and quietly give a wrong answer; a dictionary refuses. Read which exception it chooses and decide which behaviour you would rather have.

@expect raises:RuntimeError
@hint The loop is walking the dictionary while the body changes how many keys it has.
@hint `list(scores)` builds a separate list of keys. Iterate that instead.
@diagnose RuntimeError A dictionary keeps a version counter and its iterator checks it on every step, so changing the size mid-loop raises `RuntimeError: dictionary changed size during iteration` rather than skipping entries. That is a deliberate kindness: a list in the same situation walks an index forward through a shrinking sequence and silently skips elements, which is far harder to notice. Iterate over a snapshot, `for key in list(scores)`, or build a new dictionary with a comprehension.

~~~starter
def drop_negatives(scores):
    """Remove every negative score, in place."""
    for name in scores:
        if scores[name] < 0:
            del scores[name]
    return scores


print(drop_negatives({"a": 1, "b": -1, "c": 2}))
~~~

~~~tests
scores = {"a": 1, "b": -1, "c": 2, "d": -5}
out = drop_negatives(scores)
assert out == {"a": 1, "c": 2}, f"wrong result: {out}"
assert scores == {"a": 1, "c": 2}, "it was supposed to be in place"
~~~

~~~solution
def drop_negatives(scores):
    """Remove every negative score, in place."""
    for name in list(scores):
        if scores[name] < 0:
            del scores[name]
    return scores


print(drop_negatives({"a": 1, "b": -1, "c": 2}))
~~~

## Sorting in place returns nothing

`top_three` sorts and then slices. The standard library is careful to distinguish methods that mutate from functions that return, and this line assumes it is not. Both static judges have something to say.

@expect raises:TypeError
@expect mypy:index
@hint `list.sort()` sorts in place. What is the natural thing for an in-place method to return?
@hint There is a builtin that sorts and gives you a new list.
@diagnose TypeError `list.sort()` returns `None`, so the slice is being applied to `None` and fails. This is a convention rather than an accident: throughout the standard library, an operation that changes an object in place returns `None`, precisely so that chaining off it is an immediate error instead of a silent wrong answer. `sorted()` is the version that returns a new list.
@diagnose index mypy knows the declared return type of `list.sort` is `None` and that `None` cannot be subscripted, so it reports the same defect at check time.

~~~starter
def top_three(scores: list[int]) -> list[int]:
    """Return the three highest scores, highest first."""
    return scores.sort(reverse=True)[:3]


print(top_three([3, 9, 1, 7]))
~~~

~~~tests
scores = [3, 9, 1, 7, 5]
assert top_three(scores) == [9, 7, 5]
assert scores == [3, 9, 1, 7, 5], f"the caller's list was reordered: {scores}"
~~~

~~~solution
def top_three(scores: list[int]) -> list[int]:
    """Return the three highest scores, highest first."""
    return sorted(scores, reverse=True)[:3]


print(top_three([3, 9, 1, 7]))
~~~

## Both mutating and returning

`add_line` appends a line and returns the report, which reads perfectly well at the call site and is the exact shape this unit warns about. The tests use it the way its signature invites you to.

@expect silent
@hint A function that mutates its argument *and* returns it invites the caller to treat the result as a new object.
@hint Decide which one this function is doing, and make the other impossible.
@diagnose silent It runs, and both names now refer to one list, so the "copy" the caller thought they had grows every time the original does. The standard library never does this: `list.sort()` mutates and returns `None`, `sorted()` leaves the input alone and returns something new. Pick one. Here the docstring promises a new report, so build one, and if you had wanted the mutating version, returning `None` would have made the mistake impossible to write.

~~~starter
def add_line(report, line):
    """Return a new report with line added, leaving the original alone."""
    report.append(line)
    return report
~~~

~~~tests
original = ["header"]
extended = add_line(original, "body")
assert extended == ["header", "body"]
assert original == ["header"], f"the original report was modified: {original}"
assert extended is not original, "the same list came back"
~~~

~~~solution
def add_line(report, line):
    """Return a new report with line added, leaving the original alone."""
    return [*report, line]
~~~
