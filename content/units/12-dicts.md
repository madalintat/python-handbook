---
slug: 12-dicts
title: Dicts and sets
---

A dict maps keys to values and finds one in roughly constant time. A set holds distinct values and answers membership in roughly constant time. They are the same machinery with a different question attached, and between them they replace more slow loops than anything else in the language.

## What constant time buys

Finding an item in a list means comparing against the items until you hit it, so the cost grows with the length. A dict hashes the key, uses that number to pick a slot, and looks only there.

The practical version of that:

```python
if name in names_list:      # scans, cost grows with the list
if name in names_set:       # hashes, cost does not
```

A membership test inside a loop over the same collection is the single most common reason Python code is unexpectedly slow, and turning the collection into a set is usually a one-line fix that changes a quadratic function into a linear one. Unit 04 established the requirement that comes with it: keys and set members must be hashable, which means immutable in whatever their hash reads.

## How the lookup actually works

Worth knowing in outline, because it explains every rule in this unit and unit 04's contract.

A dict holds an array of slots. To store a key it computes `hash(key)`, uses the low bits of that number to pick a slot, and puts the entry there. To find one it does the same arithmetic and looks in that slot, comparing with `==` to confirm it has the right key rather than a different one that landed in the same place.

Three consequences fall out.

**A hash must not change while the key is in the table**, because nothing will move the entry when it does. That is why keys must be immutable in whatever the hash reads, and why unit 04's mutated key became unreachable while still being visible.

**Equal keys must hash equal**, or the lookup computes a different slot and never finds the entry. That is why defining `__eq__` removes hashing until you supply a matching `__hash__`.

**Collisions are normal.** Two different keys can land in the same slot; the table probes nearby slots and compares as it goes. This costs a little and is entirely routine, which is why "a smaller hash is fine" is true and "a hash over fewer fields than equality" is not.

The table also resizes when it gets around two-thirds full, rehashing everything into a bigger array. That makes an individual insert occasionally expensive and the average still constant, which is what "amortised" means when you see it written about `append` and about dicts.

## Dicts are everywhere underneath

A great deal of Python is a dict wearing a costume, which is worth seeing once because it makes several later units obvious rather than surprising.

Module globals are a dict, and `globals()` hands it to you. An object's attributes are a dict, visible as `obj.__dict__`, so `obj.x = 1` is close to `obj.__dict__["x"] = 1`. A class body's names end up in a dict on the class. Keyword arguments arrive as a dict. And unit 01's namespaces were dicts all along.

That is why attribute access and dictionary lookup have such similar performance, why `__slots__` in unit 19 saves memory by *removing* that per-instance dict, and why unit 08's name resolution is a sequence of dictionary lookups in a fixed order.

## Insertion order is a guarantee

Since 3.7, a dict preserves the order keys were first inserted, and this is part of the language rather than an implementation detail. Iterating, printing and `list(d)` all follow that order.

Two things it does not mean. Re-assigning an existing key does not move it, because the key was already inserted; only deleting and re-adding does. And a set is **not** ordered, despite looking like a dict without values, so anything that depends on the order of a set is depending on nothing.

## Getting a value out

Four ways, and the differences matter:

```python
d[key]                  # KeyError if absent
d.get(key)              # None if absent
d.get(key, default)     # your default if absent
d.setdefault(key, [])   # inserts the default and returns it
```

`d[key]` is right when a missing key is a bug, and it says so loudly. `get` is right when absent is a normal case. The mistake worth naming is using `get` everywhere out of caution: it converts a missing key into a `None` that flows onward and fails somewhere else, which is exactly the swap unit 09 warned about.

`setdefault` both looks up and inserts, which makes it the one-line way to accumulate:

```python
groups.setdefault(kind, []).append(item)
```

It has a wart: the default is built on every call whether it is needed or not, so `setdefault(k, expensive())` pays for the expensive call every time.

## `defaultdict`, and when not to

`collections.defaultdict` takes a factory and calls it whenever a missing key is read:

```python
from collections import defaultdict
groups = defaultdict(list)
groups[kind].append(item)      # no setdefault, no check
```

Cleaner for accumulation, and it has one behaviour to keep in mind: **reading a missing key inserts it**. A `defaultdict` that gets looked up with an unexpected key silently grows, and `if k in d` still works but `d[k]` in a condition does not. Convert back with `dict(groups)` when you are done building, so the rest of the program gets a mapping that raises on a typo.

`Counter` is the specialised version for tallying, and it is worth reaching for by name:

```python
from collections import Counter
counts = Counter(words)
counts.most_common(3)
```

## The three views

`.keys()`, `.values()` and `.items()` return **views**: live windows onto the dict, not copies. They reflect later changes, they are cheap, and they are why iterating a dict while changing its size raises rather than misbehaving.

Iterating a dict gives keys, which unit 06 met. `for key, value in d.items()` is how you get both, and it is one lookup rather than two.

Key views support set operations, which is a genuinely useful and little-known trick:

```python
d.keys() & other.keys()     # keys in both
d.keys() - other.keys()     # keys only in the first
```

## Merging

```python
merged = {**defaults, **overrides}     # a new dict, later keys win
merged = defaults | overrides          # the same thing, since 3.9
defaults.update(overrides)             # in place, returns None
defaults |= overrides                  # the same thing, in place
```

The first two build something new and leave both inputs alone. The last two modify the left-hand one. Which you want is unit 02's question again, and the answer is usually the one that does not touch the caller's data.

## Sets

A set is written `{1, 2, 3}`, and the empty one is `set()`, because `{}` is a dict. Sets are for two questions: is this in there, and what do these two collections have in common.

```python
a | b        # union
a & b        # intersection
a - b        # difference
a ^ b        # in one or the other, not both
a <= b       # subset
```

These read far better than the loops they replace, and each is one pass rather than nested passes. `frozenset` is the immutable version, and it is what you use when a set needs to be a dict key or a member of another set.

The operators have method forms that are worth knowing about, because they differ: `a | b` requires both to be sets, while `a.union(b)` accepts any iterable. So `tags.union(["x", "y"])` works and `tags | ["x", "y"]` is a `TypeError`. The same holds for the others.

The trap is that a set silently discards duplicates, which is what you want when deduplicating and not what you want when the count matters. `len(set(items))` answers "how many distinct" and quietly stops answering "how many" the moment there is a repeat.

## Comprehensions over mappings

The comprehension forms exist for both types, and they are the readable way to build one from another:

```python
{name: len(name) for name in names}          # a dict
{name.lower() for name in names}             # a set
{k: v for k, v in d.items() if v is not None}   # filtering a mapping
{v: k for k, v in d.items()}                 # inverting one
```

The inversion is worth a caution: values need not be unique, so a duplicate value silently keeps whichever key came last. If that matters, build a mapping to lists instead.

Note the shapes carefully, because `{}` alone is a dict and the set has no empty literal at all. `{x for x in ...}` is a set comprehension and `{k: v for ...}` is a dict one, and the only difference is the colon.

Unit 13 takes comprehensions apart properly, including why they have their own scope and when a loop says more.

## Choosing between them

A short decision procedure, since the types overlap enough to be worth stating.

If you need to answer "is this one of them" repeatedly, a **set**. If you need a value alongside the key, a **dict**. If you need order and duplicates and position, a **list**. If you need to count, a **Counter**, which is a dict that starts every key at zero.

The conversion is cheap and usually worth it: building a set from a list you are about to search many times pays for itself after about two lookups. What is not free is building the set inside the loop, which is a mistake that looks like an optimisation and is slower than the list scan it replaced.

Two smaller notes. A dict with `True` and `1` as separate keys does not exist, for the reason unit 04 gave. And `dict.fromkeys(seq)` is a neat way to deduplicate while keeping order, since dicts preserve insertion order and sets do not:

```python
list(dict.fromkeys(items))     # unique, in first-seen order
list(set(items))               # unique, in no order you can rely on
```

## What to carry forward

Dicts and sets answer membership in constant time, which turns a great many quadratic loops linear. Keys must be hashable, so immutable in whatever the hash reads. Insertion order is guaranteed for dicts and meaningless for sets. `d[key]` when absent is a bug, `get` when it is not, `setdefault` or a `defaultdict` for accumulating. The three views are live windows rather than copies. And a set discards duplicates, which is the whole point right up until it is the bug.
