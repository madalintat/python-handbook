---
slug: retry-decorator
---

## Retrying at all

Start with the smallest thing that is still a retry: call the function, and if
it raises, call it again, up to a limit. Two details separate this from the
version people write first. The last attempt must let the exception through
rather than swallowing it, so a caller learns that the operation failed. And the
loop must not lose the original exception when it gives up, which is unit 32's
`B904` argument and unit 38's argument about what a traceback is worth.

Unit 26 covered the shape: a decorator with an argument is three levels, and
`functools.wraps` is not optional.

@goal `@retry(attempts=n)` calls the function up to n times and re-raises the last failure.

~~~starter
import functools


def retry(attempts=3):
    """Call the wrapped function again when it raises."""
    raise NotImplementedError
~~~

~~~tests
CALLS = []


@retry(attempts=3)
def flaky(fail_times):
    """Fail the first `fail_times` calls, then succeed."""
    CALLS.append(len(CALLS))
    if len(CALLS) <= fail_times:
        raise ValueError(f"attempt {len(CALLS)}")
    return "ok"


CALLS.clear()
assert flaky(0) == "ok"
assert len(CALLS) == 1, "a call that works must not be retried"

CALLS.clear()
assert flaky(2) == "ok"
assert len(CALLS) == 3

# the last failure reaches the caller rather than being swallowed
CALLS.clear()
try:
    flaky(5)
except ValueError as exc:
    assert str(exc) == "attempt 3", f"the exception the caller saw was {exc}"
else:
    raise AssertionError("giving up should raise, not return None")
assert len(CALLS) == 3, f"tried {len(CALLS)} times, attempts was 3"

# unit 26: the wrapper must not eat the function's identity
assert flaky.__name__ == "flaky"
assert flaky.__doc__.startswith("Fail the first")

# one attempt is a valid setting and means no retry
CALLS.clear()


@retry(attempts=1)
def always_fails():
    CALLS.append(1)
    raise RuntimeError("no")


try:
    always_fails()
except RuntimeError:
    pass
assert len(CALLS) == 1
~~~

~~~solution
import functools


def retry(attempts=3):
    """Call the wrapped function again when it raises."""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(1, attempts + 1):
                try:
                    return func(*args, **kwargs)
                except Exception:
                    # The last attempt is the caller's answer, so it goes up
                    # with its traceback rather than becoming a None.
                    if attempt == attempts:
                        raise
            return None

        return wrapper

    return decorator
~~~

## Retrying only what is worth retrying

A retry that catches everything is worse than no retry. A `TypeError` from
calling the function wrongly will fail identically three times and then surface
three times slower, and unit 32's argument about bare excepts applies with
force: retrying a `KeyboardInterrupt` is a program that will not stop.

So the decorator needs to be told which exceptions are worth another go. The
usual interface is a tuple of exception classes, defaulting to something narrow,
plus a predicate for the cases a type cannot express: an HTTP 503 is worth
retrying and an HTTP 400 is not, and both are the same exception class.

@goal `on=` selects which exception types retry, and `should_retry=` decides per exception.

~~~starter
import functools


class Transient(Exception):
    """Something that might work next time."""


class Permanent(Exception):
    """Something that will not."""


def retry(attempts=3, on=(Exception,), should_retry=None):
    """Call the wrapped function again when it raises something retryable."""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(1, attempts + 1):
                try:
                    return func(*args, **kwargs)
                except Exception:
                    if attempt == attempts:
                        raise
            return None

        return wrapper

    return decorator
~~~

~~~tests
CALLS = []


# an exception outside `on` is not retried at all
@retry(attempts=3, on=(Transient,))
def wrong_type():
    CALLS.append(1)
    raise Permanent("do not try this again")


CALLS.clear()
try:
    wrong_type()
except Permanent:
    pass
else:
    raise AssertionError("a non-retryable exception should reach the caller")
assert len(CALLS) == 1, f"a Permanent error was retried {len(CALLS)} times"


# one inside it is
@retry(attempts=3, on=(Transient,))
def right_type():
    CALLS.append(1)
    if len(CALLS) < 3:
        raise Transient("again")
    return "ok"


CALLS.clear()
assert right_type() == "ok"
assert len(CALLS) == 3


# a subclass of a listed type counts
class VeryTransient(Transient):
    pass


CALLS.clear()


@retry(attempts=2, on=(Transient,))
def subclass():
    CALLS.append(1)
    raise VeryTransient("still transient")


try:
    subclass()
except VeryTransient:
    pass
assert len(CALLS) == 2


# the predicate decides where the type cannot
class HttpError(Exception):
    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.status = status


CALLS.clear()


@retry(attempts=4, on=(HttpError,), should_retry=lambda exc: exc.status >= 500)
def request(status):
    CALLS.append(status)
    raise HttpError(status)


try:
    request(503)
except HttpError:
    pass
assert len(CALLS) == 4, "a 503 should have been retried"

CALLS.clear()
try:
    request(400)
except HttpError:
    pass
assert len(CALLS) == 1, "a 400 should not have been retried"

# the predicate only ever sees exceptions that already matched `on`
seen = []
CALLS.clear()


@retry(attempts=2, on=(Transient,), should_retry=lambda exc: seen.append(type(exc)) or True)
def mixed():
    CALLS.append(1)
    raise Permanent("not in on=")


try:
    mixed()
except Permanent:
    pass
assert seen == [], "the predicate was asked about an exception `on` had excluded"
~~~

~~~solution
import functools


class Transient(Exception):
    """Something that might work next time."""


class Permanent(Exception):
    """Something that will not."""


def retry(attempts=3, on=(Exception,), should_retry=None):
    """Call the wrapped function again when it raises something retryable."""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(1, attempts + 1):
                try:
                    return func(*args, **kwargs)
                except on as exc:
                    # Two filters, in order: the type says whether this is the
                    # kind of failure that retries, and the predicate says
                    # whether this particular one does. An exception outside
                    # `on` never reaches either and goes straight up.
                    if should_retry is not None and not should_retry(exc):
                        raise
                    if attempt == attempts:
                        raise
            return None

        return wrapper

    return decorator
~~~

## Backing off, with jitter

Retrying immediately is the wrong thing to do to a service that is struggling,
and retrying on a fixed schedule is worse: every client that failed at the same
moment comes back at the same moment, which is the thundering herd that turns a
blip into an outage.

Exponential backoff waits `base * factor ** (attempt - 1)`, so the gaps grow.
Jitter spreads the clients out by randomising each wait, and full jitter, a
uniform draw between zero and the computed delay, is the variant that measures
best. Cap the delay so the twentieth attempt is not an hour away.

Take the sleep function as an argument rather than calling `time.sleep`
directly. Unit 31 gave the reason: a test for the delays should not spend the
delays, and a decorator that hardcodes its clock cannot be tested at all.

@goal `delays_for(...)` produces capped exponential waits, and the decorator sleeps them.

~~~starter
import functools
import random


class Transient(Exception):
    """Something that might work next time."""


class Permanent(Exception):
    """Something that will not."""


def delays_for(attempts, base=0.1, factor=2.0, cap=10.0, jitter=None):
    """The wait before each retry. One shorter than `attempts`."""
    raise NotImplementedError


def retry(attempts=3, on=(Exception,), should_retry=None,
          base=0.1, factor=2.0, cap=10.0, jitter=None, sleep=None):
    """Call the wrapped function again, waiting longer each time."""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(1, attempts + 1):
                try:
                    return func(*args, **kwargs)
                except on as exc:
                    if should_retry is not None and not should_retry(exc):
                        raise
                    if attempt == attempts:
                        raise
            return None

        return wrapper

    return decorator
~~~

~~~tests
# no jitter: a plain geometric sequence, one delay shorter than the attempts
assert delays_for(1) == []
assert delays_for(4, base=1, factor=2, cap=100, jitter=lambda d: d) == [1, 2, 4]
assert delays_for(3, base=0.5, factor=3, cap=100, jitter=lambda d: d) == [0.5, 1.5]

# the cap holds, and holds for every later attempt
capped = delays_for(6, base=1, factor=10, cap=5, jitter=lambda d: d)
assert capped == [1, 5, 5, 5, 5], f"got {capped}"

# jitter draws between zero and the computed delay
import random

rng = random.Random(0)
drawn = delays_for(5, base=1, factor=2, cap=100, jitter=lambda d: rng.uniform(0, d))
plain = [1, 2, 4, 8]
assert len(drawn) == 4
assert all(0 <= d <= p for d, p in zip(drawn, plain, strict=True)), f"got {drawn}"
assert drawn != plain, "with jitter the delays should not be the plain sequence"

# the decorator sleeps between attempts, and not after the last one
SLEPT = []
CALLS = []


@retry(attempts=3, base=1, factor=2, cap=100, jitter=lambda d: d, sleep=SLEPT.append)
def always_fails():
    CALLS.append(1)
    raise ValueError("no")


try:
    always_fails()
except ValueError:
    pass
assert CALLS == [1, 1, 1]
assert SLEPT == [1, 2], f"slept {SLEPT}, expected one wait between each pair"

# a call that works sleeps not at all
SLEPT.clear()
CALLS.clear()


@retry(attempts=3, base=1, jitter=lambda d: d, sleep=SLEPT.append)
def works():
    CALLS.append(1)
    return "ok"


assert works() == "ok"
assert SLEPT == []

# and one that recovers sleeps only for the failures
SLEPT.clear()
CALLS.clear()


@retry(attempts=5, base=1, factor=2, cap=100, jitter=lambda d: d, sleep=SLEPT.append)
def recovers():
    CALLS.append(1)
    if len(CALLS) < 3:
        raise ValueError("again")
    return "ok"


assert recovers() == "ok"
assert SLEPT == [1, 2]
~~~

~~~solution
import functools
import random


class Transient(Exception):
    """Something that might work next time."""


class Permanent(Exception):
    """Something that will not."""


def full_jitter(delay):
    """A uniform draw between zero and the delay."""
    return random.uniform(0, delay)


def delays_for(attempts, base=0.1, factor=2.0, cap=10.0, jitter=None):
    """The wait before each retry. One shorter than `attempts`.

    Exponential, capped, then jittered. Full jitter, a uniform draw between
    zero and the computed delay, is the default: it spreads clients that failed
    together so they do not come back together.
    """
    if jitter is None:
        jitter = full_jitter
    out = []
    for attempt in range(1, attempts):
        out.append(jitter(min(cap, base * factor ** (attempt - 1))))
    return out


def retry(attempts=3, on=(Exception,), should_retry=None,
          base=0.1, factor=2.0, cap=10.0, jitter=None, sleep=None):
    """Call the wrapped function again, waiting longer each time."""
    if sleep is None:
        import time

        sleep = time.sleep

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            waits = delays_for(attempts, base, factor, cap, jitter)
            for attempt in range(1, attempts + 1):
                try:
                    return func(*args, **kwargs)
                except on as exc:
                    if should_retry is not None and not should_retry(exc):
                        raise
                    if attempt == attempts:
                        raise
                    sleep(waits[attempt - 1])
            return None

        return wrapper

    return decorator
~~~

## Something you would deploy

The last stage adds the two things that separate a retry helper from a retry
library. A caller needs to know what happened, so the decorator takes a hook
called before each wait, which is where logging goes; and unit 32's argument
about `logging` rather than `print` is why it is a hook rather than a print.

And when every attempt fails, the caller deserves better than the last
exception on its own. Raise a `RetryError` that says how many attempts were made
and how long was spent waiting, with the last failure attached as its cause, so
the traceback shows both halves. That is unit 38's rule: add context, keep the
cause.

Keep the original exception reachable as an attribute too, because a caller that
wants to branch on it should not have to parse a traceback.

@goal `RetryError` carries the attempts, the total wait and the last failure as its cause.

~~~starter
import functools
import random


class Transient(Exception):
    """Something that might work next time."""


class Permanent(Exception):
    """Something that will not."""


class RetryError(Exception):
    """Every attempt failed."""

    def __init__(self, attempts, waited, last):
        super().__init__(
            f"{attempts} attempts failed over {waited:.2f}s: {type(last).__name__}: {last}"
        )
        self.attempts = attempts
        self.waited = waited
        self.last = last


def full_jitter(delay):
    """A uniform draw between zero and the delay, which is the default."""
    return random.uniform(0, delay)


def delays_for(attempts, base=0.1, factor=2.0, cap=10.0, jitter=None):
    """The wait before each retry. One shorter than `attempts`."""
    if jitter is None:
        jitter = full_jitter
    out = []
    for attempt in range(1, attempts):
        out.append(jitter(min(cap, base * factor ** (attempt - 1))))
    return out


def retry(attempts=3, on=(Exception,), should_retry=None,
          base=0.1, factor=2.0, cap=10.0, jitter=None, sleep=None, before_sleep=None):
    """Call the wrapped function again, and report properly when it never works."""
    if sleep is None:
        import time

        sleep = time.sleep

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            waits = delays_for(attempts, base, factor, cap, jitter)
            for attempt in range(1, attempts + 1):
                try:
                    return func(*args, **kwargs)
                except on as exc:
                    if should_retry is not None and not should_retry(exc):
                        raise
                    if attempt == attempts:
                        raise
                    sleep(waits[attempt - 1])
            return None

        return wrapper

    return decorator
~~~

~~~tests
CALLS = []
SLEPT = []
EVENTS = []


@retry(attempts=3, base=1, factor=2, cap=100, jitter=lambda d: d,
       sleep=SLEPT.append, before_sleep=lambda info: EVENTS.append(info))
def always_fails():
    CALLS.append(1)
    raise ValueError("boom")


try:
    always_fails()
except RetryError as exc:
    assert exc.attempts == 3, f"reported {exc.attempts} attempts"
    assert abs(exc.waited - 3.0) < 1e-9, f"reported {exc.waited}s waited"
    assert isinstance(exc.last, ValueError)
    assert str(exc.last) == "boom"
    assert isinstance(exc.__cause__, ValueError), "the last failure should be the cause"
    assert "3 attempts" in str(exc) and "boom" in str(exc)
else:
    raise AssertionError("exhausting the attempts should raise RetryError")

assert CALLS == [1, 1, 1]
assert SLEPT == [1, 2]

# the hook fires once per wait, before it, with the attempt and the delay
assert len(EVENTS) == 2, f"the hook fired {len(EVENTS)} times for two waits"
assert EVENTS[0]["attempt"] == 1 and EVENTS[0]["delay"] == 1
assert EVENTS[1]["attempt"] == 2 and EVENTS[1]["delay"] == 2
assert isinstance(EVENTS[0]["exception"], ValueError)

# a non-retryable exception is still not wrapped: the caller wanted that one
CALLS.clear()


@retry(attempts=3, on=(ValueError,), sleep=SLEPT.append)
def wrong_type():
    CALLS.append(1)
    raise TypeError("not retryable")


try:
    wrong_type()
except TypeError:
    pass
else:
    raise AssertionError("an exception outside `on` should reach the caller unchanged")
assert len(CALLS) == 1

# nor is one the predicate refused
CALLS.clear()


@retry(attempts=3, on=(ValueError,), should_retry=lambda e: False, sleep=SLEPT.append)
def refused():
    CALLS.append(1)
    raise ValueError("give up now")


try:
    refused()
except ValueError as exc:
    assert not isinstance(exc, RetryError)
assert len(CALLS) == 1

# success still returns, and still says nothing
EVENTS.clear()
SLEPT.clear()


@retry(attempts=3, sleep=SLEPT.append, before_sleep=EVENTS.append)
def works():
    return "ok"


assert works() == "ok"
assert (SLEPT, EVENTS) == ([], [])
~~~

~~~solution
import functools
import random


class Transient(Exception):
    """Something that might work next time."""


class Permanent(Exception):
    """Something that will not."""


class RetryError(Exception):
    """Every attempt failed."""

    def __init__(self, attempts, waited, last):
        super().__init__(
            f"{attempts} attempts failed over {waited:.2f}s: {type(last).__name__}: {last}"
        )
        self.attempts = attempts
        self.waited = waited
        self.last = last


def full_jitter(delay):
    """A uniform draw between zero and the delay, which is the default."""
    return random.uniform(0, delay)


def delays_for(attempts, base=0.1, factor=2.0, cap=10.0, jitter=None):
    """The wait before each retry. One shorter than `attempts`."""
    if jitter is None:
        jitter = full_jitter
    out = []
    for attempt in range(1, attempts):
        out.append(jitter(min(cap, base * factor ** (attempt - 1))))
    return out


def retry(attempts=3, on=(Exception,), should_retry=None,
          base=0.1, factor=2.0, cap=10.0, jitter=None, sleep=None, before_sleep=None):
    """Call the wrapped function again, and report properly when it never works."""
    if sleep is None:
        import time

        sleep = time.sleep

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            waits = delays_for(attempts, base, factor, cap, jitter)
            waited = 0.0
            for attempt in range(1, attempts + 1):
                try:
                    return func(*args, **kwargs)
                except on as exc:
                    # An exception the caller did not ask to retry is the
                    # caller's, unchanged: wrapping it would hide a bug behind
                    # a retry failure.
                    if should_retry is not None and not should_retry(exc):
                        raise
                    if attempt == attempts:
                        # Context added, cause kept: the traceback shows both
                        # what gave up and what actually went wrong.
                        raise RetryError(attempts, waited, exc) from exc
                    delay = waits[attempt - 1]
                    if before_sleep is not None:
                        before_sleep({"attempt": attempt, "delay": delay, "exception": exc})
                    sleep(delay)
                    waited += delay
            return None

        return wrapper

    return decorator
~~~
