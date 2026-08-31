---
slug: 02-mutability
title: Mutability and aliasing
---

Unit 01 established that a name refers to an object and that binding never copies. This unit is about the consequence, which is where the bugs actually are: when two names share an object, changing it through one of them changes it for both, and Python offers you at least four different operations that look like copying and are not.

## Which types can change at all

Split every type you meet into two piles.

**Mutable**: `list`, `dict`, `set`, `bytearray`, and almost every class you write. These have methods that change the object in place, and after such a call the object has a new value and the same identity.

**Immutable**: `int`, `float`, `str`, `bytes`, `tuple`, `frozenset`, `bool`, `None`. These have no operation anywhere in the language that changes an existing instance. Every method that looks like it edits one returns a new object instead.

```python
s = "hello"
print(id(s))
s = s.upper()
print(id(s))      # a different object
```

That is not `s` being modified; it is `s` being rebound to a new string. Which is why calling `s.upper()` on its own line accomplishes nothing at all, and why that is such a common first bug.

Immutability is what makes a value safe to share. A string can be handed to twenty functions with no coordination, because none of them can change it. That guarantee is also why only immutable-ish objects can be dict keys. Unit 04 makes that precise.

## The list that changed under you

```python
def totals(rows):
    rows.append(["total", sum(r[1] for r in rows)])
    return rows

data = [["a", 1], ["b", 2]]
report = totals(data)
```

`report` and `data` are the same list. The function did not build a report; it edited the caller's data and handed it back, and every later use of `data` now has a total row in it that nobody asked for.

This is the single most common shape of bug in Python code that handles collections, and it has one reliable tell: **a function that both mutates its argument and returns it**. Pick one. Either mutate and return `None`, the way `list.sort()` does, or leave the input alone and return something new, the way `sorted()` does. The standard library is careful about this distinction and it is worth copying.

## Four things that look like copies

```python
b = a           # not a copy at all: a second name
b = a[:]        # shallow copy
b = list(a)     # shallow copy
b = copy.deepcopy(a)   # a real copy, all the way down
```

Only the last one is independent. A **shallow copy** builds a new outer container and fills it with the same references the original held, so the top level is independent and everything inside is still shared.

```python
grid = [[0, 0], [0, 0]]
copy_of = grid[:]
copy_of[0][0] = 9
print(grid)         # [[9, 0], [0, 0]]
```

The outer list really was copied, appending to `copy_of` leaves `grid` alone. It is the rows that are shared, because copying a list copies its references and a reference to a row is not a row.

`copy.deepcopy` walks the whole structure and rebuilds every mutable object it finds, handling cycles correctly. It is the right answer when you genuinely need independence and the wrong default: it is slow, it copies things you may have wanted shared, and on objects holding file handles or connections it either fails or produces something broken. Reach for it deliberately.

## The multiplication trap

```python
grid = [[0] * 3] * 3
grid[0][0] = 9
print(grid)         # [[9, 0, 0], [9, 0, 0], [9, 0, 0]]
```

`[x] * 3` builds a list of three references to the same `x`. For the inner `[0] * 3` that is harmless, because integers are immutable and you can never change one. For the outer multiplication it is a disaster: three references to one row.

The fix is a comprehension, which evaluates its expression once per iteration and therefore builds three separate lists:

```python
grid = [[0] * 3 for _ in range(3)]
```

`dict.fromkeys(keys, [])` has exactly the same shape and exactly the same problem: one list, shared by every key.

## `+=` is two different operators

```python
a = [1, 2]
b = a
a += [3]
print(b)        # [1, 2, 3]
```

```python
a = (1, 2)
b = a
a += (3,)
print(b)        # (1, 2)
```

Same syntax, opposite outcomes. `+=` first asks the object whether it can extend itself in place, by looking for `__iadd__`. Lists have one, so `a += [3]` mutates the list and every name bound to it sees the change. Tuples do not, so Python falls back to `a = a + (3,)`, which builds a new tuple and rebinds, leaving `b` where it was.

So `+=` is a mutation for mutable types and a rebinding for immutable ones. In a function that means `items += [x]` changes the caller's list, while `total += 1` cannot possibly change the caller's number. Nothing about the syntax tells you which you are doing; the type does.

## Immutable does not mean deeply immutable

A tuple cannot be changed. That is a promise about the tuple, and about nothing else.

```python
row = ([1, 2], "b")
row[0] = []            # TypeError: 'tuple' object does not support item assignment
row[0].append(3)       # fine. row is now ([1, 2, 3], "b")
```

The tuple guarantees that slot zero will always refer to that same list object. It makes no promise whatever about what is inside the list. So "I made it a tuple so it cannot change" is only true when everything inside is itself immutable, and that is the same distinction as shallow versus deep, arriving under a different name.

This is exactly why a tuple containing a list cannot be used as a dictionary key while a tuple of strings can. The hashability rule follows the deep structure, not the outer type.

## The default argument, properly

Unit 01 met this as a puzzle. Here is the mechanism.

A `def` statement is an instruction that runs when it is reached, and part of running it is evaluating each default expression, once, and storing the results on the function object. You can look at them:

```python
def collect(item, into=[]):
    into.append(item)
    return into

print(collect.__defaults__)     # ([],)
collect(1)
print(collect.__defaults__)     # ([1],)
```

That list is an attribute of the function, created once when the module was imported, and it lives for as long as the process does. Every caller who omits the argument gets the same one. The bug is not that the default is mutable. It is that the default is *shared*, and mutability is what makes the sharing observable.

The idiom is `None` as a sentinel, with the real default built inside the body where it runs per call:

```python
def collect(item, into=None):
    if into is None:
        into = []
    into.append(item)
    return into
```

Use `is None` rather than `if not into:`, because an empty list the caller deliberately passed is falsy and would be quietly replaced by a fresh one.

Immutable defaults are safe for the same reason, `def f(x=0)` shares that zero with every call and no caller can do anything about it, which is why the rule people repeat is specifically about mutable defaults.

## Mutating what you are iterating over

```python
items = [1, 2, 3, 4]
for item in items:
    if item % 2 == 0:
        items.remove(item)
print(items)      # [1, 3] is what you wanted; you get [1, 3] here but not always
```

Iterating a list walks an index forward while you shorten the list underneath it, so every removal makes the loop skip the next element. Sometimes the answer comes out right by luck, which is worse than it always being wrong.

Dictionaries and sets refuse outright rather than silently misbehaving:

```python
for key in scores:
    if scores[key] < 0:
        del scores[key]     # RuntimeError: dictionary changed size during iteration
```

Two fixes. Build a new collection, `[x for x in items if x % 2]`, which is usually clearer anyway. Or iterate over a snapshot: `for key in list(scores):` makes a separate list of keys first, so the loop is not walking the thing you are editing.

## Mutable state that outlives the call

The default argument is one instance of a larger pattern: a mutable object created once, at a point you did not think of as "once", and then shared by everything that touches it afterwards.

The same shape appears as a class attribute, which unit 01 met in the last exercise and which is worth naming here: a class body executes a single time, so `items = []` in a class body creates one list for the class, not one per instance. It appears as a module-level cache that nothing ever evicts. And it appears whenever a function stores something into an object it was handed and the caller keeps using that object.

The question that catches all of them is the same: **how many times does this line run, and how many things can see the result?** If the answer to the first is "once" and to the second is "more than one", you have shared mutable state, and the only remaining question is whether anybody is going to mutate it.

Shared mutable state is not automatically wrong, a cache is exactly that, deliberately. What makes it a bug is sharing you did not intend and cannot see at the call site.

## Copying, decided

A short decision procedure, since this is where the time actually goes:

If the object is immutable, do nothing at all. There is no copy to make, because nobody can change it. Passing a string, a number or a tuple of numbers around freely is safe and costs nothing.

If it is flat and mutable, a list of numbers, a set of strings, a dict of strings to strings. Take a shallow copy with `list(x)`, `dict(x)`, `set(x)` or a slice. One level is all there is.

If it is nested and you need real independence, use `copy.deepcopy`, and know that you are paying for it.

And if you find yourself deep-copying on every call in a hot path, that is usually a sign the design wants changing rather than the copy wanting optimising: pass immutable data, or make the function build and return something new instead of editing what it was given.

## What to carry forward

Mutable types can be changed in place and every name bound to them sees it; immutable types cannot be changed at all. Assignment never copies, slicing and `list()` copy one level, and only `deepcopy` copies all of them. `[x] * n` and `dict.fromkeys(k, [])` repeat a reference rather than the object. `+=` mutates a list and rebinds a tuple. And never edit a collection while you are looping over it.

The practical habit that falls out of all of this: when a function takes a mutable argument, decide up front whether it mutates or returns, say so in its name, and never do both.
