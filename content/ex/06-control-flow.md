---
slug: 06-control-flow
---

## The else that belongs to the loop

`find_admin` reports the first admin it finds, or says there is none. The `else` is attached to the `for`, not to the `if`, and it runs at a moment other than the one the keyword suggests.

@expect silent
@hint The loop `else` runs when the loop finished. Work out what "finished" excludes.
@hint It is skipped only when a `break` got you out. Reaching the end of the collection counts as finishing.
@diagnose silent Nothing raised, and the function reports no admin even when it found one. A `for ... else` runs its `else` when the loop completed **without breaking**, and this loop never breaks, so the `else` runs every time, overwriting the answer. Read the construct as "if we got all the way through without finding anything". Used properly it removes the `found = False` flag a search loop would otherwise need; misread as "if the loop did not run", it is wrong every time, which is why plenty of experienced Python programmers avoid it entirely.

~~~starter
def find_admin(users):
    """Return the first admin's name, or 'none' if there is not one."""
    for name, role in users:
        if role == "admin":
            result = name
    else:
        result = "none"
    return result
~~~

~~~tests
assert find_admin([("ada", "user"), ("bob", "admin")]) == "bob"
assert find_admin([("ada", "user")]) == "none"
assert find_admin([]) == "none"
assert find_admin([("bob", "admin"), ("cat", "admin")]) == "bob", "should be the first"
~~~

~~~solution
def find_admin(users):
    """Return the first admin's name, or 'none' if there is not one."""
    for name, role in users:
        if role == "admin":
            return name
    return "none"
~~~

## A name in a pattern is a place to put something

`classify` matches a status against two constants. Every status comes out as the first one. A pattern is not an expression, and a bare name in one does not mean what it means everywhere else in Python.

@expect raises:SyntaxError
@expect ruff:invalid-syntax
@expect ruff:F841
@hint Read the error message. It says a name makes the remaining patterns unreachable, which tells you what that name is doing.
@hint What does `case [a, b]:` do with `a` and `b`? A lone name follows the same rule.
@hint A dotted name is compared. A bare one is not.
@diagnose SyntaxError The message is `name capture 'ACTIVE' makes remaining patterns unreachable`, and it is naming the mechanism exactly. A bare name in a pattern is a **capture**, not a comparison: `case ACTIVE:` means "match anything, and bind it to the name `ACTIVE`", the same thing `case [a, b]` does for `a` and `b`. Since it matches everything, no later case can ever be reached, and Python refuses to compile that. Be glad it does: put the bare name in the *last* case and there is nothing unreachable, so it compiles cleanly and silently swallows every value while quietly overwriting your constant. The fix is that a *dotted* name is a value pattern, `case Status.ACTIVE:` compares, which is why constants used in patterns must live on a class, an enum or a module.
@diagnose invalid-syntax ruff parses Python itself, so it reports the same refusal before you run anything. When all three judges agree and one of them is the parser, the problem is that the file cannot become a program at all.
@diagnose F841 A side effect of the capture: ruff sees `ACTIVE` being assigned by the pattern and never read afterwards, which is exactly what a capture that was meant to be a comparison looks like from the outside.

~~~starter
ACTIVE = "active"
CLOSED = "closed"


def classify(status):
    """Label a status."""
    match status:
        case ACTIVE:
            return "open for business"
        case CLOSED:
            return "shut"
        case _:
            return "unknown"
~~~

~~~tests
assert classify("active") == "open for business"
assert classify("closed") == "shut", "closed was captured by the first case"
assert classify("pending") == "unknown"
~~~

~~~solution
class Status:
    ACTIVE = "active"
    CLOSED = "closed"


def classify(status):
    """Label a status."""
    match status:
        case Status.ACTIVE:
            return "open for business"
        case Status.CLOSED:
            return "shut"
        case _:
            return "unknown"
~~~

## Breaking out of one loop

`find_pair` searches a grid for a target and reports where it is. It breaks when it finds it, and the break only takes it out of one of the two loops it is inside.

@expect silent
@hint `break` leaves the innermost enclosing loop. Count how many loops there are.
@hint Python has no labelled break. What construct leaves a function entirely?
@diagnose silent Runs clean and returns the wrong coordinates. `break` leaves only the innermost enclosing loop, so the inner one stops and the outer one carries straight on to the next row, overwriting whatever was found. Python has no `break 2` and no labels. The three honest ways out of two loops are: put them in a function and `return`, which is nearly always clearest; use a flag and check it in the outer loop; or flatten the nesting with `itertools.product` so there is only one loop to leave.

~~~starter
def find_pair(grid, target):
    """Return (row, col) of the first cell equal to target, or None."""
    found = None
    for r, row in enumerate(grid):
        for c, cell in enumerate(row):
            if cell == target:
                found = (r, c)
                break
    return found
~~~

~~~tests
grid = [[1, 2], [3, 2]]
assert find_pair(grid, 2) == (0, 1), "should be the first match, scanning row by row"
assert find_pair(grid, 3) == (1, 0)
assert find_pair(grid, 9) is None
~~~

~~~solution
def find_pair(grid, target):
    """Return (row, col) of the first cell equal to target, or None."""
    for r, row in enumerate(grid):
        for c, cell in enumerate(row):
            if cell == target:
                return (r, c)
    return None
~~~

## One past the end

`running_totals` walks a list by index and builds the cumulative sums. Somebody added one to the range to "include the last element". Run it and read which index the interpreter objected to.

@expect raises:IndexError
@hint `range(n)` produces `0` to `n - 1`. Work out what `range(len(x))` already covers.
@hint The stop value is exclusive, which is the same convention slicing uses.
@diagnose IndexError `range` excludes its stop value, so `range(len(values))` already yields exactly the valid indices, `0` through `len - 1`. Adding one asks for an index one past the end. This is the single most common off-by-one in Python and it comes from importing the habit of inclusive bounds from another language. The deeper fix is not to index at all: iterating the items directly, or with `enumerate` when the position is genuinely needed, removes the whole class of error.

~~~starter
def running_totals(values):
    """Return the cumulative sums of values."""
    totals = []
    total = 0
    for i in range(len(values) + 1):
        total += values[i]
        totals.append(total)
    return totals


print(running_totals([1, 2, 3]))
~~~

~~~tests
assert running_totals([1, 2, 3]) == [1, 3, 6]
assert running_totals([]) == []
assert running_totals([5]) == [5]
~~~

~~~solution
def running_totals(values):
    """Return the cumulative sums of values."""
    totals = []
    total = 0
    for value in values:
        total += value
        totals.append(total)
    return totals


print(running_totals([1, 2, 3]))
~~~

## The variable the loop never used

`any_expired` checks whether any record has expired. ruff notices something about the loop variable, and what it noticed is the bug rather than a style preference.

@expect ruff:B007
@expect ruff:SIM110
@expect silent
@hint ruff is telling you the loop variable is never read. If the body does not use it, what is the body looking at?
@hint This whole loop is one call to a builtin that short-circuits.
@diagnose B007 ruff's `B007` is "loop control variable not used within loop body". Usually that means the name should be `_`. Here it means something has gone wrong: a loop that iterates a collection without ever looking at the item is either pointless or, as in this case, examining the wrong thing.
@diagnose SIM110 ruff's `SIM110` is "use `return any(...)` instead of a `for` loop". It has recognised the shape (iterate, return True on a match, return False after) and is proposing the exact rewrite this exercise wants. A linter suggesting your solution is worth noticing: this shape is common enough to have a rule about it.
@diagnose silent It runs and answers based entirely on the first record, however many there are, because the body reads `records[0]` instead of the `record` the loop bound. Once you see it, the whole loop collapses into `any(r.expired for r in records)`, which short-circuits on the first true value and states the question in one line rather than requiring the reader to execute four.

~~~starter
def any_expired(records):
    """True if any record has expired."""
    for record in records:
        if records[0]["expired"]:
            return True
    return False
~~~

~~~tests
assert any_expired([{"expired": False}, {"expired": True}]) is True, "only the first record was checked"
assert any_expired([{"expired": False}]) is False
assert any_expired([]) is False
assert any_expired([{"expired": True}]) is True
~~~

~~~solution
def any_expired(records):
    """True if any record has expired."""
    return any(record["expired"] for record in records)
~~~

## Iterating a dictionary

`total_score` adds up the numbers in a mapping of name to score. Iterating a dict hands you one of its three possible things, and this function assumed a different one.

@expect raises:TypeError
@hint `for k in d` is shorthand for one of `.keys()`, `.values()` or `.items()`. Which one?
@hint The error names the types it could not add, which tells you what the loop was actually handing over.
@diagnose TypeError Iterating a dictionary yields its **keys**, `for name in scores` is `for name in scores.keys()`, so this is adding strings to an integer and Python says so. The three views are `.keys()`, `.values()` and `.items()`, the last giving `(key, value)` pairs, and being explicit about which one you want makes the loop read correctly to somebody who has not memorised the default. For a plain total, `sum(scores.values())` is the whole function.

~~~starter
def total_score(scores):
    """Return the sum of all scores in the mapping."""
    total = 0
    for score in scores:
        total += score
    return total


print(total_score({"ada": 3, "bob": 4}))
~~~

~~~tests
assert total_score({"ada": 3, "bob": 4}) == 7
assert total_score({}) == 0
assert total_score({"solo": 10}) == 10
~~~

~~~solution
def total_score(scores):
    """Return the sum of all scores in the mapping."""
    return sum(scores.values())


print(total_score({"ada": 3, "bob": 4}))
~~~

## Two lists that stopped agreeing

`pair_up` zips names against scores. The two lists are supposed to correspond, and when they do not, `zip` says nothing at all and quietly drops the surplus.

@expect silent
@expect ruff:B905
@hint `zip` stops at the shorter input by default. Ask whether silence is the right response to mismatched data.
@hint There is a keyword argument, added in 3.10, that turns the mismatch into an error.
@diagnose B905 ruff's `B905` is "`zip()` without an explicit `strict=` parameter". The rule exists because the default is a silent truncation, and a linter cannot know whether you meant it, so it asks you to say. Passing `strict=False` explicitly satisfies the rule too, and documents that the mismatch is expected.
@diagnose silent It runs and silently discards the extra name. `zip` stopping at the shorter input is occasionally what you want and far more often a bug that hides a data problem, two lists that were meant to correspond, one of them short, and rows dropped with nothing to show for it. `zip(a, b, strict=True)` raises `ValueError` on a length mismatch instead, and is worth making a habit whenever the inputs are supposed to line up.

~~~starter
def pair_up(names, scores):
    """Pair each name with its score. The two lists must be the same length."""
    return list(zip(names, scores))
~~~

~~~tests
assert pair_up(["a", "b"], [1, 2]) == [("a", 1), ("b", 2)]
try:
    pair_up(["a", "b", "c"], [1, 2])
except ValueError:
    pass
else:
    raise AssertionError("a length mismatch was silently truncated")
~~~

~~~solution
def pair_up(names, scores):
    """Pair each name with its score. The two lists must be the same length."""
    return list(zip(names, scores, strict=True))
~~~

## A string is not a sequence pattern

`describe` matches a command that arrives either as a list of words or as a single word. The sequence case is meant to catch the list. Try it with the string and read which branch answers.

@expect silent
@hint Sequence patterns match lists and tuples. Check whether they match strings too, and why that choice was made.
@hint The string falls through to a case you did not intend.
@diagnose silent Runs clean and sends the plain string to the wrong branch. Sequence patterns deliberately do **not** match `str` or `bytes`, even though both are sequences, because matching a string as a sequence of characters is almost never what anybody means and would make `case [a, b]:` quietly match every two-character string. So the string here skips the sequence case entirely. Match it explicitly with `case str():`, which is a class pattern, and put it before or after the sequence case depending on which should win.

~~~starter
def describe(command):
    """Describe a command given as a list of words or as a single word."""
    match command:
        case [verb, *rest]:
            return f"{verb} with {len(rest)} argument(s)"
        case _:
            return "unrecognised"
~~~

~~~tests
assert describe(["move", "north"]) == "move with 1 argument(s)"
assert describe(["quit"]) == "quit with 0 argument(s)"
assert describe("quit") == "quit with 0 argument(s)", "a bare string went to the wildcard"
assert describe(42) == "unrecognised"
~~~

~~~solution
def describe(command):
    """Describe a command given as a list of words or as a single word."""
    match command:
        case str() as word:
            return f"{word} with 0 argument(s)"
        case [verb, *rest]:
            return f"{verb} with {len(rest)} argument(s)"
        case _:
            return "unrecognised"
~~~
