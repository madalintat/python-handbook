---
slug: 25-typecheck
---

## One ignore, two errors

The line carries a `# type: ignore` with no code. There are two problems on it, and the bare form silences both.

@expect raises:TypeError
@hint mypy reported nothing. Cover the comment and ask what it was hiding.
@hint An ignore should name the one code it means to silence.
@diagnose TypeError mypy said nothing at all, which is the point of the exercise: a bare `# type: ignore` silences **every** error on its line, and this line has two. One is the argument, a `list[str]` where `list[int]` was declared. The other is `"total: " + <int>`, which is the failure you actually get. Naming the code, `# type: ignore[arg-type]`, would have let the second one through. That is why the rule is to always name it, and why `warn_unused_ignores` is worth turning on: it tells you when an ignore has outlived its reason, which is how they get removed rather than accumulating for a decade.

~~~starter
def total(values: list[int]) -> int:
    """Add up a list of numbers."""
    return sum(values)


def report(raw: list[str]) -> str:
    """Describe the total of some numbers that arrived as text."""
    return "total: " + total(raw)  # type: ignore


print(report(["1", "2"]))
~~~

~~~tests
assert report(["1", "2", "3"]) == "total: 6"
assert report([]) == "total: 0"
assert total([1, 2]) == 3
~~~

~~~solution
def total(values: list[int]) -> int:
    """Add up a list of numbers."""
    return sum(values)


def report(raw: list[str]) -> str:
    """Describe the total of some numbers that arrived as text."""
    return f"total: {total([int(value) for value in raw])}"


print(report(["1", "2"]))
~~~

## An assertion nothing checks

`cast` tells the checker to believe something. It generates no code, so when the belief is wrong nothing finds out until the value is used.

@expect raises:AttributeError
@hint `cast` is not a conversion and not a check. What does it actually do at run time?
@hint There is a way to state the same belief that is verified when the program runs.
@diagnose AttributeError mypy reported nothing, because `cast` told it to stop asking, and at run time `cast` is close to a no-op: it returns its second argument unchanged. So an `int` travelled through a function that had promised the checker it was a `str`, and failed at the first string method. `assert isinstance(value, str)` states the same belief and is genuinely checked, which makes it the better of the two whenever the cost is acceptable. Better still here, the function does not need to assert anything: an `isinstance` test with a branch for each case is shorter than the cast and handles the input the caller actually sends.

~~~starter
from typing import cast


def label(value: object) -> str:
    """Render any value as an upper-case label."""
    text = cast(str, value)
    return text.upper()


print(label(42))
~~~

~~~tests
assert label("ada") == "ADA"
assert label(42) == "42"
assert label(None) == "NONE"
~~~

~~~solution
def label(value: object) -> str:
    """Render any value as an upper-case label."""
    if isinstance(value, str):
        return value.upper()
    return str(value).upper()


print(label(42))
~~~

## An attribute the checker cannot see

`Session.token` is never assigned inside the class at all: a caller sets it from outside. mypy has no way to know the attribute exists, and a session nobody set it on finds out at the first read.

@expect mypy:attr-defined
@expect raises:AttributeError
@hint mypy learns a class's attributes from its class body and its methods. Where is this one assigned?
@hint Declaring it in the class body with a type and no value is the fix, and it also documents the object.
@diagnose attr-defined mypy reports that `Session` has no attribute `token`, at the read and at the assignment both. It learns a class's attributes from the class body and from assignments in its own methods, and this one is assigned only from outside, where nothing declares it. It is not being pedantic: an attribute that exists only on some paths is exactly the shape that fails in production and not in testing.
@diagnose AttributeError The run-time half. `describe` was called on a session that had not connected, and the attribute genuinely did not exist. Declaring `token: str | None = None` in the class body fixes both at once: the checker now knows the attribute, and it knows it may be `None`, so it will ask for a guard at every read. That second half is the real win, because the missing attribute has become a missing **value**, which is a thing the type system can talk about.

~~~starter
class Session:
    def __init__(self, host: str) -> None:
        self.host = host

    def describe(self) -> str:
        return f"{self.host}:{self.token}"


session = Session("localhost")
session.token = "abc123"
print(session.describe())
~~~

~~~tests
fresh = Session("example.com")
assert fresh.describe() == "example.com:(not connected)"

fresh.token = "xyz"
assert fresh.describe() == "example.com:xyz"
~~~

~~~solution
class Session:
    token: str | None = None

    def __init__(self, host: str) -> None:
        self.host = host

    def describe(self) -> str:
        if self.token is None:
            return f"{self.host}:(not connected)"
        return f"{self.host}:{self.token}"


session = Session("localhost")
session.token = "abc123"
print(session.describe())
~~~

## One name doing two jobs

`count` starts as a number and is reassigned to a string when there is nothing to count. Everything below it then has to handle both.

@expect mypy:assignment
@expect raises:TypeError
@hint mypy inferred a type from the first assignment. What does the second one do to it?
@hint The fix is a second name, not a broader annotation.
@diagnose assignment mypy inferred `int` from `count = 0` and reports the string assigned to it later. Widening the annotation to `int | str` would silence this and make everything downstream worse, because every use would then need a guard. The error is worth reading as a design note rather than a type complaint: a name that holds two kinds of thing is a name doing two jobs, and separating them is an improvement whether or not anybody is running a checker.
@diagnose TypeError The run-time consequence, arriving at the arithmetic. Two names, or a `count` that stays a number with the "nothing found" case handled by the caller, both fix it. The second is usually better: returning `0` and letting the caller decide how to describe it keeps the type honest and moves the presentation to where presentation belongs.

~~~starter
def describe(items: list[str], target: str) -> str:
    """Say how many times target appears."""
    count = 0
    for item in items:
        if item == target:
            count += 1
    if count == 0:
        count = "none"
    return f"found {count}, or {count + 1} with one more"


print(describe([], "a"))
~~~

~~~tests
assert describe(["a", "b", "a"], "a") == "found 2, or 3 with one more"
assert describe([], "a") == "found 0, or 1 with one more"
~~~

~~~solution
def describe(items: list[str], target: str) -> str:
    """Say how many times target appears."""
    count = 0
    for item in items:
        if item == target:
            count += 1
    return f"found {count}, or {count + 1} with one more"


print(describe([], "a"))
~~~

## An empty container with nothing to go on

`seen = []` gives the checker no way to know what the list holds, so it asks. The annotation it wants is also the thing that would have caught what gets put in.

@expect mypy:arg-type
@expect silent
@hint mypy worked out what the list holds from the first thing appended to it. Look at the second.
@hint The list is being used to carry two kinds of thing, and only one of them belongs.
@diagnose arg-type mypy inferred `list[int]` from the first `append` and reports the second, which puts a string in. Inference from first use is why an empty container does not always need an annotation, and `var-annotated`, the error asking for one, appears only when there is nothing at all to infer from. Either way the lesson is the same: once the element type is known, every later use of the container is checkable, which is what makes annotating the empty one worth the keystrokes.
@diagnose silent Nothing raised, and the total was wrong, because a string was appended alongside the numbers and `len` was summed for it rather than the value. With `seen: list[int] = []` the checker reports the append immediately, and the bug never reaches a test. That is the shape of the argument for annotating containers: the annotation on the empty one is what makes every later use of it checkable.

~~~starter
def collect(rows: list[dict[str, int]]) -> int:
    """Add up every score, skipping rows that have none."""
    seen = []
    for row in rows:
        if "score" in row:
            seen.append(row["score"])
        else:
            seen.append("missing")
    return sum(value if isinstance(value, int) else len(value) for value in seen)
~~~

~~~tests
assert collect([{"score": 3}, {"score": 4}]) == 7
assert collect([{"score": 3}, {}]) == 3, (
    f"a row with no score contributed {collect([{'score': 3}, {}]) - 3}"
)
assert collect([]) == 0
~~~

~~~solution
def collect(rows: list[dict[str, int]]) -> int:
    """Add up every score, skipping rows that have none."""
    seen: list[int] = []
    for row in rows:
        if "score" in row:
            seen.append(row["score"])
    return sum(seen)
~~~

## An operator with nothing to apply

`banner` builds a line by multiplying a string by a string. mypy knows which operand types `*` accepts, and this is not one of them.

@expect mypy:operator
@expect raises:TypeError
@hint Read the annotation of `width`, then read what it is used for.
@hint The value arrives as text and is used as a number.
@diagnose operator mypy reports that `*` is not defined between `str` and `str`. The `operator` code covers every arithmetic and comparison mismatch, and it is one of the most reliably useful, because a wrong operand type usually means a value is not the kind of thing you thought it was several lines earlier. That is the case here: `width` is text, and everything downstream assumed a number.
@diagnose TypeError The same fact at run time. Converting at the boundary, `int(width)` where the value enters, is the fix that scales: the alternative is converting at each use, which works until somebody adds a use and forgets. Unit 23's argument about validating at the edges is the same principle one size up, and it is why a parser at the boundary beats a check at every call site.

~~~starter
def banner(text: str, width: str) -> str:
    """Draw text above a rule of the given width."""
    return text + "\n" + "-" * width


print(banner("hi", "4"))
~~~

~~~tests
assert banner("hi", "4") == "hi\n----"
assert banner("", "0") == "\n"
~~~

~~~solution
def banner(text: str, width: str) -> str:
    """Draw text above a rule of the given width."""
    return text + "\n" + "-" * int(width)


print(banner("hi", "4"))
~~~

## Indexing with the wrong kind of key

`lookup` is annotated as a dict keyed by name. The function indexes it with a number, which mypy compares against the declared key type.

@expect mypy:index
@expect raises:KeyError
@hint The annotation says what the keys are. Compare it against what the function passes.
@hint The row already holds the value under a name.
@diagnose index mypy reports an invalid index type: the mapping is declared `dict[str, int]` and the subscript is an `int`. The `index` code covers subscripting generally, so it also catches indexing a `TypedDict` with an unknown key and slicing something that does not support it. It is worth noticing how much information the annotation on `lookup` did here: without it the parameter would be `Any` and nothing would have been checked at all.
@diagnose KeyError No key `0` in the dict, which is what indexing a mapping with a position gets you. Dicts and sequences both use square brackets and mean entirely different things by them, and the annotation is what keeps the two apart. When a function genuinely needs both a position and a name, that is usually two collections, or one list of records.

~~~starter
def totals(lookup: dict[str, int], names: list[str]) -> int:
    """Add up the values for the given names."""
    running = 0
    for index in range(len(names)):
        running += lookup[index]
    return running


print(totals({"a": 1}, ["a"]))
~~~

~~~tests
assert totals({"a": 1, "b": 2}, ["a", "b"]) == 3
assert totals({"a": 1, "b": 2}, ["b"]) == 2
assert totals({}, []) == 0
~~~

~~~solution
def totals(lookup: dict[str, int], names: list[str]) -> int:
    """Add up the values for the given names."""
    running = 0
    for name in names:
        running += lookup[name]
    return running


print(totals({"a": 1}, ["a"]))
~~~

## A literal that does not match its declaration

`SCORES` is annotated as a list of numbers and one of its elements is text. The annotation is checked against the literal that fills it.

@expect mypy:list-item
@expect raises:TypeError
@hint The annotation is on the list. Look at every element against it.
@hint The error names the position.
@diagnose list-item mypy reports the element that does not fit, naming its position, which is more than it can do for a list built at run time. This is the case for annotating module-level data even when the value is right there: a literal is checked against its annotation immediately, so a typo in a table of constants is caught at the moment it is written rather than at whatever line first touches that row.
@diagnose TypeError `sum` reached the string and stopped. In a longer table this is the version of the bug that is genuinely hard: the failure is in a function that is correct, the traceback names no line that is wrong, and the actual mistake is one character in a list somebody edited a month ago. The annotation turns it into an error report with a position in it.

~~~starter
SCORES: list[int] = [10, 20, "30", 40]


def average() -> float:
    """The mean of every score."""
    return sum(SCORES) / len(SCORES)


print(average())
~~~

~~~tests
assert average() == 25.0
assert SCORES == [10, 20, 30, 40]
~~~

~~~solution
SCORES: list[int] = [10, 20, 30, 40]


def average() -> float:
    """The mean of every score."""
    return sum(SCORES) / len(SCORES)


print(average())
~~~
