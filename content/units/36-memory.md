---
slug: 36-memory
title: Memory and the runtime
---

Unit 02 said that a name is a label on an object and that two names can label the same one. This unit is what happens underneath: how objects are kept alive, when they go away, and the small number of ways a Python program uses far more memory than you expected.

## Reference counting

Every object carries a count of how many references point at it. Bind a name, put it in a list, pass it to a function, and the count goes up; the name goes out of scope, the list is discarded, the function returns, and it comes down. At zero, the object is freed immediately.

That immediacy is the property worth knowing. In Python, an object with no references is gone **now**, not at some later collection, which is why a file whose last reference disappears is closed promptly and why `with` is a guarantee rather than an optimisation.

`sys.getrefcount(obj)` reports the count, and always reads one higher than you expect, because passing the object to the function is itself a reference. That off-by-one is not a quirk to remember so much as a demonstration of the rule: every reference counts, including the temporary ones you did not name.

## The cycle collector

Reference counting alone cannot free a cycle. Two objects that refer to each other keep each other's count above zero forever, even when nothing outside can reach them:

```python
a = {}
b = {"other": a}
a["other"] = b
del a, b            # unreachable, and both counts are still 1
```

So CPython has a second mechanism: a generational garbage collector that periodically looks for groups of objects that reference only each other and frees them. `gc.collect()` runs it by hand, and `gc.get_count()` shows how close each generation is to a run.

Two consequences. Cycles are collected **eventually** rather than promptly, so an object in a cycle holds whatever it holds until then. And `__del__` on an object in a cycle used to prevent collection entirely; that has not been true since 3.4, but `__del__` remains a poor place for cleanup, because you cannot say when it runs and any exception in it is swallowed. Use `with` and a `close` method.

## Where the memory actually goes

Python objects are much larger than their contents suggest, and this is usually the surprise.

An `int` is 28 bytes. A one-character `str` is 50. An empty `dict` is 64, an empty `list` 56, and each holds pointers to objects that are themselves 28 bytes and up. A list of a million small integers is not four megabytes; it is around forty.

`sys.getsizeof(obj)` reports the object's own size and **not** what it refers to, so a list of a million items reports about eight megabytes, which is the pointers alone. Measuring the whole graph means walking it, which `tracemalloc` does properly.

Three fixes, in order of how often they apply.

**`__slots__`**, from unit 19, removes the per-instance dict and is the single biggest win for a class you make a great many of, often halving it.

**Generators**, from unit 16, avoid holding the whole sequence at once. Reading a file line by line uses the memory of one line; `f.readlines()` uses the memory of the file.

**`array`, `numpy` or `bytes`** store values rather than pointers to objects, which for numbers is roughly an order of magnitude.

## What a variable costs, and what it does not

A useful correction to an intuition most people carry in from other languages: assignment in Python never copies.

```python
a = list(range(1_000_000))
b = a                    # costs one pointer
c = a[:]                 # copies the list: a million pointers, same objects
d = copy.deepcopy(a)     # copies the list and everything in it
```

`b = a` is free whatever `a` is. `c = a[:]` allocates a new list of the same length, holding the same objects, so it is a **shallow** copy: cheap relative to the contents, and not an isolation from mutation of the elements. `deepcopy` walks the whole graph, is the expensive one, and is the only one that gives you genuine independence, which unit 02 covered from the correctness side.

The same distinction explains a common surprise about function calls. Passing a large object to a function costs nothing; it is one reference. What costs is anything inside that builds a new structure, which is why `sorted(rows)` is a copy and `rows.sort()` is not, and why a comprehension over a large sequence has the memory of the result.

## Memory is not returned to the operating system

A process that peaks at two gigabytes and then frees everything usually still shows two gigabytes to the operating system. This alarms people and is normal.

CPython allocates small objects out of arenas it manages itself, and an arena is only returned when every object in it has been freed, which fragmentation makes unlikely. Larger allocations do go back. The practical upshot is that resident memory measures the **high-water mark** rather than current use, so watching it tells you what a program peaked at, not what it holds now.

Two things follow. `tracemalloc` measures what Python holds and is the right tool for a leak; the operating system's number is the right one for deciding how much memory a container needs. And the standard answer to a process that peaks enormously once is not to tune the allocator but to stop peaking: stream the input rather than loading it, which is unit 16's generators being about memory rather than about elegance.

## Interning, and why `is` sometimes lies

Python reuses some objects. Small integers from -5 to 256 are created once at startup and shared, and short strings that look like identifiers are interned by the compiler. So:

```python
a = 256; b = 256; a is b        # True
a = 257; b = 257; a is b        # False, usually
```

This is an implementation detail and it is the reason unit 04 said to compare with `==` and reserve `is` for `None`, `True` and `False`. Code that works because two small numbers happen to be the same object breaks silently on a different value, a different version or a different interpreter.

## Leaks in a language with a garbage collector

Python does not leak in the C sense; it holds things you forgot you were holding. Four ways.

**A module-level container that only grows.** A cache with no bound, a list of every request. This is the commonest by far, and `functools.lru_cache(maxsize=...)` versus `cache` is exactly this decision.

**A closure or default argument holding a large object.** Unit 02's mutable default, in its memory-shaped form: whatever it captured lives as long as the function does, which is usually the process.

**A reference cycle containing something large.** Collected eventually, so memory sits high between runs of the collector.

**A registry nobody removes from.** Observers, handlers, `__init_subclass__` from unit 27 filling a table. `weakref` is the tool: a weak reference does not keep its target alive, and `WeakValueDictionary` drops entries when the value is collected, which is what a cache of live objects wants. The catch worth knowing before you reach for it is that not everything can be weakly referenced: a class with `__slots__` needs `__weakref__` in the list, and `int`, `str`, `tuple` and `list` cannot be referenced weakly at all, which is often enough to decide the design for you.

## Finding one

`tracemalloc` is in the standard library and answers the question directly:

```python
tracemalloc.start()
# ... do the work ...
snapshot = tracemalloc.take_snapshot()
for stat in snapshot.statistics("lineno")[:10]:
    print(stat)
```

That gives you the ten lines that allocated the most memory still held. Taking two snapshots and comparing them with `compare_to` is better still for a leak, because it shows what grew between them rather than what is merely large.

The method that works: snapshot, do a unit of work, snapshot again, compare. Anything that grows every time round is the leak, and its allocation site is in the output.

For a running process, `memray` and `objgraph` go further, the second by drawing what is keeping an object alive, which is the question you actually have.

## When to care

Most programs never need any of this. The time it matters is when a process grows without bound, when a container is being restarted for exceeding its limit, or when the data genuinely does not fit and the answer is to stream it rather than to load it.

There is one more case, and it is the one people meet first without recognising it. A long-running process, a server or a worker, has a memory profile that only makes sense over hours: it climbs during warm-up as caches fill, and then should be flat. Flat is the property to check, not the absolute number. A slow, steady climb over a day is a leak whatever the number is, and a large but flat process is usually working correctly and needs the memory it needs.

The habits that prevent nearly all of it are cheap and worth having anyway: bound your caches, prefer a generator to a list when the sequence is large, use `with` so resources are released at a point you can name, and be suspicious of any module-level container that only ever grows.
