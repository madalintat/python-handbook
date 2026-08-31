---
slug: 00-toolchain
---

## Versions are not strings

`modern_enough` decides whether a version string is 3.10 or newer. It works for most of the versions you would test it with, which is what makes it dangerous. The hidden tests try 3.9.

@expect silent
@hint Compare `"3.9"` and `"3.10"` as text, character by character, and say which one sorts first.
@hint The parts are numbers. Compare them as numbers.
@diagnose silent Nothing raised, because comparing two strings is a perfectly legal thing to do — it just answers a different question than you meant. Text comparison goes character by character, so `"3.9"` and `"3.10"` are decided at the third character, where `9` beats `1`. Every version below 3.10 is therefore reported as newer than every version above it. Split on the dot and compare integers, or use the tuple the interpreter already hands you as `sys.version_info`.

~~~starter
def modern_enough(version):
    """True if version is 3.10 or newer."""
    return version >= "3.10"
~~~

~~~tests
assert modern_enough("3.14") is True
assert modern_enough("3.10") is True
assert modern_enough("3.9") is False, "3.9 was reported as newer than 3.10"
assert modern_enough("2.7") is False
~~~

~~~solution
def modern_enough(version):
    """True if version is 3.10 or newer."""
    return tuple(int(part) for part in version.split(".")) >= (3, 10)
~~~

## Two ways to compile

`evaluate` is meant to compile a small expression and hand back its value. It compiles, it runs, it raises nothing at all, and it returns the wrong thing every time. The third argument to `compile` is the one to look at.

@expect silent
@hint `compile` takes a mode. There are three, and only one of them produces something with a value.
@hint `"exec"` compiles a sequence of statements. A statement does not evaluate to anything.
@diagnose silent It ran cleanly and gave you `None`. `compile(src, filename, "exec")` produces a code object for a *module body* — a series of statements — and running statements does not produce a value, so `eval` hands back `None`. The mode you want is `"eval"`, which compiles exactly one expression and yields its value. The third mode, `"single"`, is what the REPL uses: one statement, and it prints the result if there is one.

~~~starter
def evaluate(expr):
    """Compile a Python expression and return its value."""
    return eval(compile(expr, "<input>", "exec"))


print(evaluate("2 + 2"))
~~~

~~~tests
assert evaluate("2 + 2") == 4, "got something other than 4"
assert evaluate("len('abc')") == 3
assert evaluate("[1, 2] + [3]") == [1, 2, 3]
~~~

~~~solution
def evaluate(expr):
    """Compile a Python expression and return its value."""
    return eval(compile(expr, "<input>", "eval"))


print(evaluate("2 + 2"))
~~~

## assert is not validation

`parse_port` rejects a port outside the legal range, and it rejects it with the wrong tool. Run it and read which exception comes out, then ask what would happen to this function if Python were started with the `-O` flag.

@expect raises:AssertionError
@hint `assert` exists to catch bugs in your own code. This is checking someone else's input.
@hint Every `assert` statement is removed entirely when Python runs with `-O`. Write the check so that cannot happen.
@diagnose AssertionError The check fired, so at first glance this works. It is still the wrong tool. `assert` is a statement Python removes completely under the `-O` optimisation flag — every one of them, silently — so a validation written as an assert is a validation that vanishes in exactly the deployment where you were counting on it. `assert` is for conditions you believe are already true and want to catch yourself being wrong about. Rejecting bad input is not that; raise a real exception, and pick one that says what the caller did wrong.

~~~starter
def parse_port(text):
    """Return text as a port number, rejecting anything out of range."""
    port = int(text)
    assert 0 < port < 65536, "port out of range"
    return port


print(parse_port("99999"))
~~~

~~~tests
assert parse_port("8080") == 8080
try:
    parse_port("99999")
except ValueError:
    pass
except AssertionError:
    raise AssertionError("rejected with assert, which -O would delete") from None
else:
    raise AssertionError("99999 was accepted")
~~~

~~~solution
def parse_port(text):
    """Return text as a port number, rejecting anything out of range."""
    port = int(text)
    if not 0 < port < 65536:
        raise ValueError(f"port out of range: {port}")
    return port


print(parse_port("8080"))
~~~

## The division that changed in Python 3

`middle` looks correct and would have been correct in Python 2. Run it, then note that this is one of the rare cases where two judges catch the same mistake and one of them does it without running anything.

@expect raises:TypeError
@expect mypy:call-overload
@hint What type does `/` return, always, even when both operands are whole numbers?
@hint There is a second division operator that keeps the result an integer.
@diagnose TypeError `/` is true division and always produces a `float`, even for `4 / 2`. A list cannot be indexed by a float, however round that float looks, so the subscript fails. Python 2 made `/` mean integer division for integers, which is exactly the kind of quiet type change Python 3 set out to remove.
@diagnose call-overload mypy found this without running the function, because it knows `len()` returns `int`, knows `int / int` is `float`, and knows `list[int]` cannot be indexed by a `float`. This is the case for annotating: the same defect, reported at check time, on a line that did not have to execute.

~~~starter
def middle(items: list[int]) -> int:
    """Return the middle element of an odd-length list."""
    return items[len(items) / 2]


print(middle([1, 2, 3]))
~~~

~~~tests
assert middle([1, 2, 3]) == 2
assert middle([10, 20, 30, 40, 50]) == 30
assert middle([7]) == 7
~~~

~~~solution
def middle(items: list[int]) -> int:
    """Return the middle element of an odd-length list."""
    return items[len(items) // 2]


print(middle([1, 2, 3]))
~~~

## The repr you meant to print

`describe` builds a debug label. Compare what it produces for the string `"3"` with what it produces for the integer `3`, and decide whether a debug label that cannot tell those apart is doing its job.

@expect silent
@hint `str` and `repr` are two different renderings of a value. Printing uses one; debugging wants the other.
@hint An f-string has a conversion flag for this. It is one character.
@diagnose silent Nothing failed, and that is the trouble: `f"{value}"` calls `str(value)`, which is the rendering meant for people. For a string it strips the quotes, so `"3"` and `3` come out identically and your debug output has lost the one distinction you were debugging. `f"{value!r}"` calls `repr` instead, which is the rendering meant for programmers and is supposed to be unambiguous. `!r` is worth reaching for by default in log lines and error messages.

~~~starter
def describe(value):
    """Return a debug label that shows exactly what value is."""
    return f"value={value}"
~~~

~~~tests
assert describe(3) == "value=3"
assert describe("3") == "value='3'", "a string and an integer looked identical"
assert describe(None) == "value=None"
assert describe([1]) == "value=[1]"
~~~

~~~solution
def describe(value):
    """Return a debug label that shows exactly what value is."""
    return f"value={value!r}"
~~~

## Rounding does not do what you were taught

`to_nearest` is documented as rounding half upward, the way you learned in school. `round` does something else, deliberately, and the tests pick the two values where the difference shows.

@expect silent
@hint Try `round(0.5)` and `round(1.5)` in your head, then check whether you were right.
@hint The rule Python uses is called round-half-to-even, and it is a deliberate choice about bias, not a bug.
@diagnose silent It runs and it is wrong at exactly the halfway points. `round` implements round-half-to-even, also called banker's rounding: a value exactly between two integers goes to the even one, so `round(0.5)` is `0` and `round(1.5)` is `2`. Rounding halves consistently upward biases the sum of a long column of numbers upward; going to even cancels out. It is the right default and the wrong one for a function documented to round halves up, which has to say so itself.

~~~starter
def to_nearest(value):
    """Round to the nearest integer, with .5 always going up."""
    return round(value)
~~~

~~~tests
assert to_nearest(1.4) == 1
assert to_nearest(1.6) == 2
assert to_nearest(0.5) == 1, "0.5 did not round up"
assert to_nearest(2.5) == 3, "2.5 did not round up"
~~~

~~~solution
import math


def to_nearest(value):
    """Round to the nearest integer, with .5 always going up."""
    return math.floor(value + 0.5)
~~~

## Asking what type something is

`is_integer` answers whether a value is an integer. It answers by comparing types with `==`, which ruff objects to on sight, and the hidden tests show why the objection is not merely stylistic.

@expect ruff:E721
@expect silent
@hint Comparing types with `==` asks whether they are that exact type. Ask a different question.
@hint What should this say about a class that inherits from `int`?
@diagnose E721 ruff's `E721` is "do not compare types, for exact checks use `is`, or `isinstance()` for instance checks". The rule exists because `type(x) == int` is almost never what anybody means: it demands that exact class and rejects every subclass of it, which breaks the substitution that inheritance is for.
@diagnose silent No exception, and the right answer for ordinary integers — which is why this survives code review. `type(value) == int` is `False` for an instance of a class deriving from `int`, even though such a value *is* an integer in every sense that matters. `isinstance(value, int)` asks the question you actually meant.

~~~starter
def is_integer(value):
    """True if value is an integer."""
    return type(value) == int
~~~

~~~tests
class Count(int):
    pass


assert is_integer(3) is True
assert is_integer("3") is False
assert is_integer(3.0) is False
assert is_integer(Count(3)) is True, "a subclass of int was not recognised as an int"
~~~

~~~solution
def is_integer(value):
    """True if value is an integer."""
    return isinstance(value, int)
~~~

## Floats are not the numbers you think

`totals_match` compares two sums for equality. Both sums are correct to every decimal place you would ever print. The function still says they differ, and the reason has nothing to do with Python.

@expect silent
@hint Evaluate `0.1 + 0.2` in the REPL and read every digit of the answer.
@hint Two floats computed different ways are almost never bit-identical. Compare them with a tolerance.
@diagnose silent Nothing went wrong in your code. A `float` is a binary fraction, and `0.1` has no exact binary representation any more than one third has an exact decimal one — so `0.1 + 0.2` is `0.30000000000000004`, and `==` is quite right to say that is not `0.3`. This is IEEE 754 and every language with floats has it. Compare with a tolerance (`math.isclose`), or, when the values are money, do not use floats at all — use `decimal.Decimal` or count in whole cents.

~~~starter
def totals_match(a, b):
    """True if two computed totals are the same amount."""
    return a == b
~~~

~~~tests
assert totals_match(0.1 + 0.2, 0.3) is True, "0.1 + 0.2 was not recognised as 0.3"
assert totals_match(1.0, 1.0) is True
assert totals_match(0.1, 0.2) is False
~~~

~~~solution
import math


def totals_match(a, b):
    """True if two computed totals are the same amount."""
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-12)
~~~
