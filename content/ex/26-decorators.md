---
slug: 26-decorators
---

## The wrapper that dropped the answer

`log` wraps a function, calls it, and forgets to hand the result back. Every decorated function now returns `None`.

@expect silent
@hint Follow the value. Where does the wrapped function's result go?
@hint One word, on one line.
@diagnose silent Nothing raised, and every decorated function returned `None`. `wrapper` becomes the function, so whatever `wrapper` returns is what the caller gets, and this one calls `func` for its side effects and then falls off the end. It is the single most common decorator bug, and it is quiet in the worst way: functions used for their effects keep working, functions used for their values silently produce `None`, and the two are usually in different files. Whenever a decorated function starts returning `None` for no reason, this is the first thing to check.

~~~starter
import functools


def log(func):
    """Announce each call, then get out of the way."""
    calls = []

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        calls.append(func.__name__)
        func(*args, **kwargs)

    wrapper.calls = calls
    return wrapper


@log
def double(n):
    return n * 2
~~~

~~~tests
assert double(4) == 8
assert double(0) == 0
assert double.calls == ["double", "double"]
~~~

~~~solution
import functools


def log(func):
    """Announce each call, then get out of the way."""
    calls = []

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        calls.append(func.__name__)
        return func(*args, **kwargs)

    wrapper.calls = calls
    return wrapper


@log
def double(n):
    return n * 2
~~~

## A function wearing the wrapper's name

`timed` returns a wrapper with no `functools.wraps`, so the decorated function reports the wrapper's name and has lost its docstring.

@expect silent
@hint The decorated function **is** the wrapper. Whose `__name__` does it have?
@hint One decorator on one line fixes every tool that reads function metadata.
@diagnose silent Nothing raised, and the function's name came back as `"wrapper"`. That is not cosmetic. The decorated function genuinely is the wrapper, so `help`, `inspect.signature`, Sphinx, pytest's test names, your own logging, and anything that dispatches on `__name__` all see the wrong thing, and a traceback names a function that appears nowhere in the source. `@functools.wraps(func)` copies `__name__`, `__doc__`, `__module__`, `__qualname__` and `__dict__` across, and sets `__wrapped__` so the original stays reachable. There is no case where you want a wrapper without it.

~~~starter
def timed(func):
    """Count how long each call takes."""

    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)

    return wrapper


@timed
def fetch(url):
    """Fetch a URL and return its body."""
    return f"body of {url}"
~~~

~~~tests
assert fetch("/a") == "body of /a"
assert fetch.__name__ == "fetch", f"the function calls itself {fetch.__name__!r}"
assert fetch.__doc__ == "Fetch a URL and return its body."
assert fetch.__wrapped__("/b") == "body of /b"
~~~

~~~solution
import functools


def timed(func):
    """Count how long each call takes."""

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)

    return wrapper


@timed
def fetch(url):
    """Fetch a URL and return its body."""
    return f"body of {url}"
~~~

## A decorator with configuration and one layer too few

`retry` is used as `@retry(times=3)`, which calls it and then applies the result. It is written as though it were applied directly.

@expect raises:TypeError
@hint `@retry(times=3)` expands to `f = retry(times=3)(f)`. Count the calls.
@hint A decorator that takes arguments needs three levels, and there is no way around it.
@diagnose TypeError `@retry(times=3)` is two calls: `retry(times=3)` runs first and must return something that then takes the function. This version returns a wrapper immediately, so the function is never passed in and calling the result goes wrong. The three-level shape, a configuration function returning a decorator returning a wrapper, is the whole pattern, and it reads normally from the inside out: `wrapper` does the work, `decorator` attaches it, `retry` captures the settings. Keeping those three names rather than `inner` at every level is most of what makes one of these readable a year later.

~~~starter
import functools


def retry(times):
    """Call the function again, up to `times` attempts, until it works."""

    @functools.wraps(times)
    def wrapper(*args, **kwargs):
        for attempt in range(times):
            try:
                return times(*args, **kwargs)
            except ValueError:
                if attempt == times - 1:
                    raise
        return None

    return wrapper


@retry(times=3)
def flaky(box):
    box.append(1)
    if len(box) < 3:
        raise ValueError("not yet")
    return "ok"
~~~

~~~tests
box = []
assert flaky(box) == "ok"
assert len(box) == 3

try:
    flaky([0, 0])
except ValueError:
    raise AssertionError("two failures should still have been retried into a success")
~~~

~~~solution
import functools


def retry(times):
    """Call the function again, up to `times` attempts, until it works."""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(times):
                try:
                    return func(*args, **kwargs)
                except ValueError:
                    if attempt == times - 1:
                        raise
            return None

        return wrapper

    return decorator


@retry(times=3)
def flaky(box):
    box.append(1)
    if len(box) < 3:
        raise ValueError("not yet")
    return "ok"
~~~

## Parentheses that were not there

`audit` takes an optional label, so it must be written `@audit()`. It is written `@audit`, which passes the function in where the label was expected.

@expect silent
@hint `@audit` calls `audit(the_function)`. Which parameter does the function land in, and what comes back?
@hint The fix is at the decoration, not in `audit`.
@diagnose silent Nothing raised, which is the worst possible outcome here. `@audit` without parentheses calls `audit(charge)`, binding the function to `label`, so what comes back is the inner `decorator`. `charge` is now that decorator, and `charge(5)` calls it with `5` as the function it is supposed to decorate, which returns `wrapper`. So the call succeeds and hands back a function instead of a number. This is the price of the three-level shape: `@thing` and `@thing()` are genuinely different, and the first fails somewhere well downstream rather than at the decoration. The usual answer is to require the parentheses and let the failure be loud.

~~~starter
import functools


def audit(label="call"):
    """Record every call under a label."""
    record = []

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            record.append(label)
            return func(*args, **kwargs)

        wrapper.record = record
        return wrapper

    return decorator


@audit
def charge(pence):
    return pence * 2


print(charge(5))
~~~

~~~tests
# the module-level print above already recorded one call
assert charge(5) == 10, f"charge(5) gave {charge(5)!r}"
assert charge.record == ["call", "call"]
~~~

~~~solution
import functools


def audit(label="call"):
    """Record every call under a label."""
    record = []

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            record.append(label)
            return func(*args, **kwargs)

        wrapper.record = record
        return wrapper

    return decorator


@audit()
def charge(pence):
    return pence * 2


print(charge(5))
~~~

## Stacked in the wrong order

`cached` and `authorised` are both applied. The authorisation check sits below the cache, so a request that should have been rejected is served from the cache instead.

@expect silent
@hint Decorators apply bottom up. Which one sees the call first?
@hint The check that can reject a call belongs where nothing can answer before it.
@diagnose silent Nothing raised, and an unauthorised request was served. `@cached` above `@authorised` means `f = cached(authorised(f))`, so the cache is outermost and answers first: once a value is in it, the authorisation check below never runs again. Swapping them puts the check outermost, where every call reaches it. The general rule is that the decorator nearest the `def` is closest to the function and sees every call, and the one at the top is outermost and sees only what the layers below let through. Anything that can reject a call belongs at the top; anything that exists to avoid work belongs low.

~~~starter
import functools


def cached(func):
    store = {}

    @functools.wraps(func)
    def wrapper(user, key):
        if key not in store:
            store[key] = func(user, key)
        return store[key]

    return wrapper


def authorised(func):
    @functools.wraps(func)
    def wrapper(user, key):
        if user != "admin":
            raise PermissionError("not allowed")
        return func(user, key)

    return wrapper


@cached
@authorised
def read(user, key):
    return f"value of {key}"
~~~

~~~tests
assert read("admin", "a") == "value of a"

try:
    read("guest", "a")
except PermissionError:
    pass
else:
    raise AssertionError("a guest was served from the cache")
~~~

~~~solution
import functools


def cached(func):
    store = {}

    @functools.wraps(func)
    def wrapper(user, key):
        if key not in store:
            store[key] = func(user, key)
        return store[key]

    return wrapper


def authorised(func):
    @functools.wraps(func)
    def wrapper(user, key):
        if user != "admin":
            raise PermissionError("not allowed")
        return func(user, key)

    return wrapper


@authorised
@cached
def read(user, key):
    return f"value of {key}"
~~~

## Configuration read once, at import

`retry` reads the retry count out of a settings dict in the decorator's argument. That expression runs when the `def` runs, so a later change to the settings changes nothing.

@expect raises:ValueError
@hint When does the expression in `@retry(SETTINGS["attempts"])` run?
@hint Pass the thing that can be read later, rather than the value read now.
@diagnose ValueError The call gave up after one attempt and let the failure through, even though the test raised the configured attempts to five first. Raising it had no effect, because `SETTINGS["attempts"]` was evaluated once, when the module was imported and the `def` ran. Decorators run at definition time, which is exactly what registration decorators rely on and exactly what catches this one out. It is unit 07's mutable-default surprise in a new setting: an expression in a position that runs once. The fix is to defer the read, by passing a callable that looks the value up at call time, or by reading the setting inside the wrapper. Configuration that can change wants the second; configuration fixed at start-up is fine as it was.

~~~starter
import functools

SETTINGS = {"attempts": 1}


def retry(attempts):
    """Retry a failing call the configured number of times."""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(attempts):
                try:
                    return func(*args, **kwargs)
                except ValueError:
                    if attempt == attempts - 1:
                        raise
            return None

        return wrapper

    return decorator


@retry(SETTINGS["attempts"])
def flaky(box):
    box.append(1)
    if len(box) < 3:
        raise ValueError("not yet")
    return "ok"
~~~

~~~tests
SETTINGS["attempts"] = 5
box = []
assert flaky(box) == "ok", "raising the configured attempts had no effect"
assert len(box) == 3
~~~

~~~solution
import functools

SETTINGS = {"attempts": 1}


def retry(setting):
    """Retry a failing call the configured number of times, read at each call."""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            attempts = SETTINGS[setting]
            for attempt in range(attempts):
                try:
                    return func(*args, **kwargs)
                except ValueError:
                    if attempt == attempts - 1:
                        raise
            return None

        return wrapper

    return decorator


@retry("attempts")
def flaky(box):
    box.append(1)
    if len(box) < 3:
        raise ValueError("not yet")
    return "ok"
~~~

## A decorator that is not a function

`CountCalls` is a class, so decorating a method with it puts an instance on the class. An instance is not a descriptor, so nothing binds `self`.

@expect raises:TypeError
@hint Unit 20: what turns a function on a class into a bound method?
@hint The error is about argument counts. Work out which argument is missing.
@diagnose TypeError Unit 20's protocol, arriving where you would not expect it. A function stored on a class is a non-data descriptor whose `__get__` returns a method bound to the instance, which is how `self` gets passed. A `CountCalls` instance defines `__call__` but not `__get__`, so accessing it through an instance returns the object itself with nothing bound, and the call is one argument short. A class-based decorator is fine on a plain function and broken on a method, which is a distinction nothing warns you about. The fix here is a closure, which is a function and therefore a descriptor; the alternative, adding a `__get__` that returns `functools.partial(self, obj)`, works and is more machinery than the state was worth.

~~~starter
import functools


class CountCalls:
    """Count how many times the wrapped callable ran."""

    def __init__(self, func):
        functools.update_wrapper(self, func)
        self.func = func
        self.count = 0

    def __call__(self, *args, **kwargs):
        self.count += 1
        return self.func(*args, **kwargs)


class Meter:
    def __init__(self):
        self.total = 0

    @CountCalls
    def add(self, n):
        self.total += n
        return self.total


print(Meter().add(1))
~~~

~~~tests
m = Meter()
assert m.add(2) == 2
assert m.add(3) == 5
# three calls: the module-level one above, and the two here
assert Meter.add.count == 3
~~~

~~~solution
import functools


def count_calls(func):
    """Count how many times the wrapped callable ran."""

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        wrapper.count += 1
        return func(*args, **kwargs)

    wrapper.count = 0
    return wrapper


class Meter:
    def __init__(self):
        self.total = 0

    @count_calls
    def add(self, n):
        self.total += n
        return self.total


print(Meter().add(1))
~~~

## Registered, and then thrown away

`route` records the function in a table, which is how every web framework's routing works. It records it and returns nothing, so the name it decorates becomes `None`.

@expect raises:TypeError
@hint A registration decorator does not wrap. What does it still have to do?
@hint `@` rebinds the name to whatever the decorator returns.
@diagnose TypeError The decorator returned `None`, so `home` is `None` and calling it fails. `@` rebinds the name to the decorator's result, always, whether or not the decorator meant to change anything. A registration decorator is the most common kind in real code and the least like the tutorial shape, because there is no wrapper at all: it puts the function in a table and hands it straight back. Handing it back is the part that is easy to forget precisely because nothing about the decorator's purpose suggests a return value.

~~~starter
ROUTES: dict[str, object] = {}


def route(path):
    """Register a handler for a URL path."""

    def decorator(func):
        ROUTES[path] = func

    return decorator


@route("/")
def home():
    return "welcome"


print(home())
~~~

~~~tests
assert home() == "welcome"
assert ROUTES["/"] is home
assert ROUTES["/"]() == "welcome"
~~~

~~~solution
ROUTES: dict[str, object] = {}


def route(path):
    """Register a handler for a URL path."""

    def decorator(func):
        ROUTES[path] = func
        return func

    return decorator


@route("/")
def home():
    return "welcome"


print(home())
~~~
