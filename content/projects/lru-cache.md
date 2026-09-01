---
slug: lru-cache
---

## A list you can cut from the middle

An LRU cache has to do two things in constant time: find an entry by key, and
move an entry to the front because it was just used. A dict does the first. No
built-in sequence does the second, because a list has to shift everything after
the position you removed, which unit 13 measured.

A doubly linked list does. Each node knows its neighbours, so unlinking is two
pointer assignments and does not touch anything else. Build one with sentinel
head and tail nodes, which removes every "is this the first one" branch from the
code that follows: a real node always has a real neighbour on both sides.

@goal `unlink` and `append` are constant time and never touch the sentinels.

~~~starter
class Node:
    """One entry, and its neighbours."""

    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key=None, value=None):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None


class Ring:
    """A doubly linked list with sentinels at both ends."""

    def __init__(self):
        self.head = Node()
        self.tail = Node()
        self.head.next = self.tail
        self.tail.prev = self.head

    def append(self, node):
        """Put this node at the tail end, which is the most recent end."""
        raise NotImplementedError

    def unlink(self, node):
        """Take this node out, leaving its neighbours joined."""
        raise NotImplementedError

    def keys(self):
        """Every real key, oldest first."""
        node = self.head.next
        while node is not self.tail:
            yield node.key
            node = node.next
~~~

~~~tests
ring = Ring()
assert list(ring.keys()) == []

a, b, c = Node("a", 1), Node("b", 2), Node("c", 3)
ring.append(a)
ring.append(b)
ring.append(c)
assert list(ring.keys()) == ["a", "b", "c"]

ring.unlink(b)
assert list(ring.keys()) == ["a", "c"]

# the node keeps its data, so it can go straight back in
ring.append(b)
assert list(ring.keys()) == ["a", "c", "b"]
assert b.value == 2

# unlink the ends
ring.unlink(a)
assert list(ring.keys()) == ["c", "b"]
ring.unlink(b)
assert list(ring.keys()) == ["c"]
ring.unlink(c)
assert list(ring.keys()) == []

# the sentinels survive an empty ring and it still works afterwards
ring.append(a)
assert list(ring.keys()) == ["a"]

# unlinking from the middle of a long ring touches only its two neighbours
big = Ring()
nodes = [Node(i, i) for i in range(2000)]
for node in nodes:
    big.append(node)
big.unlink(nodes[1000])
assert len(list(big.keys())) == 1999
~~~

~~~solution
class Node:
    """One entry, and its neighbours."""

    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key=None, value=None):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None


class Ring:
    """A doubly linked list with sentinels at both ends."""

    def __init__(self):
        self.head = Node()
        self.tail = Node()
        self.head.next = self.tail
        self.tail.prev = self.head

    def append(self, node):
        """Put this node at the tail end, which is the most recent end."""
        last = self.tail.prev
        last.next = node
        node.prev = last
        node.next = self.tail
        self.tail.prev = node

    def unlink(self, node):
        """Take this node out, leaving its neighbours joined."""
        node.prev.next = node.next
        node.next.prev = node.prev
        node.prev = node.next = None

    def keys(self):
        """Every real key, oldest first."""
        node = self.head.next
        while node is not self.tail:
            yield node.key
            node = node.next
~~~

## The cache

Now put a dict in front of the ring. The dict maps a key to its node, so a
lookup is a hash; the ring keeps the order, so eviction is "take the node next
to the head". Getting an entry moves it to the tail, because it has just been
used and is therefore the least likely to be evicted next.

Two cases people get wrong. Setting a key that is already present has to move
the existing node rather than adding a second one, or the ring and the dict
disagree about how many entries there are. And eviction has to remove the key
from the dict as well as the node from the ring, or the dict grows forever while
the cache reports the right size.

@goal `Cache(maxsize)` evicts the least recently used entry and never exceeds its size.

~~~starter
class Node:
    """One entry, and its neighbours."""

    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key=None, value=None):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None


class Ring:
    """A doubly linked list with sentinels at both ends."""

    def __init__(self):
        self.head = Node()
        self.tail = Node()
        self.head.next = self.tail
        self.tail.prev = self.head

    def append(self, node):
        last = self.tail.prev
        last.next = node
        node.prev = last
        node.next = self.tail
        self.tail.prev = node

    def unlink(self, node):
        node.prev.next = node.next
        node.next.prev = node.prev
        node.prev = node.next = None

    def keys(self):
        node = self.head.next
        while node is not self.tail:
            yield node.key
            node = node.next


MISSING = object()


class Cache:
    """A bounded mapping that forgets what has gone longest unused."""

    def __init__(self, maxsize=128):
        self.maxsize = maxsize
        self.ring = Ring()
        self.index = {}

    def get(self, key, default=None):
        """The value for this key, and it becomes the most recently used."""
        raise NotImplementedError

    def put(self, key, value):
        """Store a value, evicting the oldest if that would overflow."""
        raise NotImplementedError

    def __len__(self):
        return len(self.index)

    def order(self):
        """Keys from least to most recently used."""
        return list(self.ring.keys())
~~~

~~~tests
c = Cache(maxsize=3)
assert len(c) == 0
assert c.get("nothing") is None
assert c.get("nothing", "fallback") == "fallback"

c.put("a", 1)
c.put("b", 2)
c.put("c", 3)
assert len(c) == 3
assert c.order() == ["a", "b", "c"]
assert c.get("a") == 1
assert c.order() == ["b", "c", "a"], "a get should make the key most recent"

# the oldest goes when a fourth arrives
c.put("d", 4)
assert len(c) == 3
assert c.order() == ["c", "a", "d"]
assert c.get("b") is None, "b was the least recently used and should be gone"

# overwriting a key moves it rather than adding a second node
c.put("c", 30)
assert len(c) == 3
assert c.order() == ["a", "d", "c"]
assert c.get("c") == 30

# eviction removes the key from the dict too, so the two never disagree
big = Cache(maxsize=2)
for i in range(100):
    big.put(i, i)
assert len(big) == 2
assert len(big.index) == 2, "the index kept entries the ring has evicted"
assert big.order() == [98, 99]

# a maxsize of one is a cache, not a special case
one = Cache(maxsize=1)
one.put("x", 1)
one.put("y", 2)
assert one.order() == ["y"] and one.get("x") is None

# None is a value like any other, and must not read as a miss
c2 = Cache(maxsize=2)
c2.put("k", None)
assert c2.get("k", "fallback") is None
~~~

~~~solution
class Node:
    """One entry, and its neighbours."""

    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key=None, value=None):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None


class Ring:
    """A doubly linked list with sentinels at both ends."""

    def __init__(self):
        self.head = Node()
        self.tail = Node()
        self.head.next = self.tail
        self.tail.prev = self.head

    def append(self, node):
        last = self.tail.prev
        last.next = node
        node.prev = last
        node.next = self.tail
        self.tail.prev = node

    def unlink(self, node):
        node.prev.next = node.next
        node.next.prev = node.prev
        node.prev = node.next = None

    def keys(self):
        node = self.head.next
        while node is not self.tail:
            yield node.key
            node = node.next


MISSING = object()


class Cache:
    """A bounded mapping that forgets what has gone longest unused."""

    def __init__(self, maxsize=128):
        self.maxsize = maxsize
        self.ring = Ring()
        self.index = {}

    def get(self, key, default=None):
        """The value for this key, and it becomes the most recently used."""
        node = self.index.get(key, MISSING)
        if node is MISSING:
            return default
        self.ring.unlink(node)
        self.ring.append(node)
        return node.value

    def put(self, key, value):
        """Store a value, evicting the oldest if that would overflow."""
        node = self.index.get(key, MISSING)
        if node is not MISSING:
            node.value = value
            self.ring.unlink(node)
            self.ring.append(node)
            return
        if len(self.index) >= self.maxsize:
            oldest = self.ring.head.next
            self.ring.unlink(oldest)
            del self.index[oldest.key]
        node = Node(key, value)
        self.index[key] = node
        self.ring.append(node)

    def __len__(self):
        return len(self.index)

    def order(self):
        """Keys from least to most recently used."""
        return list(self.ring.keys())
~~~

## Hits, misses and honesty about them

A cache you cannot measure is a cache you cannot size. `functools.lru_cache`
reports hits, misses, its maxsize and how full it is, and the reason is the one
unit 35 gave: a cache that is never hit is pure cost, and the only way to know
is to count.

Count a hit when the key was present and a miss when it was not. Report them
through a `cache_info()` that returns a `NamedTuple`, because unit 23's rule
applies exactly: this is a small fixed group of values, its positions deserve
names, and a caller wants to unpack it. Add `cache_clear()`, which has to reset
the ring, the index and the counters together.

@goal `cache_info()` reports hits, misses, maxsize and currsize, and `cache_clear()` resets all four.

~~~starter
from typing import NamedTuple


class Node:
    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key=None, value=None):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None


class Ring:
    def __init__(self):
        self.head = Node()
        self.tail = Node()
        self.head.next = self.tail
        self.tail.prev = self.head

    def append(self, node):
        last = self.tail.prev
        last.next = node
        node.prev = last
        node.next = self.tail
        self.tail.prev = node

    def unlink(self, node):
        node.prev.next = node.next
        node.next.prev = node.prev
        node.prev = node.next = None

    def keys(self):
        node = self.head.next
        while node is not self.tail:
            yield node.key
            node = node.next


MISSING = object()


class CacheInfo(NamedTuple):
    hits: int
    misses: int
    maxsize: int
    currsize: int


class Cache:
    """A bounded mapping that forgets what has gone longest unused."""

    def __init__(self, maxsize=128):
        self.maxsize = maxsize
        self.ring = Ring()
        self.index = {}
        self.hits = 0
        self.misses = 0

    def get(self, key, default=None):
        node = self.index.get(key, MISSING)
        if node is MISSING:
            return default
        self.ring.unlink(node)
        self.ring.append(node)
        return node.value

    def put(self, key, value):
        node = self.index.get(key, MISSING)
        if node is not MISSING:
            node.value = value
            self.ring.unlink(node)
            self.ring.append(node)
            return
        if len(self.index) >= self.maxsize:
            oldest = self.ring.head.next
            self.ring.unlink(oldest)
            del self.index[oldest.key]
        node = Node(key, value)
        self.index[key] = node
        self.ring.append(node)

    def __len__(self):
        return len(self.index)

    def order(self):
        return list(self.ring.keys())

    def cache_info(self):
        """Hits, misses, maxsize and how full it is."""
        raise NotImplementedError

    def cache_clear(self):
        """Forget everything, including the counters."""
        raise NotImplementedError
~~~

~~~tests
c = Cache(maxsize=2)
info = c.cache_info()
assert (info.hits, info.misses, info.maxsize, info.currsize) == (0, 0, 2, 0)

c.put("a", 1)
assert c.cache_info().currsize == 1

assert c.get("a") == 1
assert c.cache_info().hits == 1
assert c.cache_info().misses == 0

assert c.get("nope") is None
assert c.cache_info().misses == 1

# a miss on an evicted key counts as a miss
c.put("b", 2)
c.put("c", 3)
assert c.get("a") is None
assert c.cache_info().misses == 2
assert c.cache_info().currsize == 2

# it unpacks, because it is a NamedTuple
hits, misses, maxsize, currsize = c.cache_info()
assert (hits, misses, maxsize, currsize) == (1, 2, 2, 2)
assert isinstance(c.cache_info(), tuple)

# clearing resets everything, and the cache still works afterwards
c.cache_clear()
assert c.cache_info() == (0, 0, 2, 0)
assert c.order() == []
c.put("x", 1)
assert c.get("x") == 1 and c.cache_info().hits == 1
~~~

~~~solution
from typing import NamedTuple


class Node:
    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key=None, value=None):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None


class Ring:
    def __init__(self):
        self.head = Node()
        self.tail = Node()
        self.head.next = self.tail
        self.tail.prev = self.head

    def append(self, node):
        last = self.tail.prev
        last.next = node
        node.prev = last
        node.next = self.tail
        self.tail.prev = node

    def unlink(self, node):
        node.prev.next = node.next
        node.next.prev = node.prev
        node.prev = node.next = None

    def keys(self):
        node = self.head.next
        while node is not self.tail:
            yield node.key
            node = node.next


MISSING = object()


class CacheInfo(NamedTuple):
    hits: int
    misses: int
    maxsize: int
    currsize: int


class Cache:
    """A bounded mapping that forgets what has gone longest unused."""

    def __init__(self, maxsize=128):
        self.maxsize = maxsize
        self.ring = Ring()
        self.index = {}
        self.hits = 0
        self.misses = 0

    def get(self, key, default=None):
        node = self.index.get(key, MISSING)
        if node is MISSING:
            self.misses += 1
            return default
        self.hits += 1
        self.ring.unlink(node)
        self.ring.append(node)
        return node.value

    def put(self, key, value):
        node = self.index.get(key, MISSING)
        if node is not MISSING:
            node.value = value
            self.ring.unlink(node)
            self.ring.append(node)
            return
        if len(self.index) >= self.maxsize:
            oldest = self.ring.head.next
            self.ring.unlink(oldest)
            del self.index[oldest.key]
        node = Node(key, value)
        self.index[key] = node
        self.ring.append(node)

    def __len__(self):
        return len(self.index)

    def order(self):
        return list(self.ring.keys())

    def cache_info(self):
        """Hits, misses, maxsize and how full it is."""
        return CacheInfo(self.hits, self.misses, self.maxsize, len(self.index))

    def cache_clear(self):
        """Forget everything, including the counters."""
        self.ring = Ring()
        self.index = {}
        self.hits = 0
        self.misses = 0
~~~

## Wearing it as a decorator

The last stage turns the class into the thing you would actually import.
`@memoize(maxsize=2)` wraps a function so that calling it twice with the same
arguments calls it once, and unit 26 covered every part of the shape: three
levels because it takes an argument, `functools.wraps` because a wrapper without
it breaks every tool that reads a function's metadata, and the wrapper carrying
`cache_info` and `cache_clear` as attributes, which is how the standard library
exposes them.

The key has to distinguish calls that differ. `f(1)` and `f("1")` are different
calls, and so are `f(1, b=2)` and `f(1, 2)`. Building a key from the arguments
plus a marker between the positional and keyword parts handles both, and the key
has to be hashable, which is the documented limit of this whole approach.

@goal `@memoize(maxsize=n)` caches by arguments and exposes `cache_info` and `cache_clear`.

~~~starter
import functools
from typing import NamedTuple


class Node:
    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key=None, value=None):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None


class Ring:
    def __init__(self):
        self.head = Node()
        self.tail = Node()
        self.head.next = self.tail
        self.tail.prev = self.head

    def append(self, node):
        last = self.tail.prev
        last.next = node
        node.prev = last
        node.next = self.tail
        self.tail.prev = node

    def unlink(self, node):
        node.prev.next = node.next
        node.next.prev = node.prev
        node.prev = node.next = None

    def keys(self):
        node = self.head.next
        while node is not self.tail:
            yield node.key
            node = node.next


MISSING = object()


class CacheInfo(NamedTuple):
    hits: int
    misses: int
    maxsize: int
    currsize: int


class Cache:
    def __init__(self, maxsize=128):
        self.maxsize = maxsize
        self.ring = Ring()
        self.index = {}
        self.hits = 0
        self.misses = 0

    def get(self, key, default=None):
        node = self.index.get(key, MISSING)
        if node is MISSING:
            self.misses += 1
            return default
        self.hits += 1
        self.ring.unlink(node)
        self.ring.append(node)
        return node.value

    def put(self, key, value):
        node = self.index.get(key, MISSING)
        if node is not MISSING:
            node.value = value
            self.ring.unlink(node)
            self.ring.append(node)
            return
        if len(self.index) >= self.maxsize:
            oldest = self.ring.head.next
            self.ring.unlink(oldest)
            del self.index[oldest.key]
        node = Node(key, value)
        self.index[key] = node
        self.ring.append(node)

    def __len__(self):
        return len(self.index)

    def order(self):
        return list(self.ring.keys())

    def cache_info(self):
        return CacheInfo(self.hits, self.misses, self.maxsize, len(self.index))

    def cache_clear(self):
        self.ring = Ring()
        self.index = {}
        self.hits = 0
        self.misses = 0


def make_key(args, kwargs):
    """A hashable key that tells different calls apart."""
    raise NotImplementedError


def memoize(maxsize=128):
    """Cache a function's results, keeping the most recent `maxsize`."""
    raise NotImplementedError
~~~

~~~tests
CALLS = []


@memoize(maxsize=2)
def slow_double(n):
    """Double a number, expensively."""
    CALLS.append(n)
    return n * 2


assert slow_double(2) == 4
assert slow_double(2) == 4
assert CALLS == [2], f"the function ran {len(CALLS)} times for one distinct call"
assert slow_double.cache_info().hits == 1
assert slow_double.cache_info().misses == 1

# unit 26: the wrapper must not eat the function's identity
assert slow_double.__name__ == "slow_double"
assert slow_double.__doc__ == "Double a number, expensively."

# eviction happens at the size given
CALLS.clear()
slow_double.cache_clear()
for n in (1, 2, 3, 1):
    slow_double(n)
assert CALLS == [1, 2, 3, 1], f"got {CALLS}"
assert slow_double.cache_info().currsize == 2

# calls that differ must not collide
@memoize(maxsize=8)
def show(*args, **kwargs):
    CALLS.append((args, kwargs))
    return f"{args}{kwargs}"


CALLS.clear()
show(1)
show("1")
show(1, b=2)
show(1, 2)
assert len(CALLS) == 4, f"four different calls collapsed into {len(CALLS)}"
show(1)
assert len(CALLS) == 4

# keyword order must not make a new entry
CALLS.clear()
show(a=1, b=2)
show(b=2, a=1)
assert len(CALLS) == 1, "the same keywords in a different order made two entries"

# an unhashable argument is the documented limit, and should say so
try:
    show([1, 2])
except TypeError:
    pass
else:
    raise AssertionError("an unhashable argument should raise TypeError")

# clearing resets the counters through the decorator too
show.cache_clear()
assert show.cache_info() == (0, 0, 8, 0)
~~~

~~~solution
import functools
from typing import NamedTuple


class Node:
    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key=None, value=None):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None


class Ring:
    def __init__(self):
        self.head = Node()
        self.tail = Node()
        self.head.next = self.tail
        self.tail.prev = self.head

    def append(self, node):
        last = self.tail.prev
        last.next = node
        node.prev = last
        node.next = self.tail
        self.tail.prev = node

    def unlink(self, node):
        node.prev.next = node.next
        node.next.prev = node.prev
        node.prev = node.next = None

    def keys(self):
        node = self.head.next
        while node is not self.tail:
            yield node.key
            node = node.next


MISSING = object()


class CacheInfo(NamedTuple):
    hits: int
    misses: int
    maxsize: int
    currsize: int


class Cache:
    def __init__(self, maxsize=128):
        self.maxsize = maxsize
        self.ring = Ring()
        self.index = {}
        self.hits = 0
        self.misses = 0

    def get(self, key, default=None):
        node = self.index.get(key, MISSING)
        if node is MISSING:
            self.misses += 1
            return default
        self.hits += 1
        self.ring.unlink(node)
        self.ring.append(node)
        return node.value

    def put(self, key, value):
        node = self.index.get(key, MISSING)
        if node is not MISSING:
            node.value = value
            self.ring.unlink(node)
            self.ring.append(node)
            return
        if len(self.index) >= self.maxsize:
            oldest = self.ring.head.next
            self.ring.unlink(oldest)
            del self.index[oldest.key]
        node = Node(key, value)
        self.index[key] = node
        self.ring.append(node)

    def __len__(self):
        return len(self.index)

    def order(self):
        return list(self.ring.keys())

    def cache_info(self):
        return CacheInfo(self.hits, self.misses, self.maxsize, len(self.index))

    def cache_clear(self):
        self.ring = Ring()
        self.index = {}
        self.hits = 0
        self.misses = 0


_KEYWORDS = object()


def make_key(args, kwargs):
    """A hashable key that tells different calls apart.

    The type goes in beside each value, because 1 and "1" are equal keys in a
    dict and are not the same call. The marker separates the positional part
    from the keyword part, so f(1, 2) and f(1, b=2) cannot collide, and the
    keywords are sorted so their order does not matter.
    """
    key = tuple((type(a).__name__, a) for a in args)
    if kwargs:
        key += (_KEYWORDS,)
        key += tuple((k, type(v).__name__, v) for k, v in sorted(kwargs.items()))
    hash(key)          # fail here, with the caller's frame on top
    return key


def memoize(maxsize=128):
    """Cache a function's results, keeping the most recent `maxsize`."""

    def decorator(func):
        cache = Cache(maxsize)

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            key = make_key(args, kwargs)
            found = cache.get(key, MISSING)
            if found is not MISSING:
                return found
            result = func(*args, **kwargs)
            cache.put(key, result)
            return result

        wrapper.cache_info = cache.cache_info
        wrapper.cache_clear = cache.cache_clear
        return wrapper

    return decorator
~~~
