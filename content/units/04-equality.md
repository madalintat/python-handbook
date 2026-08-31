---
slug: 04-equality
title: Equality, hashing, truthiness
---

Three questions that look like one. "Are these the same?" splits into identity and equality; "can I put this in a set?" turns out to depend on the answer; and "is this thing there?" has a default that catches everybody at least once.

## Identity and equality are different questions

`a is b` asks whether two expressions refer to one object. It is a pointer comparison, it cannot be overridden, and it is always fast and always exact.

`a == b` asks whether two objects have the same value, and the objects decide what that means. `int` says the numbers match. `str` compares characters. `list` compares element by element. Your class says whatever you write in `__eq__`.

Two different lists holding the same numbers are `==` and are not `is`. Two names for one list are both. Unit 01 covered the small-integer cache that makes `is` accidentally agree with `==` for small numbers and stop agreeing above 256, and the rule that follows:

**Use `is` for `None`, `True` and `False`, and for genuine "same object?" questions. Use `==` for everything else.**

`None` is a singleton — there is exactly one, forever — so `x is None` is both correct and unmistakable. `x == None` usually gives the same answer, but it is a request the other object gets to answer, and a class with a permissive `__eq__` will happily say yes. ruff flags it as `E711` for that reason.

## The `__eq__` contract

Write `__eq__` and you are making promises the rest of the language relies on.

It should be **reflexive** (`x == x`), **symmetric** (if `x == y` then `y == x`), and **transitive**. It should return `NotImplemented` rather than `False` for types it does not understand, so that Python can try the other operand's `__eq__` before deciding. And it should not raise: comparing two unrelated objects is a legitimate question with the answer "no".

The commonest mistake is comparing only some of the fields, so that two objects your program considers different compare equal, and the second one silently replaces the first the moment either goes into a set.

Python gives you `!=` for free: unless you define `__ne__`, it is the negation of `__eq__`. The ordering operators are not free — `<`, `<=`, `>`, `>=` come from `__lt__` and friends, and a class with `__eq__` but no `__lt__` cannot be sorted.

## Hashing shares that contract

A hash is an integer summarising a value, used by `set` and `dict` to pick a bucket. Lookup hashes the key, goes to that bucket, and compares for equality with what it finds. From which one rule follows, and everything else is a consequence:

**If `a == b` then `hash(a)` must equal `hash(b)`.**

The reverse need not hold. Two unequal objects may share a hash — that is a collision, and the table handles it by comparing within the bucket. But two equal objects with different hashes land in different buckets and the table can never match them up. You get a set containing two things you consider identical, and a dictionary that cannot find a key you are certain you stored.

Python protects you from half of this: defining `__eq__` sets `__hash__` to `None`, so instances are unhashable until you write a hash yourself. Write it over exactly the fields equality uses:

```python
class Point:
    def __init__(self, x, y):
        self.x, self.y = x, y

    def __eq__(self, other):
        if not isinstance(other, Point):
            return NotImplemented
        return (self.x, self.y) == (other.x, other.y)

    def __hash__(self):
        return hash((self.x, self.y))
```

Hashing a tuple of the fields is the idiom. It is correct, it is fast, and it stays in step with `__eq__` as long as both mention the same fields.

## What can be a key

A key must be **hashable**, which means it has a `__hash__` that never changes for the life of the object and an `__eq__` consistent with it.

Immutable built-ins qualify: numbers, strings, bytes, tuples, frozensets, `None`. Lists, dicts and sets do not, and a tuple containing a list does not either — a tuple's hash is computed from its elements, so it inherits their hashability.

Objects you define are hashable by default, using identity, which is exactly right for objects whose equality is identity and exactly wrong the moment you add `__eq__` without `__hash__`.

The genuinely dangerous case is an object that is hashable and mutable. Put it in a dict, change a field the hash depends on, and the entry is still in the old bucket while lookups now go to the new one. The key is not lost from memory — you can still find it by iterating — but it is unreachable by lookup, which is a bug that looks like the dictionary lying to you. Keys should be immutable in the fields their hash uses, and `frozen=True` on a dataclass is the tidy way to guarantee it.

## What a hash is actually for

It is worth knowing why any of this machinery exists, because the contract stops looking arbitrary once you do.

Finding an item in a list of a million elements means comparing against up to a million of them. A hash table does it in roughly one comparison: it turns the key into an integer, uses that integer to pick a slot in an array, and looks only there. The speed comes entirely from the arithmetic deciding where to look, which is why hashing has to be cheap, and why it has to be stable.

Stable means two things. Within one run, an object's hash must never change while it is in a table, because the table will not be told to move it. Across runs it need not be stable at all, and for strings it deliberately is not: Python randomises string hashing per process by default, so that an attacker cannot craft input that collides into one bucket and turns your dictionary into a linked list. That is why `hash("abc")` gives a different number each time you start Python, and why writing a hash to a file as an identifier is a mistake.

Collisions are normal and cheap — the table keeps looking in nearby slots and compares for equality as it goes. An inconsistent hash is not a collision. It is the table looking in a place the key was never put.

## Comparing objects of different types

`==` between unrelated types is a question, not an error. `1 == "1"` is `False`, not a `TypeError`, and that is deliberate: you can compare anything to anything and get an answer.

Ordering is the opposite. `1 < "1"` raises `TypeError`, because there is no defensible answer and Python 2's willingness to invent one caused enough sorting bugs that Python 3 removed it. So a heterogeneous list can be searched and compared but not sorted, and `sorted(mixed)` fails on the first pair it cannot order.

For your own classes this shows up as a class with `__eq__` that cannot be sorted, because ordering needs `__lt__`. Writing all six comparison methods by hand is tedious and easy to get inconsistent; `functools.total_ordering` fills in the rest from `__eq__` and `__lt__`, and a dataclass with `order=True` generates all of them from the field order. Unit 23 covers both.

## `True` is `1`

`bool` is a subclass of `int`, and `True` really does equal `1`. Consequences worth knowing before they surprise you:

```python
{1: "one", True: "two"}      # {1: 'two'} — one key
{1, True, 1.0}               # {1} — one element
["a", "b"][True]             # 'b'
sum([True, True, False])     # 2
```

`1 == True` and `hash(1) == hash(True)`, so a dict cannot tell them apart and the second assignment overwrites the first while keeping the original key object. It is rarely what you want and occasionally very useful — counting truths with `sum` is idiomatic.

## Truthiness in full

`if x:` calls `bool(x)`, which asks `__bool__`, falls back to `__len__` being non-zero, and otherwise says true. The built-in false values are worth memorising because they are the whole list: `False`, `None`, `0`, `0.0`, `Decimal(0)`, `""`, `b""`, `()`, `[]`, `{}`, `set()`, `range(0)`.

Which means `if items:` is the idiomatic way to ask whether a collection has anything in it, and `if count:` is a bug whenever zero is a legitimate value. The two questions "is this absent?" and "is this empty or zero?" collapse into one test, and separating them is why `is None` exists:

```python
if timeout is None:        # no timeout was given
if not timeout:            # no timeout given, OR the caller asked for zero
```

That distinction matters most in default arguments, where `None` is the sentinel precisely because an empty list or a zero the caller passed deliberately must not be mistaken for "nothing passed".

## `nan` breaks all of it

One value in Python is not equal to itself:

```python
x = float("nan")
x == x          # False
x is x          # True
[x] == [x]      # True
```

IEEE 754 requires that a not-a-number value compares unequal to everything including itself, so `==` is quite right. The list comparison is `True` because containers check identity first as a shortcut — which means a `nan` inside a list behaves differently from a bare one. Use `math.isnan(x)` when you need to ask.

## What to carry forward

`is` is identity and cannot be overridden; `==` is a question the object answers. Equal objects must hash equal, which is why defining `__eq__` removes hashing until you supply `__hash__` over the same fields. Keys must be immutable in whatever their hash reads. `True` is `1` and shares its hash. And `if x:` conflates absent with empty, so use `is None` whenever those two mean different things — which, in a function signature, is nearly always.
