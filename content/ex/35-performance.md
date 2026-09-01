---
slug: 35-performance
---

## Quadratic, and invisible at ten rows

`common` checks each name against a list. Membership in a list is a scan, so the cost is the product of the two sizes rather than their sum.

@expect silent
@hint How long does `x in some_list` take, and how many times does this do it?
@hint Unit 12 answered this. The fix is one word.
@diagnose silent It gives the right answer, and the test counted how it got there: one full scan of the list per name. `x in list` walks until it matches, so doing it once per name is the product of the two sizes, which is fine at ten rows and fatal at a hundred thousand. Converting the collection you search into a `set` makes each test a hash lookup, and pays for itself after about two lookups. This is the single most common performance bug in real Python, and it is the kind that matters most: not a constant factor but a change of shape, invisible on a small sample and catastrophic on a real one.

~~~starter
def common(names, known):
    """The names that appear in `known`, in order."""
    return [name for name in names if name in known]
~~~

~~~tests
class Watched(list):
    """A list that records how often something searched it end to end."""

    scans = 0

    def __contains__(self, item):
        Watched.scans += 1
        return list.__contains__(self, item)


known = Watched(str(i) for i in range(2000))
names = [str(i) for i in range(1000, 3000)]

assert common(["1", "9999"], Watched(["1", "2"])) == ["1"]
assert len(common(names, known)) == 1000
assert Watched.scans == 0, (
    f"the list was searched {Watched.scans} times, once per name"
)
~~~

~~~solution
def common(names, known):
    """The names that appear in `known`, in order."""
    lookup = set(known)
    return [name for name in names if name in lookup]
~~~

## A string built one copy at a time

`render` grows an accumulator with `+`. Strings are immutable, so each step copies everything so far, and the total copied is the square of the length.

@expect silent
@hint Strings are immutable. What has to happen for `out + row` to produce a longer string?
@hint Collect the pieces, then join them once.
@diagnose silent It produces the right text, and the test counted the characters copied on the way: not the length of the result but roughly its square. A string cannot be extended in place, so `out + row` allocates a new string holding both and copies each of them into it; doing that n times copies the accumulated length n times over. `"\n".join(rows)` walks the list once to add up the lengths, allocates the result once, and fills it, which is linear. This is the classic accidental quadratic alongside membership in a list, and like that one it is invisible at ten rows. CPython does have an optimisation that sometimes extends a string in place, when the old one has exactly one reference; it is an implementation detail, it does not apply through a subclass, and it is not something to rely on.

~~~starter
def render(rows):
    """Join the rows with newlines between them."""
    if not rows:
        return ""
    out = rows[0]
    for row in rows[1:]:
        out = out + "\n" + row
    return out
~~~

~~~tests
class Watched(str):
    """A string that records how many characters get copied out of it."""

    copied = 0

    def __add__(self, other):
        Watched.copied += len(self)
        return Watched(str.__add__(self, other))


assert render([Watched("a"), Watched("b")]) == "a\nb"
assert render([]) == ""
assert render([Watched("only")]) == "only"

Watched.copied = 0
rows = [Watched("x" * 10) for _ in range(200)]
assert len(render(rows)) == 200 * 10 + 199
assert Watched.copied == 0, (
    f"{Watched.copied} characters were copied to build a string of 2199"
)
~~~

~~~solution
def render(rows):
    """Join the rows with newlines between them."""
    return "\n".join(rows)
~~~

## Work repeated inside the loop

`report` recomputes the same total on every iteration. Nothing inside the loop changes it, so the whole computation belongs outside.

@expect silent
@hint What does `total` depend on, and does any of it change during the loop?
@hint Compute it once.
@diagnose silent It gives the right answer and computes the total once per row, because the expensive call sits inside the loop and depends on nothing the loop changes. Hoisting an invariant out of a loop is the plainest optimisation there is, and the reason it keeps happening is that the expression usually starts outside and migrates inwards during a refactor. This is the cheapest kind of win available, because it changes the number of times the work happens rather than how fast the work is, and those are the wins worth looking for first: making a function twenty percent faster is a percentage, and calling it once instead of a thousand times is a multiple.

~~~starter
CALLS = {"total": 0}


def expensive_total(rows):
    CALLS["total"] += 1
    return sum(rows)


def report(rows):
    """One line per row, each showing its share of the total."""
    lines = []
    for row in rows:
        lines.append(f"{row}/{expensive_total(rows)}")
    return lines
~~~

~~~tests
CALLS["total"] = 0
assert report([1, 2, 3]) == ["1/6", "2/6", "3/6"]
assert CALLS["total"] == 1, f"the total was computed {CALLS['total']} times"
assert report([]) == []
~~~

~~~solution
CALLS = {"total": 0}


def expensive_total(rows):
    CALLS["total"] += 1
    return sum(rows)


def report(rows):
    """One line per row, each showing its share of the total."""
    if not rows:
        return []
    total = expensive_total(rows)
    return [f"{row}/{total}" for row in rows]
~~~

## One request per row

`load_users` fetches each user separately. A round trip per item is the shape that turns a fast query into a slow page.

@expect silent
@hint How many times does this cross the boundary, and how many times does it need to?
@hint The backend already accepts several ids at once.
@diagnose silent It returns the right users and asks for them one at a time, which is the N+1 query problem: a fixed cost per round trip, paid once per row, where one request would have done. It is the most expensive mistake on this list in practice, because the per-request cost is often a millisecond of network rather than a microsecond of Python, so a hundred rows is a tenth of a second of doing nothing. Batching is a multiple rather than a percentage, and the fix is nearly always available: `WHERE id IN (...)`, a bulk endpoint, `select_related` in an ORM. The tell in a profile is a function with a large `cumtime`, a small `tottime` and a very large call count.

~~~starter
REQUESTS: list[tuple] = []
USERS = {1: "ada", 2: "bob", 3: "cleo"}


def fetch_users(ids):
    """One request. The backend takes as many ids as you like."""
    REQUESTS.append(tuple(ids))
    return {i: USERS[i] for i in ids if i in USERS}


def load_users(ids):
    """The names for these ids, in order."""
    return [fetch_users([i])[i] for i in ids]
~~~

~~~tests
REQUESTS.clear()
assert load_users([1, 2, 3]) == ["ada", "bob", "cleo"]
assert len(REQUESTS) == 1, f"{len(REQUESTS)} requests were made for 3 users"

REQUESTS.clear()
assert load_users([]) == []
~~~

~~~solution
REQUESTS: list[tuple] = []
USERS = {1: "ada", 2: "bob", 3: "cleo"}


def fetch_users(ids):
    """One request. The backend takes as many ids as you like."""
    REQUESTS.append(tuple(ids))
    return {i: USERS[i] for i in ids if i in USERS}


def load_users(ids):
    """The names for these ids, in order."""
    if not ids:
        return []
    found = fetch_users(ids)
    return [found[i] for i in ids]
~~~

## Sorting to find the smallest few

`smallest` sorts everything and takes the first three. Sorting is more work than the question needs.

@expect silent
@hint Sorting orders every element. How many do you actually need ordered?
@hint `heapq` has a function with exactly this name.
@diagnose silent It gives the right answer by ordering ten thousand elements to look at three. `heapq.nsmallest(n, items)` keeps a heap of size n and walks the input once, which is a different shape of cost: linear in the input and logarithmic in n, rather than n log n over everything. The same applies to `nlargest`, and to `min` and `max` when n is one. It is worth recognising as a family: `bisect` for searching a sorted list, `heapq` for the smallest few, `collections.Counter.most_common` for the commonest few. Each one answers a narrower question than sorting does, and costs correspondingly less.

~~~starter
def smallest(items, n):
    """The n smallest items, in order."""
    return sorted(items)[:n]
~~~

~~~tests
class Watched(list):
    """A list that records how often something sorted it."""

    sorts = 0


def counting_sorted(items, **kwargs):
    if isinstance(items, Watched):
        Watched.sorts += 1
    return _real_sorted(items, **kwargs)


_real_sorted = sorted
sorted = counting_sorted  # noqa: A001

data = Watched(range(1000, 0, -1))
assert smallest(data, 3) == [1, 2, 3]
assert Watched.sorts == 0, "the whole list was sorted to find three items"
assert smallest([5, 1], 5) == [1, 5]
~~~

~~~solution
import heapq


def smallest(items, n):
    """The n smallest items, in order."""
    return heapq.nsmallest(n, items)
~~~

## A check that kept going after it knew

`has_failure` walks every row and records whether any failed. It has the answer at the first failure and carries on to the end regardless.

@expect silent
@hint Once one row has failed, is there anything left to find out?
@hint There is a builtin that answers this and stops at the first true value.
@diagnose silent It gives the right answer and checks every row to get it, because the loop sets a flag and keeps going. Note that ruff says nothing here: its `SIM110` rule fires on the shape that returns from inside the loop, and this one accumulates into a variable instead, which is far enough from the pattern to slip past. A linter finds the mistakes somebody wrote a rule for, and this is a reminder that the set of mistakes is larger. `any(...)` stops at the first true value, which matters whenever the check costs something: a query, a request, a parse. The generator inside matters too, and is the difference between `any(check(r) for r in rows)` and `any([check(r) for r in rows])`: the second builds the whole list first, checking everything, and throws the short-circuit away. This is the same class of win as the others in this unit, doing the work fewer times rather than doing it faster, and it is the one most often available for free.

~~~starter
CHECKED: list[str] = []


def check(row):
    CHECKED.append(row)
    return row.startswith("bad")


def has_failure(rows):
    """Whether any row failed."""
    found = False
    for row in rows:
        if check(row):
            found = True
    return found
~~~

~~~tests
CHECKED.clear()
assert has_failure(["bad-1", "ok", "ok"]) is True
assert CHECKED == ["bad-1"], f"checked {CHECKED} after already knowing"

CHECKED.clear()
assert has_failure(["ok", "ok"]) is False
assert CHECKED == ["ok", "ok"]
assert has_failure([]) is False
~~~

~~~solution
CHECKED: list[str] = []


def check(row):
    CHECKED.append(row)
    return row.startswith("bad")


def has_failure(rows):
    """Whether any row failed."""
    return any(check(row) for row in rows)
~~~

## Optimised against the wrong input

`choose` picks an algorithm by measuring both on a sample. The sample is ten rows, where the naive one wins and the real workload is a hundred thousand.

@expect silent
@hint A measurement on ten rows tells you about ten rows.
@hint Which of the two changes shape as the input grows?
@diagnose silent It runs, and it chose the quadratic algorithm, because on ten rows the scan really is faster: it has no set to build and no hashing to do. Optimising against a small sample regularly makes the large case worse, precisely because the algorithm that wins at small n is usually the naive one. The measurement to make is not "which is faster on my sample" but "how does each one grow", and the cheapest version of it is to run on ten times the data and see whether the time goes up ten times or a hundred. That single comparison separates a constant-factor problem, which stays the size it is, from an accidental quadratic, which is invisible small and fatal large.

~~~starter
COSTS = {
    "scan": lambda n: n * n,
    "hash": lambda n: 12 * n,
}


def choose(sample_size, real_size):
    """Pick the algorithm that will be faster on the real workload."""
    return min(COSTS, key=lambda name: COSTS[name](sample_size))
~~~

~~~tests
assert choose(sample_size=10, real_size=100_000) == "hash", (
    "the algorithm was chosen on the sample rather than the real workload"
)
assert choose(sample_size=10, real_size=10) == "scan"
assert choose(sample_size=100_000, real_size=100_000) == "hash"
~~~

~~~solution
COSTS = {
    "scan": lambda n: n * n,
    "hash": lambda n: 12 * n,
}


def choose(sample_size, real_size):
    """Pick the algorithm that will be faster on the real workload."""
    return min(COSTS, key=lambda name: COSTS[name](real_size))
~~~

## The largest number in the profile, and the one you can change

`what_to_fix` reads a profile and picks the biggest entry. The biggest entry is time spent waiting on a socket, which no optimisation will touch.

@expect silent
@hint Which of these entries is your code, and which is the program waiting?
@hint The number to look at is the largest one you can change.
@diagnose silent It runs and points at `socket.recv`, which is the program waiting for a server on the other side of the world and is not something an optimisation can help with. A profile dominated by waiting is telling you to look at unit 33: overlap the waiting, or make fewer requests. The number worth acting on is the largest one **you can change**, which means your own code. The related habit is reading `tottime` against `cumtime`: a large `cumtime` with a small `tottime` means the time is underneath, so keep looking down; a large `tottime` means the work is right there.

~~~starter
PROFILE = [
    {"name": "socket.recv", "tottime": 8.10, "ours": False},
    {"name": "parse_row", "tottime": 1.90, "ours": True},
    {"name": "json.loads", "tottime": 0.40, "ours": False},
    {"name": "format_line", "tottime": 0.20, "ours": True},
]


def what_to_fix(profile):
    """The entry worth spending effort on."""
    return max(profile, key=lambda e: e["tottime"])["name"]
~~~

~~~tests
assert what_to_fix(PROFILE) == "parse_row", f"picked {what_to_fix(PROFILE)}"
assert what_to_fix(PROFILE[:1]) is None, "a profile that is all waiting has nothing to fix"
~~~

~~~solution
PROFILE = [
    {"name": "socket.recv", "tottime": 8.10, "ours": False},
    {"name": "parse_row", "tottime": 1.90, "ours": True},
    {"name": "json.loads", "tottime": 0.40, "ours": False},
    {"name": "format_line", "tottime": 0.20, "ours": True},
]


def what_to_fix(profile):
    """The entry worth spending effort on."""
    ours = [entry for entry in profile if entry["ours"]]
    if not ours:
        return None
    return max(ours, key=lambda e: e["tottime"])["name"]
~~~
