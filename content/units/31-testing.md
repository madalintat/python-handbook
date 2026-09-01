---
slug: 31-testing
title: Testing
---

Everything you have written in this book has been judged by a test you did not see. This unit is about writing them, and about the small number of decisions that separate a test suite people trust from one they learn to ignore.

## `pytest`, and why not `unittest`

`unittest` is in the standard library and modelled on JUnit: a class per test group, a method per test, and `assertEqual` rather than `assert`.

`pytest` runs those too, and lets you write this instead:

```python
def test_total_of_empty_basket():
    assert total([]) == 0
```

A plain function, a plain `assert`, and when it fails you get the values:

```
E       assert 3 == 0
E        +  where 3 = total([])
```

That output is not luck. `pytest` rewrites the AST of your test modules at import, replacing each `assert` with code that records the sub-expressions, which is unit 28's material doing something you will use every day. It is why a bare `assert` is enough and `assertEqual` was ever necessary.

Use `pytest`. It is the ecosystem standard, and the remainder of this unit assumes it.

## What a test is for

A test exists to fail. That is the whole value: a test that cannot fail is a cost with no return, and a test suite is worth exactly what it catches.

Three consequences follow, and they are most of what makes tests good.

**Write the failure first, or at least see it once.** A test you have never watched fail is a test you have not verified. Change the code to be wrong, confirm the test notices, put it back. This takes ten seconds and catches the assertion that was passing for the wrong reason.

**Test behaviour, not implementation.** A test that asserts a private method was called in a particular order breaks every time somebody refactors and catches nothing when the behaviour is wrong. Assert what the caller can observe.

**One reason to fail per test.** When a test with four assertions fails, you learn that one of four things is wrong. When it has one, the name tells you what broke, which is why the name matters and why `test_total_of_empty_basket` beats `test_total_2`.

## The shape of a test

Three parts, and naming them makes tests easier to read and much easier to write:

```python
def test_discount_applies_to_the_subtotal():
    basket = Basket([Item("book", 1000), Item("pen", 200)])   # arrange
    total = basket.total(discount=0.1)                        # act
    assert total == 1080                                      # assert
```

Arrange, act, assert. When a test is hard to write, it is almost always because the arrange step is long, and a long arrange step is the test telling you the code under test needs too much to exist. That signal is one of the more reliable design reviews available, and it arrives free.

## Fixtures

A fixture is a function that provides something a test needs. `pytest` matches them by **parameter name**, which is the piece that looks like magic until you know it:

```python
@pytest.fixture
def basket():
    return Basket([Item("book", 1000)])


def test_total(basket):
    assert basket.total() == 1000
```

A fixture that `yield`s runs the part after the yield as teardown, whether the test passed or failed, which is unit 22's context manager protocol again.

```python
@pytest.fixture
def db():
    connection = connect()
    yield connection
    connection.close()
```

`scope="module"` or `"session"` reuses one across many tests, which is how a slow resource gets set up once. The trade is real: a shared fixture that tests mutate makes them order-dependent, which is the beginning of a suite nobody trusts.

Two built-in fixtures earn their place immediately. `tmp_path` gives a fresh directory per test, so tests that touch files stay isolated. `monkeypatch` sets attributes, dict items and environment variables and undoes them afterwards, which is the right tool for "make this configuration value different for one test".

## Parametrising

When the same test body should run over several inputs, say so:

```python
@pytest.mark.parametrize(
    ("text", "expected"),
    [("", 0), ("a", 1), ("a b", 2), ("  a  b  ", 2)],
)
def test_word_count(text, expected):
    assert word_count(text) == expected
```

Four tests, four names in the output, four separate failures. The alternative, a loop inside one test, stops at the first failure and tells you less. Adding a case is one line, which is exactly what you want when a bug report arrives: add the input, watch it fail, fix it.

## Testing that something fails

Half of what a function promises is what it refuses, and that half is usually untested.

```python
def test_negative_quantity_is_refused():
    with pytest.raises(ValueError, match="positive"):
        Order("apple", -1)
```

`pytest.raises` fails the test if the block does **not** raise, which is the point: a bare `try`/`except`/`pass` passes when nothing goes wrong, which is the opposite of what you meant. The `match` argument checks the message against a regular expression, and it is worth including, because a test asserting only the type passes when a completely different `ValueError` arrives from three frames deeper.

`pytest.warns` does the same for warnings, and `pytest.approx` handles the floating-point comparison you will otherwise get wrong: `assert result == pytest.approx(0.3)` rather than `assert result == 0.3`, because `0.1 + 0.2` is not `0.3` and unit 05 said why.

## Marks

A mark is a label on a test, and three are worth knowing.

`@pytest.mark.skip(reason=...)` and `@pytest.mark.skipif(condition, reason=...)` leave a test out, with the reason printed in the summary. The reason is not decoration: a skipped test with no explanation is a test nobody will ever dare delete.

`@pytest.mark.xfail` says a test is expected to fail. It is the honest way to commit a failing test for a known bug: the suite stays green, the failure is recorded, and when somebody fixes it the mark turns into an `XPASS` that tells you to remove it.

Your own marks, registered in `pyproject.toml`, let you split the suite: `pytest -m "not slow"` on every save and everything in CI. That is usually the practical answer to a suite that has grown too slow to run constantly, and it is better than deleting tests.

## Mocking, and when not to

`unittest.mock` replaces something with an object that records how it was used. It is necessary at the boundaries of your program, where the real thing is a network, a clock or a payment.

```python
def test_retries_on_timeout(monkeypatch):
    calls = []

    def fake_get(url):
        calls.append(url)
        if len(calls) < 3:
            raise TimeoutError
        return "ok"

    monkeypatch.setattr(client, "get", fake_get)
    assert fetch("/a") == "ok"
    assert len(calls) == 3
```

Two rules save most of the trouble. **Patch where the name is used, not where it is defined**, which is unit 29's `from x import y` fact: the module under test holds its own reference, and that is the one to replace. And **mock the boundary, not the internals**: a test that mocks three of your own functions asserts that your code calls your code, which is true by construction and catches nothing.

When a test needs many mocks, that is usually the code telling you it has too many dependencies. A function taking a value rather than fetching it needs no mock at all, which is the design fix that keeps paying.

## Coverage, and what it is worth

`pytest --cov` reports which lines ran. It is genuinely useful for one thing: finding code no test touches at all, which is often more than you expect.

It is a poor target. A line that ran is not a line that was checked, and a suite with every line covered and no meaningful assertions reports 100% while testing nothing. Chasing a number produces tests written to reach lines rather than to catch bugs, which is the sort of test that has to be updated on every refactor and has never once found a defect.

Look at what is uncovered and ask whether it matters. Do not set a threshold and let people meet it.

## Where the tests live

`pytest` finds files called `test_*.py`, functions called `test_*`, and classes called `Test*` with no `__init__`. Two layouts work: tests beside the code, or a `tests/` directory next to the package. The second is the more common and pairs with unit 29's src layout, because it forces the tests to import the installed package rather than reaching sideways into the source.

`conftest.py` holds fixtures shared by every test in its directory and below, and is found automatically with no import. It is the right home for fixtures used across files and the wrong home for anything else: a `conftest.py` full of helper functions is a module that should have a name.

Configuration goes in `pyproject.toml` under `[tool.pytest.ini_options]`, which keeps one file for the project as unit 30 described.

## What to test

Not everything, and knowing where the value is concentrated is most of the skill.

Test the **logic that is easy to get wrong**: boundaries, empty inputs, the off-by-one, the case with one element, the case with duplicates. Test **every bug you fix**, with the failing input, because a bug that happened once can happen again and this is the cheapest regression test there is. Test the **contracts other people depend on**, which are your public functions.

Do not test the language, the framework, or a getter that returns a field. Do not write a test whose assertion restates the implementation, because it will break on every change and catch nothing on any of them.

The suite you want is fast enough to run on every save, and trustworthy enough that a failure means something is broken. Those two properties are what make a test suite an asset, and both are lost the same way: by adding tests that do not earn their place.
