---
slug: 28-ast
title: Introspection and the AST
---

Python can look at itself at every level: at objects, at the functions that made them, at the bytecode those compile to, and at the syntax tree the bytecode came from. Three modules cover it, and each answers a different question.

`inspect` asks what an object is and where it came from. `dis` asks what the interpreter will actually do. `ast` asks what the source says, before any of it runs.

## `inspect`

The functions worth knowing by name:

```python
inspect.signature(func)     # parameters, defaults, annotations
inspect.getsource(func)     # the source text, if it is on disk
inspect.getmembers(obj)     # every attribute, as (name, value) pairs
inspect.isclass(x)          # and isfunction, ismethod, isgenerator, ...
inspect.unwrap(func)        # follow __wrapped__ down through decorators
inspect.stack()             # the call stack, as frame records
```

`signature` is the one that earns its place. It gives you a `Signature` object whose `parameters` is an ordered mapping of `Parameter` objects, each with a name, a kind, a default and an annotation. It is what every dependency injector, CLI generator and test framework uses to work out what to pass:

```python
sig = inspect.signature(greet)
for name, param in sig.parameters.items():
    print(name, param.kind, param.default, param.annotation)
```

`param.kind` distinguishes positional-only, positional-or-keyword, `*args`, keyword-only and `**kwargs`, which is the information you need to call a function you were handed.

Two cautions. `signature` follows `__wrapped__`, so it sees through a decorator that used `functools.wraps` and reports the wrapper's `(*args, **kwargs)` for one that did not, which is unit 26's argument made concrete. And `getsource` reads the file, so it fails for anything defined in a REPL, in an `exec`, or inside a zipped package.

Two more are worth having in reach. `inspect.getmro(cls)` is unit 21's search order, and `inspect.getclosurevars(func)` reports what a function actually captured, separated into globals, nonlocals, builtins and unbound names, which turns unit 08's scope question from an argument into a printout.

## `dis`

`dis.dis(func)` prints the bytecode. It answers questions no amount of reading can settle:

```python
def f():
    return [x * 2 for x in range(3)]

dis.dis(f)
```

You will see the comprehension compiled inline, `LOAD_FAST`, `BINARY_OP`, `LIST_APPEND`, and a separate `FOR_ITER` loop. That is why a comprehension is faster than the equivalent `for` with `.append`: the append is one instruction rather than an attribute lookup and a call.

Use it for three things. To settle a performance argument, because a difference visible in the bytecode is real and one that is not usually is not. To understand a construct, since `a, b = b, a` compiling to a `SWAP` rather than a temporary tuple is more convincing than any explanation. And to see what a closure actually captured, since `LOAD_DEREF` against `LOAD_GLOBAL` is unit 08's scope question answered directly.

Do not use it to optimise. The instruction count is a poor proxy for time, the compiler changes between versions, and unit 34's answer, measure first, applies here as much as anywhere.

## `ast`

This is the one that does real work. `ast.parse(source)` gives you a tree of the program's structure, before compilation and before anything runs:

```python
tree = ast.parse("x = 1 + 2")
ast.dump(tree, indent=2)
```

Every node has a type, `Assign`, `BinOp`, `Name`, `Call`, and children that are nodes or lists of nodes. Nodes carry `lineno` and `col_offset`, which is how a tool can point at the right place.

Two visitors do most of the work.

`ast.NodeVisitor` walks the tree read-only. Define `visit_<NodeType>` for the nodes you care about, call `generic_visit(node)` to keep descending, and you have a linter:

```python
class FindBareExcept(ast.NodeVisitor):
    def visit_ExceptHandler(self, node):
        if node.type is None:
            print(f"bare except at line {node.lineno}")
        self.generic_visit(node)
```

That is roughly how ruff's rules are shaped, and how this book's own vocabulary gate decides whether an exercise uses a construct the reader has not met.

`ast.NodeTransformer` is the same walk, except that returning a node replaces the one you visited, returning `None` deletes it, and returning a list splices several in. After transforming, `ast.fix_missing_locations(tree)` fills in the line numbers on nodes you created, and `compile(tree, "<ast>", "exec")` turns the result into something runnable.

The rule that catches everybody: **`generic_visit` is not called for you.** A `visit_X` that does not call it stops the walk at that node, so anything nested inside is never visited. Every mysteriously incomplete AST tool is this.

## Building a node by hand

Reading a tree is straightforward. Writing one has three details that account for most of the frustration.

**Nodes need every field.** `ast.Name` needs an `id` and a `ctx`, where `ctx` is `ast.Load()` for a read and `ast.Store()` for the left-hand side of an assignment. Getting that wrong produces an error at `compile` rather than at construction, which is a long way from the mistake.

**Constants are `ast.Constant`.** The older `Num`, `Str` and `NameConstant` were merged into it, kept as deprecated shims for several releases, and removed in 3.12. Anything literal is a `Constant` with a `value`, and code written against the old names now fails with an `AttributeError` rather than, as it did in between, silently matching nothing.

**Locations are required.** Every node needs `lineno` and `col_offset` before `compile` will accept it, and `ast.fix_missing_locations(tree)` copies them down from the parent, which is why it is called on the whole tree after transforming rather than on each new node.

The shortest path to a node you are unsure of is to have Python build it for you:

```python
print(ast.dump(ast.parse("x = f(1)"), indent=2))
```

Read the output, and construct the same shape. This is faster than the documentation for anything but the simplest node, and it is what everybody who works with this module actually does.

## The other direction

`ast.unparse(tree)` turns a tree back into source, which closes the loop: parse, transform, unparse, and you have a codemod. The output is normalised rather than faithful, comments are gone and formatting is the module's own, so a real refactoring tool either runs a formatter afterwards or uses a concrete syntax tree library such as LibCST, which preserves both.

Knowing which of the two you need is the first decision in any such project. A one-off mechanical change that a formatter will clean up afterwards is an `ast` job. Anything that has to leave the rest of the file byte-identical is not.

## What this is actually for

Reading source as data is how a large amount of the tooling you use every day works, and recognising the shape makes those tools legible.

`ruff`, `flake8` and every linter walk the tree looking for patterns. `black` parses and re-prints. `mypy` builds its own graph from one. Coverage tools use line numbers from it. Codemods, mechanical refactors across thousands of files, are transformers. A test framework that reports which comparison failed got that from the AST of the assertion.

In your own code it is worth reaching for in a narrow set of cases: analysing a codebase, enforcing a project-specific rule no linter has, mechanically applying a change too large to do by hand, and safely evaluating a restricted expression, for which `ast.literal_eval` is the answer and `eval` is not.

## `ast.literal_eval`

Worth its own note, because the alternative is a security hole. `ast.literal_eval("[1, 2, {'a': 3}]")` parses a literal and returns the value, and refuses anything that is not one: no calls, no names, no attribute access, no imports. `eval` on the same string will run whatever it is given, which for input from a file, a form or a network is a remote code execution vulnerability rather than a bug.

If you are reaching for `eval` on data, this is the function you wanted. If `literal_eval` refuses your input, the input was not data.

## A worked example, end to end

The shape of a small analysis tool is worth seeing whole, because the pieces are each simple and the assembly is what is unfamiliar.

Suppose you want to find every function in a project that has more than four parameters. Parse each file, walk it for `FunctionDef` nodes, count `node.args.args`, and report `node.name` with `node.lineno`. That is fifteen lines, it runs over a large codebase in seconds, and it answers a question no grep can.

The same shape with a different predicate is how a team enforces a rule its linter has no opinion about: no bare `except`, no calls to a deprecated helper, no `datetime.now()` without a timezone. Once the walk is written, each new rule is a `visit_` method.

The reason to know this is not that you will write many of them. It is that when a rule matters enough to be argued about in review every week, turning it into fifteen lines and a CI step is available to you, and it stops being argued about.

## Where the line is

Introspection is a tool for tools. Code that inspects its own callers, rewrites its own source, or dispatches on `inspect.stack()` is code nobody can follow and no checker can help with, and the effect is usually reachable with an argument.

The distinction worth holding is between **inspecting** and **depending**. Reading a signature to build a CLI is inspection: the function is normal and something else looks at it. Behaving differently depending on which function called you is a dependency on the call stack, and it makes every caller part of the contract.

There is a cost worth naming too. Introspection is slow, in a way that ordinary attribute access is not: `inspect.signature` builds objects, `getsource` reads a file, and `stack()` walks frames. Doing any of it once at import to build a table is free. Doing it inside a function that runs a million times is a performance problem you will find with unit 34's profiler and be surprised by, because the line looks like nothing.

`inspect` and `dis` at a REPL, to answer a question, cost nothing and are among the fastest ways to learn what the language actually does. That is most of what this unit is for.
