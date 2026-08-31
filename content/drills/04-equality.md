---
slug: 04-equality
---

## `is` compares
- (x) Whether two expressions refer to the same object
- ( ) Whether two objects have the same value
- ( ) Whether two objects have the same type
- ( ) Whatever the class's `__is__` says
> Identity is a pointer comparison. It cannot be overridden, which is exactly why it is the right test for singletons.

## Which comparison should you use for `None`?
- (x) `x is None`
- ( ) `x == None`
- ( ) `x.__eq__(None)`
- ( ) `not x`
> `None` is a singleton, so identity is both correct and unmistakable. `==` is a question the other object gets to answer.

## ruff's `E711` flags
- ( ) Using `is` on integers
- (x) Comparison to None with `==`
- ( ) An unused variable
- ( ) A mutable default argument
> `E712` is the same rule for `True` and `False`.

## If `a == b`, what must be true of their hashes?
- (x) `hash(a) == hash(b)`
- ( ) They must differ
- ( ) Nothing
- ( ) Only if both are immutable
> Otherwise the two land in different buckets and a hash table can never match them up. The converse need not hold: unequal objects may share a hash, which is just a collision.

## Two unequal objects with the same hash cause
- ( ) A KeyError
- (x) A collision, which the table handles by comparing within the bucket
- ( ) Silent data loss
- ( ) A RuntimeError
> Collisions are normal and cheap. It is the other direction — equal objects with different hashes — that breaks the table.

## `hash("abc")` gives a different number in each new Python process because
- ( ) Strings are mutable
- (x) String hashing is randomised per process to defend against collision attacks
- ( ) The hash includes the object's address
- ( ) It does not; it is stable
> Which is why a hash must never be written to a file and used as a durable identifier.

## You mutate a field a key's `__hash__` reads, while the key is in a dict. What happens?
- ( ) The dict rehashes the entry
- ( ) A RuntimeError
- (x) The entry becomes unreachable by lookup while still present
- ( ) The entry is deleted
> The bucket was chosen at insertion and nothing ever asks again. The key still shows up when you iterate, which makes it look like the dict is lying to you.

## Which cannot be a dict key?
- ( ) `("a", "b")`
- ( ) `frozenset({1})`
- (x) `("a", [])`
- ( ) `None`
> A tuple's hash comes from its elements, so it is hashable only if all of them are.

## `{1: "one", True: "two"}` has how many keys?
- (x) One
- ( ) Two
- ( ) Zero; it raises
- ( ) Depends on insertion order
> `bool` subclasses `int`, `True == 1` and their hashes match, so the second assignment overwrites the first while keeping the original key object.

## `sum([True, True, False])` is
- ( ) `TypeError`
- (x) `2`
- ( ) `True`
- ( ) `0`
> Booleans are integers, which makes counting truths with `sum` an idiom rather than a trick.

## A class defines `__eq__` but not `__lt__`. `sorted()` on its instances
- ( ) Sorts by identity
- ( ) Sorts by `__eq__`
- (x) Raises TypeError
- ( ) Leaves the list unchanged
> Python gives you `!=` free from `__eq__` but deliberately refuses to invent an ordering, because there is no defensible way to derive one.

## `1 < "1"` in Python 3
- ( ) Returns True
- ( ) Returns False
- (x) Raises TypeError
- ( ) Compares their string forms
> Python 2 invented an answer and caused enough sorting bugs that Python 3 removed it. Equality across types is still fine and simply returns False.

## Which of these is truthy?
- ( ) `[]`
- ( ) `0.0`
- ( ) `""`
- (x) `[0]`
> A list containing a falsy value is still a non-empty list. Truthiness looks at the container, not its contents.

## `if not timeout:` differs from `if timeout is None:` because
- ( ) They are the same
- (x) The first is also true for `0`, `""` and `[]`
- ( ) The first raises when timeout is None
- ( ) The second cannot be used in a conditional
> Which is exactly why `None` is the conventional sentinel: it distinguishes "nothing was supplied" from "an empty or zero value was supplied deliberately".

## `float("nan") == float("nan")` is
- ( ) True
- (x) False
- ( ) It raises
- ( ) True only for the same object
> IEEE 754 requires nan to compare unequal to everything including itself. Containers test identity first, which is why `[nan] == [nan]` is True for one shared object.
