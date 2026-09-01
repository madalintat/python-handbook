---
slug: 15-iterators
---

## An iterable is something that
- (x) Can give you an iterator, via `__iter__`
- ( ) Produces values with `__next__`
- ( ) Has a length
- ( ) Can be indexed
> An iterator is the thing with `__next__`. It also has `__iter__`, which returns itself.

## Is a list an iterator?
- ( ) Yes
- (x) No; it is an iterable, and each walk asks for a fresh iterator
- ( ) Only when it is non-empty
- ( ) Only inside a `for` loop
> Which is why a list can be walked as many times as you like.

## `for item in things` begins by calling
- (x) `iter(things)`
- ( ) `things[0]`
- ( ) `len(things)`
- ( ) `next(things)`
> Then `next` repeatedly until `StopIteration`, which the loop catches.

## `list(it)` twice on the same iterator gives
- ( ) The same values both times
- (x) The values, then an empty list
- ( ) A RuntimeError on the second call
- ( ) The values twice over
> Exhaustion is reported as emptiness rather than as an error, which is why the bug travels rather than raising.

## Which of these returns an iterator?
- ( ) `range(10)`
- ( ) `d.items()`
- (x) `zip(a, b)`
- ( ) `sorted(x)`
> `map`, `filter`, `enumerate`, `reversed` and an open file are iterators too. `range` is a lazy sequence and views are reusable.

## `__iter__` returning `self` makes the object
- (x) An iterator, so it has one pass in it
- ( ) A reusable iterable
- ( ) A sequence
- ( ) A generator
> Returning a fresh iterator each time is what makes something walkable more than once.

## `len()` on an iterator
- ( ) Returns the number of values left
- (x) Raises TypeError
- ( ) Returns 0
- ( ) Consumes it and returns the count
> An iterator does not know how many remain, and finding out would consume them.

## `if some_iterator:` tells you
- ( ) Whether it has values left
- (x) Nothing; it is always true
- ( ) Whether it is exhausted
- ( ) Whether its first value is truthy
> It defines neither `__bool__` nor `__len__`, so unit 03's default applies.

## `x in some_iterator`
- ( ) Is a cheap check
- (x) Walks it until it matches, consuming everything it passed
- ( ) Raises TypeError
- ( ) Restarts it afterwards
> Which makes a membership test followed by a loop see only the remainder.

## `next(it)` on an exhausted iterator
- ( ) Returns `None`
- (x) Raises StopIteration
- ( ) Returns an empty value
- ( ) Restarts the iterator
> `next(it, default)` returns the default instead, which is right when running out is a normal case.

## `iter(callable, sentinel)` does what?
- (x) Calls the callable repeatedly, stopping when the result equals the sentinel
- ( ) Iterates the callable's arguments
- ( ) Applies the callable to each item
- ( ) Raises; `iter` takes one argument
> It turns any "call until it says stop" API into something a `for` loop can walk.

## A class with `__getitem__` taking 0, 1, 2... and no `__iter__`
- ( ) Cannot be iterated
- (x) Is iterable through the old protocol, stopping at IndexError
- ( ) Raises TypeError
- ( ) Is iterated in reverse
> Which is why `isinstance(x, Iterable)` can say False for something a `for` loop handles perfectly well.

## `iter(x) is x` is true for
- (x) An iterator
- ( ) Any iterable
- ( ) A list
- ( ) A range
> Which makes it the fastest way to settle whether the thing you are holding has one pass in it.

## A function that takes an iterable and walks it twice
- ( ) Works for anything iterable
- (x) Works for a list and silently misbehaves for a generator
- ( ) Raises for a generator
- ( ) Is always wrong
> Either walk once, or materialise at the top with `items = list(items)` and say so.

## The main thing laziness buys is
- ( ) Speed
- (x) Unbounded sources, bounded memory, and work that is never done
- ( ) Thread safety
- ( ) Shorter code
> And one `sorted()` or list comprehension in the middle of a chain forces everything through it, which loses all of it.
