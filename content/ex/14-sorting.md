---
slug: 14-sorting
---

## Calling the key instead of passing it

`by_length` sorts words by how long they are. It hands `key` the result of a call rather than the function itself, and the error names the type it was given.

@expect raises:TypeError
@hint `key` wants a function. Ask what `len(words)` is.
@hint The value of `key` should be a name or a lambda, never a call with its arguments already applied.
@diagnose TypeError `key=len(words)` computes the length of the whole list and passes that integer, and an integer is not callable. `key` takes a **function** that will be called once per element, so its value should be a bare name (`key=len`), a lambda, or something like `operator.itemgetter`. The mistake is easy to make because every other argument in the call is a value, and the error lands one step from the line that is wrong: the complaint is about an `int` rather than about the key.

~~~starter
def by_length(words):
    """Return the words sorted from shortest to longest."""
    return sorted(words, key=len(words))


print(by_length(["ccc", "a", "bb"]))
~~~

~~~tests
assert by_length(["ccc", "a", "bb"]) == ["a", "bb", "ccc"]
assert by_length([]) == []
~~~

~~~solution
def by_length(words):
    """Return the words sorted from shortest to longest."""
    return sorted(words, key=len)


print(by_length(["ccc", "a", "bb"]))
~~~

## Sorting in place and returning it

`ranked` sorts a caller's rows and hands the result back. `list.sort` reorders in place and returns `None`, so the caller gets nothing and their list is reordered as a parting gift.

@expect raises:TypeError
@hint What does an in-place operation return, throughout the standard library?
@hint There is a builtin that leaves its argument alone and returns a new list.
@diagnose TypeError `list.sort()` returns `None`, so the subscript in the test fails on `NoneType`. Two lessons in one line, and the second is the important one. The convention that in-place operations return `None` exists so that chaining off one fails immediately instead of quietly, which is the same rule met with `reverse` in unit 10 and `update` in unit 12. And sorting the caller's list at all is a side effect they did not ask for: `sorted(rows)` builds a new list and leaves theirs alone, which is what a function that returns a ranking should do.

~~~starter
def ranked(rows):
    """Return the rows in ascending order, leaving the caller's list alone."""
    return rows.sort()


print(ranked([3, 1, 2])[0])
~~~

~~~tests
original = [3, 1, 2]
assert ranked(original) == [1, 2, 3]
assert original == [3, 1, 2], f"the caller's list was reordered: {original}"
~~~

~~~solution
def ranked(rows):
    """Return the rows in ascending order, leaving the caller's list alone."""
    return sorted(rows)


print(ranked([3, 1, 2])[0])
~~~

## Two levels, one of them backwards

`leaderboard` orders players by team and then by score, highest first. `reverse=True` reverses the whole ordering rather than one level of it.

@expect silent
@hint `reverse=True` applies to the entire key, not to part of it.
@hint For a number, there is a way to reverse one level inside the tuple.
@diagnose silent It runs, and the teams come out backwards along with the scores, because `reverse=True` reverses the comparison of the whole tuple. A tuple key compares elementwise, so the way to reverse one level and not another is to reverse that element itself: negate a number, as `(team, -score)`. For anything you cannot negate, sort twice, least significant field first, which works precisely because the sort is stable and leaves equal elements in the order it found them.

~~~starter
def leaderboard(players):
    """Order by team ascending, then by score descending."""
    return sorted(players, key=lambda p: (p["team"], p["score"]), reverse=True)
~~~

~~~tests
players = [
    {"team": "b", "score": 5},
    {"team": "a", "score": 3},
    {"team": "a", "score": 9},
]
out = [(p["team"], p["score"]) for p in leaderboard(players)]
assert out == [("a", 9), ("a", 3), ("b", 5)], f"got {out}"
~~~

~~~solution
def leaderboard(players):
    """Order by team ascending, then by score descending."""
    return sorted(players, key=lambda p: (p["team"], -p["score"]))
~~~

## Ordering needs more than equality

`Version` knows when two versions are equal, and `sorted` needs to know when one is less than another. Unit 04 met this; here it is with the error a sort produces.

@expect raises:TypeError
@expect mypy:type-var
@hint Sorting orders elements. Which method does ordering use?
@hint Comparing tuples of the fields already does the elementwise work.
@diagnose TypeError Sorting needs `<`, which comes from `__lt__`, and Python will not invent an ordering from `__eq__` because there is no defensible way to derive one. Three ways to supply it: write `__lt__` comparing a tuple of the fields, add `functools.total_ordering` to fill in the remaining four from `__eq__` and `__lt__`, or use a dataclass with `order=True`, which generates all of them from the field order. The tuple comparison is doing the real work in every case, because tuples compare elementwise.
@diagnose type-var mypy reports it statically: `sorted` declares that its elements must support comparison, expressed as a type variable bound to a protocol with `__lt__`, and this class does not satisfy it. The message is about a type variable rather than a missing method, which takes a moment to read the first time.

~~~starter
class Version:
    def __init__(self, major, minor):
        self.major = major
        self.minor = minor

    def __eq__(self, other):
        return (self.major, self.minor) == (other.major, other.minor)

    def __repr__(self):
        return f"Version({self.major}, {self.minor})"


print(sorted([Version(1, 5), Version(1, 2)]))
~~~

~~~tests
versions = [Version(2, 0), Version(1, 5), Version(1, 2)]
assert sorted(versions) == [Version(1, 2), Version(1, 5), Version(2, 0)]
assert max(versions) == Version(2, 0)
~~~

~~~solution
class Version:
    def __init__(self, major, minor):
        self.major = major
        self.minor = minor

    def __eq__(self, other):
        return (self.major, self.minor) == (other.major, other.minor)

    def __lt__(self, other):
        return (self.major, self.minor) < (other.major, other.minor)

    def __repr__(self):
        return f"Version({self.major}, {self.minor})"


print(sorted([Version(1, 5), Version(1, 2)]))
~~~

## Sorting text by code point

`alphabetical` sorts names for display. It sorts them by code point, which puts every capital letter before every lowercase one and is not alphabetical order in any language.

@expect silent
@hint Compare `"Apple"` and `"banana"` character by character. Where do the capitals sit?
@hint There is a string method that makes the comparison case-insensitive, and a better one for text that is not English.
@diagnose silent Nothing raised, and everything beginning with a capital sorted first. String comparison is by code point, and in that table every uppercase ASCII letter comes before every lowercase one, so a mixed-case list separates into two blocks rather than interleaving. `key=str.lower` fixes the common case, and `key=str.casefold` handles more of the awkward ones, such as the German sharp s comparing equal to "ss". Note the form: passing the unbound method means each element becomes `str.lower(element)`, which is both faster than a lambda and clearer. Correct alphabetical order beyond that is language-dependent and genuinely hard, and a library is the honest answer when it matters.

~~~starter
def alphabetical(names):
    """Return the names in case-insensitive alphabetical order."""
    return sorted(names)
~~~

~~~tests
assert alphabetical(["banana", "Apple", "cherry"]) == ["Apple", "banana", "cherry"]
assert alphabetical(["b", "A", "c"]) == ["A", "b", "c"]
assert alphabetical(["Zoe", "adam"]) == ["adam", "Zoe"], "capitals were sorted before everything"
~~~

~~~solution
def alphabetical(names):
    """Return the names in case-insensitive alphabetical order."""
    return sorted(names, key=str.lower)
~~~

## The unknowns that could not be compared

`by_date` orders records by date, and some records have no date. Comparing a date with `None` has no answer, and the sort says so.

@expect raises:TypeError
@hint What does `None < 3` give you? Ordering across unrelated types was removed in Python 3.
@hint A tuple key can put the unknowns at one end, using a flag that sorts before the value.
@diagnose TypeError There is no ordering between `None` and a number, and Python 3 raises rather than inventing one, which is the change from Python 2 that removed a family of sorting bugs. The idiom for "unknowns last" is a tuple key whose first element is a boolean: `(r["date"] is None, r["date"])`. `False` sorts before `True`, so the known dates come first, and the comparison never reaches the second element when the flags differ, which is what stops the `None` from ever being compared. Swap the flag for "unknowns first".

~~~starter
def by_date(records):
    """Order records by date, with the undated ones last."""
    return sorted(records, key=lambda r: r["date"])


print(by_date([{"date": 2}, {"date": None}]))
~~~

~~~tests
records = [{"date": 3}, {"date": None}, {"date": 1}]
out = [r["date"] for r in by_date(records)]
assert out == [1, 3, None], f"got {out}"
assert [r["date"] for r in by_date([{"date": None}])] == [None]
~~~

~~~solution
def by_date(records):
    """Order records by date, with the undated ones last."""
    return sorted(records, key=lambda r: (r["date"] is None, r["date"] or 0))


print(by_date([{"date": 2}, {"date": None}]))
~~~

## Sorting everything to take three

`top_three` returns the three largest values. It sorts the whole collection to do it, which is more work than the question needs when the collection is large.

@expect silent
@hint How much of the sorted order does this function actually use?
@hint `heapq` keeps only as many as you asked for and walks the input once.
@diagnose silent It runs and gives the right answer, and it also mutates the caller's list, because `sort` reorders in place. Two things to take. A function that sorts a list it was handed has changed the caller's data as a side effect, and `sorted` is the version that does not. And sorting everything to look at three of it is doing n log n work for a question that needs one pass: `heapq.nlargest(3, values)` keeps a heap of three and walks the input once, which is the right shape whenever the number wanted is small relative to the input. For exactly one, `max` with a `key` is better still.

~~~starter
def top_three(values):
    """Return the three largest values, highest first."""
    values.sort(reverse=True)
    return values[:3]
~~~

~~~tests
original = [5, 1, 9, 3, 7]
assert top_three(original) == [9, 7, 5]
assert original == [5, 1, 9, 3, 7], f"the caller's list was reordered: {original}"
assert top_three([1]) == [1]
assert top_three([]) == []
~~~

~~~solution
import heapq


def top_three(values):
    """Return the three largest values, highest first."""
    return heapq.nlargest(3, values)
~~~

## Sorting twice, in the wrong order

`grouped` orders rows by department and then by name within each department. It sorts by the most significant field first and then re-sorts, which throws the first ordering away.

@expect silent
@hint A stable sort preserves the order of equal elements. Which sort should therefore run first?
@hint Sort by the least significant field first, and let stability carry it through.
@diagnose silent It runs, and the names come out unordered within each department. Sorting twice works because the sort is stable: equal elements keep the order they were already in, so an earlier sort survives inside the groups a later one creates. That only helps in one direction. Sorting by department last preserves the name ordering within each department; sorting by name last destroys the department ordering entirely. The rule is least significant field first. The single-pass alternative says it more plainly: one sort with a tuple key, `(dept, name)`, which needs no reasoning about stability at all.

~~~starter
def grouped(rows):
    """Order rows by department, and by name within each department."""
    rows = list(rows)
    rows.sort(key=lambda r: r["dept"])
    rows.sort(key=lambda r: r["name"])
    return rows
~~~

~~~tests
# a name in the later department must sort before one in the earlier department,
# or both orderings agree by accident and the bug is invisible
rows = [
    {"dept": "b", "name": "ada"},
    {"dept": "a", "name": "zoe"},
    {"dept": "a", "name": "bob"},
]
out = [(r["dept"], r["name"]) for r in grouped(rows)]
assert out == [("a", "bob"), ("a", "zoe"), ("b", "ada")], f"got {out}"
~~~

~~~solution
def grouped(rows):
    """Order rows by department, and by name within each department."""
    return sorted(rows, key=lambda r: (r["dept"], r["name"]))
~~~
