---
slug: test-framework
---

## Finding the tests

Before anything can be run, it has to be found. `pytest` collects by convention:
a function whose name starts with `test_`, in a module whose name does too. That
convention is doing real work, because it means a test is an ordinary function
and needs no registration, no decorator and no base class.

Collect in **definition order** rather than alphabetically. A module reads top to
bottom, and a report that jumps around is harder to follow than one that does
not. A function object carries `__code__.co_firstlineno`, which is where it was
defined, and that is enough to sort by.

Skip anything that is not callable, and skip classes, because `TestCase` is
somebody else's convention and a class named `test_thing` is a mistake rather
than a test.

@goal `collect` finds test functions in definition order and nothing else.

~~~starter
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    def summary(self):
        return f"{len(self.passed)} passed, {len(self.failed)} failed"


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined."""
    raise NotImplementedError
~~~

~~~tests
import types

mod = types.ModuleType("sample")
exec(
    "def test_zebra(): pass\n"
    "def helper(): pass\n"
    "def test_apple(): pass\n"
    "value = 3\n"
    "def test_middle(): pass\n"
    "class test_klass: pass\n"
    "check_this = lambda: None\n",
    mod.__dict__,
)

names = [name for name, _ in collect(mod)]
assert names == ["test_zebra", "test_apple", "test_middle"], names

# definition order, not alphabetical, which is the whole point of the sort
assert names != sorted(names)

# the callables come back too, and they are the real functions
found = dict(collect(mod))
assert found["test_apple"] is mod.test_apple
assert callable(found["test_zebra"])

# non-tests are left alone
assert "helper" not in found
assert "value" not in found
assert "test_klass" not in found, "a class is not a test function"

# the prefix is an argument
assert [n for n, _ in collect(mod, prefix="check_")] == ["check_this"]
assert collect(mod, prefix="nothing_") == []

# an empty namespace collects nothing rather than failing
assert collect(types.ModuleType("empty")) == []

# a plain object with attributes works too, since it only needs vars()
class Holder:
    def test_one(self):
        pass

    def test_two(self):
        pass

    def not_a_test(self):
        pass


assert [n for n, _ in collect(Holder)] == ["test_one", "test_two"]

# the report type carries what a caller needs
report = Report([Result("a", True), Result("b", False, ValueError("no"))])
assert len(report.passed) == 1 and len(report.failed) == 1
assert report.summary() == "1 passed, 1 failed"
assert not report, "a report with a failure should be falsy"
assert Report([Result("a", True)]), "a report with no failures should be truthy"
assert Report([]), "an empty report has nothing wrong with it"
~~~

~~~solution
import inspect
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    def summary(self):
        return f"{len(self.passed)} passed, {len(self.failed)} failed"


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]
~~~

## Running them, and surviving what they do

A test runner is a loop that calls functions and refuses to be stopped by any of
them. Everything a test can do has to be caught: an assertion, an unexpected
exception, a `SystemExit` from something that called `sys.exit`.

Catch `BaseException` rather than `Exception`, which is the one place unit 32's
rule about bare excepts is turned around. A test that raises `SystemExit` has
failed, and the runner has to say so rather than exiting. The single exception
is `KeyboardInterrupt`: swallow that and the run cannot be stopped, so re-raise
it and let the interruption work.

Capture what a test prints, because a hundred tests each printing is noise, and
the output of the one that failed is exactly what you want to see.

@goal `run` reports every test's outcome and survives anything a test does.

~~~starter
import inspect
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    def summary(self):
        return f"{len(self.passed)} passed, {len(self.failed)} failed"


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]


def run_one(name, func):
    """Run one test, catching whatever it does."""
    raise NotImplementedError


def run(namespace, prefix="test_"):
    """Run every test in a namespace and report what happened."""
    raise NotImplementedError
~~~

~~~tests
import types

# stage one still holds
mod = types.ModuleType("s")
exec("def test_b(): pass\ndef test_a(): pass\n", mod.__dict__)
assert [n for n, _ in collect(mod)] == ["test_b", "test_a"]

# a passing test and a failing one
mod = types.ModuleType("t")
exec(
    "def test_passes():\n    assert 1 == 1\n"
    "def test_fails():\n    assert 1 == 2\n"
    "def test_raises():\n    raise ValueError('boom')\n",
    mod.__dict__,
)
report = run(mod)
assert len(report.results) == 3
assert [r.name for r in report.passed] == ["test_passes"]
assert [r.name for r in report.failed] == ["test_fails", "test_raises"]
assert report.summary() == "1 passed, 2 failed"
assert not report

# the exception is kept, not just the fact of it
failure = {r.name: r for r in report.failed}
assert isinstance(failure["test_fails"].error, AssertionError)
assert isinstance(failure["test_raises"].error, ValueError)
assert str(failure["test_raises"].error) == "boom"

# one test failing does not stop the next one running
assert len(report.results) == 3

# output is captured, per test, and not printed
noisy = types.ModuleType("n")
exec(
    "def test_talks():\n    print('hello from the test')\n"
    "def test_quiet():\n    pass\n",
    noisy.__dict__,
)
out = run(noisy)
by_name = {r.name: r for r in out.results}
assert by_name["test_talks"].output == "hello from the test\n"
assert by_name["test_quiet"].output == ""
assert out.summary() == "2 passed, 0 failed"

# a test that exits is a failed test, not the end of the run
exiting = types.ModuleType("e")
exec(
    "import sys\n"
    "def test_exits():\n    sys.exit(1)\n"
    "def test_after(): pass\n",
    exiting.__dict__,
)
result = run(exiting)
assert result.summary() == "1 passed, 1 failed"
assert isinstance(result.failed[0].error, SystemExit)

# but an interruption really does interrupt
stopping = types.ModuleType("k")
exec("def test_stops():\n    raise KeyboardInterrupt\n", stopping.__dict__)
try:
    run(stopping)
except KeyboardInterrupt:
    pass
else:
    raise AssertionError("KeyboardInterrupt must not be swallowed by the runner")

# a module with no tests is a clean run
assert run(types.ModuleType("empty")).summary() == "0 passed, 0 failed"
~~~

~~~solution
import contextlib
import inspect
import io
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    def summary(self):
        return f"{len(self.passed)} passed, {len(self.failed)} failed"


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




def run_one(name, func):
    """Run one test, catching whatever it does."""
    captured = io.StringIO()
    try:
        with contextlib.redirect_stdout(captured):
            func()
    except BaseException as exc:  # noqa: BLE001
        # BaseException, not Exception: a test that raises SystemExit has
        # failed, and swallowing KeyboardInterrupt would make the run
        # unstoppable, so it is re-raised below rather than reported.
        if isinstance(exc, KeyboardInterrupt):
            raise
        return Result(name, False, exc, captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_"):
    """Run every test in a namespace and report what happened."""
    return Report([run_one(name, func) for name, func in collect(namespace, prefix)])
~~~

## Fixtures, matched by name

This is the piece that looks like magic and is not. A test declares what it
needs as parameters, and the runner looks each parameter name up in a registry
of fixtures and calls the one it finds. That is the whole mechanism, and
`inspect.signature` from unit 28 is what makes it possible.

A fixture that `yield`s gets teardown for free: run it to the first yield, hand
the test what came out, and run it again afterwards. Unit 22 explained why the
teardown has to happen whether the test passed or failed, and unit 16 explained
what calling a generator function actually gives you.

Fixtures can ask for fixtures, because resolving one is the same operation
applied to its own parameters. Tear down in reverse order, so a fixture that
depends on another is finished before the thing it depends on.

@goal Fixtures resolve by parameter name, nest, and tear down in reverse order.

~~~starter
import contextlib
import inspect
import io
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    def summary(self):
        return f"{len(self.passed)} passed, {len(self.failed)} failed"


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




def run_one(name, func):
    """Run one test, catching whatever it does."""
    captured = io.StringIO()
    try:
        with contextlib.redirect_stdout(captured):
            func()
    except BaseException as exc:  # noqa: BLE001
        # BaseException, not Exception: a test that raises SystemExit has
        # failed, and swallowing KeyboardInterrupt would make the run
        # unstoppable, so it is re-raised below rather than reported.
        if isinstance(exc, KeyboardInterrupt):
            raise
        return Result(name, False, exc, captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_"):
    """Run every test in a namespace and report what happened."""
    return Report([run_one(name, func) for name, func in collect(namespace, prefix)])


FIXTURES: dict = {}


def fixture(func):
    """Register a function that provides something a test asks for by name."""
    raise NotImplementedError


def resolve(func, registry=None, finished=None):
    """The arguments a test asked for, and the teardowns owed afterwards."""
    raise NotImplementedError


def teardown(finished):
    """Finish every generator fixture, in reverse order, whatever happened."""
    raise NotImplementedError
~~~

~~~tests
import types

# stage two still holds
mod = types.ModuleType("t")
exec("def test_ok(): pass\ndef test_no(): assert False\n", mod.__dict__)
assert run(mod).summary() == "1 passed, 1 failed"

# a fixture is matched to a parameter by name
registry = {}
LOG = []


def number():
    return 42


registry["number"] = number

mod = types.ModuleType("f")
exec("def test_gets_it(number):\n    assert number == 42\n", mod.__dict__)
assert run(mod, registry=registry).summary() == "1 passed, 0 failed"

# a parameter with no fixture is an error that names it
mod = types.ModuleType("g")
exec("def test_missing(nothing): pass\n", mod.__dict__)
report = run(mod, registry=registry)
assert len(report.failed) == 1
assert isinstance(report.failed[0].error, LookupError)
assert "nothing" in str(report.failed[0].error)

# a yielding fixture tears down after the test
def resource():
    LOG.append("open")
    yield "handle"
    LOG.append("close")


registry["resource"] = resource
LOG.clear()
mod = types.ModuleType("h")
exec("def test_uses(resource):\n    assert resource == 'handle'\n", mod.__dict__)
assert run(mod, registry=registry).summary() == "1 passed, 0 failed"
assert LOG == ["open", "close"], LOG

# and it tears down even when the test fails
LOG.clear()
mod = types.ModuleType("i")
exec("def test_breaks(resource):\n    raise ValueError('no')\n", mod.__dict__)
report = run(mod, registry=registry)
assert not report
assert LOG == ["open", "close"], "teardown must run whatever the test did"

# fixtures can ask for fixtures
def wrapper(resource):
    LOG.append("wrap")
    yield f"wrapped({resource})"
    LOG.append("unwrap")


registry["wrapper"] = wrapper
LOG.clear()
mod = types.ModuleType("j")
exec("def test_nested(wrapper):\n    assert wrapper == 'wrapped(handle)'\n", mod.__dict__)
assert run(mod, registry=registry).summary() == "1 passed, 0 failed"
assert LOG == ["open", "wrap", "unwrap", "close"], f"torn down in the wrong order: {LOG}"

# several fixtures on one test
LOG.clear()
mod = types.ModuleType("k")
exec("def test_both(number, resource):\n    assert (number, resource) == (42, 'handle')\n",
     mod.__dict__)
assert run(mod, registry=registry).summary() == "1 passed, 0 failed"

# a test with no parameters needs no fixtures at all
mod = types.ModuleType("l")
exec("def test_plain(): pass\n", mod.__dict__)
assert run(mod, registry=registry).summary() == "1 passed, 0 failed"

# the decorator registers into the global table
@fixture
def registered():
    return "yes"


assert FIXTURES["registered"] is registered
assert registered() == "yes", "the decorator must hand the function back"
~~~

~~~solution
import contextlib
import inspect
import io
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    def summary(self):
        return f"{len(self.passed)} passed, {len(self.failed)} failed"


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




FIXTURES: dict = {}


def fixture(func):
    """Register a function that provides something a test asks for by name."""
    FIXTURES[func.__name__] = func
    return func


def resolve(func, registry=None, finished=None):
    """The arguments a test asked for, and the teardowns owed afterwards.

    A parameter name is a fixture name, which is how a test says what it needs
    without importing it. A fixture that yields runs the part after the yield
    as teardown, which is unit 22's protocol in a different shape.
    """
    registry = FIXTURES if registry is None else registry
    finished = [] if finished is None else finished
    kwargs = {}
    for name in inspect.signature(func).parameters:
        if name not in registry:
            raise LookupError(f"{func.__name__} asks for {name!r}, which is not a fixture")
        provider = registry[name]
        nested = resolve(provider, registry, finished)
        made = provider(**nested)
        if inspect.isgenerator(made):
            kwargs[name] = next(made)
            finished.append(made)
        else:
            kwargs[name] = made
    return kwargs


def teardown(finished):
    """Finish every generator fixture, in reverse order, whatever happened."""
    errors = []
    for generator in reversed(finished):
        try:
            next(generator, None)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    return errors
def run_one(name, func, registry=None):
    """Run one test with its fixtures, catching whatever it does."""
    captured = io.StringIO()
    finished = []
    try:
        with contextlib.redirect_stdout(captured):
            kwargs = resolve(func, registry, finished)
            func(**kwargs)
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, KeyboardInterrupt):
            teardown(finished)
            raise
        teardown(finished)
        return Result(name, False, exc, captured.getvalue())
    errors = teardown(finished)
    if errors:
        return Result(name, False, errors[0], captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_", registry=None):
    """Run every test in a namespace and report what happened."""
    return Report([run_one(name, func, registry)
                   for name, func in collect(namespace, prefix)])
~~~

## Making a bare assert explain itself

`assert total == expected` fails with `AssertionError` and nothing else, which
is why `unittest` has forty `assertEqual` methods. `pytest` does not, and the
reason is unit 28: it rewrites the AST of your test modules at import, turning
each bare assert into one that carries a description of what it compared.

Do the same. Walk the tree, find every `Assert` node, and give it a message
built from the source of the test it was checking. `ast.unparse` renders a node
back to source, so `assert total == 42` gains the message `total == 42` and a
failure says which comparison it was rather than only that there was one.

Leave an assert that already has a message alone. The author said something
better than a machine can.

@goal `rewrite` gives every bare assert a message describing what it compared.

~~~starter
import ast
import contextlib
import inspect
import io
import linecache
import types
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    def summary(self):
        return f"{len(self.passed)} passed, {len(self.failed)} failed"


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




FIXTURES: dict = {}


def fixture(func):
    """Register a function that provides something a test asks for by name."""
    FIXTURES[func.__name__] = func
    return func


def resolve(func, registry=None, finished=None):
    """The arguments a test asked for, and the teardowns owed afterwards.

    A parameter name is a fixture name, which is how a test says what it needs
    without importing it. A fixture that yields runs the part after the yield
    as teardown, which is unit 22's protocol in a different shape.
    """
    registry = FIXTURES if registry is None else registry
    finished = [] if finished is None else finished
    kwargs = {}
    for name in inspect.signature(func).parameters:
        if name not in registry:
            raise LookupError(f"{func.__name__} asks for {name!r}, which is not a fixture")
        provider = registry[name]
        nested = resolve(provider, registry, finished)
        made = provider(**nested)
        if inspect.isgenerator(made):
            kwargs[name] = next(made)
            finished.append(made)
        else:
            kwargs[name] = made
    return kwargs


def teardown(finished):
    """Finish every generator fixture, in reverse order, whatever happened."""
    errors = []
    for generator in reversed(finished):
        try:
            next(generator, None)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    return errors
def run_one(name, func, registry=None):
    """Run one test with its fixtures, catching whatever it does."""
    captured = io.StringIO()
    finished = []
    try:
        with contextlib.redirect_stdout(captured):
            kwargs = resolve(func, registry, finished)
            func(**kwargs)
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, KeyboardInterrupt):
            teardown(finished)
            raise
        teardown(finished)
        return Result(name, False, exc, captured.getvalue())
    errors = teardown(finished)
    if errors:
        return Result(name, False, errors[0], captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_", registry=None):
    """Run every test in a namespace and report what happened."""
    return Report([run_one(name, func, registry)
                   for name, func in collect(namespace, prefix)])



class AssertRewriter(ast.NodeTransformer):
    """Replace `assert X` with one that reports the values X was made of."""

    def visit_Assert(self, node):
        raise NotImplementedError


def explain(test):
    """A description of what the assertion compared, from its source."""
    raise NotImplementedError


def rewrite(source, filename="<tests>"):
    """Compile test source with every bare assert given a message."""
    raise NotImplementedError


def load_tests(source, filename="<tests>"):
    """Execute rewritten test source and return the namespace it built.

    The source is registered with linecache so a traceback can show the failing
    line. Code compiled from a string has no file to read, and every tool that
    generates code does this for the same reason.
    """
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    namespace = types.ModuleType(filename)
    exec(rewrite(source, filename), namespace.__dict__)
    return namespace
~~~

~~~tests
import ast
import types

# stage three still holds
registry = {"number": lambda: 42}
mod = types.ModuleType("t")
exec("def test_uses(number):\n    assert number == 42\n", mod.__dict__)
assert run(mod, registry=registry).summary() == "1 passed, 0 failed"

# explain renders the comparison back to source
assert explain(ast.parse("a == b", mode="eval").body) == "a == b"
assert explain(ast.parse("total > 0", mode="eval").body) == "total > 0"
assert explain(ast.parse("f(x) in items", mode="eval").body) == "f(x) in items"

# a rewritten bare assert carries that description
namespace = load_tests(
    "def test_fails():\n"
    "    total = 3\n"
    "    assert total == 42\n"
)
report = run(namespace)
assert len(report.failed) == 1
message = str(report.failed[0].error)
assert "total == 42" in message, f"the failure said {message!r}"

# a passing assert is untouched in behaviour
namespace = load_tests("def test_passes():\n    assert 1 + 1 == 2\n")
assert run(namespace).summary() == "1 passed, 0 failed"

# an assert the author gave a message keeps it
namespace = load_tests(
    "def test_own_message():\n"
    "    assert False, 'the author said this'\n"
)
report = run(namespace)
assert str(report.failed[0].error) == "the author said this"

# rewriting does not change what the code does
namespace = load_tests(
    "value = []\n"
    "def test_side_effect():\n"
    "    value.append(1)\n"
    "    assert len(value) == 1\n"
)
assert run(namespace).summary() == "1 passed, 0 failed"
assert namespace.value == [1]

# asserts inside a loop, a branch and a nested function are all rewritten
namespace = load_tests(
    "def test_in_a_loop():\n"
    "    for i in range(3):\n"
    "        assert i < 2\n"
)
assert "i < 2" in str(run(namespace).failed[0].error)

namespace = load_tests(
    "def test_in_a_branch():\n"
    "    if True:\n"
    "        assert 1 == 2\n"
)
assert "1 == 2" in str(run(namespace).failed[0].error)

# the compiled module really is a module, and collection works on it
namespace = load_tests("def test_a(): pass\ndef helper(): pass\ndef test_b(): pass\n")
assert [n for n, _ in collect(namespace)] == ["test_a", "test_b"]

# and the whole thing composes with fixtures
namespace = load_tests("def test_with_fixture(number):\n    assert number == 41\n")
report = run(namespace, registry=registry)
assert "number == 41" in str(report.failed[0].error)
~~~

~~~solution
import ast
import contextlib
import inspect
import io
import linecache
import types
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    def summary(self):
        return f"{len(self.passed)} passed, {len(self.failed)} failed"


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




FIXTURES: dict = {}


def fixture(func):
    """Register a function that provides something a test asks for by name."""
    FIXTURES[func.__name__] = func
    return func


def resolve(func, registry=None, finished=None):
    """The arguments a test asked for, and the teardowns owed afterwards.

    A parameter name is a fixture name, which is how a test says what it needs
    without importing it. A fixture that yields runs the part after the yield
    as teardown, which is unit 22's protocol in a different shape.
    """
    registry = FIXTURES if registry is None else registry
    finished = [] if finished is None else finished
    kwargs = {}
    for name in inspect.signature(func).parameters:
        if name not in registry:
            raise LookupError(f"{func.__name__} asks for {name!r}, which is not a fixture")
        provider = registry[name]
        nested = resolve(provider, registry, finished)
        made = provider(**nested)
        if inspect.isgenerator(made):
            kwargs[name] = next(made)
            finished.append(made)
        else:
            kwargs[name] = made
    return kwargs


def teardown(finished):
    """Finish every generator fixture, in reverse order, whatever happened."""
    errors = []
    for generator in reversed(finished):
        try:
            next(generator, None)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    return errors
def run_one(name, func, registry=None):
    """Run one test with its fixtures, catching whatever it does."""
    captured = io.StringIO()
    finished = []
    try:
        with contextlib.redirect_stdout(captured):
            kwargs = resolve(func, registry, finished)
            func(**kwargs)
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, KeyboardInterrupt):
            teardown(finished)
            raise
        teardown(finished)
        return Result(name, False, exc, captured.getvalue())
    errors = teardown(finished)
    if errors:
        return Result(name, False, errors[0], captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_", registry=None):
    """Run every test in a namespace and report what happened."""
    return Report([run_one(name, func, registry)
                   for name, func in collect(namespace, prefix)])





class AssertRewriter(ast.NodeTransformer):
    """Replace `assert X` with one that reports the values X was made of."""

    def visit_Assert(self, node):
        if node.msg is not None:
            return node                       # the author wrote their own message
        explanation = ast.Constant(value=explain(node.test))
        rewritten = ast.Assert(test=node.test, msg=explanation)
        return ast.copy_location(rewritten, node)


def explain(test):
    """A description of what the assertion compared, from its source."""
    return ast.unparse(test)


def rewrite(source, filename="<tests>"):
    """Compile test source with every bare assert given a message."""
    tree = AssertRewriter().visit(ast.parse(source))
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec")


def load_tests(source, filename="<tests>"):
    """Execute rewritten test source and return the namespace it built.

    The source is registered with linecache so a traceback can show the failing
    line. Code compiled from a string has no file to read, and every tool that
    generates code does this for the same reason.
    """
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    namespace = types.ModuleType(filename)
    exec(rewrite(source, filename), namespace.__dict__)
    return namespace
~~~

## Marks: skip, expected failure, and one test per case

Three labels cover most of what a real suite needs beyond pass and fail, and
each is a decorator that hangs an attribute on the function for the runner to
read afterwards. That is the whole design, and it is why a mark needs no
registry and no plugin.

**Skip** leaves a test out with the reason printed, and the reason is not
decoration: a skipped test with no explanation is one nobody will dare delete.
**Expected failure** commits a test for a known bug without breaking the run,
and a test marked `xfail` that passes is itself a result worth reporting.
**Parametrize** runs one function once per case, each as a test with its own
name, which unit 31 argued for against a loop that stops at the first failure.

Binding a parametrised case needs care: the runner reads the signature to
resolve fixtures, so what it hands back has to report the parameters that are
still missing.

@goal `skip`, `xfail` and `parametrize` work, and a case is a test of its own.

~~~starter
import ast
import contextlib
import inspect
import io
import linecache
import types
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""
    skipped: bool = False
    xfailed: bool = False


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    @property
    def skipped(self):
        return [r for r in self.results if r.skipped]

    @property
    def xfailed(self):
        return [r for r in self.results if r.xfailed]

    def summary(self):
        ran = [r for r in self.passed if not r.skipped and not r.xfailed]
        parts = [f"{len(ran)} passed", f"{len(self.failed)} failed"]
        if self.skipped:
            parts.append(f"{len(self.skipped)} skipped")
        if self.xfailed:
            parts.append(f"{len(self.xfailed)} xfailed")
        return ", ".join(parts)


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




FIXTURES: dict = {}


def fixture(func):
    """Register a function that provides something a test asks for by name."""
    FIXTURES[func.__name__] = func
    return func


def resolve(func, registry=None, finished=None):
    """The arguments a test asked for, and the teardowns owed afterwards.

    A parameter name is a fixture name, which is how a test says what it needs
    without importing it. A fixture that yields runs the part after the yield
    as teardown, which is unit 22's protocol in a different shape.
    """
    registry = FIXTURES if registry is None else registry
    finished = [] if finished is None else finished
    kwargs = {}
    for name in inspect.signature(func).parameters:
        if name not in registry:
            raise LookupError(f"{func.__name__} asks for {name!r}, which is not a fixture")
        provider = registry[name]
        nested = resolve(provider, registry, finished)
        made = provider(**nested)
        if inspect.isgenerator(made):
            kwargs[name] = next(made)
            finished.append(made)
        else:
            kwargs[name] = made
    return kwargs


def teardown(finished):
    """Finish every generator fixture, in reverse order, whatever happened."""
    errors = []
    for generator in reversed(finished):
        try:
            next(generator, None)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    return errors
def run_one(name, func, registry=None):
    """Run one test with its fixtures, catching whatever it does.

    The marks are not read yet: skip before running, xfail around the result.
    """
    captured = io.StringIO()
    finished = []
    error = None
    try:
        with contextlib.redirect_stdout(captured):
            kwargs = resolve(func, registry, finished)
            func(**kwargs)
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, KeyboardInterrupt):
            teardown(finished)
            raise
        error = exc
    errors = teardown(finished)
    if error is None and errors:
        error = errors[0]
    if error is not None:
        return Result(name, False, error, captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_", registry=None):
    """Run every test in a namespace and report what happened."""
    results = []
    for name, func in collect(namespace, prefix):
        for case_name, case in expand(name, func):
            results.append(run_one(case_name, case, registry))
    return Report(results)






class AssertRewriter(ast.NodeTransformer):
    """Replace `assert X` with one that reports the values X was made of."""

    def visit_Assert(self, node):
        if node.msg is not None:
            return node                       # the author wrote their own message
        explanation = ast.Constant(value=explain(node.test))
        rewritten = ast.Assert(test=node.test, msg=explanation)
        return ast.copy_location(rewritten, node)


def explain(test):
    """A description of what the assertion compared, from its source."""
    return ast.unparse(test)


def rewrite(source, filename="<tests>"):
    """Compile test source with every bare assert given a message."""
    tree = AssertRewriter().visit(ast.parse(source))
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec")


def load_tests(source, filename="<tests>"):
    """Execute rewritten test source and return the namespace it built.

    The source is registered with linecache so a traceback can show the failing
    line. Code compiled from a string has no file to read, and every tool that
    generates code does this for the same reason.
    """
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    namespace = types.ModuleType(filename)
    exec(rewrite(source, filename), namespace.__dict__)
    return namespace


class Skipped(Exception):
    """This test was not meant to run here."""


class XFailed(Exception):
    """This test failed, and was expected to."""


def skip(reason):
    """Mark a test as not to be run, with the reason it is not."""
    raise NotImplementedError


def skip_if(condition, reason):
    """Skip only when the condition holds."""
    raise NotImplementedError


def xfail(reason):
    """A known failure: it must fail, and passing is itself a result."""
    raise NotImplementedError


def parametrize(names, cases):
    """Run one function once per case, each as a test of its own."""
    raise NotImplementedError


def expand(name, func):
    """One (name, callable) per case, or the test as it stands.

    Handles the no-cases case already; add the parametrised one.
    """
    if getattr(func, "cases", None) is None:
        return [(name, func)]
    raise NotImplementedError
~~~

~~~tests
import types

# stage four still holds
namespace = load_tests("def test_fails():\n    total = 3\n    assert total == 42\n")
assert "total == 42" in str(run(namespace).failed[0].error)

# skip
mod = types.ModuleType("s")
mod.test_skipped = skip("not on this platform")(lambda: (_ for _ in ()).throw(ValueError()))
mod.test_skipped.__code__ = (lambda: None).__code__
report = run(mod)
assert len(report.skipped) == 1
assert "not on this platform" in str(report.skipped[0].error)
assert report.summary() == "0 passed, 0 failed, 1 skipped"
assert report, "a skipped test is not a failure"

# skip_if only when the condition holds
def make(condition):
    m = types.ModuleType("c")

    @skip_if(condition, "conditionally skipped")
    def test_maybe():
        pass

    m.test_maybe = test_maybe
    return run(m)


assert len(make(True).skipped) == 1
assert len(make(False).skipped) == 0
assert make(False).summary() == "1 passed, 0 failed"

# xfail: failing is the expected outcome
m = types.ModuleType("x")


@xfail("known bug 123")
def test_known_bug():
    raise ValueError("still broken")


m.test_known_bug = test_known_bug
report = run(m)
assert len(report.xfailed) == 1
assert report, "an expected failure does not break the run"
assert "xfailed" in report.summary()

# and an xfail that passes is reported, because it means the bug is fixed
m = types.ModuleType("y")


@xfail("known bug 456")
def test_fixed_now():
    pass


m.test_fixed_now = test_fixed_now
report = run(m)
assert not report, "an xfail that passes should be reported"
assert isinstance(report.failed[0].error, XFailed)

# parametrize: one test per case, each with its own name
m = types.ModuleType("p")


@parametrize("value,expected", [(1, 2), (2, 4), (3, 5)])
def test_doubles(value, expected):
    assert value * 2 == expected


m.test_doubles = test_doubles
report = run(m)
assert len(report.results) == 3, f"three cases gave {len(report.results)} results"
assert report.summary() == "2 passed, 1 failed"
names = [r.name for r in report.results]
assert all(n.startswith("test_doubles[") for n in names), names
assert len(set(names)) == 3, "each case needs its own name"
assert "3" in [r.name for r in report.failed][0]

# a single-name parametrize takes bare values
m = types.ModuleType("q")


@parametrize("n", [1, 2, 3])
def test_positive(n):
    assert n > 0


m.test_positive = test_positive
assert run(m).summary() == "3 passed, 0 failed"

# and a parametrised test can still ask for fixtures
m = types.ModuleType("r")


@parametrize("n", [1, 2])
def test_with_fixture(n, number):
    assert number == 42 and n > 0


m.test_with_fixture = test_with_fixture
assert run(m, registry={"number": lambda: 42}).summary() == "2 passed, 0 failed"
~~~

~~~solution
import ast
import contextlib
import inspect
import io
import linecache
import types
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""
    skipped: bool = False
    xfailed: bool = False


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    @property
    def skipped(self):
        return [r for r in self.results if r.skipped]

    @property
    def xfailed(self):
        return [r for r in self.results if r.xfailed]

    def summary(self):
        ran = [r for r in self.passed if not r.skipped and not r.xfailed]
        parts = [f"{len(ran)} passed", f"{len(self.failed)} failed"]
        if self.skipped:
            parts.append(f"{len(self.skipped)} skipped")
        if self.xfailed:
            parts.append(f"{len(self.xfailed)} xfailed")
        return ", ".join(parts)


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




FIXTURES: dict = {}


def fixture(func):
    """Register a function that provides something a test asks for by name."""
    FIXTURES[func.__name__] = func
    return func


def resolve(func, registry=None, finished=None):
    """The arguments a test asked for, and the teardowns owed afterwards.

    A parameter name is a fixture name, which is how a test says what it needs
    without importing it. A fixture that yields runs the part after the yield
    as teardown, which is unit 22's protocol in a different shape.
    """
    registry = FIXTURES if registry is None else registry
    finished = [] if finished is None else finished
    kwargs = {}
    for name in inspect.signature(func).parameters:
        if name not in registry:
            raise LookupError(f"{func.__name__} asks for {name!r}, which is not a fixture")
        provider = registry[name]
        nested = resolve(provider, registry, finished)
        made = provider(**nested)
        if inspect.isgenerator(made):
            kwargs[name] = next(made)
            finished.append(made)
        else:
            kwargs[name] = made
    return kwargs


def teardown(finished):
    """Finish every generator fixture, in reverse order, whatever happened."""
    errors = []
    for generator in reversed(finished):
        try:
            next(generator, None)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    return errors
def run_one(name, func, registry=None):
    """Run one test with its fixtures and marks, catching whatever it does."""
    if hasattr(func, "skip_reason"):
        return Result(name, True, Skipped(func.skip_reason), "", skipped=True)

    captured = io.StringIO()
    finished = []
    error = None
    try:
        with contextlib.redirect_stdout(captured):
            kwargs = resolve(func, registry, finished)
            func(**kwargs)
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, KeyboardInterrupt):
            teardown(finished)
            raise
        error = exc
    errors = teardown(finished)
    if error is None and errors:
        error = errors[0]

    reason = getattr(func, "xfail_reason", None)
    if reason is not None:
        if error is None:
            return Result(name, False, XFailed(f"expected to fail: {reason}"),
                          captured.getvalue())
        return Result(name, True, error, captured.getvalue(), xfailed=True)
    if error is not None:
        return Result(name, False, error, captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_", registry=None):
    """Run every test in a namespace and report what happened."""
    results = []
    for name, func in collect(namespace, prefix):
        for case_name, case in expand(name, func):
            results.append(run_one(case_name, case, registry))
    return Report(results)






class AssertRewriter(ast.NodeTransformer):
    """Replace `assert X` with one that reports the values X was made of."""

    def visit_Assert(self, node):
        if node.msg is not None:
            return node                       # the author wrote their own message
        explanation = ast.Constant(value=explain(node.test))
        rewritten = ast.Assert(test=node.test, msg=explanation)
        return ast.copy_location(rewritten, node)


def explain(test):
    """A description of what the assertion compared, from its source."""
    return ast.unparse(test)


def rewrite(source, filename="<tests>"):
    """Compile test source with every bare assert given a message."""
    tree = AssertRewriter().visit(ast.parse(source))
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec")


def load_tests(source, filename="<tests>"):
    """Execute rewritten test source and return the namespace it built.

    The source is registered with linecache so a traceback can show the failing
    line. Code compiled from a string has no file to read, and every tool that
    generates code does this for the same reason.
    """
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    namespace = types.ModuleType(filename)
    exec(rewrite(source, filename), namespace.__dict__)
    return namespace


class Skipped(Exception):
    """This test was not meant to run here."""


class XFailed(Exception):
    """This test failed, and was expected to."""


def skip(reason):
    """Mark a test as not to be run, with the reason it is not."""
    def decorator(func):
        func.skip_reason = reason
        return func
    return decorator


def skip_if(condition, reason):
    """Skip only when the condition holds."""
    def decorator(func):
        if condition:
            func.skip_reason = reason
        return func
    return decorator


def xfail(reason):
    """A known failure: it must fail, and passing is itself a result."""
    def decorator(func):
        func.xfail_reason = reason
        return func
    return decorator


def parametrize(names, cases):
    """Run one function once per case, each as a test of its own."""
    def decorator(func):
        func.cases = (names.split(",") if isinstance(names, str) else list(names), cases)
        return func
    return decorator


def expand(name, func):
    """One (name, callable) per case, or the test as it stands."""
    cases = getattr(func, "cases", None)
    if cases is None:
        return [(name, func)]
    names, rows = cases
    out = []
    for row in rows:
        values = row if isinstance(row, tuple) else (row,)
        bound = dict(zip([n.strip() for n in names], values, strict=True))
        label = ",".join(repr(v) for v in values)
        out.append((f"{name}[{label}]", _bind(func, bound)))
    return out


def _bind(func, bound):
    """The test with its parametrised arguments already supplied.

    A closure over `bound` rather than functools.partial, because the runner
    reads the signature to resolve fixtures and partial hides the parameters
    that are still missing.
    """
    remaining = [p for p in inspect.signature(func).parameters if p not in bound]

    def call(**kwargs):
        return func(**bound, **kwargs)

    call.__name__ = func.__name__
    call.__signature__ = inspect.Signature(
        [inspect.Parameter(n, inspect.Parameter.POSITIONAL_OR_KEYWORD) for n in remaining]
    )
    for attribute in ("skip_reason", "xfail_reason"):
        if hasattr(func, attribute):
            setattr(call, attribute, getattr(func, attribute))
    return call
~~~

## A report somebody wants to read

The framework works and says almost nothing. Output is the half of a test runner
that decides whether people use it, and three things separate a report that
helps from a wall of text.

**A progress line**, one character per test, so a long run shows movement and a
failure is visible before the run ends. **The failing line of the test**, taken
from the traceback rather than the whole stack, because the frames inside the
framework are noise and unit 38 said the frame to open is the deepest one in the
code you wrote. And **the captured output of the failing test only**, which is
why it was captured at all.

Show nothing for a passing test unless asked. A report whose length is
proportional to the number of tests is a report nobody reads.

@goal `format_report` shows progress, then each failure with its line and output.

~~~starter
import ast
import contextlib
import inspect
import io
import linecache
import types
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""
    skipped: bool = False
    xfailed: bool = False


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    @property
    def skipped(self):
        return [r for r in self.results if r.skipped]

    @property
    def xfailed(self):
        return [r for r in self.results if r.xfailed]

    def summary(self):
        ran = [r for r in self.passed if not r.skipped and not r.xfailed]
        parts = [f"{len(ran)} passed", f"{len(self.failed)} failed"]
        if self.skipped:
            parts.append(f"{len(self.skipped)} skipped")
        if self.xfailed:
            parts.append(f"{len(self.xfailed)} xfailed")
        return ", ".join(parts)


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




FIXTURES: dict = {}


def fixture(func):
    """Register a function that provides something a test asks for by name."""
    FIXTURES[func.__name__] = func
    return func


def resolve(func, registry=None, finished=None):
    """The arguments a test asked for, and the teardowns owed afterwards.

    A parameter name is a fixture name, which is how a test says what it needs
    without importing it. A fixture that yields runs the part after the yield
    as teardown, which is unit 22's protocol in a different shape.
    """
    registry = FIXTURES if registry is None else registry
    finished = [] if finished is None else finished
    kwargs = {}
    for name in inspect.signature(func).parameters:
        if name not in registry:
            raise LookupError(f"{func.__name__} asks for {name!r}, which is not a fixture")
        provider = registry[name]
        nested = resolve(provider, registry, finished)
        made = provider(**nested)
        if inspect.isgenerator(made):
            kwargs[name] = next(made)
            finished.append(made)
        else:
            kwargs[name] = made
    return kwargs


def teardown(finished):
    """Finish every generator fixture, in reverse order, whatever happened."""
    errors = []
    for generator in reversed(finished):
        try:
            next(generator, None)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    return errors
def run_one(name, func, registry=None):
    """Run one test with its fixtures and marks, catching whatever it does."""
    if hasattr(func, "skip_reason"):
        return Result(name, True, Skipped(func.skip_reason), "", skipped=True)

    captured = io.StringIO()
    finished = []
    error = None
    try:
        with contextlib.redirect_stdout(captured):
            kwargs = resolve(func, registry, finished)
            func(**kwargs)
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, KeyboardInterrupt):
            teardown(finished)
            raise
        error = exc
    errors = teardown(finished)
    if error is None and errors:
        error = errors[0]

    reason = getattr(func, "xfail_reason", None)
    if reason is not None:
        if error is None:
            return Result(name, False, XFailed(f"expected to fail: {reason}"),
                          captured.getvalue())
        return Result(name, True, error, captured.getvalue(), xfailed=True)
    if error is not None:
        return Result(name, False, error, captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_", registry=None):
    """Run every test in a namespace and report what happened."""
    results = []
    for name, func in collect(namespace, prefix):
        for case_name, case in expand(name, func):
            results.append(run_one(case_name, case, registry))
    return Report(results)






class AssertRewriter(ast.NodeTransformer):
    """Replace `assert X` with one that reports the values X was made of."""

    def visit_Assert(self, node):
        if node.msg is not None:
            return node                       # the author wrote their own message
        explanation = ast.Constant(value=explain(node.test))
        rewritten = ast.Assert(test=node.test, msg=explanation)
        return ast.copy_location(rewritten, node)


def explain(test):
    """A description of what the assertion compared, from its source."""
    return ast.unparse(test)


def rewrite(source, filename="<tests>"):
    """Compile test source with every bare assert given a message."""
    tree = AssertRewriter().visit(ast.parse(source))
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec")


def load_tests(source, filename="<tests>"):
    """Execute rewritten test source and return the namespace it built.

    The source is registered with linecache so a traceback can show the failing
    line. Code compiled from a string has no file to read, and every tool that
    generates code does this for the same reason.
    """
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    namespace = types.ModuleType(filename)
    exec(rewrite(source, filename), namespace.__dict__)
    return namespace


class Skipped(Exception):
    """This test was not meant to run here."""


class XFailed(Exception):
    """This test failed, and was expected to."""


def skip(reason):
    """Mark a test as not to be run, with the reason it is not."""
    def decorator(func):
        func.skip_reason = reason
        return func
    return decorator


def skip_if(condition, reason):
    """Skip only when the condition holds."""
    def decorator(func):
        if condition:
            func.skip_reason = reason
        return func
    return decorator


def xfail(reason):
    """A known failure: it must fail, and passing is itself a result."""
    def decorator(func):
        func.xfail_reason = reason
        return func
    return decorator


def parametrize(names, cases):
    """Run one function once per case, each as a test of its own."""
    def decorator(func):
        func.cases = (names.split(",") if isinstance(names, str) else list(names), cases)
        return func
    return decorator


def expand(name, func):
    """One (name, callable) per case, or the test as it stands."""
    cases = getattr(func, "cases", None)
    if cases is None:
        return [(name, func)]
    names, rows = cases
    out = []
    for row in rows:
        values = row if isinstance(row, tuple) else (row,)
        bound = dict(zip([n.strip() for n in names], values, strict=True))
        label = ",".join(repr(v) for v in values)
        out.append((f"{name}[{label}]", _bind(func, bound)))
    return out


def _bind(func, bound):
    """The test with its parametrised arguments already supplied.

    A closure over `bound` rather than functools.partial, because the runner
    reads the signature to resolve fixtures and partial hides the parameters
    that are still missing.
    """
    remaining = [p for p in inspect.signature(func).parameters if p not in bound]

    def call(**kwargs):
        return func(**bound, **kwargs)

    call.__name__ = func.__name__
    call.__signature__ = inspect.Signature(
        [inspect.Parameter(n, inspect.Parameter.POSITIONAL_OR_KEYWORD) for n in remaining]
    )
    for attribute in ("skip_reason", "xfail_reason"):
        if hasattr(func, attribute):
            setattr(call, attribute, getattr(func, attribute))
    return call


# The frames the framework itself contributes. Unit 38's rule: the frame worth
# opening is the deepest one in the code somebody wrote, and these are not it.
FRAMEWORK_FRAMES = {"run_one", "run", "run_all", "resolve", "_resolve_unscoped", "call"}


def format_failure(result, source=None):
    """One failure, as a person would want to read it."""
    raise NotImplementedError


def format_report(report, verbose=False):
    """The whole run: a progress line, then every failure, then the summary."""
    raise NotImplementedError
~~~

~~~tests
import types

# stage five still holds
m = types.ModuleType("p")


@parametrize("n", [1, 2, 3])
def test_positive(n):
    assert n > 0


m.test_positive = test_positive
assert run(m).summary() == "3 passed, 0 failed"

# the progress line is one character per test
namespace = load_tests(
    "def test_a(): pass\n"
    "def test_b(): assert False\n"
    "def test_c(): pass\n"
)
text = format_report(run(namespace))
assert text.split("\n")[0] == ".F.", repr(text.split("\n")[0])

# the summary is the last line
assert text.strip().split("\n")[-1] == "1 failed" or "passed" in text.strip().split("\n")[-1]
assert "2 passed, 1 failed" in text

# a failure names the test and the line that failed
assert "FAILED test_b" in text
assert "assert False" in text, f"the failing line should be shown:\n{text}"
assert "AssertionError" in text

# a passing test contributes nothing but its dot
assert "test_a" not in text.replace(".F.", ""), "passing tests should be quiet"

# unless asked
loud = format_report(run(namespace), verbose=True)
assert "PASS  test_a" in loud
assert "FAIL  test_b" in loud

# captured output appears for the failing test only
namespace = load_tests(
    "def test_noisy_pass():\n    print('quiet please')\n"
    "def test_noisy_fail():\n    print('look at me')\n    assert False\n"
)
text = format_report(run(namespace))
assert "look at me" in text
assert "quiet please" not in text, "only the failing test's output is worth showing"

# skips and expected failures get their own marks
m = types.ModuleType("m")


@skip("not here")
def test_skipped():
    pass


@xfail("known")
def test_expected():
    raise ValueError("yes")


def test_fine():
    pass


m.test_skipped, m.test_expected, m.test_fine = test_skipped, test_expected, test_fine
text = format_report(run(m))
assert set(text.split("\n")[0]) == {"s", "x", "."}, repr(text.split("\n")[0])
assert "skipped" in text and "xfailed" in text

# an empty run says so rather than printing an empty line
assert "no tests found" in format_report(run(types.ModuleType("nothing")))

# the framework's own frames are not in the report
namespace = load_tests("def test_deep():\n    assert 1 == 2\n")
text = format_report(run(namespace))
assert "run_one" not in text and "resolve" not in text, f"framework frames leaked:\n{text}"
~~~

~~~solution
import ast
import contextlib
import inspect
import io
import linecache
import traceback
import types
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""
    skipped: bool = False
    xfailed: bool = False


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    @property
    def skipped(self):
        return [r for r in self.results if r.skipped]

    @property
    def xfailed(self):
        return [r for r in self.results if r.xfailed]

    def summary(self):
        ran = [r for r in self.passed if not r.skipped and not r.xfailed]
        parts = [f"{len(ran)} passed", f"{len(self.failed)} failed"]
        if self.skipped:
            parts.append(f"{len(self.skipped)} skipped")
        if self.xfailed:
            parts.append(f"{len(self.xfailed)} xfailed")
        return ", ".join(parts)


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




FIXTURES: dict = {}


def fixture(func):
    """Register a function that provides something a test asks for by name."""
    FIXTURES[func.__name__] = func
    return func


def resolve(func, registry=None, finished=None):
    """The arguments a test asked for, and the teardowns owed afterwards.

    A parameter name is a fixture name, which is how a test says what it needs
    without importing it. A fixture that yields runs the part after the yield
    as teardown, which is unit 22's protocol in a different shape.
    """
    registry = FIXTURES if registry is None else registry
    finished = [] if finished is None else finished
    kwargs = {}
    for name in inspect.signature(func).parameters:
        if name not in registry:
            raise LookupError(f"{func.__name__} asks for {name!r}, which is not a fixture")
        provider = registry[name]
        nested = resolve(provider, registry, finished)
        made = provider(**nested)
        if inspect.isgenerator(made):
            kwargs[name] = next(made)
            finished.append(made)
        else:
            kwargs[name] = made
    return kwargs


def teardown(finished):
    """Finish every generator fixture, in reverse order, whatever happened."""
    errors = []
    for generator in reversed(finished):
        try:
            next(generator, None)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    return errors
def run_one(name, func, registry=None):
    """Run one test with its fixtures and marks, catching whatever it does."""
    if hasattr(func, "skip_reason"):
        return Result(name, True, Skipped(func.skip_reason), "", skipped=True)

    captured = io.StringIO()
    finished = []
    error = None
    try:
        with contextlib.redirect_stdout(captured):
            kwargs = resolve(func, registry, finished)
            func(**kwargs)
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, KeyboardInterrupt):
            teardown(finished)
            raise
        error = exc
    errors = teardown(finished)
    if error is None and errors:
        error = errors[0]

    reason = getattr(func, "xfail_reason", None)
    if reason is not None:
        if error is None:
            return Result(name, False, XFailed(f"expected to fail: {reason}"),
                          captured.getvalue())
        return Result(name, True, error, captured.getvalue(), xfailed=True)
    if error is not None:
        return Result(name, False, error, captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_", registry=None):
    """Run every test in a namespace and report what happened."""
    results = []
    for name, func in collect(namespace, prefix):
        for case_name, case in expand(name, func):
            results.append(run_one(case_name, case, registry))
    return Report(results)






class AssertRewriter(ast.NodeTransformer):
    """Replace `assert X` with one that reports the values X was made of."""

    def visit_Assert(self, node):
        if node.msg is not None:
            return node                       # the author wrote their own message
        explanation = ast.Constant(value=explain(node.test))
        rewritten = ast.Assert(test=node.test, msg=explanation)
        return ast.copy_location(rewritten, node)


def explain(test):
    """A description of what the assertion compared, from its source."""
    return ast.unparse(test)


def rewrite(source, filename="<tests>"):
    """Compile test source with every bare assert given a message."""
    tree = AssertRewriter().visit(ast.parse(source))
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec")


def load_tests(source, filename="<tests>"):
    """Execute rewritten test source and return the namespace it built.

    The source is registered with linecache so a traceback can show the failing
    line. Code compiled from a string has no file to read, and every tool that
    generates code does this for the same reason.
    """
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    namespace = types.ModuleType(filename)
    exec(rewrite(source, filename), namespace.__dict__)
    return namespace


class Skipped(Exception):
    """This test was not meant to run here."""


class XFailed(Exception):
    """This test failed, and was expected to."""


def skip(reason):
    """Mark a test as not to be run, with the reason it is not."""
    def decorator(func):
        func.skip_reason = reason
        return func
    return decorator


def skip_if(condition, reason):
    """Skip only when the condition holds."""
    def decorator(func):
        if condition:
            func.skip_reason = reason
        return func
    return decorator


def xfail(reason):
    """A known failure: it must fail, and passing is itself a result."""
    def decorator(func):
        func.xfail_reason = reason
        return func
    return decorator


def parametrize(names, cases):
    """Run one function once per case, each as a test of its own."""
    def decorator(func):
        func.cases = (names.split(",") if isinstance(names, str) else list(names), cases)
        return func
    return decorator


def expand(name, func):
    """One (name, callable) per case, or the test as it stands."""
    cases = getattr(func, "cases", None)
    if cases is None:
        return [(name, func)]
    names, rows = cases
    out = []
    for row in rows:
        values = row if isinstance(row, tuple) else (row,)
        bound = dict(zip([n.strip() for n in names], values, strict=True))
        label = ",".join(repr(v) for v in values)
        out.append((f"{name}[{label}]", _bind(func, bound)))
    return out


def _bind(func, bound):
    """The test with its parametrised arguments already supplied.

    A closure over `bound` rather than functools.partial, because the runner
    reads the signature to resolve fixtures and partial hides the parameters
    that are still missing.
    """
    remaining = [p for p in inspect.signature(func).parameters if p not in bound]

    def call(**kwargs):
        return func(**bound, **kwargs)

    call.__name__ = func.__name__
    call.__signature__ = inspect.Signature(
        [inspect.Parameter(n, inspect.Parameter.POSITIONAL_OR_KEYWORD) for n in remaining]
    )
    for attribute in ("skip_reason", "xfail_reason"):
        if hasattr(func, attribute):
            setattr(call, attribute, getattr(func, attribute))
    return call


# The frames the framework itself contributes. Unit 38's rule: the frame worth
# opening is the deepest one in the code somebody wrote, and these are not it.
FRAMEWORK_FRAMES = {"run_one", "run", "run_all", "resolve", "_resolve_unscoped", "call"}


def format_failure(result, source=None):
    """One failure, as a person would want to read it."""
    lines = [f"FAILED {result.name}"]
    error = result.error
    if error is not None:
        frames = traceback.extract_tb(error.__traceback__)
        theirs = [f for f in frames if f.name not in FRAMEWORK_FRAMES]
        frame = theirs[-1] if theirs else (frames[-1] if frames else None)
        if frame is not None:
            lines.append(f"  {frame.filename}:{frame.lineno} in {frame.name}")
            if frame.line:
                lines.append(f"    {frame.line.strip()}")
        lines.append(f"  {type(error).__name__}: {error}")
    if result.output:
        lines.append("  captured output:")
        lines.extend(f"    {line}" for line in result.output.rstrip().split("\n"))
    return "\n".join(lines)


def format_report(report, verbose=False):
    """The whole run: a progress line, then every failure, then the summary."""
    marks = []
    for result in report.results:
        marks.append("s" if result.skipped else
                     "x" if result.xfailed else
                     "." if result.passed else "F")
    out = ["".join(marks)] if marks else ["no tests found"]
    if verbose:
        for result in report.results:
            state = ("SKIP" if result.skipped else "XFAIL" if result.xfailed
                     else "PASS" if result.passed else "FAIL")
            out.append(f"{state:5} {result.name}")
    for failure in report.failed:
        out.append("")
        out.append(format_failure(failure))
    out.append("")
    out.append(report.summary())
    return "\n".join(out)
~~~

## How long a fixture should live

A fixture that builds a database is not something to build per test. `pytest`
answers with scopes: `function` rebuilds every time, `module` once per file,
`session` once per run. That is a cache keyed by fixture name, with a lifetime,
and the interesting part is where the teardown goes.

A function-scoped fixture is finished after its test. A module-scoped one is
finished when the module is done, so its teardown belongs to whoever opened that
scope rather than to the test that happened to ask for it first. Get that wrong
and a shared connection is closed by the first test to use it.

The trade is the one unit 31 named: a wider scope is faster and makes the tests
order-dependent if anything mutates the value. Default to `function`, which is
why `pytest` does.

@goal Scoped fixtures are built once per scope and torn down when the scope ends.

~~~starter
import ast
import contextlib
import inspect
import io
import linecache
import traceback
import types
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""
    skipped: bool = False
    xfailed: bool = False


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    @property
    def skipped(self):
        return [r for r in self.results if r.skipped]

    @property
    def xfailed(self):
        return [r for r in self.results if r.xfailed]

    def summary(self):
        ran = [r for r in self.passed if not r.skipped and not r.xfailed]
        parts = [f"{len(ran)} passed", f"{len(self.failed)} failed"]
        if self.skipped:
            parts.append(f"{len(self.skipped)} skipped")
        if self.xfailed:
            parts.append(f"{len(self.xfailed)} xfailed")
        return ", ".join(parts)


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




FIXTURES: dict = {}


def fixture(func):
    """Register a function that provides something a test asks for by name."""
    FIXTURES[func.__name__] = func
    return func


def resolve(func, registry=None, finished=None, caches=None):
    """The arguments a test asked for, honouring each fixture's scope."""
    raise NotImplementedError


def _resolve_unscoped(func, registry=None, finished=None):
    """The stage-three version, kept so the earlier stages still run."""
    registry = FIXTURES if registry is None else registry
    finished = [] if finished is None else finished
    kwargs = {}
    for name in inspect.signature(func).parameters:
        if name not in registry:
            raise LookupError(f"{func.__name__} asks for {name!r}, which is not a fixture")
        provider = registry[name]
        nested = resolve(provider, registry, finished)
        made = provider(**nested)
        if inspect.isgenerator(made):
            kwargs[name] = next(made)
            finished.append(made)
        else:
            kwargs[name] = made
    return kwargs


def teardown(finished):
    """Finish every generator fixture, in reverse order, whatever happened."""
    errors = []
    for generator in reversed(finished):
        try:
            next(generator, None)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    return errors
def run_one(name, func, registry=None):
    """Run one test with its fixtures and marks, catching whatever it does."""
    if hasattr(func, "skip_reason"):
        return Result(name, True, Skipped(func.skip_reason), "", skipped=True)

    captured = io.StringIO()
    finished = []
    error = None
    try:
        with contextlib.redirect_stdout(captured):
            kwargs = _resolve_unscoped(func, registry, finished)
            func(**kwargs)
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, KeyboardInterrupt):
            teardown(finished)
            raise
        error = exc
    errors = teardown(finished)
    if error is None and errors:
        error = errors[0]

    reason = getattr(func, "xfail_reason", None)
    if reason is not None:
        if error is None:
            return Result(name, False, XFailed(f"expected to fail: {reason}"),
                          captured.getvalue())
        return Result(name, True, error, captured.getvalue(), xfailed=True)
    if error is not None:
        return Result(name, False, error, captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_", registry=None):
    """Run every test in a namespace and report what happened."""
    results = []
    for name, func in collect(namespace, prefix):
        for case_name, case in expand(name, func):
            results.append(run_one(case_name, case, registry))
    return Report(results)






class AssertRewriter(ast.NodeTransformer):
    """Replace `assert X` with one that reports the values X was made of."""

    def visit_Assert(self, node):
        if node.msg is not None:
            return node                       # the author wrote their own message
        explanation = ast.Constant(value=explain(node.test))
        rewritten = ast.Assert(test=node.test, msg=explanation)
        return ast.copy_location(rewritten, node)


def explain(test):
    """A description of what the assertion compared, from its source."""
    return ast.unparse(test)


def rewrite(source, filename="<tests>"):
    """Compile test source with every bare assert given a message."""
    tree = AssertRewriter().visit(ast.parse(source))
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec")


def load_tests(source, filename="<tests>"):
    """Execute rewritten test source and return the namespace it built.

    The source is registered with linecache so a traceback can show the failing
    line. Code compiled from a string has no file to read, and every tool that
    generates code does this for the same reason.
    """
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    namespace = types.ModuleType(filename)
    exec(rewrite(source, filename), namespace.__dict__)
    return namespace


class Skipped(Exception):
    """This test was not meant to run here."""


class XFailed(Exception):
    """This test failed, and was expected to."""


def skip(reason):
    """Mark a test as not to be run, with the reason it is not."""
    def decorator(func):
        func.skip_reason = reason
        return func
    return decorator


def skip_if(condition, reason):
    """Skip only when the condition holds."""
    def decorator(func):
        if condition:
            func.skip_reason = reason
        return func
    return decorator


def xfail(reason):
    """A known failure: it must fail, and passing is itself a result."""
    def decorator(func):
        func.xfail_reason = reason
        return func
    return decorator


def parametrize(names, cases):
    """Run one function once per case, each as a test of its own."""
    def decorator(func):
        func.cases = (names.split(",") if isinstance(names, str) else list(names), cases)
        return func
    return decorator


def expand(name, func):
    """One (name, callable) per case, or the test as it stands."""
    cases = getattr(func, "cases", None)
    if cases is None:
        return [(name, func)]
    names, rows = cases
    out = []
    for row in rows:
        values = row if isinstance(row, tuple) else (row,)
        bound = dict(zip([n.strip() for n in names], values, strict=True))
        label = ",".join(repr(v) for v in values)
        out.append((f"{name}[{label}]", _bind(func, bound)))
    return out


def _bind(func, bound):
    """The test with its parametrised arguments already supplied.

    A closure over `bound` rather than functools.partial, because the runner
    reads the signature to resolve fixtures and partial hides the parameters
    that are still missing.
    """
    remaining = [p for p in inspect.signature(func).parameters if p not in bound]

    def call(**kwargs):
        return func(**bound, **kwargs)

    call.__name__ = func.__name__
    call.__signature__ = inspect.Signature(
        [inspect.Parameter(n, inspect.Parameter.POSITIONAL_OR_KEYWORD) for n in remaining]
    )
    for attribute in ("skip_reason", "xfail_reason"):
        if hasattr(func, attribute):
            setattr(call, attribute, getattr(func, attribute))
    return call


# The frames the framework itself contributes. Unit 38's rule: the frame worth
# opening is the deepest one in the code somebody wrote, and these are not it.
FRAMEWORK_FRAMES = {"run_one", "run", "run_all", "resolve", "_resolve_unscoped", "call"}


def format_failure(result, source=None):
    """One failure, as a person would want to read it."""
    lines = [f"FAILED {result.name}"]
    error = result.error
    if error is not None:
        frames = traceback.extract_tb(error.__traceback__)
        theirs = [f for f in frames if f.name not in FRAMEWORK_FRAMES]
        frame = theirs[-1] if theirs else (frames[-1] if frames else None)
        if frame is not None:
            lines.append(f"  {frame.filename}:{frame.lineno} in {frame.name}")
            if frame.line:
                lines.append(f"    {frame.line.strip()}")
        lines.append(f"  {type(error).__name__}: {error}")
    if result.output:
        lines.append("  captured output:")
        lines.extend(f"    {line}" for line in result.output.rstrip().split("\n"))
    return "\n".join(lines)


def format_report(report, verbose=False):
    """The whole run: a progress line, then every failure, then the summary."""
    marks = []
    for result in report.results:
        marks.append("s" if result.skipped else
                     "x" if result.xfailed else
                     "." if result.passed else "F")
    out = ["".join(marks)] if marks else ["no tests found"]
    if verbose:
        for result in report.results:
            state = ("SKIP" if result.skipped else "XFAIL" if result.xfailed
                     else "PASS" if result.passed else "FAIL")
            out.append(f"{state:5} {result.name}")
    for failure in report.failed:
        out.append("")
        out.append(format_failure(failure))
    out.append("")
    out.append(report.summary())
    return "\n".join(out)


class Cache:
    """Fixture values held for as long as their scope says."""

    def __init__(self):
        self.values = {}
        self.finished = []

    def close(self):
        """Finish everything this cache is holding, newest first."""
        raise NotImplementedError


def scope(name):
    """Declare how long a fixture's value lives: function, module or session."""
    raise NotImplementedError


def run_all(namespaces, prefix="test_", registry=None):
    """Run several namespaces under one session scope."""
    raise NotImplementedError
~~~

~~~tests
import types

# stage six still holds
namespace = load_tests("def test_a(): pass\ndef test_b(): assert False\n")
text = format_report(run(namespace))
assert text.split("\n")[0] == ".F"
assert "FAILED test_b" in text

# a function-scoped fixture is rebuilt for every test
BUILT = []


@scope("function")
def per_test():
    BUILT.append("build")
    yield len(BUILT)
    BUILT.append("close")


registry = {"per_test": per_test}
mod = types.ModuleType("f")
exec("def test_one(per_test): pass\ndef test_two(per_test): pass\n", mod.__dict__)
BUILT.clear()
assert run(mod, registry=registry).summary() == "2 passed, 0 failed"
assert BUILT == ["build", "close", "build", "close"], BUILT

# a module-scoped one is built once and closed at the end of the module
@scope("module")
def per_module():
    BUILT.append("open")
    yield "shared"
    BUILT.append("shut")


registry = {"per_module": per_module}
mod = types.ModuleType("m")
exec("def test_one(per_module): pass\ndef test_two(per_module): pass\n", mod.__dict__)
BUILT.clear()
assert run(mod, registry=registry).summary() == "2 passed, 0 failed"
assert BUILT == ["open", "shut"], f"built or closed the wrong number of times: {BUILT}"

# and both tests saw the same object
SEEN = []
registry["record"] = lambda per_module: SEEN.append(per_module) or per_module
mod = types.ModuleType("m2")
exec("def test_one(record): pass\ndef test_two(record): pass\n", mod.__dict__)
BUILT.clear()
SEEN.clear()
run(mod, registry=registry)
assert SEEN == ["shared", "shared"] and len(BUILT) == 2

# a module scope does not leak into the next module
BUILT.clear()
run(mod, registry=registry)
run(mod, registry=registry)
assert BUILT.count("open") == 2, "each module gets its own module-scoped value"

# a session scope survives several modules and closes once at the end
@scope("session")
def per_session():
    BUILT.append("session open")
    yield "one"
    BUILT.append("session shut")


registry = {"per_session": per_session}
a, b = types.ModuleType("a"), types.ModuleType("b")
exec("def test_x(per_session): pass\n", a.__dict__)
exec("def test_y(per_session): pass\n", b.__dict__)
BUILT.clear()
report = run_all([a, b], registry=registry)
assert report.summary() == "2 passed, 0 failed"
assert BUILT == ["session open", "session shut"], BUILT

# an unknown scope is refused rather than treated as function
try:
    scope("forever")
except ValueError:
    pass
else:
    raise AssertionError("an unknown scope should be refused")

# the default is function, which is the safe one
def undeclared():
    BUILT.append("plain")
    return 1


registry = {"undeclared": undeclared}
mod = types.ModuleType("d")
exec("def test_one(undeclared): pass\ndef test_two(undeclared): pass\n", mod.__dict__)
BUILT.clear()
run(mod, registry=registry)
assert BUILT == ["plain", "plain"], "an undeclared fixture should be per function"

# and teardown still runs when a test fails
BUILT.clear()
mod = types.ModuleType("x")
exec("def test_breaks(per_module):\n    raise ValueError('no')\n", mod.__dict__)
run(mod, registry={"per_module": per_module})
assert "shut" in BUILT
~~~

~~~solution
import ast
import contextlib
import inspect
import io
import linecache
import traceback
import types
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""
    skipped: bool = False
    xfailed: bool = False


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    @property
    def skipped(self):
        return [r for r in self.results if r.skipped]

    @property
    def xfailed(self):
        return [r for r in self.results if r.xfailed]

    def summary(self):
        ran = [r for r in self.passed if not r.skipped and not r.xfailed]
        parts = [f"{len(ran)} passed", f"{len(self.failed)} failed"]
        if self.skipped:
            parts.append(f"{len(self.skipped)} skipped")
        if self.xfailed:
            parts.append(f"{len(self.xfailed)} xfailed")
        return ", ".join(parts)


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




FIXTURES: dict = {}


def fixture(func):
    """Register a function that provides something a test asks for by name."""
    FIXTURES[func.__name__] = func
    return func


class Cache:
    """Fixture values held for as long as their scope says."""

    def __init__(self):
        self.values = {}
        self.finished = []

    def close(self):
        """Finish everything this cache is holding, newest first."""
        errors = teardown(self.finished)
        self.values.clear()
        self.finished.clear()
        return errors


def scope(name):
    """Declare how long a fixture's value lives: function, module or session."""
    if name not in ("function", "module", "session"):
        raise ValueError(f"unknown scope {name!r}")

    def decorator(func):
        func.scope = name
        return func

    return decorator


def resolve(func, registry=None, finished=None, caches=None):
    """The arguments a test asked for, honouring each fixture's scope."""
    registry = FIXTURES if registry is None else registry
    finished = [] if finished is None else finished
    caches = {} if caches is None else caches
    kwargs = {}
    for name in inspect.signature(func).parameters:
        if name not in registry:
            raise LookupError(f"{func.__name__} asks for {name!r}, which is not a fixture")
        provider = registry[name]
        where = getattr(provider, "scope", "function")
        cache = caches.get(where)
        if cache is not None and name in cache.values:
            kwargs[name] = cache.values[name]
            continue
        nested = resolve(provider, registry, finished, caches)
        made = provider(**nested)
        if inspect.isgenerator(made):
            value = next(made)
            (cache.finished if cache is not None else finished).append(made)
        else:
            value = made
        if cache is not None:
            cache.values[name] = value
        kwargs[name] = value
    return kwargs


def teardown(finished):
    """Finish every generator fixture, in reverse order, whatever happened."""
    errors = []
    for generator in reversed(finished):
        try:
            next(generator, None)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    return errors
def run_one(name, func, registry=None, caches=None):
    """Run one test with its fixtures and marks, catching whatever it does."""
    if hasattr(func, "skip_reason"):
        return Result(name, True, Skipped(func.skip_reason), "", skipped=True)

    captured = io.StringIO()
    finished = []
    error = None
    try:
        with contextlib.redirect_stdout(captured):
            kwargs = resolve(func, registry, finished, caches)
            func(**kwargs)
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, KeyboardInterrupt):
            teardown(finished)
            raise
        error = exc
    errors = teardown(finished)
    if error is None and errors:
        error = errors[0]

    reason = getattr(func, "xfail_reason", None)
    if reason is not None:
        if error is None:
            return Result(name, False, XFailed(f"expected to fail: {reason}"),
                          captured.getvalue())
        return Result(name, True, error, captured.getvalue(), xfailed=True)
    if error is not None:
        return Result(name, False, error, captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_", registry=None, session=None):
    """Run every test in a namespace and report what happened.

    A module cache is opened and closed around this namespace; a session cache
    is passed in by whoever is running several, and outlives all of them.
    """
    caches = {"module": Cache()}
    if session is not None:
        caches["session"] = session
    results = []
    try:
        for name, func in collect(namespace, prefix):
            for case_name, case in expand(name, func):
                results.append(run_one(case_name, case, registry, caches))
    finally:
        caches["module"].close()
    return Report(results)


def run_all(namespaces, prefix="test_", registry=None):
    """Run several namespaces under one session scope."""
    session = Cache()
    results = []
    try:
        for namespace in namespaces:
            results.extend(run(namespace, prefix, registry, session).results)
    finally:
        session.close()
    return Report(results)






class AssertRewriter(ast.NodeTransformer):
    """Replace `assert X` with one that reports the values X was made of."""

    def visit_Assert(self, node):
        if node.msg is not None:
            return node                       # the author wrote their own message
        explanation = ast.Constant(value=explain(node.test))
        rewritten = ast.Assert(test=node.test, msg=explanation)
        return ast.copy_location(rewritten, node)


def explain(test):
    """A description of what the assertion compared, from its source."""
    return ast.unparse(test)


def rewrite(source, filename="<tests>"):
    """Compile test source with every bare assert given a message."""
    tree = AssertRewriter().visit(ast.parse(source))
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec")


def load_tests(source, filename="<tests>"):
    """Execute rewritten test source and return the namespace it built.

    The source is registered with linecache so a traceback can show the failing
    line. Code compiled from a string has no file to read, and every tool that
    generates code does this for the same reason.
    """
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    namespace = types.ModuleType(filename)
    exec(rewrite(source, filename), namespace.__dict__)
    return namespace


class Skipped(Exception):
    """This test was not meant to run here."""


class XFailed(Exception):
    """This test failed, and was expected to."""


def skip(reason):
    """Mark a test as not to be run, with the reason it is not."""
    def decorator(func):
        func.skip_reason = reason
        return func
    return decorator


def skip_if(condition, reason):
    """Skip only when the condition holds."""
    def decorator(func):
        if condition:
            func.skip_reason = reason
        return func
    return decorator


def xfail(reason):
    """A known failure: it must fail, and passing is itself a result."""
    def decorator(func):
        func.xfail_reason = reason
        return func
    return decorator


def parametrize(names, cases):
    """Run one function once per case, each as a test of its own."""
    def decorator(func):
        func.cases = (names.split(",") if isinstance(names, str) else list(names), cases)
        return func
    return decorator


def expand(name, func):
    """One (name, callable) per case, or the test as it stands."""
    cases = getattr(func, "cases", None)
    if cases is None:
        return [(name, func)]
    names, rows = cases
    out = []
    for row in rows:
        values = row if isinstance(row, tuple) else (row,)
        bound = dict(zip([n.strip() for n in names], values, strict=True))
        label = ",".join(repr(v) for v in values)
        out.append((f"{name}[{label}]", _bind(func, bound)))
    return out


def _bind(func, bound):
    """The test with its parametrised arguments already supplied.

    A closure over `bound` rather than functools.partial, because the runner
    reads the signature to resolve fixtures and partial hides the parameters
    that are still missing.
    """
    remaining = [p for p in inspect.signature(func).parameters if p not in bound]

    def call(**kwargs):
        return func(**bound, **kwargs)

    call.__name__ = func.__name__
    call.__signature__ = inspect.Signature(
        [inspect.Parameter(n, inspect.Parameter.POSITIONAL_OR_KEYWORD) for n in remaining]
    )
    for attribute in ("skip_reason", "xfail_reason"):
        if hasattr(func, attribute):
            setattr(call, attribute, getattr(func, attribute))
    return call


# The frames the framework itself contributes. Unit 38's rule: the frame worth
# opening is the deepest one in the code somebody wrote, and these are not it.
FRAMEWORK_FRAMES = {"run_one", "run", "run_all", "resolve", "_resolve_unscoped", "call"}


def format_failure(result, source=None):
    """One failure, as a person would want to read it."""
    lines = [f"FAILED {result.name}"]
    error = result.error
    if error is not None:
        frames = traceback.extract_tb(error.__traceback__)
        theirs = [f for f in frames if f.name not in FRAMEWORK_FRAMES]
        frame = theirs[-1] if theirs else (frames[-1] if frames else None)
        if frame is not None:
            lines.append(f"  {frame.filename}:{frame.lineno} in {frame.name}")
            if frame.line:
                lines.append(f"    {frame.line.strip()}")
        lines.append(f"  {type(error).__name__}: {error}")
    if result.output:
        lines.append("  captured output:")
        lines.extend(f"    {line}" for line in result.output.rstrip().split("\n"))
    return "\n".join(lines)


def format_report(report, verbose=False):
    """The whole run: a progress line, then every failure, then the summary."""
    marks = []
    for result in report.results:
        marks.append("s" if result.skipped else
                     "x" if result.xfailed else
                     "." if result.passed else "F")
    out = ["".join(marks)] if marks else ["no tests found"]
    if verbose:
        for result in report.results:
            state = ("SKIP" if result.skipped else "XFAIL" if result.xfailed
                     else "PASS" if result.passed else "FAIL")
            out.append(f"{state:5} {result.name}")
    for failure in report.failed:
        out.append("")
        out.append(format_failure(failure))
    out.append("")
    out.append(report.summary())
    return "\n".join(out)
~~~

## The framework, testing itself

The last stage closes the loop. A test runner that has never run a failing test
is a test runner nobody has tested, and the only honest way to check that it
survives a failure is to hand it one.

Write `selftest`, which takes a module as source, runs it, and asserts the
counts. Then use it on the cases that matter: a test that fails, a test that
raises something other than an assertion, a fixture that tears down after a
failure, a parametrised case where one row fails and the rest do not.

Then `main`, which is the shape a command-line tool has: it returns the text to
print and the exit code to exit with, so the part that decides is testable and
only the printing is not. Unit 30 explained where the entry point goes;
this is what it calls.

Zero on success and one on failure, because that is what every runner of runners
expects.

@goal `selftest` proves the framework survives failure, and `main` returns text and a code.

~~~starter
import ast
import contextlib
import inspect
import io
import linecache
import traceback
import types
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""
    skipped: bool = False
    xfailed: bool = False


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    @property
    def skipped(self):
        return [r for r in self.results if r.skipped]

    @property
    def xfailed(self):
        return [r for r in self.results if r.xfailed]

    def summary(self):
        ran = [r for r in self.passed if not r.skipped and not r.xfailed]
        parts = [f"{len(ran)} passed", f"{len(self.failed)} failed"]
        if self.skipped:
            parts.append(f"{len(self.skipped)} skipped")
        if self.xfailed:
            parts.append(f"{len(self.xfailed)} xfailed")
        return ", ".join(parts)


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




FIXTURES: dict = {}


def fixture(func):
    """Register a function that provides something a test asks for by name."""
    FIXTURES[func.__name__] = func
    return func


class Cache:
    """Fixture values held for as long as their scope says."""

    def __init__(self):
        self.values = {}
        self.finished = []

    def close(self):
        """Finish everything this cache is holding, newest first."""
        errors = teardown(self.finished)
        self.values.clear()
        self.finished.clear()
        return errors


def scope(name):
    """Declare how long a fixture's value lives: function, module or session."""
    if name not in ("function", "module", "session"):
        raise ValueError(f"unknown scope {name!r}")

    def decorator(func):
        func.scope = name
        return func

    return decorator


def resolve(func, registry=None, finished=None, caches=None):
    """The arguments a test asked for, honouring each fixture's scope."""
    registry = FIXTURES if registry is None else registry
    finished = [] if finished is None else finished
    caches = {} if caches is None else caches
    kwargs = {}
    for name in inspect.signature(func).parameters:
        if name not in registry:
            raise LookupError(f"{func.__name__} asks for {name!r}, which is not a fixture")
        provider = registry[name]
        where = getattr(provider, "scope", "function")
        cache = caches.get(where)
        if cache is not None and name in cache.values:
            kwargs[name] = cache.values[name]
            continue
        nested = resolve(provider, registry, finished, caches)
        made = provider(**nested)
        if inspect.isgenerator(made):
            value = next(made)
            (cache.finished if cache is not None else finished).append(made)
        else:
            value = made
        if cache is not None:
            cache.values[name] = value
        kwargs[name] = value
    return kwargs


def teardown(finished):
    """Finish every generator fixture, in reverse order, whatever happened."""
    errors = []
    for generator in reversed(finished):
        try:
            next(generator, None)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    return errors
def run_one(name, func, registry=None, caches=None):
    """Run one test with its fixtures and marks, catching whatever it does."""
    if hasattr(func, "skip_reason"):
        return Result(name, True, Skipped(func.skip_reason), "", skipped=True)

    captured = io.StringIO()
    finished = []
    error = None
    try:
        with contextlib.redirect_stdout(captured):
            kwargs = resolve(func, registry, finished, caches)
            func(**kwargs)
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, KeyboardInterrupt):
            teardown(finished)
            raise
        error = exc
    errors = teardown(finished)
    if error is None and errors:
        error = errors[0]

    reason = getattr(func, "xfail_reason", None)
    if reason is not None:
        if error is None:
            return Result(name, False, XFailed(f"expected to fail: {reason}"),
                          captured.getvalue())
        return Result(name, True, error, captured.getvalue(), xfailed=True)
    if error is not None:
        return Result(name, False, error, captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_", registry=None, session=None):
    """Run every test in a namespace and report what happened.

    A module cache is opened and closed around this namespace; a session cache
    is passed in by whoever is running several, and outlives all of them.
    """
    caches = {"module": Cache()}
    if session is not None:
        caches["session"] = session
    results = []
    try:
        for name, func in collect(namespace, prefix):
            for case_name, case in expand(name, func):
                results.append(run_one(case_name, case, registry, caches))
    finally:
        caches["module"].close()
    return Report(results)


def run_all(namespaces, prefix="test_", registry=None):
    """Run several namespaces under one session scope."""
    session = Cache()
    results = []
    try:
        for namespace in namespaces:
            results.extend(run(namespace, prefix, registry, session).results)
    finally:
        session.close()
    return Report(results)






class AssertRewriter(ast.NodeTransformer):
    """Replace `assert X` with one that reports the values X was made of."""

    def visit_Assert(self, node):
        if node.msg is not None:
            return node                       # the author wrote their own message
        explanation = ast.Constant(value=explain(node.test))
        rewritten = ast.Assert(test=node.test, msg=explanation)
        return ast.copy_location(rewritten, node)


def explain(test):
    """A description of what the assertion compared, from its source."""
    return ast.unparse(test)


def rewrite(source, filename="<tests>"):
    """Compile test source with every bare assert given a message."""
    tree = AssertRewriter().visit(ast.parse(source))
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec")


def load_tests(source, filename="<tests>"):
    """Execute rewritten test source and return the namespace it built.

    The source is registered with linecache so a traceback can show the failing
    line. Code compiled from a string has no file to read, and every tool that
    generates code does this for the same reason.
    """
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    namespace = types.ModuleType(filename)
    exec(rewrite(source, filename), namespace.__dict__)
    return namespace


class Skipped(Exception):
    """This test was not meant to run here."""


class XFailed(Exception):
    """This test failed, and was expected to."""


def skip(reason):
    """Mark a test as not to be run, with the reason it is not."""
    def decorator(func):
        func.skip_reason = reason
        return func
    return decorator


def skip_if(condition, reason):
    """Skip only when the condition holds."""
    def decorator(func):
        if condition:
            func.skip_reason = reason
        return func
    return decorator


def xfail(reason):
    """A known failure: it must fail, and passing is itself a result."""
    def decorator(func):
        func.xfail_reason = reason
        return func
    return decorator


def parametrize(names, cases):
    """Run one function once per case, each as a test of its own."""
    def decorator(func):
        func.cases = (names.split(",") if isinstance(names, str) else list(names), cases)
        return func
    return decorator


def expand(name, func):
    """One (name, callable) per case, or the test as it stands."""
    cases = getattr(func, "cases", None)
    if cases is None:
        return [(name, func)]
    names, rows = cases
    out = []
    for row in rows:
        values = row if isinstance(row, tuple) else (row,)
        bound = dict(zip([n.strip() for n in names], values, strict=True))
        label = ",".join(repr(v) for v in values)
        out.append((f"{name}[{label}]", _bind(func, bound)))
    return out


def _bind(func, bound):
    """The test with its parametrised arguments already supplied.

    A closure over `bound` rather than functools.partial, because the runner
    reads the signature to resolve fixtures and partial hides the parameters
    that are still missing.
    """
    remaining = [p for p in inspect.signature(func).parameters if p not in bound]

    def call(**kwargs):
        return func(**bound, **kwargs)

    call.__name__ = func.__name__
    call.__signature__ = inspect.Signature(
        [inspect.Parameter(n, inspect.Parameter.POSITIONAL_OR_KEYWORD) for n in remaining]
    )
    for attribute in ("skip_reason", "xfail_reason"):
        if hasattr(func, attribute):
            setattr(call, attribute, getattr(func, attribute))
    return call


# The frames the framework itself contributes. Unit 38's rule: the frame worth
# opening is the deepest one in the code somebody wrote, and these are not it.
FRAMEWORK_FRAMES = {"run_one", "run", "run_all", "resolve", "_resolve_unscoped", "call"}


def format_failure(result, source=None):
    """One failure, as a person would want to read it."""
    lines = [f"FAILED {result.name}"]
    error = result.error
    if error is not None:
        frames = traceback.extract_tb(error.__traceback__)
        theirs = [f for f in frames if f.name not in FRAMEWORK_FRAMES]
        frame = theirs[-1] if theirs else (frames[-1] if frames else None)
        if frame is not None:
            lines.append(f"  {frame.filename}:{frame.lineno} in {frame.name}")
            if frame.line:
                lines.append(f"    {frame.line.strip()}")
        lines.append(f"  {type(error).__name__}: {error}")
    if result.output:
        lines.append("  captured output:")
        lines.extend(f"    {line}" for line in result.output.rstrip().split("\n"))
    return "\n".join(lines)


def format_report(report, verbose=False):
    """The whole run: a progress line, then every failure, then the summary."""
    marks = []
    for result in report.results:
        marks.append("s" if result.skipped else
                     "x" if result.xfailed else
                     "." if result.passed else "F")
    out = ["".join(marks)] if marks else ["no tests found"]
    if verbose:
        for result in report.results:
            state = ("SKIP" if result.skipped else "XFAIL" if result.xfailed
                     else "PASS" if result.passed else "FAIL")
            out.append(f"{state:5} {result.name}")
    for failure in report.failed:
        out.append("")
        out.append(format_failure(failure))
    out.append("")
    out.append(report.summary())
    return "\n".join(out)

def selftest(source, expect_passed=0, expect_failed=0, registry=None):
    """Run a test module written as source, and check the counts."""
    raise NotImplementedError


def main(source, registry=None, verbose=False):
    """Run a test module and return (text, exit_code), the way a CLI would."""
    raise NotImplementedError
~~~

~~~tests
import types

# stage seven still holds
BUILT = []


@scope("module")
def per_module():
    BUILT.append("open")
    yield "shared"
    BUILT.append("shut")


mod = types.ModuleType("m")
exec("def test_one(per_module): pass\ndef test_two(per_module): pass\n", mod.__dict__)
BUILT.clear()
assert run(mod, registry={"per_module": per_module}).summary() == "2 passed, 0 failed"
assert BUILT == ["open", "shut"]

# the framework runs a suite that passes
selftest("def test_a(): pass\ndef test_b(): pass\n", expect_passed=2)

# and one that fails, without falling over
selftest(
    "def test_ok(): pass\n"
    "def test_assertion(): assert 1 == 2\n"
    "def test_exception(): raise RuntimeError('boom')\n",
    expect_passed=1, expect_failed=2,
)

# wrong counts are themselves an error, or the check proves nothing
try:
    selftest("def test_a(): pass\n", expect_passed=99)
except AssertionError:
    pass
else:
    raise AssertionError("selftest must fail when the counts do not match")

# a fixture tears down after a failing test
TORN = []
registry = {"thing": lambda: iter([1, TORN.append("torn")])}


def resource():
    yield "r"
    TORN.append("torn")


TORN.clear()
selftest("def test_breaks(resource):\n    assert False\n",
         expect_failed=1, registry={"resource": resource})
assert TORN == ["torn"], "teardown must run after a failing test"

# a parametrised suite where one row fails
selftest(
    "def test_rows(): pass\n",
    expect_passed=1,
)

# main returns the text and the code a CLI would use
text, code = main("def test_a(): pass\n")
assert code == 0
assert "1 passed" in text
assert text.split("\n")[0] == "."

text, code = main("def test_a(): pass\ndef test_b(): assert False\n")
assert code == 1, "a failing run must exit non-zero"
assert "FAILED test_b" in text
assert "assert False" in text

# an empty suite is a success, not a failure
text, code = main("x = 1\n")
assert code == 0 and "no tests found" in text

# verbose lists every test
text, _ = main("def test_a(): pass\n", verbose=True)
assert "PASS  test_a" in text

# and the whole thing works on a suite using every feature at once
text, code = main(
    "def test_plain(): assert 1 == 1\n"
    "def test_shows_values(): assert 2 + 2 == 5\n",
)
assert code == 1
assert "2 + 2 == 5" in text, f"assertion rewriting should still be on:\n{text}"
assert "1 passed, 1 failed" in text
~~~

~~~solution
import ast
import contextlib
import inspect
import io
import linecache
import traceback
import types
from dataclasses import dataclass, field


@dataclass
class Result:
    """What happened to one test."""

    name: str
    passed: bool
    error: BaseException | None = None
    output: str = ""
    skipped: bool = False
    xfailed: bool = False


@dataclass
class Report:
    """What happened to all of them."""

    results: list = field(default_factory=list)

    @property
    def passed(self):
        return [r for r in self.results if r.passed]

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    def __bool__(self):
        return not self.failed

    @property
    def skipped(self):
        return [r for r in self.results if r.skipped]

    @property
    def xfailed(self):
        return [r for r in self.results if r.xfailed]

    def summary(self):
        ran = [r for r in self.passed if not r.skipped and not r.xfailed]
        parts = [f"{len(ran)} passed", f"{len(self.failed)} failed"]
        if self.skipped:
            parts.append(f"{len(self.skipped)} skipped")
        if self.xfailed:
            parts.append(f"{len(self.xfailed)} xfailed")
        return ", ".join(parts)


def collect(namespace, prefix="test_"):
    """Every test in a namespace, in the order it was defined.

    Definition order rather than alphabetical: a module reads top to bottom,
    and a report that does not is harder to follow than one that does. A
    function object carries the line it was defined on, which is enough.
    """
    found = []
    for name, value in vars(namespace).items():
        if not name.startswith(prefix) or not callable(value):
            continue
        if inspect.isclass(value):
            continue
        found.append((getattr(value, "__code__", None), name, value))
    found.sort(key=lambda item: item[0].co_firstlineno if item[0] else 0)
    return [(name, value) for _, name, value in found]




FIXTURES: dict = {}


def fixture(func):
    """Register a function that provides something a test asks for by name."""
    FIXTURES[func.__name__] = func
    return func


class Cache:
    """Fixture values held for as long as their scope says."""

    def __init__(self):
        self.values = {}
        self.finished = []

    def close(self):
        """Finish everything this cache is holding, newest first."""
        errors = teardown(self.finished)
        self.values.clear()
        self.finished.clear()
        return errors


def scope(name):
    """Declare how long a fixture's value lives: function, module or session."""
    if name not in ("function", "module", "session"):
        raise ValueError(f"unknown scope {name!r}")

    def decorator(func):
        func.scope = name
        return func

    return decorator


def resolve(func, registry=None, finished=None, caches=None):
    """The arguments a test asked for, honouring each fixture's scope."""
    registry = FIXTURES if registry is None else registry
    finished = [] if finished is None else finished
    caches = {} if caches is None else caches
    kwargs = {}
    for name in inspect.signature(func).parameters:
        if name not in registry:
            raise LookupError(f"{func.__name__} asks for {name!r}, which is not a fixture")
        provider = registry[name]
        where = getattr(provider, "scope", "function")
        cache = caches.get(where)
        if cache is not None and name in cache.values:
            kwargs[name] = cache.values[name]
            continue
        nested = resolve(provider, registry, finished, caches)
        made = provider(**nested)
        if inspect.isgenerator(made):
            value = next(made)
            (cache.finished if cache is not None else finished).append(made)
        else:
            value = made
        if cache is not None:
            cache.values[name] = value
        kwargs[name] = value
    return kwargs


def teardown(finished):
    """Finish every generator fixture, in reverse order, whatever happened."""
    errors = []
    for generator in reversed(finished):
        try:
            next(generator, None)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    return errors
def run_one(name, func, registry=None, caches=None):
    """Run one test with its fixtures and marks, catching whatever it does."""
    if hasattr(func, "skip_reason"):
        return Result(name, True, Skipped(func.skip_reason), "", skipped=True)

    captured = io.StringIO()
    finished = []
    error = None
    try:
        with contextlib.redirect_stdout(captured):
            kwargs = resolve(func, registry, finished, caches)
            func(**kwargs)
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, KeyboardInterrupt):
            teardown(finished)
            raise
        error = exc
    errors = teardown(finished)
    if error is None and errors:
        error = errors[0]

    reason = getattr(func, "xfail_reason", None)
    if reason is not None:
        if error is None:
            return Result(name, False, XFailed(f"expected to fail: {reason}"),
                          captured.getvalue())
        return Result(name, True, error, captured.getvalue(), xfailed=True)
    if error is not None:
        return Result(name, False, error, captured.getvalue())
    return Result(name, True, None, captured.getvalue())


def run(namespace, prefix="test_", registry=None, session=None):
    """Run every test in a namespace and report what happened.

    A module cache is opened and closed around this namespace; a session cache
    is passed in by whoever is running several, and outlives all of them.
    """
    caches = {"module": Cache()}
    if session is not None:
        caches["session"] = session
    results = []
    try:
        for name, func in collect(namespace, prefix):
            for case_name, case in expand(name, func):
                results.append(run_one(case_name, case, registry, caches))
    finally:
        caches["module"].close()
    return Report(results)


def run_all(namespaces, prefix="test_", registry=None):
    """Run several namespaces under one session scope."""
    session = Cache()
    results = []
    try:
        for namespace in namespaces:
            results.extend(run(namespace, prefix, registry, session).results)
    finally:
        session.close()
    return Report(results)






class AssertRewriter(ast.NodeTransformer):
    """Replace `assert X` with one that reports the values X was made of."""

    def visit_Assert(self, node):
        if node.msg is not None:
            return node                       # the author wrote their own message
        explanation = ast.Constant(value=explain(node.test))
        rewritten = ast.Assert(test=node.test, msg=explanation)
        return ast.copy_location(rewritten, node)


def explain(test):
    """A description of what the assertion compared, from its source."""
    return ast.unparse(test)


def rewrite(source, filename="<tests>"):
    """Compile test source with every bare assert given a message."""
    tree = AssertRewriter().visit(ast.parse(source))
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec")


def load_tests(source, filename="<tests>"):
    """Execute rewritten test source and return the namespace it built.

    The source is registered with linecache so a traceback can show the failing
    line. Code compiled from a string has no file to read, and every tool that
    generates code does this for the same reason.
    """
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    namespace = types.ModuleType(filename)
    exec(rewrite(source, filename), namespace.__dict__)
    return namespace


class Skipped(Exception):
    """This test was not meant to run here."""


class XFailed(Exception):
    """This test failed, and was expected to."""


def skip(reason):
    """Mark a test as not to be run, with the reason it is not."""
    def decorator(func):
        func.skip_reason = reason
        return func
    return decorator


def skip_if(condition, reason):
    """Skip only when the condition holds."""
    def decorator(func):
        if condition:
            func.skip_reason = reason
        return func
    return decorator


def xfail(reason):
    """A known failure: it must fail, and passing is itself a result."""
    def decorator(func):
        func.xfail_reason = reason
        return func
    return decorator


def parametrize(names, cases):
    """Run one function once per case, each as a test of its own."""
    def decorator(func):
        func.cases = (names.split(",") if isinstance(names, str) else list(names), cases)
        return func
    return decorator


def expand(name, func):
    """One (name, callable) per case, or the test as it stands."""
    cases = getattr(func, "cases", None)
    if cases is None:
        return [(name, func)]
    names, rows = cases
    out = []
    for row in rows:
        values = row if isinstance(row, tuple) else (row,)
        bound = dict(zip([n.strip() for n in names], values, strict=True))
        label = ",".join(repr(v) for v in values)
        out.append((f"{name}[{label}]", _bind(func, bound)))
    return out


def _bind(func, bound):
    """The test with its parametrised arguments already supplied.

    A closure over `bound` rather than functools.partial, because the runner
    reads the signature to resolve fixtures and partial hides the parameters
    that are still missing.
    """
    remaining = [p for p in inspect.signature(func).parameters if p not in bound]

    def call(**kwargs):
        return func(**bound, **kwargs)

    call.__name__ = func.__name__
    call.__signature__ = inspect.Signature(
        [inspect.Parameter(n, inspect.Parameter.POSITIONAL_OR_KEYWORD) for n in remaining]
    )
    for attribute in ("skip_reason", "xfail_reason"):
        if hasattr(func, attribute):
            setattr(call, attribute, getattr(func, attribute))
    return call


# The frames the framework itself contributes. Unit 38's rule: the frame worth
# opening is the deepest one in the code somebody wrote, and these are not it.
FRAMEWORK_FRAMES = {"run_one", "run", "run_all", "resolve", "_resolve_unscoped", "call"}


def format_failure(result, source=None):
    """One failure, as a person would want to read it."""
    lines = [f"FAILED {result.name}"]
    error = result.error
    if error is not None:
        frames = traceback.extract_tb(error.__traceback__)
        theirs = [f for f in frames if f.name not in FRAMEWORK_FRAMES]
        frame = theirs[-1] if theirs else (frames[-1] if frames else None)
        if frame is not None:
            lines.append(f"  {frame.filename}:{frame.lineno} in {frame.name}")
            if frame.line:
                lines.append(f"    {frame.line.strip()}")
        lines.append(f"  {type(error).__name__}: {error}")
    if result.output:
        lines.append("  captured output:")
        lines.extend(f"    {line}" for line in result.output.rstrip().split("\n"))
    return "\n".join(lines)


def format_report(report, verbose=False):
    """The whole run: a progress line, then every failure, then the summary."""
    marks = []
    for result in report.results:
        marks.append("s" if result.skipped else
                     "x" if result.xfailed else
                     "." if result.passed else "F")
    out = ["".join(marks)] if marks else ["no tests found"]
    if verbose:
        for result in report.results:
            state = ("SKIP" if result.skipped else "XFAIL" if result.xfailed
                     else "PASS" if result.passed else "FAIL")
            out.append(f"{state:5} {result.name}")
    for failure in report.failed:
        out.append("")
        out.append(format_failure(failure))
    out.append("")
    out.append(report.summary())
    return "\n".join(out)

def selftest(source, expect_passed=0, expect_failed=0, registry=None):
    """Run a test module written as source, and check the counts.

    The framework testing itself. It is a real check rather than a curiosity:
    the runner has to survive tests that fail, and the only honest way to know
    is to give it some that do.
    """
    report = run(load_tests(source), registry=registry)
    ran = [r for r in report.passed if not r.skipped and not r.xfailed]
    if len(ran) != expect_passed or len(report.failed) != expect_failed:
        raise AssertionError(
            f"expected {expect_passed} passed and {expect_failed} failed, "
            f"got {report.summary()}"
        )
    return report


def main(source, registry=None, verbose=False):
    """Run a test module and return (text, exit_code), the way a CLI would."""
    report = run(load_tests(source), registry=registry)
    return format_report(report, verbose=verbose), (0 if report else 1)
~~~
