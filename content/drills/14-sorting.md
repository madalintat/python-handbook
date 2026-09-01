---
slug: 14-sorting
---

## `sorted(x)` and `x.sort()` differ in that
- (x) `sorted` returns a new list; `sort` reorders in place and returns `None`
- ( ) `sorted` is stable and `sort` is not
- ( ) `sort` accepts any iterable
- ( ) They are the same
> `sorted` takes any iterable and always gives a list. `sort` exists only on lists.

## The `key` function is called
- ( ) Once per comparison
- (x) Once per element
- ( ) Once in total
- ( ) Only when two elements are equal
> Which is why an expensive key costs n rather than n log n, and why this replaced Python 2's comparison function.

## `key=len(words)` instead of `key=len` gives
- ( ) The same result
- (x) A TypeError, because an integer is not callable
- ( ) A sort by the list's length
- ( ) A SyntaxError
> `key` wants a function, so its value should be a name, a lambda, or an `itemgetter`, never a call with arguments applied.

## `sorted(rows, key=lambda r: (r.dept, r.name))` sorts by
- (x) Department, then name within each department
- ( ) Name, then department
- ( ) The tuple's length
- ( ) Nothing; tuples are not comparable
> Tuples compare elementwise, which makes a tuple key the whole of multi-level sorting.

## To sort by one field ascending and another descending, for numbers
- (x) Negate the descending one inside the tuple key
- ( ) Pass `reverse=True`
- ( ) Sort twice with `reverse=True` on the second
- ( ) It cannot be done in one sort
> `reverse=True` reverses the whole ordering, not one level of it.

## Python's sort being stable means
- (x) Elements that compare equal keep the order they were already in
- ( ) The order is the same on every platform
- ( ) It never raises
- ( ) Equal elements are removed
> Which is what makes sorting twice work, and it is documented behaviour rather than an accident.

## To sort by two fields where one cannot be negated, sort twice
- ( ) Most significant field first
- (x) Least significant field first
- ( ) In either order
- ( ) It cannot be done
> The later sort's groups preserve the earlier sort's order, because the sort is stable.

## `sorted(x, reverse=True)` versus `reversed(sorted(x))`
- ( ) Identical
- (x) `reverse=True` keeps ties in their original order; reversing afterwards flips them
- ( ) `reversed` is faster
- ( ) `reverse=True` is unstable
> Which is the reason to prefer `reverse=True` in a multi-level sort.

## Sorting needs which method?
- ( ) `__eq__`
- (x) `__lt__`
- ( ) `__cmp__`
- ( ) `__hash__`
> `functools.total_ordering` fills in the rest from `__eq__` and `__lt__`; a dataclass with `order=True` generates all of them.

## `sorted(["banana", "Apple"])` gives
- (x) `["Apple", "banana"]`, because capitals sort before lowercase
- ( ) `["banana", "Apple"]`
- ( ) A TypeError
- ( ) Locale-dependent output
> String comparison is by code point. `key=str.lower` fixes the common case and `str.casefold` handles more.

## Sorting records where some dates are `None`
- ( ) Works; `None` sorts first
- (x) Raises TypeError, because there is no ordering between `None` and a date
- ( ) Silently drops them
- ( ) Sorts them last
> The idiom is a tuple key beginning with a flag: `(r.date is None, r.date)`, since `False` sorts before `True`.

## To get the three largest of a million items
- ( ) `sorted(items)[-3:]`
- (x) `heapq.nlargest(3, items)`
- ( ) `max(items)` three times
- ( ) `items.sort()` then slice
> Sorting everything is n log n work for a question that needs one pass and a heap of three.

## `bisect.insort` is for
- ( ) Sorting faster
- (x) Inserting into an already-sorted list at the right position
- ( ) Splitting a list in two
- ( ) Binary comparison of two lists
> A search per insert rather than a sort per query, which is the right trade when reads outnumber writes.

## Timsort on already-sorted input is
- ( ) n log n, like any other input
- (x) Roughly linear, because it finds the existing run
- ( ) Slower, because of the run detection
- ( ) Undefined
> Which is why re-sorting a list you have added a few items to is much cheaper than sorting from scratch.

## Sorting by `hash(x)` produces an order that
- ( ) Is stable across runs
- (x) Changes between processes, because string hashing is randomised
- ( ) Is the same as sorting by value
- ( ) Raises
> Tests that depend on it pass locally and fail in CI. Sort by something the data actually contains.
