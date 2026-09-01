---
slug: 15-iterators
---

## A collection that empties after one use

`Deck` holds cards and can be walked with a `for` loop. Walk it twice and the second pass finds nothing, because `__iter__` hands back the same iterator every time.

@expect silent
@hint `__iter__` returning `self` makes the object an iterator, and an iterator has one pass in it.
@hint A reusable iterable returns a **fresh** iterator each time it is asked.
@diagnose silent Nothing raised, and the second loop saw an empty deck. Returning `self` from `__iter__` makes this class an iterator rather than an iterable: the position lives on the object, so once one loop has run it to the end there is nothing for the next one. That is the right design when the values genuinely arrive once, such as a socket or a cursor. For something holding data, separate the two roles: `__iter__` returns a new iterator over the stored cards each time it is called, which is exactly what a list does and why a list can be walked as often as you like.

~~~starter
class Deck:
    def __init__(self, cards):
        self.cards = list(cards)
        self.pos = 0

    def __iter__(self):
        return self

    def __next__(self):
        if self.pos >= len(self.cards):
            raise StopIteration
        self.pos += 1
        return self.cards[self.pos - 1]
~~~

~~~tests
deck = Deck(["a", "b"])
assert list(deck) == ["a", "b"]
assert list(deck) == ["a", "b"], "the deck was empty the second time"
assert [c for c in deck] == ["a", "b"]
~~~

~~~solution
class Deck:
    def __init__(self, cards):
        self.cards = list(cards)

    def __iter__(self):
        return iter(self.cards)
~~~

## Half a protocol

`Counter` produces values with `__next__` and never says it is iterable, so a `for` loop refuses it. Read which method the interpreter says is missing.

@expect raises:TypeError
@expect mypy:call-overload
@hint An iterator needs both halves: `__next__` to produce values, and `__iter__` to say it is one.
@hint An iterator's `__iter__` returns itself.
@diagnose call-overload mypy reports it without running anything: `list()` is declared to take an iterable, and a class with no `__iter__` does not match any of its overloads. Protocols are visible to a type checker as the methods they require, which is why every missing dunder in this book shows up statically as well as at runtime.
@diagnose TypeError `for` begins by calling `iter()`, which looks for `__iter__`, and a class that has only `__next__` fails there before a single value is produced. An iterator has to declare itself with an `__iter__` that returns `self`, which looks redundant and is not: it is what makes an iterator usable everywhere an iterable is expected, so that `list(it)`, `for x in it` and `zip(it, other)` all work. The error names `__iter__` specifically, which is a useful thing to recognise, because the instinct on seeing "not iterable" is to look at the values rather than at the two-method protocol.

~~~starter
class Countdown:
    def __init__(self, start):
        self.n = start

    def __next__(self):
        if self.n <= 0:
            raise StopIteration
        self.n -= 1
        return self.n + 1


print(list(Countdown(3)))
~~~

~~~tests
assert list(Countdown(3)) == [3, 2, 1]
assert list(Countdown(0)) == []
it = Countdown(2)
assert iter(it) is it, "an iterator's __iter__ should return itself"
~~~

~~~solution
class Countdown:
    def __init__(self, start):
        self.n = start

    def __iter__(self):
        return self

    def __next__(self):
        if self.n <= 0:
            raise StopIteration
        self.n -= 1
        return self.n + 1


print(list(Countdown(3)))
~~~

## Asking for one more than there was

`first_two` pulls two values off an iterator. When there is only one, `next` raises the signal a `for` loop would have caught, and here nothing catches it.

@expect raises:StopIteration
@hint `next(it)` raises when there is nothing left. There is a way to ask for a default instead.
@hint A `for` loop catches this signal for you. A bare `next` does not.
@diagnose StopIteration `StopIteration` is the signal an iterator raises when it is finished, and a `for` loop catches it and stops. Calling `next` yourself puts you outside that loop, so the signal arrives as an ordinary exception. Two ways to handle it, and they say different things. `next(it, default)` returns the default instead of raising, which is right when running out is a normal case. Catching `StopIteration` explicitly is right when running out means the input was malformed and you want to say so. Note that from Python 3.7 a `StopIteration` that escapes inside a generator becomes a `RuntimeError` rather than quietly ending it, precisely because this was such a confusing bug.

~~~starter
def first_two(source):
    """Return the first two values, padding with None if there are fewer."""
    return [next(source), next(source)]


print(first_two(iter(["only"])))
~~~

~~~tests
assert first_two(iter([1, 2, 3])) == [1, 2]
assert first_two(iter(["only"])) == ["only", None]
assert first_two(iter([])) == [None, None]
~~~

~~~solution
def first_two(source):
    """Return the first two values, padding with None if there are fewer."""
    return [next(source, None), next(source, None)]


print(first_two(iter(["only"])))
~~~

## zip gives you an iterator

`compare` pairs two sequences and reports both the count and the mismatches. It walks the `zip` twice, and a `zip` object is an iterator.

@expect silent
@hint `zip` returns an iterator, not a list. What does the second walk see?
@hint The fix is one call, at the top.
@diagnose silent Nothing raised, and the second walk found nothing, so the mismatches came back empty. `zip` returns an iterator, as do `map`, `filter`, `enumerate`, `reversed` and an open file, and every one of them produces its values exactly once. This is the single most common iterator bug and it never announces itself: exhaustion is reported as emptiness rather than as an error, so the wrong answer travels on. When a result is needed twice, needs a length, or needs indexing, build a list from it. `pairs = list(zip(a, b))` is the whole fix.

~~~starter
def compare(left, right):
    """Return how many pairs there are, and which of them differ."""
    pairs = zip(left, right, strict=True)
    count = sum(1 for _ in pairs)
    differing = [(a, b) for a, b in pairs if a != b]
    return count, differing
~~~

~~~tests
assert compare([1, 2, 3], [1, 9, 3]) == (3, [(2, 9)])
assert compare([], []) == (0, [])
assert compare([1], [1]) == (1, [])
~~~

~~~solution
def compare(left, right):
    """Return how many pairs there are, and which of them differ."""
    pairs = list(zip(left, right, strict=True))
    count = len(pairs)
    differing = [(a, b) for a, b in pairs if a != b]
    return count, differing
~~~

## An iterator has no length

`describe` reports how many values a source has before walking it. `len` needs to know the size without consuming anything, and an iterator cannot answer.

@expect raises:TypeError
@hint An iterator does not know how many values are left, and finding out would consume them.
@hint If you need the count, you have to materialise, which also solves walking it twice.
@diagnose TypeError `len()` requires `__len__`, and an iterator deliberately has none: it has no idea how many values remain, and the only way to find out is to consume them, which would leave nothing for the caller. That is not an oversight but the whole design, and it is why `sum(1 for _ in it)` is how you count one, at the cost of exhausting it. When you need both the count and the values, build a list once and take the length of that. Note the two other operations missing for the same reason: an iterator supports no indexing and no `reversed`.

~~~starter
def describe(source):
    """Return the number of values and the values themselves."""
    return len(source), list(source)


print(describe(iter([1, 2, 3])))
~~~

~~~tests
assert describe(iter([1, 2, 3])) == (3, [1, 2, 3])
assert describe(iter([])) == (0, [])
assert describe([7, 8]) == (2, [7, 8])
~~~

~~~solution
def describe(source):
    """Return the number of values and the values themselves."""
    values = list(source)
    return len(values), values


print(describe(iter([1, 2, 3])))
~~~

## An iterator is always true

`has_any` checks whether a source contains anything by testing it in a boolean context. An iterator defines neither `__bool__` nor `__len__`, so unit 03's default applies.

@expect silent
@hint What does `if x:` do when the class defines neither `__bool__` nor `__len__`?
@hint There is a builtin that answers "is there at least one", and it stops after the first.
@diagnose silent It runs and reports every source as non-empty, including an exhausted one. `if x:` consults `__bool__`, falls back to `__len__`, and calls the object true when there is neither, which is exactly the case for an iterator. So the test tells you nothing about the contents at all. `any(source)` would answer for truthy values but not for a source of zeros; `next(source, _MISSING) is not _MISSING` answers precisely and consumes one value doing it. The general lesson from unit 03 is worth restating: an object with no `__bool__` and no `__len__` is truthy, and reaching for truthiness on an unfamiliar type is how you find that out the hard way.

~~~starter
_MISSING = object()


def has_any(source):
    """True if the source will produce at least one value."""
    return bool(source)
~~~

~~~tests
assert has_any(iter([1])) is True
assert has_any(iter([])) is False, "an exhausted iterator is still truthy"
assert has_any(iter([0])) is True, "a falsy value is still a value"
~~~

~~~solution
_MISSING = object()


def has_any(source):
    """True if the source will produce at least one value."""
    return next(source, _MISSING) is not _MISSING
~~~

## Checking membership consumed it

`route` looks for a marker in a stream and then processes what is there. The membership test walks the iterator to find the marker, so the processing starts from whatever was left.

@expect silent
@hint `x in it` walks the iterator until it matches. Ask what remains afterwards.
@hint Materialise once at the top, and both operations see the whole thing.
@diagnose silent Nothing raised, and the values before the marker had already been consumed by the check. `in` on an iterator is a linear walk that stops when it matches, and everything it passed is gone. This is the same exhaustion problem as reusing a `zip`, wearing a shape that does not look like iteration at all, which is what makes it hard to spot: a membership test reads like a question, not like a traversal. Anything that inspects an iterator consumes it, including `len` attempts, `sum`, `max`, and the logging you add while investigating. Build a list at the top when more than one thing needs to look.

~~~starter
def route(stream, marker):
    """Return the values, and whether the marker was among them."""
    found = marker in stream
    return list(stream), found
~~~

~~~tests
values, found = route(iter(["a", "flag", "b"]), "flag")
assert found is True
assert values == ["a", "flag", "b"], f"the check consumed part of the stream: {values}"
assert route(iter(["x"]), "flag") == (["x"], False)
~~~

~~~solution
def route(stream, marker):
    """Return the values, and whether the marker was among them."""
    values = list(stream)
    return values, marker in values
~~~

## Reading until it says stop

`chunks` reads fixed-size pieces from a source until it returns the empty marker. The loop reads once before the check and once inside it, so every other chunk is thrown away.

@expect raises:StopIteration
@hint Count how many times `read` is called per chunk kept.
@hint `iter(callable, sentinel)` calls until the result equals the sentinel, and yields each one.
@diagnose StopIteration Reading once to test and once to keep calls the source twice per iteration, so half the data is discarded and the source runs dry before the sentinel is ever seen. A source that produces values on demand has no way to give one back, which is what makes the double read destructive rather than merely wasteful. Unit 05 met this with the walrus operator, which is one fix. The other is the two-argument form of `iter`, which exists for exactly this shape: `iter(callable, sentinel)` calls the callable repeatedly and stops when the result equals the sentinel, turning any "call until it says stop" API into something a `for` loop can walk. It is the tidy answer for reading fixed-size chunks, draining a queue, or polling until a value changes.

~~~starter
def chunks(read):
    """Collect every chunk from `read()` until it returns an empty string."""
    out = []
    while read() != "":
        out.append(read())
    return out
~~~

~~~tests
pieces = iter(["ab", "cd", "ef", ""])
assert chunks(lambda: next(pieces)) == ["ab", "cd", "ef"], "every other chunk was dropped"
empty = iter([""])
assert chunks(lambda: next(empty)) == []
~~~

~~~solution
def chunks(read):
    """Collect every chunk from `read()` until it returns an empty string."""
    return list(iter(read, ""))
~~~
