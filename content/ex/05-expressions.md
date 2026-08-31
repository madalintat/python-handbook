---
slug: 05-expressions
---

## The condition that is always true

`wants_colour` accepts either spelling of yes. Run it against something that is plainly not a yes and read what comes back. Nothing here is a syntax error and no linter fires, which is what makes this shape worth recognising on sight.

@expect silent
@hint Precedence groups this as two things joined by `or`. Write out what each of the two is.
@hint The right-hand side is a bare non-empty string. Ask what that is worth in a boolean context.
@diagnose silent It runs and says yes to everything. `answer == "y" or "Y"` groups as `(answer == "y") or ("Y")`, and a non-empty string is truthy, so the second operand decides the whole condition whenever the first is false. The tell is a bare value on one side of `or` where a comparison belongs. Say both comparisons, or better, use `in` with a tuple, which also scales to a third spelling without repeating yourself.

~~~starter
def wants_colour(answer):
    """True if the answer is y or Y."""
    return answer == "y" or "Y"
~~~

~~~tests
assert wants_colour("y") is True
assert wants_colour("Y") is True
assert wants_colour("n") is False, "a plain no was accepted"
assert wants_colour("") is False
~~~

~~~solution
def wants_colour(answer):
    """True if the answer is y or Y."""
    return answer in ("y", "Y")
~~~

## The guard on the wrong side

`starts_with_header` checks the first row of a table before using it. Both halves of the condition are correct; they are in the wrong order, and short-circuiting only protects you when the cheap test comes first.

@expect raises:IndexError
@hint `and` stops as soon as the answer is decided. Work out which half decides it.
@hint The check that something exists has to run before the code that assumes it does.
@diagnose IndexError `and` short-circuits left to right, so it evaluates `rows[0]` first and only then asks whether `rows` is non-empty, by which time the subscript has already raised on an empty list. Written the other way round, `rows and rows[0] == "id"`, the empty list is falsy, the whole expression stops there, and the subscript is never reached. This ordering is doing real work rather than being a stylistic preference, and it is the entire basis of the guard-clause idiom.

~~~starter
def starts_with_header(rows):
    """True if the first row is the header row."""
    return rows[0] == "id" and rows


print(starts_with_header([]))
~~~

~~~tests
assert starts_with_header(["id", "1"]) is True
assert starts_with_header(["1", "2"]) is False
assert starts_with_header([]) is False, "an empty table should simply have no header"
~~~

~~~solution
def starts_with_header(rows):
    """True if the first row is the header row."""
    return bool(rows) and rows[0] == "id"


print(starts_with_header([]))
~~~

## The default that swallowed a zero

`retry_count` applies a default when none was configured. It uses `or`, which is idiomatic and correct exactly when no legitimate value is falsy. The tests configure zero retries deliberately.

@expect silent
@hint `a or b` returns `a` when `a` is truthy. Ask which configured values are not.
@hint "Nothing was configured" and "zero was configured" are different facts.
@diagnose silent Nothing raised, and a caller who deliberately asked for no retries gets three. `configured or 3` returns `configured` only when it is truthy, so `0`, `""`, `[]` and `False` all fall through to the default. This is exactly unit 04's `if not timeout:` wearing a different costume. The `or` default is a good idiom when every legitimate value is truthy, and a bug the moment one is not, at which point the test has to be `is None`.

~~~starter
def retry_count(configured):
    """Return the configured retry count, defaulting to 3 when unset."""
    return configured or 3
~~~

~~~tests
assert retry_count(5) == 5
assert retry_count(None) == 3
assert retry_count(0) == 0, "a deliberate zero was replaced by the default"
~~~

~~~solution
def retry_count(configured):
    """Return the configured retry count, defaulting to 3 when unset."""
    return 3 if configured is None else configured
~~~

## One comma

`as_row` builds a single-column row from a value. There is one character in it that changes the type of everything it touches, and it is easy to read straight past.

@expect silent
@hint What does `x = 1,` bind? Check the type, not the value.
@hint It is the comma that builds a tuple, not the parentheses.
@diagnose silent It runs and returns a tuple containing a list, rather than the list. A trailing comma builds a tuple. It is the comma that does it, never the parentheses, which is why `(1)` is an integer and `1,` is a one-element tuple. This is the same rule that lets `return a, b` appear to return two things, and it is one of the hardest typos in Python to spot by eye because the character is a single pixel wide at the end of a line.

~~~starter
def as_row(value):
    """Return a one-element list holding value."""
    return [value],
~~~

~~~tests
out = as_row("a")
assert out == ["a"], f"got {out!r}"
assert isinstance(out, list), f"got a {type(out).__name__}"
assert len(out) == 1
~~~

~~~solution
def as_row(value):
    """Return a one-element list holding value."""
    return [value]
~~~

## Parenthesising a chain

`within` checks that a value falls between two bounds. Somebody has helpfully added parentheses to a chained comparison, and the parentheses changed what it means rather than clarifying it.

@expect silent
@hint `a < b < c` is one expression, not two comparisons combined. Work out what the parentheses turn it into.
@hint The parenthesised half produces a boolean. Ask what comparing that boolean against the upper bound does.
@diagnose silent It runs, because comparing a boolean with an integer is perfectly legal, `bool` subclasses `int`, so `True` is `1`. `(low < value) < high` first computes a boolean, then compares that `0` or `1` against `high`, which answers a question nobody asked. An unparenthesised `low < value < high` is a *chained* comparison: one expression, `value` evaluated once, both comparisons applied with short-circuiting. Parenthesising a chain does not group it more clearly, it changes it into something else.

~~~starter
def within(value, low, high):
    """True if low < value < high."""
    return (low < value) < high
~~~

~~~tests
assert within(5, 0, 10) is True
assert within(50, 0, 10) is False, "50 is not between 0 and 10"
assert within(-5, 0, 10) is False
assert within(5, 0, 1) is False
~~~

~~~solution
def within(value, low, high):
    """True if low < value < high."""
    return low < value < high
~~~

## Where the conditional expression ends

`price_label` adds a currency suffix to a price, or says free. It reads as though the suffix applies to one branch. Precedence says otherwise, and the conditional expression binds looser than almost everything around it.

@expect silent
@hint A conditional expression extends as far to the right as it can. Mark where you think it ends, then check.
@hint `a if c else b + s` is `a if c else (b + s)`.
@diagnose silent No error, and the suffix only ever reaches one branch. The conditional expression binds very loosely (looser than arithmetic, looser than `+` on strings), so everything after `else` up to the end of the expression is the alternative branch. `"free" if p == 0 else str(p) + " GBP"` therefore gives a bare `"free"` with no suffix, which is what the tests object to. Parenthesise whenever an expression continues past the `else`, and switch to a real `if` statement as soon as there is a second condition.

~~~starter
def price_label(pence):
    """Return a label like '250p', or 'free (0p)' when the price is zero."""
    return "free" if pence == 0 else str(pence) + "p"
~~~

~~~tests
assert price_label(250) == "250p"
assert price_label(0) == "free (0p)", f"got {price_label(0)!r}"
~~~

~~~solution
def price_label(pence):
    """Return a label like '250p', or 'free (0p)' when the price is zero."""
    return ("free (0p)" if pence == 0 else str(pence) + "p")
~~~

## Comparing against True

`is_enabled` insists on the actual boolean rather than anything truthy. ruff objects to how it asks, and the tests show that the objection has teeth because of a fact about `bool` from unit 04.

@expect ruff:E712
@expect silent
@hint `== True` is a comparison the other operand takes part in.
@hint `bool` is a subclass of `int`, and `1 == True`.
@diagnose E712 ruff's `E712` is "comparison to True should be `cond is True` or `if cond:`". Comparing to a boolean literal with `==` is almost always either redundant, `if flag == True:` is just `if flag:`, or, as here, subtly wrong.
@diagnose silent It runs and accepts the integer `1`, which the docstring says it should not. `flag == True` is an equality question, and `1 == True` is `True` because `bool` subclasses `int` and they share a value and a hash. When you genuinely mean "is this the boolean True and nothing else", identity is the test: `flag is True`. When you mean "is this truthy", write `if flag:` and drop the comparison entirely.

~~~starter
def is_enabled(flag):
    """True only when flag is the boolean True, not merely truthy."""
    return flag == True
~~~

~~~tests
assert is_enabled(True) is True
assert is_enabled(False) is False
assert is_enabled(1) is False, "the integer 1 was accepted as True"
assert is_enabled("yes") is False
~~~

~~~solution
def is_enabled(flag):
    """True only when flag is the boolean True, not merely truthy."""
    return flag is True
~~~

## Reading twice, keeping once

`first_two` pulls up to two items from an iterator. It reads an item to test it and then reads *again* to keep one, so every item it checks is thrown away. This is the situation the walrus operator was added for.

@expect silent
@hint Count how many times `next` is called per item kept.
@hint You need the value in the condition and in the body. There is an operator that assigns and produces a value.
@diagnose silent Nothing raised, and half the input vanished. `next(source, None)` advances the iterator, so testing with one call and keeping with a second reads two items and stores the wrong one, because an iterator has no way to put an item back. This is precisely why `:=` exists: it assigns and produces the value in one go, so the condition can test the very item the body then keeps. Without it you would need an extra statement and a name in a wider scope.

~~~starter
def first_two(source):
    """Return up to the first two items of an iterator."""
    items = []
    while len(items) < 2:
        if next(source, None) is None:
            break
        items.append(next(source, None))
    return items
~~~

~~~tests
assert first_two(iter([1, 2, 3])) == [1, 2], "items were consumed without being kept"
assert first_two(iter(["a"])) == ["a"]
assert first_two(iter([])) == []
~~~

~~~solution
def first_two(source):
    """Return up to the first two items of an iterator."""
    items = []
    while len(items) < 2 and (item := next(source, None)) is not None:
        items.append(item)
    return items
~~~
