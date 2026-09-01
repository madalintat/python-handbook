---
slug: 31-testing
---

## `pytest` shows the values in a failed `assert` because
- (x) It rewrites the AST of test modules at import to record the sub-expressions
- ( ) It inspects the stack frame
- ( ) `assert` does that anyway
- ( ) It re-runs the expression
> Unit 28's material doing something you will use every day, and why `assertEqual` was ever necessary.

## `assert (a == b, "message")`
- (x) Asserts a non-empty tuple, which is always true
- ( ) Asserts the comparison with a message
- ( ) Is a syntax error
- ( ) Asserts both elements
> The correct spelling has no brackets. ruff's `F631` catches it.

## A test you have never watched fail
- (x) Is a test you have not verified
- ( ) Is a passing test
- ( ) Is fine if the code is correct
- ( ) Should be deleted
> Break the code, confirm the test notices, put it back. Ten seconds.

## A `try`/`except ValueError`/`pass` written to check that something raises
- (x) Passes when nothing raises, which is the opposite of what it meant
- ( ) Fails when nothing raises
- ( ) Is what `pytest.raises` does
- ( ) Cannot compile
> `else: raise AssertionError(...)` is the plain fix, and `pytest.raises` does it for you.

## `pytest.raises(ValueError, match="positive")` adds
- (x) A check on the message, so a different `ValueError` from deeper in does not pass
- ( ) A retry
- ( ) A timeout
- ( ) Type narrowing
> Worth including, because asserting only the type is weaker than it looks.

## Comparing two floats with `==` in a test
- (x) Is a coin toss; use a tolerance or `pytest.approx`
- ( ) Is fine for simple arithmetic
- ( ) Works if you round first
- ( ) Raises
> A test that fails against correct code is worse than one that passes against wrong code: it teaches people to ignore the suite.

## `pytest` matches a fixture to a test by
- (x) The test's parameter name
- ( ) A decorator on the test
- ( ) Import order
- ( ) A registry in `conftest.py`
> Which is the piece that looks like magic until you know it.

## A fixture that `yield`s
- (x) Runs the part after the yield as teardown, whether the test passed or failed
- ( ) Must be called twice
- ( ) Cannot have teardown
- ( ) Is a generator the test iterates
> Unit 22's context manager protocol again, and unit 16's rule about what `yield` makes a function.

## `scope="session"` on a fixture
- (x) Reuses one object across tests, which makes them order-dependent if anything mutates it
- ( ) Runs it once per test
- ( ) Runs it in a subprocess
- ( ) Is required for slow fixtures
> Default to fresh per test; widen only for something genuinely expensive that nothing changes.

## `@pytest.mark.parametrize` against a loop inside one test
- (x) Each case is a separate test with its own name, so one run reports every failure
- ( ) It is faster
- ( ) It is the same thing
- ( ) It runs cases in parallel
> A loop of assertions stops at the first failure and tells you less.

## `@pytest.mark.xfail`
- (x) Records a known failure without breaking the suite, and tells you when it starts passing
- ( ) Skips the test
- ( ) Deletes the test
- ( ) Marks a test as slow
> The honest way to commit a failing test for a known bug.

## Patch a name
- (x) Where it is used, because the module under test holds its own reference
- ( ) Where it is defined
- ( ) In both places
- ( ) In `conftest.py`
> Unit 29's `from x import y` fact, which is why `mock.patch` targets look wrong the first time.

## Mocking your own internal functions
- (x) Asserts that your code calls your code, which is true by construction
- ( ) Isolates the unit under test
- ( ) Is the point of unit testing
- ( ) Is faster than the real thing
> Mock the boundary. The tell is a test that is rewritten on every refactor and has never caught a defect.

## Coverage is useful for
- (x) Finding code no test touches at all
- ( ) Measuring test quality
- ( ) Setting a team target
- ( ) Deciding what to refactor
> A line that ran is not a line that was checked. Look at what is uncovered; do not chase a number.

## A test suite is an asset when it is
- (x) Fast enough to run on every save, and trustworthy enough that a failure means something
- ( ) Complete
- ( ) At 100% coverage
- ( ) Written before the code
> Both properties are lost the same way: by adding tests that do not earn their place.
