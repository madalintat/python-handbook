---
slug: 32-tooling
---

## Every callback pointing at the last one

`make_handlers` builds a function per name in a loop. Each closure captures the variable rather than its value, so all of them see whatever it held at the end.

@expect ruff:B023
@expect silent
@hint Unit 08: a closure captures the variable, not the value it had at the time.
@hint A default argument is evaluated when the `def` runs, which is once per iteration.
@diagnose B023 ruff's `B023` is "function definition does not bind loop variable". It is from the `bugbear` family, which is the one most worth adding to a project, because its rules are about behaviour rather than style: this is a bug in every case, not a preference. Turning a rule like this on is the transfer that this unit is about, because it converts something a reviewer has to notice into something nobody has to remember.
@diagnose silent It runs, and every handler reports the last name. The loop variable is one variable that the loop reassigns, and a closure captures the variable, so by the time any handler is called it holds the final value. A default argument fixes it because defaults are evaluated when the `def` executes, which happens once per iteration with the current value. `functools.partial(handle, name)` does the same thing more explicitly. Unit 08 explained the mechanism; the point here is that a linter finds it for you, in every file, forever.

~~~starter
def make_handlers(names):
    """One handler per name, each reporting its own."""
    handlers = []
    for name in names:
        handlers.append(lambda: f"handling {name}")
    return handlers
~~~

~~~tests
first, second = make_handlers(["a", "b"])
assert first() == "handling a", f"the first handler said {first()!r}"
assert second() == "handling b"
assert [h() for h in make_handlers([])] == []
~~~

~~~solution
def make_handlers(names):
    """One handler per name, each reporting its own."""
    handlers = []
    for name in names:
        handlers.append(lambda name=name: f"handling {name}")
    return handlers
~~~

## Two lists zipped, one of them shorter

`pair_up` zips names against scores. `zip` stops at the shorter of the two and says nothing, so a missing score silently drops a name.

@expect ruff:B905
@expect silent
@hint What does `zip` do when its inputs are different lengths?
@hint `zip` takes a keyword argument for exactly this.
@diagnose B905 ruff's `B905` is "`zip()` without an explicit `strict=` parameter". The rule exists because the default is the dangerous one: `zip` truncates to the shortest input and reports nothing, so a data error becomes a quietly shorter result. Writing `strict=True` makes a length mismatch raise `ValueError`, and writing `strict=False` says you meant to truncate. Either is fine; the rule is asking you to have decided, which is what a good lint rule does.
@diagnose silent Nothing raised, and a row went missing. `zip` stopping at the shortest input is exactly right when you are walking an infinite sequence alongside a finite one, and exactly wrong when the two are supposed to correspond, which is the usual case. Since the shorter result is often still a valid-looking answer, the bug travels a long way before anybody notices. `strict=True` turns it into a `ValueError` at the line where the mismatch is.

~~~starter
def pair_up(names, scores):
    """Pair each name with its score."""
    return dict(zip(names, scores))
~~~

~~~tests
assert pair_up(["a", "b"], [1, 2]) == {"a": 1, "b": 2}

try:
    pair_up(["a", "b", "c"], [1, 2])
except ValueError:
    pass
else:
    raise AssertionError(
        f"a missing score gave {pair_up(['a', 'b', 'c'], [1, 2])} instead of raising"
    )
~~~

~~~solution
def pair_up(names, scores):
    """Pair each name with its score."""
    return dict(zip(names, scores, strict=True))
~~~

## Catching everything, including the way out

`run_all` wraps each task in a bare `except:`, which catches every exception there is, including the ones that exist to stop the program.

@expect ruff:E722
@expect silent
@hint What is the difference between `except:` and `except Exception:`?
@hint `KeyboardInterrupt` and `SystemExit` do not inherit from `Exception`, on purpose.
@diagnose E722 ruff's `E722` is "do not use bare `except`". A bare `except:` catches `BaseException`, which includes `KeyboardInterrupt`, `SystemExit` and `GeneratorExit`. Those three deliberately sit outside `Exception` precisely so that `except Exception:` does not catch them, and a bare `except:` puts them back in. A program that swallows Ctrl-C is the classic symptom, and it is unreasonably annoying to diagnose from the outside.
@diagnose silent The tasks all reported failure, including the one that asked to stop, because `SystemExit` was caught alongside the ordinary errors. `except Exception:` is almost always what was meant. Narrower still is better: catching the specific exception you know how to handle means an unexpected one propagates with its traceback intact, rather than being turned into a log line that says something went wrong.

~~~starter
def run_all(tasks):
    """Run every task, collecting failures."""
    results = []
    for task in tasks:
        try:
            results.append(task())
        except:
            results.append("failed")
    return results
~~~

~~~tests
def ok():
    return "ok"


def broken():
    raise ValueError("no")


def stopping():
    raise SystemExit(1)


assert run_all([ok, broken]) == ["ok", "failed"]

try:
    run_all([ok, stopping])
except SystemExit:
    pass
else:
    raise AssertionError("a request to stop the program was caught and logged")
~~~

~~~solution
def run_all(tasks):
    """Run every task, collecting failures."""
    results = []
    for task in tasks:
        try:
            results.append(task())
        except Exception:
            results.append("failed")
    return results
~~~

## An error that lost the one underneath it

`load` catches a parse failure and raises its own, without saying what caused it. The original exception and its traceback are gone.

@expect ruff:B904
@expect silent
@hint There is a keyword that attaches the exception being handled to the new one.
@hint `raise X from Y`, and there is a second form for deliberately hiding the cause.
@diagnose B904 ruff's `B904` is "within an `except` clause, raise exceptions with `raise ... from err` or `raise ... from None`". It asks you to say which you meant. `from err` records the original as the cause, and the traceback then shows both with "The above exception was the direct cause of the following exception". `from None` deliberately suppresses it, which is right when the original is noise the caller cannot act on.
@diagnose silent Nothing raised, and `__cause__` was `None`, so the useful half of the information is gone. Raising a domain-specific exception from a low-level one is good practice; losing the low-level one in the process is what turns a five-second diagnosis into an afternoon, because the new exception says a config file is invalid and the old one said which character on which line. Note that Python sets `__context__` automatically for an exception raised inside an `except` block, so the original is usually still printed. `from` sets `__cause__`, which is the explicit statement that one caused the other, and is what tooling reads.

~~~starter
import json


class ConfigError(Exception):
    """The configuration could not be read."""


def load(text):
    """Parse a configuration document."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise ConfigError("the configuration is not valid JSON")
~~~

~~~tests
assert load('{"a": 1}') == {"a": 1}

try:
    load("{bad")
except ConfigError as exc:
    assert exc.__cause__ is not None, "the original parse error was lost"
    assert isinstance(exc.__cause__, json.JSONDecodeError)
else:
    raise AssertionError("a bad document should raise")
~~~

~~~solution
import json


class ConfigError(Exception):
    """The configuration could not be read."""


def load(text):
    """Parse a configuration document."""
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ConfigError("the configuration is not valid JSON") from exc
~~~

## Old formatting with a value that looks like arguments

`describe` uses `%` formatting. The value it interpolates is a tuple, and `%` reads a tuple as a list of arguments.

@expect ruff:UP031
@expect raises:TypeError
@hint What does `%` do when its right-hand side is a tuple?
@hint The modern spellings have no such ambiguity.
@diagnose UP031 ruff's `UP031` is "use format specifiers instead of percent format". The `UP` family rewrites code to newer syntax, which is how a codebase stops accumulating `%`-formatting, `typing.List` and `os.path`. Most of its fixes are applied automatically by `ruff check --fix`, which makes adopting the family close to free.
@diagnose TypeError `"%s" % value` treats a tuple on the right as the argument **list**, so a two-element tuple is two arguments for a format string that has one placeholder. There is no way to say "interpolate this one tuple" except by wrapping it in another tuple, which is a genuinely bad interface and the reason the replacement exists. An f-string has no such rule: `f"{point}"` interpolates one value whatever it is. This is what the `UP` family is for, and it is a good illustration that "modernising" syntax is sometimes about correctness rather than fashion.

~~~starter
def describe(point):
    """Describe a coordinate pair."""
    return "at %s" % point


print(describe((1, 2)))
~~~

~~~tests
assert describe((1, 2)) == "at (1, 2)"
assert describe((3,)) == "at (3,)"
~~~

~~~solution
def describe(point):
    """Describe a coordinate pair."""
    return f"at {point}"


print(describe((1, 2)))
~~~

## A result computed and then not used

`summarise` builds a total and returns something else. The unused name is the linter's clue that a line went nowhere.

@expect ruff:F841
@expect silent
@hint One name is assigned and never read. Which, and what was returned instead?
@hint `F841` is the whole diagnosis.
@diagnose F841 ruff's `F841` is "local variable is assigned to but never used". It is one of the plainest rules there is and one of the most useful, because an unused local almost always means a line of work was thrown away or a name was typed twice with a difference. It costs nothing to have on and it catches this class of mistake at the moment it is written.
@diagnose silent It runs and returns the count where the total was meant, because `total` is computed and discarded while `count` is returned. Nothing about the code is malformed, and a reader skims straight past it: the function is short, both names are plausible, and the returned value is a number of about the right size. This is the shape of bug that a linter is uniquely good at, because a tool that reads every name in the function has no opinion about which one looks right.

~~~starter
def summarise(prices):
    """The total of these prices."""
    count = len(prices)
    total = sum(prices)
    return count
~~~

~~~tests
assert summarise([10, 20, 30]) == 60, f"got {summarise([10, 20, 30])}"
assert summarise([]) == 0
~~~

~~~solution
def summarise(prices):
    """The total of these prices."""
    return sum(prices)
~~~

## One suppression, two rules

The line carries a bare `# noqa`. It was added for one rule and it silences every rule on that line, including the one that would have caught a typo.

@expect mypy:name-defined
@expect raises:NameError
@hint ruff reported nothing. Cover the comment and ask what it was hiding.
@hint A suppression should name the single code it means to silence.
@diagnose name-defined mypy found it, because `# noqa` is ruff's suppression comment and means nothing to a type checker. That is worth taking as the practical lesson under the exercise: the tools overlap almost not at all, so silencing one leaves the others watching, and running all of them is the reason a mistake this well hidden was caught at all.
@diagnose NameError ruff said nothing at all, which is the point of the exercise. A bare `# noqa` silences **every** rule on its line, and this line has two findings: `B006`, the mutable default the author knew about, and `F821`, an undefined name they did not. Naming the code, `# noqa: B006`, would have let `F821` through and caught the missing constant before the program ran. Note that a `# noqa` covers exactly its own line, which is why both findings had to be on one line for this to happen at all, and is a small mercy: the blast radius of the general form is one line rather than a file. It is exactly unit 25's argument about `# type: ignore` in a different tool, which is worth noticing as a pattern: every suppression mechanism worth using takes a specific code, and the general form is always a mistake. The deeper fix here is that a rule needing suppression in twenty files is a rule you have decided against, and saying so once in `pyproject.toml` is honest, greppable and reviewable in a way twenty comments are not.

~~~starter
def record(rows, seen=[], scale=SCALE):  # noqa
    """Record how many rows were seen, and return the scaled total."""
    seen.append(len(rows))
    return sum(rows) * scale


print(record([1, 2, 3]))
~~~

~~~tests
assert record([1, 2, 3]) == 12
assert record([]) == 0
~~~

~~~solution
SCALE = 2


def record(rows, seen=[], scale=SCALE):  # noqa: B006
    """Record how many rows were seen, and return the scaled total."""
    seen.append(len(rows))
    return sum(rows) * scale


print(record([1, 2, 3]))
~~~

## Asking a dict for its keys, and changing them

`prune` walks `cache.keys()` and deletes from the cache as it goes. Changing the size of a dict while iterating it is refused.

@expect ruff:SIM118
@expect raises:RuntimeError
@hint The error says what happened. What is `.keys()` giving you: a copy, or a view?
@hint Iterate over something that will not change.
@diagnose SIM118 ruff's `SIM118` is "use `key in dict` instead of `key in dict.keys()`", and it fires on the membership test rather than on the deletion. It is a style rule that happens to be pointing at the right line, which is a useful thing to notice about linters: a report is a reason to look, not a description of what is wrong.
@diagnose RuntimeError `dict.keys()` is a **view**, not a copy: it reflects the dict as it changes, so deleting during iteration changes the thing being iterated and Python refuses. That refusal is a feature, because the alternative in a language that allows it is skipped entries and undefined order. `list(cache)` takes a snapshot to walk, which is the usual fix and costs one list. Building the result you want and rebinding, as a dict comprehension does, is usually better still, because it never mutates anything mid-flight.

~~~starter
def prune(cache, keep):
    """Remove every entry whose key is not in `keep`."""
    for key in cache.keys():
        if key not in keep.keys():
            del cache[key]
    return cache


print(prune({"a": 1, "b": 2}, {"a": True}))
~~~

~~~tests
assert prune({"a": 1, "b": 2}, {"a": True}) == {"a": 1}
assert prune({}, {"a": True}) == {}

cache = {"a": 1, "b": 2, "c": 3}
assert prune(cache, {"b": True}) == {"b": 2}
assert cache == {"b": 2}, "the caller's dict should have been pruned in place"
~~~

~~~solution
def prune(cache, keep):
    """Remove every entry whose key is not in `keep`."""
    for key in list(cache):
        if key not in keep:
            del cache[key]
    return cache


print(prune({"a": 1, "b": 2}, {"a": True}))
~~~
