---
slug: bloom-filter
---

## A bit array you can address

Before any hashing, the storage. A Bloom filter is a row of bits and nothing
else, so the first thing to build is something that can hold `m` bits and let
you set and read one by position. Python has no bit array in the standard
library, and the honest reason to build one rather than reach for a list of
booleans is the whole point of the structure: a list of a million booleans is
around eight megabytes of pointers, and a million bits is 125 kilobytes.

Use a `bytearray`, which stores bytes rather than objects. Bit `i` lives in byte
`i // 8`, at position `i % 8` within it, and you reach it with a mask: `1 <<
(i % 8)`. Setting a bit is `|=` with that mask, reading it is `&` and a test
against zero.

@goal `BitArray(m)` holds m bits, all zero, with `set(i)`, `get(i)` and `len`.

~~~starter
class BitArray:
    """A fixed row of bits, stored eight to the byte."""

    def __init__(self, size):
        self.size = size
        self.bits = bytearray((size + 7) // 8)

    def set(self, index):
        """Turn bit `index` on."""
        raise NotImplementedError

    def get(self, index):
        """Whether bit `index` is on."""
        raise NotImplementedError

    def __len__(self):
        return self.size
~~~

~~~tests
bits = BitArray(64)
assert len(bits) == 64
assert not any(bits.get(i) for i in range(64)), "a new bit array should be all zero"

bits.set(0)
assert bits.get(0) is True
assert not bits.get(1)

# every position, including the ones that cross a byte boundary
edges = BitArray(20)
for i in (0, 7, 8, 15, 16, 19):
    edges.set(i)
on = [i for i in range(20) if edges.get(i)]
assert on == [0, 7, 8, 15, 16, 19], f"bits on: {on}"

# setting twice is not a toggle
twice = BitArray(8)
twice.set(3)
twice.set(3)
assert twice.get(3) is True

# a size that is not a multiple of eight still allocates enough bytes
assert len(BitArray(1).bits) == 1
assert len(BitArray(8).bits) == 1
assert len(BitArray(9).bits) == 2

# the storage is bytes, not objects: a million bits is not a million pointers
import sys

assert sys.getsizeof(BitArray(1_000_000).bits) < 200_000
~~~

~~~solution
class BitArray:
    """A fixed row of bits, stored eight to the byte."""

    def __init__(self, size):
        self.size = size
        self.bits = bytearray((size + 7) // 8)

    def set(self, index):
        """Turn bit `index` on."""
        self.bits[index // 8] |= 1 << (index % 8)

    def get(self, index):
        """Whether bit `index` is on."""
        return bool(self.bits[index // 8] & (1 << (index % 8)))

    def __len__(self):
        return self.size
~~~

## k hashes from one

A Bloom filter needs `k` independent hash functions, and you have one. Writing
`k` different hash functions by hand is the wrong answer: they would have to be
independent, and proving that is harder than the rest of this project.

The standard trick is Kirsch-Mitzenmacher: two hashes are enough, and the rest
are combinations of them. Given `h1` and `h2`, the `i`th hash is `h1 + i * h2`,
taken modulo the array size. The paper shows this gives a false positive rate
asymptotically indistinguishable from `k` genuinely independent hashes.

Python's `hash()` is not usable here, because unit 04 explained that it is
randomised per process for strings, so a filter built in one run would answer
differently in the next. Use `hashlib.blake2b`, which is fast, and take two
different slices of one digest as `h1` and `h2`.

@goal `hashes(item, k, m)` yields k positions in range(m), the same ones every run.

~~~starter
import hashlib


class BitArray:
    """A fixed row of bits, stored eight to the byte."""

    def __init__(self, size):
        self.size = size
        self.bits = bytearray((size + 7) // 8)

    def set(self, index):
        self.bits[index // 8] |= 1 << (index % 8)

    def get(self, index):
        return bool(self.bits[index // 8] & (1 << (index % 8)))

    def __len__(self):
        return self.size


def hashes(item, k, m):
    """The k positions in range(m) this item maps to."""
    raise NotImplementedError
~~~

~~~tests
bits = BitArray(20)
bits.set(0)
assert bits.get(0) and not bits.get(1)

positions = list(hashes("hello", 4, 1000))
assert len(positions) == 4
assert all(0 <= p < 1000 for p in positions), f"out of range: {positions}"

# k positions, not one position k times: a second hash that is always zero, or a
# step that does not move, collapses them and the filter stops filtering
assert len(set(positions)) == 4, f"the k positions are not distinct: {positions}"
spread = [len(set(hashes(f"item-{i}", 5, 4096))) for i in range(50)]
assert all(n == 5 for n in spread), "some items map to fewer than k distinct bits"

# the same item always gives the same positions, in this run and the next
assert list(hashes("hello", 4, 1000)) == positions
assert list(hashes("hello", 4, 1000)) == list(hashes("hello", 4, 1000))

# Items are normalised to bytes before hashing, so a value and its text form
# land in the same places. `hash()` does not do this: hash(5) is 5 and
# hash("5") is a randomised number.
assert list(hashes("hello", 4, 1000)) == list(hashes(b"hello", 4, 1000))
assert list(hashes(5, 4, 1000)) == list(hashes("5", 4, 1000)), (
    "normalise the item to bytes before hashing it"
)

# different items land differently, and different k gives different counts
assert list(hashes("hello", 4, 1000)) != list(hashes("world", 4, 1000))
assert len(list(hashes("hello", 7, 1000))) == 7
assert len(list(hashes("", 3, 64))) == 3

# bytes and str are both acceptable items
assert len(list(hashes(b"raw", 3, 100))) == 3
~~~

~~~solution
import hashlib


class BitArray:
    """A fixed row of bits, stored eight to the byte."""

    def __init__(self, size):
        self.size = size
        self.bits = bytearray((size + 7) // 8)

    def set(self, index):
        self.bits[index // 8] |= 1 << (index % 8)

    def get(self, index):
        return bool(self.bits[index // 8] & (1 << (index % 8)))

    def __len__(self):
        return self.size


def hashes(item, k, m):
    """The k positions in range(m) this item maps to.

    Kirsch-Mitzenmacher: two independent hashes generate as many as you like,
    because h1 + i * h2 is as good as an independent hash for this purpose.
    """
    data = item if isinstance(item, bytes) else str(item).encode()
    digest = hashlib.blake2b(data, digest_size=16).digest()
    h1 = int.from_bytes(digest[:8], "big")
    h2 = int.from_bytes(digest[8:], "big") | 1
    for i in range(k):
        yield (h1 + i * h2) % m
~~~

## The filter itself

Now the structure. `add(item)` sets every bit the item hashes to; `__contains__`
asks whether all of them are on. That asymmetry is the whole idea: a bit that is
off proves the item was never added, and bits that are all on prove nothing,
because other items could have set them.

So the answer is never "yes". It is "definitely not" or "probably yes", and a
Bloom filter is worth using exactly when a cheap "definitely not" saves an
expensive lookup, which is why they sit in front of databases and caches.

Implement `__contains__` rather than a `contains` method, because unit 22's
argument applies: a reader who has never seen this class will predict what `in`
means, and will be right.

@goal `BloomFilter(m, k)` supports `add`, `in`, and never reports a false negative.

~~~starter
import hashlib


class BitArray:
    """A fixed row of bits, stored eight to the byte."""

    def __init__(self, size):
        self.size = size
        self.bits = bytearray((size + 7) // 8)

    def set(self, index):
        self.bits[index // 8] |= 1 << (index % 8)

    def get(self, index):
        return bool(self.bits[index // 8] & (1 << (index % 8)))

    def __len__(self):
        return self.size


def hashes(item, k, m):
    """The k positions in range(m) this item maps to."""
    data = item if isinstance(item, bytes) else str(item).encode()
    digest = hashlib.blake2b(data, digest_size=16).digest()
    h1 = int.from_bytes(digest[:8], "big")
    h2 = int.from_bytes(digest[8:], "big") | 1
    for i in range(k):
        yield (h1 + i * h2) % m


class BloomFilter:
    """A set that answers "definitely not" or "probably yes"."""

    def __init__(self, size, k):
        self.bits = BitArray(size)
        self.k = k
        self.added = 0

    def add(self, item):
        """Record that this item was added."""
        raise NotImplementedError

    def __contains__(self, item):
        """False means definitely not. True means probably."""
        raise NotImplementedError

    def __len__(self):
        return self.added
~~~

~~~tests
f = BloomFilter(1024, 4)
assert len(f) == 0

f.add("ada")
assert "ada" in f
assert len(f) == 1

f.add("grace")
assert "ada" in f and "grace" in f
assert len(f) == 2

# the guarantee that matters: never a false negative, for anything added
import random

rng = random.Random(0)
big = BloomFilter(8192, 5)
words = [f"word-{rng.randrange(10**6)}" for _ in range(500)]
for w in words:
    big.add(w)
missing = [w for w in words if w not in big]
assert missing == [], f"{len(missing)} items were added and then reported absent"

# an empty filter contains nothing
empty = BloomFilter(256, 3)
assert "anything" not in empty

# adding the same item twice does not change the count of set bits
once = BloomFilter(512, 3)
once.add("x")
before = sum(once.bits.get(i) for i in range(512))
once.add("x")
assert sum(once.bits.get(i) for i in range(512)) == before

# `in` is the interface, not a method called contains
assert not hasattr(BloomFilter, "contains")
~~~

~~~solution
import hashlib


class BitArray:
    """A fixed row of bits, stored eight to the byte."""

    def __init__(self, size):
        self.size = size
        self.bits = bytearray((size + 7) // 8)

    def set(self, index):
        self.bits[index // 8] |= 1 << (index % 8)

    def get(self, index):
        return bool(self.bits[index // 8] & (1 << (index % 8)))

    def __len__(self):
        return self.size


def hashes(item, k, m):
    """The k positions in range(m) this item maps to."""
    data = item if isinstance(item, bytes) else str(item).encode()
    digest = hashlib.blake2b(data, digest_size=16).digest()
    h1 = int.from_bytes(digest[:8], "big")
    h2 = int.from_bytes(digest[8:], "big") | 1
    for i in range(k):
        yield (h1 + i * h2) % m


class BloomFilter:
    """A set that answers "definitely not" or "probably yes"."""

    def __init__(self, size, k):
        self.bits = BitArray(size)
        self.k = k
        self.added = 0

    def add(self, item):
        """Record that this item was added."""
        for position in hashes(item, self.k, len(self.bits)):
            self.bits.set(position)
        self.added += 1

    def __contains__(self, item):
        """False means definitely not. True means probably."""
        return all(self.bits.get(p) for p in hashes(item, self.k, len(self.bits)))

    def __len__(self):
        return self.added
~~~

## Measured against the formula

The last stage is the one that turns this from a toy into something you would
size for a real workload. The false positive rate of a Bloom filter is not a
mystery to be discovered by experiment; it is a formula, and your implementation
should match it.

For `m` bits, `k` hashes and `n` items added, the probability that a bit is
still zero is `(1 - 1/m) ** (k * n)`, so the chance that all `k` bits of an
absent item are on is `(1 - (1 - 1/m) ** (k * n)) ** k`. The optimal `k` for a
given `m` and `n` is `(m / n) * ln(2)`, rounded to an integer.

Add `expected_false_positive_rate()`, and a `for_capacity` classmethod that
sizes a filter from the two numbers anybody actually has: how many items, and
what error rate they can live with. Then measure: add `n` items, test items you
never added, and check the measured rate against the predicted one.

@goal `for_capacity(n, rate)` sizes a filter whose measured error matches the formula.

~~~starter
import hashlib
import math


class BitArray:
    """A fixed row of bits, stored eight to the byte."""

    def __init__(self, size):
        self.size = size
        self.bits = bytearray((size + 7) // 8)

    def set(self, index):
        self.bits[index // 8] |= 1 << (index % 8)

    def get(self, index):
        return bool(self.bits[index // 8] & (1 << (index % 8)))

    def __len__(self):
        return self.size


def hashes(item, k, m):
    """The k positions in range(m) this item maps to."""
    data = item if isinstance(item, bytes) else str(item).encode()
    digest = hashlib.blake2b(data, digest_size=16).digest()
    h1 = int.from_bytes(digest[:8], "big")
    h2 = int.from_bytes(digest[8:], "big") | 1
    for i in range(k):
        yield (h1 + i * h2) % m


class BloomFilter:
    """A set that answers "definitely not" or "probably yes"."""

    def __init__(self, size, k):
        self.bits = BitArray(size)
        self.k = k
        self.added = 0

    def add(self, item):
        for position in hashes(item, self.k, len(self.bits)):
            self.bits.set(position)
        self.added += 1

    def __contains__(self, item):
        return all(self.bits.get(p) for p in hashes(item, self.k, len(self.bits)))

    def __len__(self):
        return self.added

    @classmethod
    def for_capacity(cls, expected_items, error_rate):
        """A filter sized for this many items at this error rate."""
        raise NotImplementedError

    def expected_false_positive_rate(self):
        """The predicted rate, given how full this filter now is."""
        raise NotImplementedError
~~~

~~~tests
import math
import random

# sizing: more items or a tighter rate means more bits
small = BloomFilter.for_capacity(1000, 0.01)
looser = BloomFilter.for_capacity(1000, 0.1)
bigger = BloomFilter.for_capacity(10_000, 0.01)
assert len(small.bits) > len(looser.bits), "a tighter rate needs more bits"
assert len(bigger.bits) > len(small.bits), "more items need more bits"
assert small.k >= 1 and looser.k >= 1

# the classic result: about 9.6 bits per item for one percent
per_item = len(small.bits) / 1000
assert 9 < per_item < 11, f"{per_item:.1f} bits per item, expected about 9.6"

# k should be near the optimum, (m/n) ln 2
best_k = round((len(small.bits) / 1000) * math.log(2))
assert abs(small.k - best_k) <= 1, f"k={small.k}, optimum is {best_k}"

# an empty filter predicts no false positives
fresh = BloomFilter(1024, 4)
assert fresh.expected_false_positive_rate() == 0.0

# the prediction rises as it fills
fresh.add("a")
one = fresh.expected_false_positive_rate()
for i in range(50):
    fresh.add(f"item-{i}")
assert fresh.expected_false_positive_rate() > one

# and the measurement agrees with the prediction
rng = random.Random(7)
f = BloomFilter.for_capacity(2000, 0.02)
present = {f"in-{rng.randrange(10**9)}" for _ in range(2000)}
for item in present:
    f.add(item)

absent = [f"out-{rng.randrange(10**9)}" for _ in range(20_000)]
wrong = sum(1 for item in absent if item in f and item not in present)
measured = wrong / len(absent)
predicted = f.expected_false_positive_rate()
assert 0 < predicted < 0.05, f"predicted {predicted}"
assert abs(measured - predicted) < 0.01, (
    f"measured {measured:.4f}, formula predicts {predicted:.4f}"
)

# and nothing that was added is ever missing, whatever the rate
assert all(item in f for item in present)
~~~

~~~solution
import hashlib
import math


class BitArray:
    """A fixed row of bits, stored eight to the byte."""

    def __init__(self, size):
        self.size = size
        self.bits = bytearray((size + 7) // 8)

    def set(self, index):
        self.bits[index // 8] |= 1 << (index % 8)

    def get(self, index):
        return bool(self.bits[index // 8] & (1 << (index % 8)))

    def __len__(self):
        return self.size


def hashes(item, k, m):
    """The k positions in range(m) this item maps to."""
    data = item if isinstance(item, bytes) else str(item).encode()
    digest = hashlib.blake2b(data, digest_size=16).digest()
    h1 = int.from_bytes(digest[:8], "big")
    h2 = int.from_bytes(digest[8:], "big") | 1
    for i in range(k):
        yield (h1 + i * h2) % m


class BloomFilter:
    """A set that answers "definitely not" or "probably yes"."""

    def __init__(self, size, k):
        self.bits = BitArray(size)
        self.k = k
        self.added = 0

    def add(self, item):
        for position in hashes(item, self.k, len(self.bits)):
            self.bits.set(position)
        self.added += 1

    def __contains__(self, item):
        return all(self.bits.get(p) for p in hashes(item, self.k, len(self.bits)))

    def __len__(self):
        return self.added

    @classmethod
    def for_capacity(cls, expected_items, error_rate):
        """A filter sized for this many items at this error rate.

        m = -n ln(p) / (ln 2)^2 minimises the bits for a target rate, and
        k = (m/n) ln 2 minimises the rate for that many bits.
        """
        size = math.ceil(-expected_items * math.log(error_rate) / (math.log(2) ** 2))
        k = max(1, round((size / expected_items) * math.log(2)))
        return cls(size, k)

    def expected_false_positive_rate(self):
        """The predicted rate, given how full this filter now is."""
        m, k, n = len(self.bits), self.k, self.added
        still_zero = (1 - 1 / m) ** (k * n)
        return (1 - still_zero) ** k
~~~
