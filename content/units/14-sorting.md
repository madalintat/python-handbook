---
slug: 14-sorting
title: Sorting and ordering
---

Python has one sorting algorithm and two ways to reach it. `sorted(x)` returns a new list; `x.sort()` reorders a list in place and returns `None`. Everything else about sorting is the `key` argument, which is where the power is and where the mistakes are.

## The two calls, and choosing between them

```python
ordered = sorted(rows)      # a new list, rows untouched
rows.sort()                 # rows reordered, returns None
```

`sorted` accepts any iterable and always gives back a list, so `sorted(some_dict)` sorts the keys and `sorted(generator)` works and consumes it. `list.sort` exists only on lists and is slightly cheaper, because it does not build a second one.

Which to use is unit 02's question. If the caller handed you the list, sorting it in place changes their data, and a function that both sorts and returns invites the reader to think it did not. Default to `sorted` and reach for `.sort()` when the list is yours and large enough for the copy to matter.

The `None` return is deliberate and worth restating: it is what makes `rows.sort()[0]` fail immediately rather than quietly, and it is the same convention as `reverse`, `append` and `update`.

## Keys that are not attributes

The key does not have to read a field. It can compute anything, and the useful ones often do:

```python
sorted(files, key=lambda f: f.stat().st_size)     # by size
sorted(words, key=str.lower)                      # case-insensitive
sorted(words, key=str.casefold)                   # better for non-English
sorted(paths, key=lambda p: p.suffix)             # by extension
sorted(items, key=str)                            # by their printed form
```

`key=str.lower` is worth looking at twice: it passes the unbound method, so each element becomes `str.lower(element)`. That works for any string and is faster than a lambda.

Two patterns come up often enough to name. **Sorting by a fixed order that is not alphabetical** is a lookup in a list of the order you want:

```python
ORDER = ["critical", "warning", "info"]
sorted(logs, key=lambda log: ORDER.index(log.level))
```

And **sorting with unknowns last** is a tuple whose first element is a flag, since `False` sorts before `True`:

```python
sorted(rows, key=lambda r: (r.date is None, r.date))
```

That second one also avoids the error you would otherwise get, because the comparison never reaches the `None` when the flags differ.

## `key`, not `cmp`

`sorted` takes a function and calls it **once per element**, then sorts by the results:

```python
sorted(words, key=len)
sorted(people, key=lambda p: p.surname)
sorted(rows, key=lambda r: (r.dept, -r.salary))
```

The key function receives one element and returns something comparable. It is called once per element rather than once per comparison, so an expensive key is computed n times and not n log n times, which is why this design replaced the pairwise comparison function Python 2 had.

If you find yourself wanting the old form, `functools.cmp_to_key` wraps a two-argument comparison into a key. It exists for porting and for genuinely relational orderings, and reaching for it usually means the ordering can be expressed as a key if you think about it a little longer.

## Tuples sort elementwise

The single most useful fact here. Comparing tuples compares the first elements; if those are equal it compares the second, and so on. Which means a multi-level sort is a tuple key and needs nothing else:

```python
sorted(rows, key=lambda r: (r.dept, r.name))
```

Reversing one level and not another is the part people fight. For numbers, negate:

```python
key=lambda r: (r.dept, -r.score)      # dept ascending, score descending
```

For anything you cannot negate, sort twice, least significant first, because the sort is stable:

```python
rows.sort(key=lambda r: r.name)
rows.sort(key=lambda r: r.dept, reverse=True)
```

## Stability is a guarantee

Python's sort is **stable**: elements that compare equal keep the order they were in. This is documented behaviour, not an accident, and two things depend on it.

Sorting repeatedly, as above, works only because of stability. And a sort by one field leaves any previous ordering intact within each group, which is why sorting a table by column after column gives what a user expects.

The underlying algorithm is Timsort, which finds runs already in order and merges them. Its consequence for you is that nearly-sorted data sorts nearly linearly, so re-sorting a list after adding a few items is much cheaper than the general case.

## `reverse`, and what it does not do

`reverse=True` sorts descending, and it preserves stability rather than reversing ties, which is the difference between it and sorting ascending then reversing the whole list:

```python
sorted(rows, key=f, reverse=True)     # ties keep their original order
list(reversed(sorted(rows, key=f)))   # ties come out backwards
```

For a stable multi-level sort that is the reason to prefer `reverse=True` over reversing afterwards.

## What can be compared at all

`sorted` needs `<` between elements, which unit 04 covered: `__lt__`, not `__eq__`. A class with equality but no ordering cannot be sorted, and a heterogeneous list raises on the first pair it cannot order.

`functools.total_ordering` fills in the other comparisons from `__eq__` and `__lt__`. A dataclass with `order=True` generates all of them from the field order, which is the tidiest answer when the natural ordering is the field order.

For sorting objects by an attribute, `operator.attrgetter` and `operator.itemgetter` are faster than a lambda and say what they mean:

```python
from operator import itemgetter
sorted(rows, key=itemgetter(1))
sorted(rows, key=itemgetter("dept", "name"))
```

## What sorting costs

A comparison sort cannot beat n log n in general, and Timsort does not try to. What it does is exploit the order already present.

It scans for runs that are already ascending or descending, extends short ones with an insertion sort, and merges the runs. On data that is already sorted it makes one pass and stops, which is linear. On data that is reversed it finds one long descending run, flips it, and is also linear. On random data it is n log n like any other good sort.

Two practical consequences. Re-sorting a list you have added a few items to is much cheaper than sorting from scratch, so there is rarely a reason to be clever about maintaining order manually unless the list is large and the reads dominate. And a benchmark of sorting that uses already-sorted or reversed input measures the best case rather than the typical one.

Memory is the other half: Timsort is not in place. It allocates temporary space proportional to the input, so sorting a very large list has a memory cost as well as a time one, which is one of the arguments for `heapq` when you only want the top few.

## Sorting text

Sorting strings compares code points, which is not alphabetical order in any language including English:

```python
sorted(["banana", "Apple", "cherry"])     # ['Apple', 'banana', 'cherry']
```

Every capital letter sorts before every lowercase one, because that is where they sit in the table. `key=str.lower` fixes the common case and `key=str.casefold` handles more of the awkward ones.

Beyond that, correct alphabetical order is language-dependent and genuinely hard: it depends on the locale, on whether accented letters sort with their base letter or after it, and on rules that differ between countries using the same alphabet. The standard library's `locale.strxfrm` can help and is awkward; a library is the honest answer when it matters.

The related case is numbers inside strings. `sorted(["file10", "file2"])` puts `file10` first, because `1` precedes `2` as text. What people want there is a key that splits the digits out and compares them as numbers, which is worth writing once as a small function rather than reaching for a library.

## Two mistakes worth naming

**Calling the key function.** `key=len` passes the function; `key=len(x)` calls it and passes the result, which is a `TypeError` about an integer not being callable, one step removed from the line that is wrong. The rule is that `key` wants a function, so its value should be a name, a lambda, or an `itemgetter`, and never a call with arguments already applied.

**Sorting by something that is not stable across runs.** Sorting by `hash` or by `id` gives an order that changes between processes, because string hashing is randomised per process and addresses are whatever the allocator produced. Test suites that depend on such an order pass locally and fail in CI, and the fix is to sort by something the data actually contains.

A third, gentler one: sorting to deduplicate. `sorted(set(items))` is fine, but if you only wanted unique values then the sort is doing work you did not ask for, and if you wanted first-seen order it has destroyed it.

## Sorting is not always the answer

Three cases where a full sort is more work than the question needs.

**The largest few.** `heapq.nlargest(3, items, key=f)` keeps a heap of three and walks once, which beats sorting everything when the number wanted is small. `min` and `max` take the same `key` argument and are the right tools for one.

**A running minimum.** `heapq` gives you a priority queue: `heappush` and `heappop` are logarithmic, and `heap[0]` is the smallest without removing it. It is the structure for a scheduler, a merge of sorted streams, or Dijkstra.

**Insertion into a sorted list.** `bisect` finds the position with a binary search, and `insort` inserts there. Keeping a list sorted as it grows costs a search per insert rather than a sort per query, which is the right trade when reads outnumber writes.

## What to carry forward

`sorted` returns and `sort` mutates. `key` is called once per element and receives one element. Tuples compare elementwise, so a tuple key is a multi-level sort, and a negated number is a reversed level. The sort is stable, which is what makes sorting twice work and what `reverse=True` preserves. Ordering needs `__lt__`, which `total_ordering` and `dataclass(order=True)` can supply. And when you want the top three, or the smallest so far, or an ordered list you keep adding to, `heapq` and `bisect` do less work than a sort.
