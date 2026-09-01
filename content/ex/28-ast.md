---
slug: 28-ast
---

## A walk that stopped at the first branch

`FindBareExcept` reports bare `except` clauses. It does not call `generic_visit`, so the walk stops at every node it handles and never sees what is nested inside.

@expect silent
@hint `visit_X` replaces the default behaviour for that node. What did the default do?
@hint The nested handler is inside a function, which is inside the module.
@diagnose silent Nothing raised, and the bare `except` inside the function was missed. `ast.NodeVisitor` dispatches to `visit_<NodeType>` if you defined one, and to `generic_visit` otherwise, and `generic_visit` is what descends into the children. Defining `visit_FunctionDef` therefore replaces the descent rather than adding to it, so nothing inside any function is ever visited. Every mysteriously incomplete AST tool is this, and the fix is one line at the end of the method. The habit worth forming is to write `self.generic_visit(node)` as the last line of every `visit_` method before writing anything else in it.

~~~starter
import ast


class FindBareExcept(ast.NodeVisitor):
    """Collect the line of every bare `except:`."""

    def __init__(self):
        self.lines = []

    def visit_FunctionDef(self, node):
        self.seen_function = node.name

    def visit_ExceptHandler(self, node):
        if node.type is None:
            self.lines.append(node.lineno)
        self.generic_visit(node)


def bare_except_lines(source):
    finder = FindBareExcept()
    finder.visit(ast.parse(source))
    return finder.lines
~~~

~~~tests
source = """
try:
    a()
except:
    pass


def f():
    try:
        b()
    except:
        pass
"""
assert bare_except_lines(source) == [4, 11], f"found {bare_except_lines(source)}"
assert bare_except_lines("x = 1") == []
~~~

~~~solution
import ast


class FindBareExcept(ast.NodeVisitor):
    """Collect the line of every bare `except:`."""

    def __init__(self):
        self.lines = []

    def visit_FunctionDef(self, node):
        self.seen_function = node.name
        self.generic_visit(node)

    def visit_ExceptHandler(self, node):
        if node.type is None:
            self.lines.append(node.lineno)
        self.generic_visit(node)


def bare_except_lines(source):
    finder = FindBareExcept()
    finder.visit(ast.parse(source))
    return finder.lines
~~~

## Evaluating data as though it were code

`load_config` reads a value out of a settings file. It uses `eval`, which will run anything, and the file is not something the program wrote.

@expect raises:NameError
@hint The input is data. Which function parses a literal and refuses everything else?
@hint It lives in `ast`.
@diagnose NameError `eval` looked up `rm` as a name, because it is compiling and running the text as a Python expression rather than reading it as data. The `NameError` here is the lucky outcome. `eval` on input from a file, a form or a network is a remote code execution vulnerability rather than a bug, and the string that does damage is no harder to write than this one. `ast.literal_eval` parses a literal and returns the value, refusing calls, names, attribute access and imports outright. If you are reaching for `eval` on data, this is the function you wanted, and if `literal_eval` refuses your input, the input was not data.

~~~starter
def load_config(text):
    """Read a setting written as a Python literal."""
    return eval(text)


print(load_config("rm(-rf)"))
~~~

~~~tests
assert load_config("[1, 2, {'a': 3}]") == [1, 2, {"a": 3}]
assert load_config("'hello'") == "hello"

try:
    load_config("__import__('os').getcwd()")
except ValueError:
    pass
else:
    raise AssertionError("a call was evaluated instead of refused")
~~~

~~~solution
import ast


def load_config(text):
    """Read a setting written as a Python literal."""
    return ast.literal_eval(text)


print(load_config("[1, 2]"))
~~~

## A signature the decorator erased

`describe` reports a function's parameters. The function it is given was decorated without `functools.wraps`, so `inspect.signature` sees the wrapper.

@expect silent
@hint `inspect.signature` follows one attribute to see through a decorator. Which one sets it?
@hint The fix is in the decorator, not in `describe`.
@diagnose silent Nothing raised, and the parameters came back as `args, kwargs`. `inspect.signature` follows `__wrapped__` down through decorators, and `functools.wraps` is what sets it; without that, the decorated function genuinely is the wrapper and `(*args, **kwargs)` is genuinely its signature. This is unit 26's argument made concrete, and it matters far beyond `help`: every CLI generator, dependency injector and test framework works out what to pass by reading this, so an unwrapped decorator quietly breaks all of them. `inspect.unwrap` follows the same chain by hand when there are several layers.

~~~starter
import inspect


def logged(func):
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)

    return wrapper


@logged
def greet(name, greeting="hello", *, loud=False):
    return f"{greeting} {name}"


def describe(func):
    """List the parameter names of a function."""
    return list(inspect.signature(func).parameters)
~~~

~~~tests
assert describe(greet) == ["name", "greeting", "loud"], f"got {describe(greet)}"
assert greet("ada") == "hello ada"
assert inspect.signature(greet).parameters["greeting"].default == "hello"
~~~

~~~solution
import functools
import inspect


def logged(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)

    return wrapper


@logged
def greet(name, greeting="hello", *, loud=False):
    return f"{greeting} {name}"


def describe(func):
    """List the parameter names of a function."""
    return list(inspect.signature(func).parameters)
~~~

## Counting the wrong parameters

`arity` counts a function's parameters by reading one list off the arguments node. That list holds only the ordinary ones.

@expect silent
@hint `node.args` is an `arguments` node with several lists on it. Which ones did this miss?
@hint Print `ast.dump` of a function with a keyword-only parameter and read the field names.
@diagnose silent It runs and undercounts, because `node.args.args` holds only positional-or-keyword parameters. The `arguments` node has five relevant fields: `posonlyargs`, `args`, `vararg`, `kwonlyargs` and `kwarg`, and a tool that counts parameters has to decide about all of them. This is the general lesson about working with the AST: the node names are close enough to the language to feel obvious and different enough to be wrong, and the reliable way to find out is to have Python build the node for you and read `ast.dump` rather than to guess.

~~~starter
import ast


def arity(source):
    """How many parameters the function in this source takes."""
    tree = ast.parse(source)
    func = tree.body[0]
    return len(func.args.args)
~~~

~~~tests
assert arity("def f(a, b): pass") == 2
assert arity("def f(): pass") == 0
assert arity("def f(a, *, b): pass") == 2, "a keyword-only parameter was not counted"
assert arity("def f(a, /, b, *, c): pass") == 3
~~~

~~~solution
import ast


def arity(source):
    """How many parameters the function in this source takes."""
    tree = ast.parse(source)
    func = tree.body[0]
    return len(func.args.posonlyargs) + len(func.args.args) + len(func.args.kwonlyargs)
~~~

## A tree the compiler would not take

`double_constants` rewrites every number in an expression. It builds new nodes and never fills in their positions, so compiling the result fails.

@expect raises:TypeError
@hint Every node needs a line and a column before `compile` will accept it.
@hint One call, on the whole tree, after the transform.
@diagnose TypeError The error says a field is required and missing: `required field "lineno" missing from expr`. Nodes that Python parsed carry their position; nodes you construct do not, and `compile` refuses a tree with any missing. `ast.fix_missing_locations(tree)` copies positions down from each node's parent, which is why it is called once on the finished tree rather than on each node as it is built. Returning a node from a `NodeTransformer` method replaces the visited one; returning `None` deletes it, and returning a list splices several in, which together are most of what a codemod needs.

~~~starter
import ast


class Doubler(ast.NodeTransformer):
    """Replace every number with twice itself."""

    def visit_Constant(self, node):
        if isinstance(node.value, int):
            return ast.Constant(value=node.value * 2)
        return node


def double_constants(source):
    tree = Doubler().visit(ast.parse(source, mode="eval"))
    return eval(compile(tree, "<ast>", "eval"))


print(double_constants("1 + 2"))
~~~

~~~tests
assert double_constants("1 + 2") == 6
assert double_constants("10") == 20
# both operands are doubled, so the product is four times the original
assert double_constants("3 * 4") == 48
~~~

~~~solution
import ast


class Doubler(ast.NodeTransformer):
    """Replace every number with twice itself."""

    def visit_Constant(self, node):
        if isinstance(node.value, int):
            return ast.Constant(value=node.value * 2)
        return node


def double_constants(source):
    tree = Doubler().visit(ast.parse(source, mode="eval"))
    ast.fix_missing_locations(tree)
    return eval(compile(tree, "<ast>", "eval"))


print(double_constants("1 + 2"))
~~~

## Looking for a node type that no longer exists

`count_numbers` looks for `ast.Num`. Numeric literals became `ast.Constant` years ago, and on this version the old name has been removed outright.

@expect raises:AttributeError
@hint Every literal is one node type now. Which?
@hint The node has a `value`, and you have to check what kind of value it is.
@diagnose AttributeError `ast.Num` does not exist. It, `ast.Str` and `ast.NameConstant` were merged into `ast.Constant`, kept as deprecated shims for several releases, and removed in 3.12. This exercise is a small lesson in how a deprecation feels from the outside, because the *middle* period was the dangerous one: while the shims existed, this exact code raised nothing and reported zero, since no parsed tree ever produced one and `isinstance` against a class that matches nothing is silent. The loud failure you get now is the better outcome. Since a `Constant` holds anything literal, a tool that wants numbers must test `node.value` as well, and `bool` is worth excluding by hand, because `True` is an `int` in Python and will otherwise be counted.

~~~starter
import ast


def count_numbers(source):
    """How many numeric literals appear in this source."""
    return sum(isinstance(node, ast.Num) for node in ast.walk(ast.parse(source)))
~~~

~~~tests
assert count_numbers("x = 1 + 2") == 2, "numeric literals were not found"
assert count_numbers("x = 'a'") == 0
assert count_numbers("x = True") == 0, "True is not a numeric literal"
assert count_numbers("f(1, 2.5, 'three')") == 2
~~~

~~~solution
import ast


def count_numbers(source):
    """How many numeric literals appear in this source."""
    return sum(
        isinstance(node, ast.Constant)
        and isinstance(node.value, (int, float))
        and not isinstance(node.value, bool)
        for node in ast.walk(ast.parse(source))
    )
~~~

## Reading a name where a value was stored

`assigned_names` collects the names an assignment writes to. It matches every `Name` node, including the ones being read.

@expect silent
@hint A `Name` node has a `ctx`. What are the two it can be?
@hint The left of an assignment and the right are the same node type.
@diagnose silent It runs and reports the names on both sides, because `x` and `y` are both `Name` nodes and nothing about the node type distinguishes a read from a write. The difference is in `ctx`: `ast.Store()` for a target and `ast.Load()` for a read, with `ast.Del()` for a `del`. That field is easy to skip past when reading `ast.dump` output, and it is exactly the thing that makes a scope analysis correct. Walking `node.targets` of the `Assign` is the other way to answer this question and is clearer when you only care about assignments; checking `ctx` generalises to comprehensions, `for` targets and `with ... as`, which are also stores.

~~~starter
import ast


def assigned_names(source):
    """Every name this source assigns to."""
    return sorted(
        {node.id for node in ast.walk(ast.parse(source)) if isinstance(node, ast.Name)}
    )
~~~

~~~tests
assert assigned_names("x = y + 1") == ["x"], f"got {assigned_names('x = y + 1')}"
assert assigned_names("a = b = c") == ["a", "b"]
assert assigned_names("print(z)") == []
assert assigned_names("for i in items: pass") == ["i"]
~~~

~~~solution
import ast


def assigned_names(source):
    """Every name this source assigns to."""
    return sorted(
        {
            node.id
            for node in ast.walk(ast.parse(source))
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
        }
    )
~~~

## Introspection on the hot path

`dispatch` works out how to call a handler by reading its signature. It reads it on every call, and `inspect.signature` is not cheap.

@expect silent
@hint What about the signature changes between calls?
@hint Do the expensive part once, where the answer cannot change.
@diagnose silent It gives the right answer and asks the same question every time. `inspect.signature` builds `Signature` and `Parameter` objects on each call, and a function's parameters do not change, so every call after the first is repeating work whose answer was already known. Doing this once at import to build a table is free; doing it inside something that runs often is a performance problem that unit 34's profiler will find and that looks like nothing on the page. `functools.cache` from unit 17 is the one-line version, and it works here because a function object is hashable, which is worth noticing as the reason the decorator applies at all.

~~~starter
import inspect


CALLS = {"signature": 0}


def parameters_of(func):
    """The parameter names of a handler."""
    CALLS["signature"] += 1
    return tuple(inspect.signature(func).parameters)


def dispatch(func, values):
    """Call func with whichever of `values` it accepts, by name."""
    names = parameters_of(func)
    return func(**{k: v for k, v in values.items() if k in names})
~~~

~~~tests
def handler(name, age):
    return f"{name} is {age}"


values = {"name": "ada", "age": 36, "extra": "ignored"}
assert dispatch(handler, values) == "ada is 36"
assert dispatch(handler, values) == "ada is 36"
assert dispatch(handler, values) == "ada is 36"
assert CALLS["signature"] == 1, (
    f"the signature was read {CALLS['signature']} times for one function"
)
~~~

~~~solution
import functools
import inspect


CALLS = {"signature": 0}


@functools.cache
def parameters_of(func):
    """The parameter names of a handler."""
    CALLS["signature"] += 1
    return tuple(inspect.signature(func).parameters)


def dispatch(func, values):
    """Call func with whichever of `values` it accepts, by name."""
    names = parameters_of(func)
    return func(**{k: v for k, v in values.items() if k in names})
~~~
