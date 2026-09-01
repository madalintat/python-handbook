---
slug: 07-functions
---

## The timestamp that never moves

`stamp` records when something happened, defaulting to now. Call it twice, some time apart, and compare the two answers. ruff has a rule for the shape and the tests show what the rule is protecting you from.

@expect ruff:B008
@expect silent
@hint When does the default expression run? Not on every call.
@hint The stored default is visible as `stamp.__defaults__`. Look at it twice.
@diagnose B008 ruff's `B008` is "do not perform function call in argument defaults". The rule exists because a call in a default runs exactly once, when the `def` statement executes, and its result is then frozen onto the function object for the life of the process. That is almost never what a call in that position was meant to express.
@diagnose silent It runs and every call reports the same instant, the instant the module was imported. This is the mutable-default bug from unit 02 with a different symptom: not a shared object that grows, but a value frozen at definition time. The fix is the same sentinel: default to `None` and compute the real value inside the body, where it runs once per call.

~~~starter
import time


def stamp(event, at=time.monotonic()):
    """Return an (event, time) pair, defaulting to the time of the call."""
    return (event, at)
~~~

~~~tests
first = stamp("a")
time.sleep(0.01)
second = stamp("b")
assert first[1] != second[1], "two calls a moment apart reported the same time"
assert stamp("c", 99.0) == ("c", 99.0)
~~~

~~~solution
import time


def stamp(event, at=None):
    """Return an (event, time) pair, defaulting to the time of the call."""
    if at is None:
        at = time.monotonic()
    return (event, at)
~~~

## Collecting and spreading are opposites

`total` takes any number of values. The caller has a list, and passes it. Run it and read what the function received, then work out what the two meanings of `*` are.

@expect raises:TypeError
@hint In a definition `*values` collects. At a call site `*` does the opposite.
@hint The function received exactly one argument. Ask what it was.
@diagnose TypeError A `*values` parameter collects surplus positional arguments into a tuple, so handing it a list gives you a one-element tuple containing that list, and summing a tuple whose only element is a list fails. At the call site the same symbol means the opposite: `total(*numbers)` spreads the list into separate arguments. This mistake usually surfaces somewhere downstream rather than at the call, which is what makes it annoying to track down. If a function is only ever going to be handed one sequence, taking a plain iterable parameter is simpler than `*args`.

~~~starter
def total(*values):
    """Return the sum of any number of values."""
    return sum(values)


numbers = [1, 2, 3]
print(total(numbers))
~~~

~~~tests
assert total(1, 2, 3) == 6
numbers = [1, 2, 3]
assert total(*numbers) == 6
assert total() == 0
~~~

~~~solution
def total(*values):
    """Return the sum of any number of values."""
    return sum(values)


numbers = [1, 2, 3]
print(total(*numbers))
~~~

## The flag that has to be named

`connect` takes a couple of options. A caller has passed them positionally, which is legal and unreadable, and the tests insist the options be keyword-only so that a call site three files away can be understood without looking anything up.

@expect silent
@hint A bare `*` in a parameter list marks everything after it as keyword-only.
@hint The tests check that passing positionally is rejected. That is a property of the signature, not of the body.
@diagnose silent It runs, and `connect("db", 5, False)` is accepted, a call whose second and third arguments mean nothing to a reader. A bare `*` in the parameter list makes every parameter after it keyword-only, so the only legal form becomes `connect("db", timeout=5, retry=False)`. This is worth doing for every boolean and every optional tuning value: it costs one character in the definition and removes the need to go and look at the signature from every call site forever.

~~~starter
def connect(host, timeout=30, retry=True):
    """Return a description of the connection that would be opened."""
    return f"{host} timeout={timeout} retry={retry}"
~~~

~~~tests
assert connect("db", timeout=5) == "db timeout=5 retry=True"
assert connect("db", timeout=5, retry=False) == "db timeout=5 retry=False"
try:
    connect("db", 5, False)  # type: ignore[call-arg]  # mypy rejects this too
except TypeError:
    pass
else:
    raise AssertionError("options were accepted positionally")
~~~

~~~solution
def connect(host, *, timeout=30, retry=True):
    """Return a description of the connection that would be opened."""
    return f"{host} timeout={timeout} retry={retry}"
~~~

## A default that names another parameter

`window` gives the end of a range a sensible default based on the start. It reads perfectly and does not run, and the error names the moment at which defaults are evaluated.

@expect raises:NameError
@expect ruff:F821
@expect mypy:name-defined
@hint When the default expression is evaluated, is a call happening?
@hint `start` is a parameter, which means it only exists during a call.
@diagnose F821 ruff reports `Undefined name start` without running anything. From a linter's point of view the default expression is just code in the enclosing scope, and `start` is not a name in that scope, which is precisely the fact the runtime error is about.
@diagnose name-defined mypy says the same thing in its own vocabulary. All three judges agreeing here is worth noticing: the mistake is not subtle once you know where default expressions are evaluated, and every tool that knows the scoping rules can see it.
@diagnose NameError Default expressions are evaluated once, when the `def` statement runs, at which point no call is in progress and no parameter exists, so the name `start` is not there. This is the same single fact as the frozen timestamp and the shared mutable list, showing its third face. Any default that has to depend on the arguments must be computed in the body, with `None` standing in for "not supplied".

~~~starter
def window(start, end=start + 10):
    """Return the (start, end) pair, defaulting end to ten past the start."""
    return (start, end)


print(window(5))
~~~

~~~tests
assert window(5) == (5, 15)
assert window(5, 7) == (5, 7)
assert window(0) == (0, 10)
~~~

~~~solution
def window(start, end=None):
    """Return the (start, end) pair, defaulting end to ten past the start."""
    if end is None:
        end = start + 10
    return (start, end)


print(window(5))
~~~

## Unpacking is checked

`split_name` returns the parts of a name, and the caller unpacks the result into two names. One of the test inputs has a middle name. Read the error, which names both counts.

@expect raises:ValueError
@hint Unpacking requires the shape to match exactly, and says so when it does not.
@hint A starred target absorbs whatever is left over.
@diagnose ValueError Unpacking checks the count and refuses to guess, with a message naming what it expected and what it got. One of the more helpful errors in the language. A starred target is the fix: `first, *rest = parts` binds the leftovers as a list, and there may be at most one starred target because two would be ambiguous. Note the asymmetry with function calls, where surplus arguments are an error unless a `*args` is there to catch them: it is the same rule in both places.

~~~starter
def split_name(full):
    """Return (first, last) for a name, ignoring any middle names."""
    first, last = full.split()
    return (first, last)


print(split_name("ada byron lovelace"))
~~~

~~~tests
assert split_name("ada lovelace") == ("ada", "lovelace")
assert split_name("ada byron lovelace") == ("ada", "lovelace")
assert split_name("plato") == ("plato", "")
~~~

~~~solution
def split_name(full):
    """Return (first, last) for a name, ignoring any middle names."""
    parts = full.split()
    first = parts[0]
    last = parts[-1] if len(parts) > 1 else ""
    return (first, last)


print(split_name("ada byron lovelace"))
~~~

## The return that is not there

`normalise` strips and lowercases a name. It does the work and then does not hand it back. The annotation lets the second judge notice before anything runs.

@expect silent
@expect mypy:return
@hint Falling off the end of a function is not an error. Ask what it returns.
@hint The annotation says this returns a `str`. Check whether every path does.
@diagnose return mypy reports "missing return statement", because the annotation promises a `str` and one path through the function returns nothing. This is one of the highest-value checks a type checker performs, and it only works because the function is annotated, and mypy does not look inside unannotated functions by default, so an unannotated version of this bug would be invisible to it.
@diagnose silent Nothing raised. Every Python function returns something, and falling off the end returns `None`, so this quietly produces `None` at every call site. The failure then surfaces somewhere else entirely, an `AttributeError` on `None`, or a `None` written into a database, which is why a forgotten `return` is disproportionately annoying to track down.

~~~starter
def normalise(name: str) -> str:
    """Return the name stripped of whitespace and lowercased."""
    name.strip().lower()
~~~

~~~tests
assert normalise("  Ada  ") == "ada"
assert normalise("BYRON") == "byron"
assert normalise("") == ""
~~~

~~~solution
def normalise(name: str) -> str:
    """Return the name stripped of whitespace and lowercased."""
    return name.strip().lower()
~~~

## Forwarding everything

`traced` is meant to wrap any function at all, call it unchanged, and record that it happened. It forwards only positional arguments, so any caller using a keyword is turned away.

@expect raises:TypeError
@hint The wrapper needs to accept and pass on both kinds of argument.
@hint `*args, **kwargs` in the definition collects both; the same symbols at the call site spread them.
@diagnose TypeError The wrapper's signature accepts only positional arguments, so a keyword argument has nowhere to go and the call fails before the wrapped function is ever reached. `def wrapper(*args, **kwargs)` collects both kinds, and `original(*args, **kwargs)` spreads both back out, the two meanings of the same symbols, used once each, in the two places they mean opposite things. This pair of lines is the whole basis of unit 26: a wrapper that forwards everything untouched can wrap anything.

~~~starter
def traced(fn, log):
    """Return a version of fn that appends its name to log when called."""
    def wrapper(*args):
        log.append(fn.__name__)
        return fn(*args)
    return wrapper


def greet(name, greeting="hello"):
    return f"{greeting}, {name}"


print(traced(greet, [])("ada", greeting="hi"))
~~~

~~~tests
log: list[str] = []
wrapped = traced(greet, log)
assert wrapped("ada") == "hello, ada"
assert wrapped("ada", greeting="hi") == "hi, ada"
assert wrapped("ada", "hi") == "hi, ada"
assert log == ["greet", "greet", "greet"]
~~~

~~~solution
def traced(fn, log):
    """Return a version of fn that appends its name to log when called."""
    def wrapper(*args, **kwargs):
        log.append(fn.__name__)
        return fn(*args, **kwargs)
    return wrapper


def greet(name, greeting="hello"):
    return f"{greeting}, {name}"


print(traced(greet, [])("ada", greeting="hi"))
~~~

## Mutating and returning, again

`configure` merges some overrides onto a base configuration. It writes into the dictionary it was handed, and hands it back, so the caller ends up with two names for one modified object.

@expect silent
@hint Which object does the function return? Compare it with the one that was passed in.
@hint `{**a, **b}` builds a new dictionary with the later keys winning.
@diagnose silent Runs, returns the right values, and has edited the caller's defaults on the way, so the second call starts from a base that the first call changed. `**kwargs` really is a fresh dictionary each call, but `base` is not: it is the caller's object, bound to a local name. `{**base, **overrides}` builds a new mapping with later keys winning and leaves both inputs alone, which is the whole fix. This is unit 02's rule again: mutate and return `None`, or compute and leave the inputs untouched.

~~~starter
def configure(base, **overrides):
    """Return base with overrides applied, leaving base untouched."""
    base.update(overrides)
    return base
~~~

~~~tests
defaults = {"host": "localhost", "port": 80}
first = configure(defaults, port=8080)
assert first == {"host": "localhost", "port": 8080}
assert defaults == {"host": "localhost", "port": 80}, f"the defaults were modified: {defaults}"
second = configure(defaults)
assert second == {"host": "localhost", "port": 80}
~~~

~~~solution
def configure(base, **overrides):
    """Return base with overrides applied, leaving base untouched."""
    return {**base, **overrides}
~~~
