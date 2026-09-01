---
slug: 12-dicts
---

## `item in some_list` versus `item in some_set`
- ( ) Both scan
- (x) The list scans; the set hashes and does not
- ( ) Both hash
- ( ) The set is slower for small collections
> Which is why a membership test inside a loop over the same collection is the commonest reason Python code is unexpectedly slow.

## Dict insertion order is
- ( ) An implementation detail of CPython
- (x) Part of the language since 3.7
- ( ) Only preserved for string keys
- ( ) Alphabetical
> Sets are a different matter: they have no order at all, despite looking like a dict without values.

## Re-assigning an existing dict key
- (x) Leaves it in its original position
- ( ) Moves it to the end
- ( ) Moves it to the front
- ( ) Raises
> Only deleting and re-adding moves a key, because the position is fixed at first insertion.

## When a missing key means the caller made a mistake, use
- (x) `d[key]`
- ( ) `d.get(key)`
- ( ) `d.get(key, None)`
- ( ) `d.setdefault(key)`
> `get` converts a missing key into a `None` that fails somewhere else. `d[key]` raises naming the key, at the point of the mistake.

## `d.setdefault(key, expensive())` calls `expensive()`
- ( ) Only when the key is missing
- (x) Every time, because arguments are evaluated before the call
- ( ) Never, it is lazy
- ( ) Once, at definition time
> Which is what `defaultdict` fixes: it takes a factory and calls it only when a missing key is read.

## Reading a missing key from a `defaultdict`
- ( ) Raises KeyError
- ( ) Returns the factory's value without storing it
- (x) Inserts it, so the lookup is also a write
- ( ) Returns None
> Which is why `dict(table)` once the building is done hands the rest of the program something that raises on a typo.

## `.items()` returns
- ( ) A list of pairs
- (x) A live view onto the dict
- ( ) An iterator that is consumed
- ( ) A copy
> Views are cheap and reflect later changes, which is also why changing a dict's size mid-iteration raises.

## `d.keys() & other.keys()` gives
- (x) The keys present in both
- ( ) A TypeError
- ( ) The merged dicts
- ( ) The values in both
> Key views support set operations, which is a genuinely useful and little-known thing about them.

## `{**defaults, **overrides}`
- (x) Builds a new dict where the later keys win
- ( ) Modifies `defaults`
- ( ) Builds a new dict where the earlier keys win
- ( ) Raises on a duplicate key
> `defaults | overrides` is the same thing since 3.9. `update` and `|=` are the in-place versions.

## The empty set is written
- ( ) `{}`
- (x) `set()`
- ( ) `set[]`
- ( ) `frozenset`
> `{}` is an empty dict. A set comprehension and a dict comprehension differ only by the colon.

## `tags | ["x"]` where `tags` is a set
- ( ) Returns a set with "x" added
- (x) Raises TypeError
- ( ) Returns a list
- ( ) Ignores the list
> The operators require both sides to be sets; the method forms accept any iterable, so `tags.union(["x"])` works.

## `list(set(items))` versus `list(dict.fromkeys(items))`
- ( ) They are the same
- (x) Both deduplicate; only the second keeps first-seen order
- ( ) Only the first deduplicates
- ( ) The second is not valid
> Dicts preserve insertion order and sets have none, which makes `fromkeys` the idiom for ordered deduplication.

## Why must a dict key's hash not change while it is in the table?
- ( ) It would slow lookups down
- (x) Nothing moves the entry, so lookups compute a different slot and never find it
- ( ) It would raise immediately
- ( ) It would break iteration order
> The key is still visible when you iterate. It is only unreachable by lookup, which is what makes it confusing.

## A collision between two keys
- ( ) Loses one of them
- (x) Is routine: the table probes nearby slots and compares as it goes
- ( ) Raises
- ( ) Forces a resize
> It is the other direction, equal keys hashing differently, that actually breaks a table.

## An object's attributes are stored in
- ( ) A list
- (x) A dict, visible as `obj.__dict__`
- ( ) A fixed array, always
- ( ) The class
> Which is why `__slots__` saves memory by removing that per-instance dict, and why attribute access performs like a dict lookup.
