---
slug: 02-mutability
---

## Which of these can be changed in place?
- ( ) `tuple`
- ( ) `frozenset`
- (x) `bytearray`
- ( ) `bytes`
> `bytearray` is the mutable counterpart of `bytes`, in the same way `list` is to `tuple`.

## `grid = [[0] * 3] * 3`. How many list objects exist?
- ( ) Four: one outer and three rows
- (x) Two: one outer and one row referenced three times
- ( ) Nine
- ( ) Three
> `[x] * n` repeats a reference. The outer list holds the same row three times, so writing to one row writes to all of them.

## Which of these produces genuinely independent rows?
- ( ) `[[0] * 3] * 3`
- (x) `[[0] * 3 for _ in range(3)]`
- ( ) `list([[0] * 3] * 3)`
- ( ) `[[0] * 3].copy() * 3`
> A comprehension evaluates its expression once per iteration, so each pass builds a new list.

## `dict.fromkeys(["a", "b"], [])` gives you
- ( ) Two keys with separate empty lists
- (x) Two keys pointing at one shared list
- ( ) A TypeError, because the default is mutable
- ( ) Two keys mapped to `None`
> `fromkeys` is handed one already-built value and stores that same object against every key. It is `[x] * n` in dictionary form.

## `a = [1]; b = a; a += [2]`. What is `b`?
- ( ) `[1]`
- (x) `[1, 2]`
- ( ) `[2]`
- ( ) `[1, [2]]`
> Lists implement `__iadd__`, so `+=` extends in place. Every name bound to that list sees the change.

## `a = (1,); b = a; a += (2,)`. What is `b`?
- (x) `(1,)`
- ( ) `(1, 2)`
- ( ) `(2,)`
- ( ) It raises
> Tuples have no `__iadd__`, so `+=` falls back to building a new tuple and rebinding. `b` never moved.

## `dict(config)` where the values are lists gives you
- ( ) A fully independent copy
- (x) A new dictionary holding the same list objects
- ( ) The same dictionary object
- ( ) A copy only of the keys
> Every constructor-style copy in the standard library is shallow. The mapping is new; the values are shared.

## `row = ([1], "b")`. Which line works?
- ( ) `row[0] = []`
- (x) `row[0].append(2)`
- ( ) `row.append(3)`
- ( ) `del row[0]`
> The tuple guarantees which object each slot refers to. It makes no promise about that object's contents.

## Why can `("a", "b")` be a dict key but `("a", [])` cannot?
- ( ) Tuples of length two are special-cased
- (x) Hashability follows the contents, and a list is not hashable
- ( ) The second one is longer in memory
- ( ) It can, but only in Python 3.12 and later
> A tuple's hash is computed from its elements, so it is hashable only if all of them are.

## Deleting keys from a dict while looping over it
- ( ) Silently skips entries
- (x) Raises RuntimeError
- ( ) Works correctly
- ( ) Raises KeyError
> Dictionaries keep a version counter and their iterator checks it. A list in the same situation skips entries silently, which is worse.

## `for x in items: items.remove(x)` on a list
- ( ) Raises RuntimeError
- (x) Skips elements, because the index advances while the list shrinks
- ( ) Empties the list correctly
- ( ) Loops forever
> The loop walks an index forward through a sequence getting shorter underneath it. Sometimes the answer is right by luck, which is worse than always wrong.

## `list.sort()` returns
- ( ) The sorted list
- (x) `None`
- ( ) A new sorted list, leaving the original alone
- ( ) The number of elements moved
> Throughout the standard library an in-place operation returns `None`, so chaining off it fails immediately rather than giving a silent wrong answer.

## When is a function's default argument expression evaluated?
- ( ) On every call that omits the argument
- (x) Once, when the `def` statement runs
- ( ) On the first call only
- ( ) When the module is first garbage-collected
> The result is stored on the function object, visible as `f.__defaults__`, and shared by every call for the life of the process.

## Why `if into is None:` rather than `if not into:` for a sentinel default?
- ( ) `is None` is faster
- (x) An empty list the caller deliberately passed is falsy and would be discarded
- ( ) `not` cannot be used on lists
- ( ) They are identical
> The sentinel test must distinguish "no argument given" from "an argument that happens to be empty".

## A function both mutates its argument and returns it. What is wrong with that?
- ( ) Nothing; it is the most convenient form
- (x) It invites the caller to treat the result as a new object when it is the same one
- ( ) It is slower than returning `None`
- ( ) It prevents the function from being annotated
> Pick one: mutate and return `None`, or leave the input alone and return something new.
