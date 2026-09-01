---
slug: 15-iterators
title: The iterator protocol
---

Almost everything in Python that walks over something walks over an **iterator**, and once you can see the protocol you can see why `for` works on files and database cursors, why a generator can only be used once, and why `zip` gives you nothing the second time you look at it.

## Two different things with similar names

An **iterable** is something you can get an iterator from. It has `__iter__`.

An **iterator** is something that produces values one at a time. It has `__next__`, and it also has `__iter__`, which returns itself.

A list is an iterable and not an iterator: it has no `__next__`, and you can walk it as many times as you like because each walk asks for a fresh iterator.

```python
items = [1, 2, 3]
it = iter(items)      # a list_iterator
next(it)              # 1
next(it)              # 2
```

`iter(x)` calls `x.__iter__()` and `next(it)` calls `it.__next__()`. When there is nothing left, `__next__` raises `StopIteration`, which is a signal rather than an error.

## The fallback nobody mentions

There is a second, older way to be iterable, and it explains some code you will meet.

If a class has no `__iter__` but does have `__getitem__` accepting integers from zero upward, `iter()` builds an iterator that calls it with 0, 1, 2, and so on until it raises `IndexError`.

```python
class Alphabet:
    def __getitem__(self, i):
        if i > 25:
            raise IndexError
        return chr(ord("a") + i)

list(Alphabet())      # ['a', 'b', ..., 'z']
```

No `__iter__` anywhere, and it iterates. This is the protocol from before `__iter__` existed, kept for compatibility, and it is why some old classes are iterable in a way that looks like magic.

Two things it explains. A class that implements `__getitem__` for a *mapping*, taking string keys, is accidentally iterable in a way that fails confusingly: `iter()` will call it with `0` and get a `KeyError` rather than an `IndexError`, so the loop raises instead of stopping. And it is why `isinstance(x, Iterable)` can say `False` for something a `for` loop handles perfectly well, since that check looks for `__iter__` and nothing else.

Prefer `__iter__` in anything you write. The fallback is worth recognising, not worth using.

## Iterators in the standard library

Knowing which functions return an iterator rather than a list is most of what stops the exhaustion bug, and Python 3 moved nearly all of them.

`zip`, `map`, `filter`, `enumerate` and `reversed` all return iterators. So does `open`, which is why `for line in f` works and why a second loop over the same open file yields nothing. `dict.keys()`, `.values()` and `.items()` are views rather than iterators, which is a third thing: they are reusable, they reflect changes, and they have a length.

`range` is neither: it is a lazy **sequence**, so it has a length, supports indexing, and can be walked any number of times.

The distinction matters most in a function signature. A function that takes an iterable and walks it twice works for a list and silently misbehaves for a generator, and the caller has no way to know. Either walk once, or materialise at the top with `items = list(items)` and say so.

## What `for` actually does

```python
for item in things:
    body
```

is close to

```python
it = iter(things)
while True:
    try:
        item = next(it)
    except StopIteration:
        break
    body
```

Everything follows from that. `for` works on anything with `__iter__`, which is why files, dicts, generators and your own classes all work in one. There is no index anywhere. And `StopIteration` is caught by the loop, which is why you never see it and why an accidental one inside a generator is such a confusing bug.

## Exhaustion is the thing to internalise

An iterator produces its values once and keeps no history. After the last one it raises `StopIteration` forever.

```python
it = iter([1, 2])
list(it)      # [1, 2]
list(it)      # []  — not an error, just nothing left
```

That second result is the shape of nearly every bug in this unit. It is not an exception, it is an empty answer, so it flows onward and fails somewhere else or silently reports zero.

Anything that returns an iterator has this property, and the list is longer than people expect: generators, `zip`, `map`, `filter`, `enumerate`, `reversed`, `open` file objects, and most of `itertools`. Building a list from one is how you make it reusable, and it is the right move whenever you need the values twice, need their length, or need to index them.

## Writing one

The minimum is a class with `__iter__` and `__next__`:

```python
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
```

This is an iterator, and returning `self` from `__iter__` is what makes it one. It is also single-use, because the state lives on the object, and a second `for` over the same instance starts from wherever the first one stopped.

If you want something that can be walked many times, separate the two roles: the **iterable** holds the data and returns a **fresh iterator** each time.

```python
class Deck:
    def __init__(self, cards):
        self.cards = list(cards)

    def __iter__(self):
        return iter(self.cards)      # a new iterator every call
```

That is the usual shape, and it is why a list behaves the way it does. Deciding which of the two you are writing is the main design question in this unit, and getting it wrong produces a collection that mysteriously empties after one use.

Unit 16 shows the far shorter way to write both.

## The other `iter`

`iter` takes an optional second argument, and the two-argument form is worth knowing because nothing else in the language does this:

```python
for chunk in iter(lambda: f.read(8192), b""):
    handle(chunk)
```

Given a callable and a sentinel, it calls the callable repeatedly and stops when the result equals the sentinel. It turns any "call until it says stop" API into something you can `for` over, and it is the tidy answer for reading fixed-size chunks, polling a queue, or draining a socket.

## What an iterator does not have

An iterator is deliberately minimal, and the operations it lacks are the ones people reach for.

`len()` fails, because an iterator does not know how many values are left and finding out would consume them. `x[0]` fails, because there is no indexing. `reversed()` fails, for the same reason. And truthiness is the quiet one: an iterator has neither `__bool__` nor `__len__`, so it is **always true**, including when it is exhausted. `if it:` therefore tells you nothing at all, which unit 03's default made inevitable.

Membership does work, and it costs: `x in it` walks the iterator until it finds `x`, consuming everything it passes. Testing membership and then iterating gives you the remainder rather than the whole.

## Why laziness is the point

Producing values on demand rather than all at once is not a micro-optimisation. It changes what is possible.

An iterator can be **infinite**. `itertools.count()` produces integers forever, and that is a useful thing because whatever consumes it decides when to stop. A list cannot do this at all.

An iterator can be **larger than memory**. Reading a ten gigabyte file line by line works on a laptop; `f.readlines()` does not. The whole shape of a pipeline that filters and transforms a stream depends on nothing ever holding all of it.

An iterator can be **slow at the source**. Rows arriving from a database, responses from a network, events from a queue: the consumer sees a normal `for` loop while each value is produced when it is asked for.

And a chain of them does **only the work that is used**. Filtering a million rows and taking the first ten touches only as many as it needed to find ten, provided nothing in the chain built a list along the way. That last clause is where the benefit is usually lost: one `sorted()` or one list comprehension in the middle forces everything through it, and the laziness downstream buys nothing.

That is the trade to keep in mind. Laziness costs you length, indexing, repeat use and easy debugging; it buys you unbounded sources, bounded memory and work that is never done. Choosing per situation rather than by habit is the whole skill, and unit 16 gives you the tool for writing your own.

## Debugging an exhausted iterator

The symptom is always the same: something that worked when you tested it by hand returns nothing, or zero, or an empty list, and no exception is raised anywhere.

Three questions find it quickly.

**Did anything walk this before me?** A `len()`, a `sum()`, a membership test, a print, or a debugger stepping over a line. Anything that consumed it counts, including the logging you added to investigate, which is a genuinely confusing way to lose an afternoon.

**Is this thing an iterator at all?** `iter(x) is x` answers it: true for an iterator, false for a reusable iterable. That one line settles more of these than any amount of reading.

**Do I need it twice?** If so, `items = list(items)` at the top of the function, once, and stop worrying. The memory cost is real and is almost never the thing that matters.

`itertools.tee` exists for the case where you genuinely want two independent walks of one iterator without materialising it, and it works by buffering whatever the slower consumer has not reached yet, so it saves nothing when the two are consumed at different rates.

## What to carry forward

An iterable gives you an iterator; an iterator gives you values and is itself iterable. `for` calls `iter` then `next` until `StopIteration`. Iterators are exhausted after one pass and report emptiness rather than raising, which is why the bug is usually a silently short answer. `__iter__` returning `self` makes a single-use iterator; returning a fresh one makes a reusable iterable. `iter(callable, sentinel)` turns a call-until-done API into a loop. And an iterator has no length, no indexing and no usable truthiness.
