---
slug: 36-memory
---

## A cache that only ever grows

`lookup` remembers every answer it has ever given. Nothing removes anything, so a long-running process holds every key it has ever seen.

@expect silent
@hint What bounds this dictionary?
@hint `functools` has two decorators here, and the difference between them is one argument.
@diagnose silent It runs and returns the right answers, holding every key it has ever been asked for. This is the commonest memory leak in Python by a wide margin, and it does not look like a leak: it looks like a cache, which is a thing you were supposed to add. The distinction is whether anything bounds it. `functools.lru_cache(maxsize=128)` evicts the least recently used entry once it is full; `functools.cache` is the same decorator with no bound at all, which is correct for a small fixed set of inputs and a leak for anything driven by user input. Choosing between them is choosing whether the set of keys is bounded by something other than time.

~~~starter
CALLS = {"compute": 0}


def compute(key):
    CALLS["compute"] += 1
    return key * 2


CACHE: dict[int, int] = {}


def lookup(key):
    """The computed value for this key."""
    if key not in CACHE:
        CACHE[key] = compute(key)
    return CACHE[key]
~~~

~~~tests
CALLS["compute"] = 0
for key in range(1000):
    lookup(key)
assert CALLS["compute"] == 1000

assert lookup(0) == 0
assert len(CACHE) <= 128, f"the cache holds {len(CACHE)} entries and nothing evicts"
~~~

~~~solution
from collections import OrderedDict

CALLS = {"compute": 0}


def compute(key):
    CALLS["compute"] += 1
    return key * 2


CACHE: OrderedDict[int, int] = OrderedDict()
MAXSIZE = 128


def lookup(key):
    """The computed value for this key, keeping the most recent 128."""
    if key in CACHE:
        CACHE.move_to_end(key)
        return CACHE[key]
    CACHE[key] = compute(key)
    if len(CACHE) > MAXSIZE:
        CACHE.popitem(last=False)
    return CACHE[key]
~~~

## A registry that outlives what it holds

`Session` records every instance in a list, so a session is kept alive by the registry long after nobody else is using it.

@expect silent
@hint A strong reference keeps its target alive. What kind of reference does a registry want?
@hint `weakref` has a set for exactly this.
@diagnose silent Nothing raised, and a session nobody holds any more was still in the registry, because a list holds a **strong** reference and a strong reference is the whole reason an object stays alive. `weakref.WeakSet` holds weak references instead: they do not keep the target alive, and the entry disappears when the object is collected. `WeakValueDictionary` is the mapping version and is what a cache of live objects wants. Two things to know before reaching for it: not every type can be referenced weakly, `int`, `str`, `tuple` and `list` cannot, and a class with `__slots__` needs `__weakref__` in the list, which is often enough to settle the design.

~~~starter
REGISTRY: list = []


class Session:
    def __init__(self, name):
        self.name = name
        REGISTRY.append(self)
~~~

~~~tests
import gc

REGISTRY.clear()
kept = Session("kept")
Session("temporary")
gc.collect()

names = sorted(s.name for s in REGISTRY)
assert names == ["kept"], f"the registry still holds {names}"
assert kept.name == "kept"
~~~

~~~solution
import weakref

REGISTRY: weakref.WeakSet = weakref.WeakSet()


class Session:
    def __init__(self, name):
        self.name = name
        REGISTRY.add(self)
~~~

## Two objects keeping each other alive

`Node` and its parent point at each other. Reference counting cannot free a cycle, so nothing goes away until the cycle collector happens to run.

@expect silent
@hint Each object's count is still above zero. Who is holding it?
@hint The child does not need to keep the parent alive.
@diagnose silent Nothing raised, and both objects were still alive after everything outside them was dropped, because each one's reference count is held up by the other. Reference counting frees an object the moment its count reaches zero, which is why Python releases things promptly, and it is exactly the mechanism a cycle defeats. CPython's cycle collector finds these eventually, which means the memory sits held until it runs. A **weak** reference from the child to the parent breaks the cycle: the parent still keeps the child alive, which is the direction that matters, and the child no longer keeps the parent. This is the standard shape for a tree with parent links, and for any observer that should not outlive what it observes.

~~~starter
ALIVE: list[str] = []


class Node:
    def __init__(self, name, parent=None):
        self.name = name
        self.parent = parent
        self.children = []
        ALIVE.append(name)
        if parent is not None:
            parent.children.append(self)

    def __del__(self):
        ALIVE.remove(self.name)
~~~

~~~tests
import gc

ALIVE.clear()
gc.disable()
try:
    root = Node("root")
    Node("child", parent=root)
    del root
    assert ALIVE == [], f"still alive without a collection: {ALIVE}"
finally:
    gc.enable()
~~~

~~~solution
import weakref

ALIVE: list[str] = []


class Node:
    def __init__(self, name, parent=None):
        self.name = name
        self._parent = weakref.ref(parent) if parent is not None else None
        self.children = []
        ALIVE.append(name)
        if parent is not None:
            parent.children.append(self)

    @property
    def parent(self):
        return self._parent() if self._parent is not None else None

    def __del__(self):
        ALIVE.remove(self.name)
~~~

## The whole file, to read one line

`first_error` reads every line into a list and then looks at them. The memory is the size of the file rather than the size of a line.

@expect silent
@hint What does `readlines` build, and how much of it do you need at once?
@hint A file object is already an iterator over its lines.
@diagnose silent It gives the right answer and holds the entire file to do it. `f.readlines()` builds a list of every line; iterating the file object yields them one at a time, holding one. For a large file the difference is between a program that works and one that is killed for exceeding its memory limit, and the change is to delete a method call. Unit 16 introduced generators as a way of expressing a sequence lazily; this is the same idea with memory as the motive rather than elegance, and it is the standard answer whenever a process peaks enormously: stream the input rather than loading it.

~~~starter
def first_error(lines):
    """The first line reporting an error, or None."""
    everything = list(lines)
    for line in everything:
        if line.startswith("ERROR"):
            return line
    return None
~~~

~~~tests
class Watched:
    """A source of lines that records how many were pulled from it."""

    read = 0

    def __init__(self, lines):
        self._lines = lines

    def __iter__(self):
        for line in self._lines:
            Watched.read += 1
            yield line


Watched.read = 0
source = Watched(["ok", "ok", "ERROR one", "ok", "ERROR two"])
assert first_error(source) == "ERROR one"
assert Watched.read == 3, f"{Watched.read} lines were read to find the third"
assert first_error(Watched(["ok"])) is None
~~~

~~~solution
def first_error(lines):
    """The first line reporting an error, or None."""
    for line in lines:
        if line.startswith("ERROR"):
            return line
    return None
~~~

## A great many small objects, each with a dict

`Point` is made a million times in real use. Every instance carries its own dictionary, which is most of what it costs.

@expect silent
@hint Unit 19 named the declaration that removes the per-instance dict.
@hint The test asks the instance whether it still has one.
@diagnose silent It runs, and every point carries a `__dict__`, which for an object with two small fields is most of its size. `__slots__` replaces that dict with a fixed array of named fields, which typically halves the memory for a small class and is the single biggest win available when you make a great many of them. It also turns an undeclared attribute into an immediate `AttributeError` rather than a silent typo, which unit 19 called the underrated half. The costs are worth remembering: nothing can be attached ad hoc afterwards, a subclass that declares no slots of its own quietly gets the dict back, and weak references need `__weakref__` in the list.

~~~starter
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y
~~~

~~~tests
import sys

p = Point(1, 2)
assert (p.x, p.y) == (1, 2)
assert not hasattr(p, "__dict__"), "every instance carries its own dictionary"

try:
    p.z = 3
except AttributeError:
    pass
else:
    raise AssertionError("an undeclared attribute was accepted")

assert sys.getsizeof(p) < 100
~~~

~~~solution
class Point:
    __slots__ = ("x", "y")

    def __init__(self, x, y):
        self.x = x
        self.y = y
~~~

## Copied, and not copied

`snapshot` takes a copy of the rows so the caller's list cannot be changed. A slice copies the list and not the dicts inside it.

@expect silent
@hint `rows[:]` builds a new list. What is in it?
@hint Shallow against deep.
@diagnose silent Nothing raised, and changing the snapshot changed the caller's data, because `rows[:]` is a **shallow** copy: a new list of the same length holding the very same objects. That is cheap and is usually what you want; it is isolation from changes to the *list* and not from changes to the *rows*. `copy.deepcopy` walks the whole graph and is the only one that gives genuine independence, at a cost proportional to everything it touches. The three levels are worth holding as a set: `b = a` costs one pointer and isolates nothing, `a[:]` copies the container, and `deepcopy(a)` copies everything reachable.

~~~starter
def snapshot(rows):
    """A copy the caller's data cannot be changed through."""
    return rows[:]
~~~

~~~tests
original = [{"name": "ada", "score": 1}, {"name": "bob", "score": 2}]
copy_of = snapshot(original)

copy_of[0]["score"] = 99
assert original[0]["score"] == 1, f"the original row now reads {original[0]}"

copy_of.append({"name": "new", "score": 0})
assert len(original) == 2
~~~

~~~solution
import copy


def snapshot(rows):
    """A copy the caller's data cannot be changed through."""
    return copy.deepcopy(rows)
~~~

## Identity where equality was meant

`same_total` compares two numbers with `is`. It works for small ones because Python shares those objects, and stops working above 256.

@expect silent
@hint Small integers are created once at startup and shared. How small?
@hint Unit 04 gave the rule. This is why it exists.
@diagnose silent It runs and reports that two equal totals are different, because `is` asks whether they are the **same object** and Python only shares integers from -5 to 256. Above that, two equal values are usually two objects. The sharing is an implementation detail, it differs between versions and interpreters, and it is the whole reason unit 04's rule exists: compare with `==`, and keep `is` for `None`, `True` and `False`, which are genuinely singletons. Code that works because two small numbers happen to be one object is code that breaks silently on a larger value, which is the worst way for a bug to arrive.

~~~starter
def same_total(left, right):
    """Whether these two totals are the same amount."""
    return left is right
~~~

~~~tests
assert same_total(100, 100) is True
assert same_total(1000, 1000) is True, "two equal totals were reported as different"
assert same_total(1000, 1001) is False
assert same_total(sum([500, 500]), 1000) is True
~~~

~~~solution
def same_total(left, right):
    """Whether these two totals are the same amount."""
    return left == right
~~~

## Held by a default that never goes away

`accumulate` collects rows into a default argument. The default is one object, created once, that lives as long as the function does.

@expect ruff:B006
@expect silent
@hint Unit 02's mutable default, asked about memory instead of correctness.
@hint How long does a function object live, and what does its default hold?
@diagnose B006 ruff's `B006` is "do not use mutable data structures for argument defaults", and it is the same rule that caught this in unit 02. Worth noticing that a linter finds the memory version and the correctness version identically, because they are one mistake: the object is created once and attached to the function.
@diagnose silent It runs, and the rows from the first call were still there on the second, growing without bound for the life of the process. This is unit 02's mutable default seen from the memory side: the default is evaluated once, when the `def` runs, and the object it produced is attached to the function, so whatever accumulates in it lives as long as the function does, which for a module-level function is until the program exits. The same shape appears wherever something long-lived captures something large: a closure over a big dataframe, a decorator that keeps every result, a class attribute used as a buffer. The sentinel fix is the same as unit 02's, and the habit behind it is to ask what holds this, and for how long.

~~~starter
def accumulate(row, collected=[]):
    """Collect rows, returning everything gathered in this batch."""
    collected.append(row)
    return collected
~~~

~~~tests
first = accumulate("a")
assert first == ["a"]

second = accumulate("b")
assert second == ["b"], f"the second batch began with {second}"
assert len(accumulate("c")) == 1
~~~

~~~solution
def accumulate(row, collected=None):
    """Collect rows, returning everything gathered in this batch."""
    if collected is None:
        collected = []
    collected.append(row)
    return collected
~~~
