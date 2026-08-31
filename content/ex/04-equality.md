---
slug: 04-equality
---

## Asking None the wrong way

`is_missing` checks whether a value is absent. It asks with `==`, which ruff objects to by code, and the tests supply an object that shows the objection is not cosmetic.

@expect ruff:E711
@expect silent
@hint `==` is a question the other object answers. `is` is not.
@hint There is exactly one `None` object in a running Python, forever.
@diagnose E711 ruff's `E711` is "comparison to None should be `cond is None`". `None` is a singleton, so identity is both the correct test and the unambiguous one — and it is faster, since it compares pointers rather than dispatching to a method.
@diagnose silent It runs, and it believes the wildcard is missing. `value == None` calls `value.__eq__(None)`, which any class is free to answer however it likes; a permissive `__eq__` that returns `True` for everything therefore reports itself as absent. `is None` cannot be intercepted by anything, which is precisely why it is the right test for a sentinel.

~~~starter
def is_missing(value):
    """True if value is None."""
    return value == None
~~~

~~~tests
class Wildcard:
    def __eq__(self, other):
        return True


assert is_missing(None) is True
assert is_missing(0) is False
assert is_missing("") is False
assert is_missing(Wildcard()) is False, "a permissive __eq__ was mistaken for None"
~~~

~~~solution
def is_missing(value):
    """True if value is None."""
    return value is None
~~~

## Zero is a value

`describe_timeout` reports how a timeout was configured. It uses one test for two different questions, and the tests ask about a caller who deliberately wanted no waiting at all.

@expect silent
@hint `if not timeout:` is true for `None` and also true for `0`.
@hint "Nothing was given" and "zero was given" are different facts. Test them separately.
@diagnose silent Nothing raised, and a caller who explicitly asked for a zero timeout is told none was configured. `if not timeout:` collapses "absent" and "empty or zero" into one test, and the built-in falsy values include `0`, `0.0`, `""`, `[]` and `{}` — every one of which a caller might have meant. This is the whole reason `None` is the conventional sentinel for a default argument: it is the one value that means *nothing was supplied* and cannot be confused with a legitimate empty one.

~~~starter
def describe_timeout(timeout):
    """Say whether a timeout was configured, and what it was."""
    if not timeout:
        return "no timeout configured"
    return f"timeout of {timeout}s"
~~~

~~~tests
assert describe_timeout(None) == "no timeout configured"
assert describe_timeout(30) == "timeout of 30s"
assert describe_timeout(0) == "timeout of 0s", "a deliberate zero timeout was read as absent"
~~~

~~~solution
def describe_timeout(timeout):
    """Say whether a timeout was configured, and what it was."""
    if timeout is None:
        return "no timeout configured"
    return f"timeout of {timeout}s"
~~~

## A hash that disagrees with equality

`Card` says two cards are equal when their rank and suit match, and hashes only the rank. Both methods are individually reasonable. Put several cards in a set and count them.

@expect silent
@hint Two objects that compare equal must hash equal. Check whether the reverse holds here, and whether it needs to.
@hint The hash is computed from fewer fields than equality uses. Work out which direction that breaks.
@diagnose silent It runs and quietly produces a set with duplicates in it. Hashing on the rank alone means two different cards with the same rank collide into one bucket, which is legal and merely slow — collisions are normal. The real damage is the other way round: nothing here breaks *equal implies same hash*, but hashing on fewer fields than equality is only safe if those fields determine equality, and here they do not. The result is that `Card("A", "spades")` and `Card("A", "hearts")` land in the same bucket, get compared, and are found unequal — so both stay, which is correct — while your intuition that a smaller hash is harmless quietly stops holding the moment equality narrows. Hash exactly the fields equality uses: `hash((self.rank, self.suit))`.

~~~starter
class Card:
    def __init__(self, rank, suit):
        self.rank = rank
        self.suit = suit

    def __eq__(self, other):
        return isinstance(other, Card) and (self.rank, self.suit) == (other.rank, other.suit)

    def __hash__(self):
        return hash(self.rank)
~~~

~~~tests
cards = {Card("A", "spades"), Card("A", "hearts"), Card("A", "spades")}
assert len(cards) == 2, f"expected two distinct cards, got {len(cards)}"
assert hash(Card("A", "spades")) != hash(Card("A", "hearts")), "different cards share a hash"
assert hash(Card("A", "spades")) == hash(Card("A", "spades"))
~~~

~~~solution
class Card:
    def __init__(self, rank, suit):
        self.rank = rank
        self.suit = suit

    def __eq__(self, other):
        return isinstance(other, Card) and (self.rank, self.suit) == (other.rank, other.suit)

    def __hash__(self):
        return hash((self.rank, self.suit))
~~~

## The key that moved

`book` records a booking against a time slot and then advances that slot for the caller's next one. It advances the very object it just used as a key. Look the booking up afterwards and it is not there, though nothing was deleted and nothing raised.

@expect silent
@hint The dictionary chose a bucket from the key's hash at the moment of insertion, and nothing ever asks again.
@hint Both the hash and the equality test now give different answers than they did when the entry went in.
@diagnose silent It runs, and the entry is unreachable by lookup while still being right there when you iterate. A dict stores an entry in a bucket chosen by `hash(key)` at insertion time. Mutating a field the hash reads means every later lookup computes a different hash, and even when it happens to land on the right bucket the equality comparison against the mutated key now fails too. The key is not lost — `list(schedule)` still shows it — which makes this look like the dictionary lying to you. A key must be immutable in whatever its hash reads: store a copy, use a tuple, or freeze the class.

~~~starter
class Slot:
    def __init__(self, minute):
        self.minute = minute

    def __eq__(self, other):
        return isinstance(other, Slot) and self.minute == other.minute

    def __hash__(self):
        return hash(self.minute)

    def __repr__(self):
        return f"Slot({self.minute})"


def book(schedule, slot, name):
    """Record name against slot, then advance slot to the next quarter hour."""
    schedule[slot] = name
    slot.minute += 15
    return schedule
~~~

~~~tests
slot = Slot(0)
schedule = book({}, slot, "ada")
assert slot.minute == 15, "the slot should have been advanced"
assert schedule.get(Slot(0)) == "ada", f"the booking was not found under Slot(0): {schedule}"
assert len(schedule) == 1
~~~

~~~solution
class Slot:
    def __init__(self, minute):
        self.minute = minute

    def __eq__(self, other):
        return isinstance(other, Slot) and self.minute == other.minute

    def __hash__(self):
        return hash(self.minute)

    def __repr__(self):
        return f"Slot({self.minute})"


def book(schedule, slot, name):
    """Record name against slot, then advance slot to the next quarter hour."""
    schedule[Slot(slot.minute)] = name
    slot.minute += 15
    return schedule
~~~

## Sorting needs more than equality

`Version` knows when two versions are equal. Sort a list of them and the interpreter says it cannot. Read which method it names, and note that it is not the one you wrote.

@expect raises:TypeError
@expect mypy:type-var
@hint `==` and `<` come from different methods. Defining one does not give you the other.
@hint Comparing tuples of numbers already does what you want, elementwise.
@diagnose type-var mypy reports this statically. `sorted` is typed as requiring elements that support comparison, expressed as a type variable bound to a protocol with `__lt__`, and `Version` does not satisfy it. The message is about a type variable rather than about a missing method, which takes a moment to read the first time; what it means is "this argument does not meet the constraint the function declared".
@diagnose TypeError Sorting orders elements, and ordering is `__lt__`. Python gives you `!=` free as the negation of `__eq__`, but it deliberately does not invent an ordering from equality, because there is no defensible way to do so. Write `__lt__`, or let `functools.total_ordering` fill in the remaining four from `__eq__` and `__lt__`, or use a dataclass with `order=True`. Comparing tuples of the fields does the elementwise work for you.

~~~starter
class Version:
    def __init__(self, major, minor):
        self.major = major
        self.minor = minor

    def __eq__(self, other):
        return (self.major, self.minor) == (other.major, other.minor)

    def __repr__(self):
        return f"Version({self.major}, {self.minor})"


print(sorted([Version(1, 5), Version(1, 2)]))
~~~

~~~tests
versions = [Version(1, 5), Version(2, 0), Version(1, 2)]
assert sorted(versions) == [Version(1, 2), Version(1, 5), Version(2, 0)]
assert max(versions) == Version(2, 0)
~~~

~~~solution
class Version:
    def __init__(self, major, minor):
        self.major = major
        self.minor = minor

    def __eq__(self, other):
        return (self.major, self.minor) == (other.major, other.minor)

    def __lt__(self, other):
        return (self.major, self.minor) < (other.major, other.minor)

    def __repr__(self):
        return f"Version({self.major}, {self.minor})"


print(sorted([Version(1, 5), Version(1, 2)]))
~~~

## A key that cannot be one

`group_by_tags` wants to index some records by their tag collection. Tags arrive as a list. Run it and read what the interpreter says about using one as a key.

@expect raises:TypeError
@hint A key needs a hash that never changes. Ask whether a list can promise that.
@hint There is an immutable sequence type, and an immutable set type. Either will do here.
@diagnose TypeError Lists are unhashable, deliberately and by design: a hash must not change while the object sits in a table, and a list can be appended to at any moment. `list.__hash__` is set to `None`, which is what produces `unhashable type: 'list'`. Convert to something immutable first — `tuple(tags)` if order matters, `frozenset(tags)` if it does not and duplicates should collapse. Note that a tuple only helps if its contents are hashable too; a tuple of lists is just as unhashable.

~~~starter
def group_by_tags(records):
    """Index records by their tags."""
    grouped = {}
    for tags, name in records:
        grouped.setdefault(tags, []).append(name)
    return grouped


print(group_by_tags([(["a", "b"], "first")]))
~~~

~~~tests
out = group_by_tags([(["a", "b"], "first"), (["a", "b"], "second"), (["c"], "third")])
assert out[("a", "b")] == ["first", "second"], f"got {out}"
assert out[("c",)] == ["third"]
~~~

~~~solution
def group_by_tags(records):
    """Index records by their tags."""
    grouped = {}
    for tags, name in records:
        grouped.setdefault(tuple(tags), []).append(name)
    return grouped


print(group_by_tags([(["a", "b"], "first")]))
~~~

## True is one

`tally` counts how many times each value appears. Feed it a mixture of booleans and integers and two things that your program considers different arrive in the same bucket. This is not a bug in the function so much as a fact about `bool`.

@expect silent
@hint `bool` inherits from `int`. Check what `1 == True` and `hash(1) == hash(True)` give you.
@hint A dictionary cannot separate two keys that are equal and hash the same. Give it something that differs.
@diagnose silent It runs and reports one key where you expected two. `bool` is a subclass of `int`, `True == 1` and `hash(True) == hash(1)`, so a dictionary has no way to tell them apart — the second one found simply lands on the existing entry, keeping the original key object and updating the count. The same collapse happens in sets, and it is why `{1, True, 1.0}` has one element. When the distinction matters, key on something that carries the type as well, such as `(type(value).__name__, value)`.

~~~starter
def tally(values):
    """Count how many times each distinct value appears."""
    counts = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return counts
~~~

~~~tests
out = tally([1, True, 1, False, 0])
assert out.get(("int", 1)) == 2, f"got {out}"
assert out.get(("bool", True)) == 1, f"True and 1 were merged: {out}"
assert out.get(("bool", False)) == 1
assert out.get(("int", 0)) == 1
~~~

~~~solution
def tally(values):
    """Count how many times each distinct value appears."""
    counts = {}
    for value in values:
        key = (type(value).__name__, value)
        counts[key] = counts.get(key, 0) + 1
    return counts
~~~

## The value that is not equal to itself

`index_of` scans for a value and returns where it is. It compares with `==`, which is the obvious thing to do and which fails for exactly one value in the language. The tests look for that value.

@expect silent
@hint Evaluate `float("nan") == float("nan")`, and then evaluate it again with the same object on both sides.
@hint `list.index` and `in` do something extra before comparing. Work out what, by asking why `[nan] == [nan]` is True.
@diagnose silent Nothing raised, and a value sitting plainly in the list is reported as absent. IEEE 754 requires a not-a-number value to compare unequal to everything including itself, so `v == target` is `False` even when `v` *is* `target`, and `==` is behaving exactly as specified. The standard library works around this: `list.index`, `in` and container equality all test identity first and fall back to equality, which is why `[nan] == [nan]` is `True` for one shared object while `nan == nan` is `False`. Do the same — `v is target or v == target` — and use `math.isnan` when you actually need to ask whether something is nan.

~~~starter
def index_of(values, target):
    """Return the index of target in values, or -1 if it is not there."""
    for i, value in enumerate(values):
        if value == target:
            return i
    return -1
~~~

~~~tests
assert index_of([10, 20, 30], 20) == 1
assert index_of([10, 20], 99) == -1
nan = float("nan")
assert index_of([1, nan, 2], nan) == 1, "a nan sitting in the list was not found"
assert [nan] == [nan], "containers compare identity first"
~~~

~~~solution
def index_of(values, target):
    """Return the index of target in values, or -1 if it is not there."""
    for i, value in enumerate(values):
        if value is target or value == target:
            return i
    return -1
~~~
