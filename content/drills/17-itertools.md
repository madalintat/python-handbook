---
slug: 17-itertools
---

## `groupby` groups
- ( ) All equal values, wherever they appear
- (x) Consecutive runs of equal keys
- ( ) The input after sorting it
- ( ) Values by their hash
> Which is why the input must already be ordered by the same key, and why a mismatched key produces a result that looks almost right.

## The group `groupby` yields is
- ( ) A list
- (x) An iterator sharing the source, consumed when you advance to the next group
- ( ) A tuple
- ( ) A copy
> So `list(groupby(...))` gives you keys and a set of exhausted iterators. Convert each group as you go.

## When the input cannot be sorted, grouping is better done with
- ( ) `groupby` anyway
- (x) A `defaultdict(list)`, in one pass with no ordering requirement
- ( ) `sorted` with a key
- ( ) `Counter`
> And the groups come back as real lists you can keep.

## `takewhile` differs from `filter` in that
- (x) It stops at the first failure instead of checking every element
- ( ) It is eager
- ( ) It returns a list
- ( ) It takes a key rather than a predicate
> Which is what lets it work on an unbounded source. `dropwhile` skips that same leading run.

## `islice(source, 3)` versus `list(source)[:3]`
- ( ) Identical
- (x) `islice` reads three values; the slice reads all of them first
- ( ) `islice` returns a list
- ( ) The slice is lazy
> And on an unbounded source the slice never returns at all.

## `chain.from_iterable(batches)` is the lazy version of
- (x) `[item for batch in batches for item in batch]`
- ( ) `zip(*batches)`
- ( ) `sorted(batches)`
- ( ) `batches[0] + batches[1]`
> It holds one item at a time and reads each batch only when it reaches it.

## `pairwise([1, 4, 9])` yields
- (x) `(1, 4)` then `(4, 9)`
- ( ) `(1, 4)` then `(9, None)`
- ( ) `(1, 9)`
- ( ) `[1, 4, 9]`
> Overlapping neighbours, from any iterable, in one pass. The old `zip(x, x[1:])` needs a sequence.

## `tee(it, 2)` costs
- ( ) Nothing
- (x) Memory proportional to how far apart the two consumers are
- ( ) A full copy immediately
- ( ) One extra pass over the source
> So `tee` with one fast and one slow consumer is a memory leak with a friendly name.

## `map(lambda x: x * 2, xs)` compared with the comprehension is
- ( ) Faster and shorter
- (x) Longer and slower; `map` earns its place with a named function
- ( ) Identical in every way
- ( ) Lazy where the comprehension is not
> `map(int, fields)` is the good case. Both return iterators either way.

## `filter(None, values)` does what?
- ( ) Raises, because `None` is not callable
- (x) Drops the falsy values
- ( ) Keeps only the `None`s
- ( ) Returns everything
> The one `filter` idiom that is genuinely shorter than the comprehension.

## `@cache` requires its arguments to be
- (x) Hashable, because they become a dict key
- ( ) Immutable strings
- ( ) Positional
- ( ) Annotated
> A tuple and a list of the same values are different keys, so the conversion has to be consistent.

## `@cache` on a method
- ( ) Caches per instance
- (x) Keeps every `self` ever passed alive for the life of the process
- ( ) Raises
- ( ) Is cleared when the instance is collected
> A memory leak that looks like a speedup. Cache a plain function that takes the values it needs.

## `@cache` versus `@lru_cache(maxsize=n)`
- (x) `cache` is unbounded; `lru_cache` keeps the n most recent
- ( ) `cache` is faster but not thread safe
- ( ) They are identical
- ( ) `lru_cache` is deprecated
> Bounded is the safer default for anything driven by external input.

## Most uses of `functools.reduce` are
- ( ) The only way to express the operation
- (x) `sum`, `min`, `max`, `any`, `all` or `math.prod` in disguise
- ( ) Faster than the equivalent loop
- ( ) Required for immutability
> Which is why it moved out of builtins in Python 3. Keep it for genuinely unusual operations.

## `functools.singledispatch` replaces
- ( ) A `match` statement
- (x) A tower of `isinstance` checks, and lets other modules register cases
- ( ) A class hierarchy
- ( ) A dict of handlers
> Dispatch is on the type of the first argument, and it is extensible without editing the original.
