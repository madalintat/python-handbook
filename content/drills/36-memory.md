---
slug: 36-memory
---

## An object whose reference count reaches zero is
- (x) Freed immediately
- ( ) Freed at the next collection
- ( ) Marked for collection
- ( ) Freed when memory runs low
> Which is why a file whose last reference disappears is closed promptly.

## `sys.getrefcount(obj)` reads one higher than expected because
- (x) Passing the object to the function is itself a reference
- ( ) It counts the object itself
- ( ) It counts weak references too
- ( ) It rounds up
> Every reference counts, including the temporary ones you did not name.

## Two objects that reference each other
- (x) Cannot be freed by reference counting, and wait for the cycle collector
- ( ) Are freed normally
- ( ) Leak permanently
- ( ) Are refused at creation
> So the memory sits held until the collector happens to run.

## `__del__` is a poor place for cleanup because
- (x) You cannot say when it runs, and any exception in it is swallowed
- ( ) It is never called
- ( ) It prevents collection
- ( ) It is deprecated
> Use `with` and a `close` method.

## `sys.getsizeof(a_list)` reports
- (x) The list's own size, the pointers, and not what they point at
- ( ) The whole graph
- ( ) The number of elements
- ( ) The allocated arena
> A list of a million small integers is around forty megabytes, not eight.

## `b = a` where `a` is a large list costs
- (x) One pointer; assignment never copies
- ( ) A copy of the list
- ( ) A copy of everything in it
- ( ) Nothing, because lists are shared
> `a[:]` copies the container; `deepcopy(a)` copies everything reachable.

## `a[:]` on a list of dicts gives you
- (x) A new list holding the very same dicts
- ( ) A new list holding copies of the dicts
- ( ) The same list
- ( ) A read-only view
> Isolation from changes to the list, not from changes to the rows.

## Small integers from -5 to 256
- (x) Are created once at startup and shared, which is why `is` sometimes appears to work
- ( ) Are compared by value by `is`
- ( ) Are interned only in the REPL
- ( ) Are not objects
> Compare with `==`, and keep `is` for `None`, `True` and `False`.

## The commonest memory leak in Python is
- (x) A module-level container that only grows
- ( ) A reference cycle
- ( ) A missing `__del__`
- ( ) An unclosed file
> It does not look like a leak. It looks like a cache, which is a thing you were supposed to add.

## `functools.cache` against `lru_cache(maxsize=128)`
- (x) `cache` has no bound at all, which is a leak for anything driven by user input
- ( ) They are the same
- ( ) `cache` evicts by age
- ( ) `lru_cache` is deprecated
> Choosing between them is choosing whether the set of keys is bounded by something other than time.

## `weakref.WeakSet` differs from a list in that
- (x) It does not keep its members alive, and entries disappear when they are collected
- ( ) It is faster
- ( ) It deduplicates
- ( ) It is thread-safe
> `int`, `str`, `tuple` and `list` cannot be referenced weakly, and `__slots__` needs `__weakref__` in the list.

## The single biggest memory win for a class you make a great many of is
- (x) `__slots__`, which removes the per-instance dict
- ( ) `frozen=True`
- ( ) A metaclass
- ( ) Caching instances
> Typically halves it, and turns an undeclared attribute into an immediate error.

## A process that peaks at two gigabytes and frees everything usually
- (x) Still shows two gigabytes, because arenas are returned only when entirely free
- ( ) Returns to its starting size
- ( ) Has a leak
- ( ) Has fragmented the heap beyond use
> Resident memory measures the high-water mark. `tracemalloc` measures what Python holds.

## To find a leak, the method that works is
- (x) Snapshot, do a unit of work, snapshot again, compare
- ( ) Take one snapshot and read the largest entries
- ( ) Call `gc.collect()` and watch resident memory
- ( ) Count objects by type
> Anything that grows every time round is the leak, and `compare_to` names its allocation site.

## For a long-running server, the property to check is
- (x) Whether memory is flat after warm-up, not what the number is
- ( ) That it stays under a threshold
- ( ) That `gc.collect()` reclaims memory
- ( ) That there are no cycles
> A slow steady climb over a day is a leak whatever the number is.
