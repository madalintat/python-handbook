---
slug: 31-testing
---

## An assertion that can never fail

The test asserts a tuple. A non-empty tuple is always truthy, so the comparison inside it is never checked.

@expect ruff:F631
@expect mypy:misc
@expect silent
@hint What does `assert (a == b, "message")` assert: the comparison, or the tuple?
@hint `assert` takes a message after a comma, not inside brackets.
@diagnose misc mypy reports the same thing in its own words: an assertion on a non-empty tuple is always true. Two independent tools flagging one line is a reasonable signal that the line is worth a second look, and it is the sort of mistake that survives review precisely because it reads as more careful rather than less.
@diagnose F631 ruff's `F631` is "assertion is always true, perhaps remove parentheses". It recognises the exact shape, which is the reason this rule exists: the mistake is invisible when you read the line quickly, and the code looks more careful than the correct version rather than less. Any linter worth running catches it, which is a good argument for running one over your tests and not only over your source.
@diagnose silent The test passed against code that is wrong. `assert (a == b, "message")` asserts a two-element tuple, and every non-empty tuple is truthy, so the comparison inside is evaluated and thrown away. The correct spelling has no brackets: `assert a == b, "message"`. This is the purest example of the rule that a test exists to fail, because a test that cannot fail costs something and returns nothing, and it will sit in the suite being counted as coverage for years.

~~~starter
def total(prices):
    """Add up a list of prices. Deliberately wrong: it drops the last one."""
    return sum(prices[:-1])


def test_total():
    assert (total([1, 2, 3]) == 6, "the total should include every price")
    return "passed"
~~~

~~~tests
try:
    test_total()
except AssertionError:
    pass
else:
    raise AssertionError("the test passed against a function that drops a price")
~~~

~~~solution
def total(prices):
    """Add up a list of prices. Deliberately wrong: it drops the last one."""
    return sum(prices[:-1])


def test_total():
    assert total([1, 2, 3]) == 6, "the total should include every price"
    return "passed"
~~~

## A test that passes when nothing goes wrong

`test_rejects_negative` checks that an order refuses a negative quantity. It catches the exception and does nothing when none arrives.

@expect ruff:SIM105
@expect silent
@hint What happens if `Order` accepts the negative quantity?
@hint A test that something raises has to fail when it does not.
@diagnose SIM105 ruff's `SIM105` is "use `contextlib.suppress(ValueError)` instead of `try`/`except`/`pass`", and it is right about the code as written and wrong about what the code meant. That is worth noticing: the rule fires because the block genuinely does nothing with the exception, which is exactly the bug. Taking ruff's suggestion here would make the mistake shorter and more idiomatic rather than fixing it, which is a good reminder that a linter reports what you wrote and cannot know what you intended.
@diagnose silent The test passed against a function that accepts a negative quantity, because a `try`/`except`/`pass` succeeds when nothing goes wrong, which is the opposite of what the test was written to say. The `else` clause on a `try` is the plain fix: it runs when no exception was raised, and failing there makes the test mean what its name says. `pytest.raises` does exactly this for you, fails when the block does not raise, and takes a `match` argument that checks the message, which is worth including because a test asserting only the type passes when a completely different `ValueError` arrives from three frames deeper.

~~~starter
def make_order(item, quantity):
    """Build an order. Deliberately wrong: it does not check the quantity."""
    return {"item": item, "quantity": quantity}


def test_rejects_negative():
    try:
        make_order("apple", -1)
    except ValueError:
        pass
    return "passed"
~~~

~~~tests
try:
    test_rejects_negative()
except AssertionError:
    pass
else:
    raise AssertionError("the test passed against a function that accepts -1")
~~~

~~~solution
def make_order(item, quantity):
    """Build an order. Deliberately wrong: it does not check the quantity."""
    return {"item": item, "quantity": quantity}


def test_rejects_negative():
    try:
        make_order("apple", -1)
    except ValueError:
        pass
    else:
        raise AssertionError("a negative quantity was accepted")
    return "passed"
~~~

## Comparing floats exactly

`test_average` asserts an exact equality between two floats. Unit 05 said why that is a coin toss, and this is the coin landing badly.

@expect silent
@hint `0.1 + 0.2` is not `0.3`. Why would an average be different?
@hint Compare within a tolerance, which is what `pytest.approx` does.
@diagnose silent The test failed against a function that is correct, which is worse than a test that passes against a wrong one, because it trains people to ignore the suite. Binary floating point cannot represent most decimal fractions exactly, so an arithmetic result that should be `0.3` is `0.30000000000000004`, and `==` says no. Compare within a tolerance: `abs(got - want) < 1e-9`, or `math.isclose(got, want)`, or in a real suite `assert got == pytest.approx(want)`, which reads best and picks a sensible relative tolerance for you. The rule is simple enough to adopt outright: never write `==` between two floats.

~~~starter
def average(values):
    """The mean of some numbers."""
    return sum(values) / len(values)


def test_average():
    assert average([0.1, 0.2]) == 0.15000000000000002
    assert average([0.1, 0.2, 0.3]) == 0.2
    return "passed"
~~~

~~~tests
assert test_average() == "passed"
~~~

~~~solution
import math


def average(values):
    """The mean of some numbers."""
    return sum(values) / len(values)


def test_average():
    assert math.isclose(average([0.1, 0.2]), 0.15)
    assert math.isclose(average([0.1, 0.2, 0.3]), 0.2)
    return "passed"
~~~

## A fixture called instead of used

`db` is a fixture that yields, so calling it gives back a generator rather than the connection. The test uses the generator as though it were the thing.

@expect raises:AttributeError
@hint A function containing `yield` returns a generator when called. Unit 16 said so.
@hint The test runner advances the generator for you. Here, nothing does.
@diagnose AttributeError A generator has no `query`, because calling a function containing `yield` builds a generator object and runs none of the body, which is unit 16's rule arriving in a new setting. `pytest` never calls a fixture directly: it advances the generator to the first `yield`, hands the test what came out, and advances it again afterwards to run the teardown. That is the whole mechanism, and writing it out by hand once, `next()` for setup and `next(..., None)` for teardown, is what makes fixtures stop feeling magical. It also explains why the teardown runs whether the test passed or failed, and why a fixture with code after the `yield` that is unreachable will never clean anything up.

~~~starter
CLOSED: list[str] = []


def connect():
    return type("Connection", (), {"query": lambda self: "rows"})()


def db():
    """A fixture: set up a connection, and close it afterwards."""
    connection = connect()
    yield connection
    CLOSED.append("closed")


def test_query():
    connection = db()
    assert connection.query() == "rows"
    return "passed"
~~~

~~~tests
assert test_query() == "passed"
assert CLOSED == ["closed"], "the fixture's teardown never ran"
~~~

~~~solution
CLOSED: list[str] = []


def connect():
    return type("Connection", (), {"query": lambda self: "rows"})()


def db():
    """A fixture: set up a connection, and close it afterwards."""
    connection = connect()
    yield connection
    CLOSED.append("closed")


def test_query():
    fixture = db()
    connection = next(fixture)
    assert connection.query() == "rows"
    next(fixture, None)
    return "passed"
~~~

## Patched where it was defined

`service` copied `fetch` out of `client` at import. The test replaces the name in `client`, which the service is no longer looking at.

@expect silent
@hint Unit 29: what does `from client import fetch` bind?
@hint Replace the name the code under test actually reads.
@diagnose silent The test failed even though the fake was installed, because `service` holds its own reference to the original function, copied at import time. `from client import fetch` binds the value, not a path back to `client`, so replacing `client.fetch` afterwards changes something nothing is reading. The rule is short and saves a great deal of time: **patch where the name is used, not where it is defined**. In real code the used name is usually `myapp.service.fetch`, which is why `mock.patch("myapp.service.fetch")` names the module under test rather than the module the function came from, and why that always looks wrong the first time.

~~~starter
import sys
import types

client = types.ModuleType("client")
exec("def fetch(url):\n    return 'real'\n", client.__dict__)
sys.modules["client"] = client

fetch = client.fetch


def service(url):
    """Fetch a URL through the client."""
    return fetch(url)


def test_service_uses_the_fake():
    client.__dict__["fetch"] = lambda url: "fake"
    assert service("/a") == "fake"
    return "passed"
~~~

~~~tests
assert test_service_uses_the_fake() == "passed"
~~~

~~~solution
import sys
import types

client = types.ModuleType("client")
exec("def fetch(url):\n    return 'real'\n", client.__dict__)
sys.modules["client"] = client


def service(url):
    """Fetch a URL through the client."""
    return fetch(url)


def fetch(url):
    return client.fetch(url)


def test_service_uses_the_fake():
    globals()["fetch"] = lambda url: "fake"
    assert service("/a") == "fake"
    return "passed"
~~~

## A fixture two tests share and one of them changes

`rows` is built once and reused. The first test consumes an item from it, so the second finds it missing.

@expect silent
@hint A shared fixture is one object. What happens when a test mutates it?
@hint The cheap fix is a fresh one per test. Say what the fixture returns.
@diagnose silent The second test failed, and it fails only when the first one has already run: on its own it passes. The first test removed an item from the shared list, so what the second found at position zero was the row that used to be second. A fixture with a wider scope, `module` or `session`, is built once and handed to every test that asks for it, which is how a slow resource gets set up once and is exactly the trade this exercise is about: the tests are now order-dependent, and running one of them alone gives a different answer from running both. That is the beginning of a suite nobody trusts. Default to a fresh fixture per test, which costs a list construction, and widen the scope only for something genuinely expensive, and then only if nothing mutates it.

~~~starter
ROWS = [{"id": 1}, {"id": 2}]


def rows():
    """A fixture: the rows every test works with."""
    return ROWS


def test_pops_the_first():
    data = rows()
    assert data.pop(0) == {"id": 1}
    return "passed"


def test_reads_the_first():
    data = rows()
    assert data[0] == {"id": 1}
    return "passed"
~~~

~~~tests
assert test_pops_the_first() == "passed"
assert test_reads_the_first() == "passed"
~~~

~~~solution
def rows():
    """A fixture: the rows every test works with, fresh each time."""
    return [{"id": 1}, {"id": 2}]


def test_pops_the_first():
    data = rows()
    assert data.pop(0) == {"id": 1}
    return "passed"


def test_reads_the_first():
    data = rows()
    assert data[0] == {"id": 1}
    return "passed"
~~~

## One test that stops at the first failure

`test_word_count` loops over its cases inside a single test. The first failure ends the loop, so the other two are never tried.

@expect silent
@hint How many of the failures does one run tell you about?
@hint Collect them, or make each case its own test.
@diagnose silent It reported one failing case where three fail, because `assert` raises and a raise ends the loop. That is the argument for `@pytest.mark.parametrize`: it makes each case a separate test with its own name in the output, so one run tells you about every failure rather than the first, and adding a case is one line. That last property is what you want when a bug report arrives, because the workflow is add the input, watch it fail, fix it. Collecting the failures by hand, as the solution does, gets you the same information without the framework, and is worth knowing for the same reason: a loop of assertions hides most of what a run could have told you.

~~~starter
def word_count(text):
    """Count the words. Deliberately wrong: it splits on a single space."""
    return len(text.split(" "))


def failing_cases():
    """Every case that does not hold, as (input, expected, actual)."""
    cases = [("", 0), ("a", 1), ("a b", 2), ("  a  b  ", 2)]
    failures = []
    for text, expected in cases:
        assert word_count(text) == expected, (text, expected)
        failures.append((text, expected, word_count(text)))
    return failures
~~~

~~~tests
found = failing_cases()
assert len(found) == 2, f"reported {len(found)} failing cases: {found}"
assert ("", 0, 1) in found
assert ("  a  b  ", 2, 7) in found
~~~

~~~solution
def word_count(text):
    """Count the words. Deliberately wrong: it splits on a single space."""
    return len(text.split(" "))


def failing_cases():
    """Every case that does not hold, as (input, expected, actual)."""
    cases = [("", 0), ("a", 1), ("a b", 2), ("  a  b  ", 2)]
    failures = []
    for text, expected in cases:
        actual = word_count(text)
        if actual != expected:
            failures.append((text, expected, actual))
    return failures
~~~

## A test that asserts the code calls itself

`test_total` replaces the two helpers the function uses and then checks that they were called. It passes whatever the arithmetic does.

@expect silent
@hint What would this test say if `total` added the numbers wrongly?
@hint Assert what the caller can observe.
@diagnose silent The test passed against a function that returns the wrong total, because everything it asserts is about which internal helpers ran rather than what came out. A test that mocks your own functions asserts that your code calls your code, which is true by construction. Mock the **boundary**, a network, a clock, a payment, where the real thing cannot run in a test; do not mock the internals, which are the thing you are supposed to be checking. The tell is that this test has to be rewritten every time somebody refactors, and has never once caught a defect, which describes a cost with no return.

~~~starter
def subtotal(prices):
    return sum(prices)


def with_tax(amount):
    """Deliberately wrong: it applies the rate to nothing."""
    return amount + 0


def total(prices):
    return with_tax(subtotal(prices))


def test_total():
    calls = []
    real = subtotal, with_tax
    globals()["subtotal"] = lambda prices: calls.append("subtotal") or 100
    globals()["with_tax"] = lambda amount: calls.append("with_tax") or 120
    try:
        total([1, 2])
        assert calls == ["subtotal", "with_tax"]
    finally:
        globals()["subtotal"], globals()["with_tax"] = real
    return "passed"
~~~

~~~tests
assert test_total() == "passed"
assert total([100]) == 120, f"total([100]) is {total([100])}"
~~~

~~~solution
def subtotal(prices):
    return sum(prices)


def with_tax(amount):
    """Apply 20% tax."""
    return round(amount * 1.2)


def total(prices):
    return with_tax(subtotal(prices))


def test_total():
    assert total([100]) == 120
    assert total([]) == 0
    return "passed"
~~~
