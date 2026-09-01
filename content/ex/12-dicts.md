---
slug: 12-dicts
---

## The membership test inside the loop

`shared_names` finds the names present in both collections. It is correct, and it scans a list once per name, so the work grows with the product of the two sizes. The tests time it against a size that makes the difference visible.

@expect silent
@hint `item in some_list` scans. `item in some_set` hashes.
@hint There is a set operation that answers "what do these two have in common" in one pass.
@diagnose silent Nothing raised, and the answer is right. The cost is the problem: `name in known` scans the list until it matches, so checking every name against every known name is quadratic, and the test counted the scans rather than timing them, so the verdict is the same on any machine. Converting the collection you search into a set is usually a one-line change that turns a quadratic function linear, and it pays for itself after about two lookups. Here the intent has a name of its own: `set(a) & set(b)` is the intersection, computed in one pass, and it says what the loop was for.

~~~starter
def shared_names(names, known):
    """Return the names that also appear in known."""
    out = []
    for name in names:
        if name in known:
            out.append(name)
    return out
~~~

~~~tests
class Watched(list):
    """A list that records how often something searched it end to end."""

    scans = 0

    def __contains__(self, item):
        Watched.scans += 1
        return list.__contains__(self, item)


assert sorted(shared_names(["a", "b", "c"], Watched(["b", "c", "d"]))) == ["b", "c"]
assert shared_names([], Watched(["a"])) == []

big = [str(i) for i in range(2000)]
other = Watched(str(i) for i in range(1000, 3000))
assert len(shared_names(big, other)) == 1000
assert Watched.scans == 0, (
    f"searched the list {Watched.scans} times, "
    "and each search walks it from the start"
)
~~~

~~~solution
def shared_names(names, known):
    """Return the names that also appear in known."""
    known_set = set(known)
    return [name for name in names if name in known_set]
~~~

## get, where a missing key was a bug

`price_of` looks up a price. It uses `get`, so a key that should always be there comes back as `None` and travels on to fail somewhere else.

@expect raises:TypeError
@hint `get` turns a missing key into `None`. Ask where that `None` ends up.
@hint When a missing key means the caller is wrong, the subscript says so at the point of the mistake.
@diagnose TypeError The lookup returned `None`, the arithmetic then tried to multiply it, and the failure appears one line away from the cause with a message about `NoneType` rather than about a missing key. This is the swap unit 09 warned against, in miniature: `get` is right when absent is a normal case with a sensible default, and wrong when absent means somebody made a mistake. `d[key]` raises `KeyError` naming the key, at the point where the wrong key was used, which is the most useful thing that could happen. Reaching for `get` out of caution converts a good error into a bad one.

~~~starter
def price_of(catalogue, sku, quantity):
    """Return the total price. The sku must be in the catalogue."""
    return catalogue.get(sku) * quantity


print(price_of({"a": 3}, "missing", 2))
~~~

~~~tests
assert price_of({"a": 3}, "a", 2) == 6
try:
    price_of({"a": 3}, "zzz", 2)
except KeyError as exc:
    assert "zzz" in str(exc), "the error should name the key that was missing"
else:
    raise AssertionError("a missing sku should raise KeyError")
~~~

~~~solution
def price_of(catalogue, sku, quantity):
    """Return the total price. The sku must be in the catalogue."""
    return catalogue[sku] * quantity


print(price_of({"a": 3}, "a", 2))
~~~

## Two lookups where one would do

`totals` walks a mapping and reads each value by looking the key up again. Iterating a dict gives keys, so this works, and it does twice the work and reads worse than the form that gives you both.

@expect silent
@hint Iterating a dict yields keys. There is a view that yields pairs.
@hint The bug is not the double lookup. Look at what happens to a key whose value is missing from the second dict.
@diagnose silent It runs and silently skips any entry whose key is not in `weights`, because the `in` check quietly drops it. Two separate problems live in that shape. Looking a key up again inside the loop is one extra hash per item where `.items()` hands you the pair you already have. And splitting the read across two collections invites exactly this kind of silent omission, where the function returns a smaller answer rather than saying it could not do the job. Iterate `.items()` and let a genuinely missing weight raise.

~~~starter
def totals(counts, weights):
    """Return the weighted total of every count. Every key must have a weight."""
    total = 0
    for key in counts:
        if key in weights:
            total += counts[key] * weights[key]
    return total
~~~

~~~tests
assert totals({"a": 2, "b": 3}, {"a": 10, "b": 100}) == 320
try:
    totals({"a": 2, "b": 3}, {"a": 10})
except KeyError:
    pass
else:
    raise AssertionError("a missing weight was silently skipped")
~~~

~~~solution
def totals(counts, weights):
    """Return the weighted total of every count. Every key must have a weight."""
    total = 0
    for key, count in counts.items():
        total += count * weights[key]
    return total
~~~

## The default that every call paid for

`register` records an item under a category, creating the list on first use. It uses `setdefault`, whose default argument is built on every call whether it is needed or not, and here building it has a side effect.

@expect silent
@hint `setdefault(key, default)` evaluates `default` before it knows whether the key is there.
@hint A `defaultdict` calls its factory only when a key is actually missing.
@diagnose silent It runs and the counter is wrong, because `setdefault` is an ordinary call: its second argument is evaluated before the method runs, every single time, whether or not the key was absent. With a plain `[]` that is only a small waste; with anything that costs or counts, it is a bug. `collections.defaultdict` takes a *factory* and calls it only when a missing key is read, which is both cheaper and honest about when the default happens. Keep in mind what a `defaultdict` does in exchange: reading a missing key inserts it, so convert back with `dict(...)` once you have finished building.

~~~starter
def register(groups, kind, item, made):
    """Add item to its group, creating the group on first use.

    `made` counts how many new groups were created.
    """
    def new_group():
        made.append(kind)
        return []

    groups.setdefault(kind, new_group()).append(item)
    return groups
~~~

~~~tests
made = []
groups = {}
register(groups, "fruit", "apple", made)
register(groups, "fruit", "pear", made)
register(groups, "veg", "leek", made)
assert groups == {"fruit": ["apple", "pear"], "veg": ["leek"]}
assert made == ["fruit", "veg"], f"a group was built for a key that already existed: {made}"
~~~

~~~solution
def register(groups, kind, item, made):
    """Add item to its group, creating the group on first use.

    `made` counts how many new groups were created.
    """
    if kind not in groups:
        made.append(kind)
        groups[kind] = []
    groups[kind].append(item)
    return groups
~~~

## A set is not ordered

`first_unique` returns the distinct values in the order they first appeared. It builds a set, which discards the order along with the duplicates.

@expect silent
@hint A set has no order. Whatever comes out is not the order that went in.
@hint A dict does preserve insertion order, and `dict.fromkeys` uses that.
@diagnose silent Nothing raised, and the values came back in an order that has nothing to do with the input. For small integers that order looks suspiciously sorted, because an integer hashes to itself; for strings it changes between runs, because string hashing is randomised per process. A set is unordered: anything that depends on the order of one is depending on nothing, even when a small set of small integers happens to look sorted. Dicts have preserved insertion order as a language guarantee since 3.7, so `dict.fromkeys(items)` deduplicates *and* keeps first-seen order, and `list(dict.fromkeys(items))` is the idiom for this exact job. The alternative, a set for the seen-check plus a list for the output, is what you write when you also need to filter as you go.

~~~starter
def first_unique(items):
    """Return the distinct items, in the order they first appeared."""
    return list(set(items))
~~~

~~~tests
# small integers hash to themselves, so a set of them has a stable order and
# this test cannot pass by luck the way one over strings could
assert first_unique([3, 1, 3, 2, 1]) == [3, 1, 2]
assert first_unique([5, 4]) == [5, 4]
assert first_unique([]) == []
~~~

~~~solution
def first_unique(items):
    """Return the distinct items, in the order they first appeared."""
    return list(dict.fromkeys(items))
~~~

## Merging in the wrong direction

`with_overrides` applies per-user settings on top of the defaults. It merges the two dicts in an order that lets the defaults win, and it edits the defaults while doing it.

@expect silent
@hint In `{**a, **b}` the later keys win. Which of the two should win here?
@hint `update` modifies the dict it is called on. Ask whose dict that is.
@diagnose silent It runs and the override is ignored, then the defaults are left permanently changed. Two mistakes in one line. `defaults.update(overrides)` mutates the caller's defaults, so the second call starts from a base the first one altered, which is unit 02's rule again. And returning `defaults` after updating means the later keys did win here, but the shape invites the reverse: `{**overrides, **defaults}` reads as "overrides first" and lets the defaults overwrite them. `{**defaults, **overrides}`, or `defaults | overrides` since 3.9, builds a new mapping with the later keys winning and leaves both inputs alone.

~~~starter
def with_overrides(defaults, overrides):
    """Return the settings with the user's overrides applied on top."""
    return {**overrides, **defaults}
~~~

~~~tests
defaults = {"colour": "blue", "size": 10}
out = with_overrides(defaults, {"size": 99})
assert out == {"colour": "blue", "size": 99}, f"the default won: {out}"
assert defaults == {"colour": "blue", "size": 10}, "the defaults were modified"
~~~

~~~solution
def with_overrides(defaults, overrides):
    """Return the settings with the user's overrides applied on top."""
    return {**defaults, **overrides}
~~~

## Counting with a set

`busiest` reports how many times the busiest hour appears in a log. It puts the hours in a set first, which is the right tool for "how many distinct" and the wrong one for "how many".

@expect silent
@hint A set discards duplicates. That is the whole point right up until it is the bug.
@hint There is a `collections` type whose entire job is tallying.
@diagnose silent Nothing raised, and every hour is reported as occurring once, because a set kept one of each. This is the trap in the type: deduplication is exactly what you want when you are asking "which hours appear" and exactly wrong when you are asking "how often". `collections.Counter` is the tool with the right shape: it is a dict that starts every key at zero, counts an iterable in one pass, and `most_common(1)` hands back the winner with its tally.

~~~starter
def busiest(hours):
    """Return (hour, count) for the most frequent hour."""
    seen = set(hours)
    best = None
    for hour in seen:
        count = 1
        if best is None or count > best[1]:
            best = (hour, count)
    return best
~~~

~~~tests
assert busiest([9, 9, 10, 9, 11, 10]) == (9, 3)
assert busiest([5]) == (5, 1)
assert busiest([1, 1, 2, 2, 2]) == (2, 3)
~~~

~~~solution
from collections import Counter


def busiest(hours):
    """Return (hour, count) for the most frequent hour."""
    return Counter(hours).most_common(1)[0]
~~~

## A key that grew a table

`lookup` reports whether a code is known, using a `defaultdict` so that building the table needed no checks. Reading a missing key from one inserts it, so asking about an unknown code makes it known.

@expect silent
@hint A `defaultdict` calls its factory when a missing key is *read*, not only when it is written.
@hint `in` does not insert. `d[k]` does.
@diagnose silent It runs, and the table grows every time somebody asks about a code that is not in it. That is what a `defaultdict` is for and it is also its one sharp edge: reading a missing key inserts it, so a lookup is a write. Two fixes, and they say different things. `code in table` asks without inserting, and is what a read-only check should use. Converting with `dict(table)` once the building is finished is the broader habit: it hands the rest of the program a mapping that raises on a typo instead of quietly inventing an entry.

~~~starter
from collections import defaultdict


def build(pairs):
    """Group values by code."""
    table = defaultdict(list)
    for code, value in pairs:
        table[code].append(value)
    return table


def lookup(table, code):
    """True if the code has any values recorded."""
    return len(table[code]) > 0
~~~

~~~tests
table = build([("a", 1), ("a", 2), ("b", 3)])
assert lookup(table, "a") is True
assert lookup(table, "zzz") is False
assert "zzz" not in table, "asking about an unknown code added it to the table"
assert len(table) == 2
~~~

~~~solution
from collections import defaultdict


def build(pairs):
    """Group values by code."""
    table = defaultdict(list)
    for code, value in pairs:
        table[code].append(value)
    return table


def lookup(table, code):
    """True if the code has any values recorded."""
    return code in table and len(table[code]) > 0
~~~
