---
slug: 28-ast
---

## The three modules answer
- (x) `inspect` what an object is, `dis` what the interpreter will do, `ast` what the source says
- ( ) The same question at different speeds
- ( ) `inspect` for classes, `dis` for functions, `ast` for modules
- ( ) Debugging, profiling and linting
> Different levels: objects, bytecode, and syntax before anything runs.

## `inspect.signature(func).parameters` gives you
- (x) An ordered mapping of `Parameter` objects, each with a name, kind, default and annotation
- ( ) A list of names
- ( ) The argument values of the last call
- ( ) The annotations only
> Which is how every CLI generator and dependency injector works out what to pass.

## `inspect.signature` on a function decorated without `functools.wraps` reports
- (x) `(*args, **kwargs)`, because the decorated function genuinely is the wrapper
- ( ) The original signature
- ( ) Nothing
- ( ) An error
> It follows `__wrapped__`, and `wraps` is what sets it.

## `inspect.getsource` fails for
- (x) Anything defined in a REPL, in an `exec`, or inside a zipped package
- ( ) Decorated functions
- ( ) Classes
- ( ) Anything in the standard library
> It reads the file, so there has to be a file.

## `dis` is good for
- (x) Settling what a construct compiles to, and what a closure captured
- ( ) Optimising
- ( ) Finding type errors
- ( ) Measuring run time
> Instruction count is a poor proxy for time, and the compiler changes between versions.

## `ast.NodeVisitor` dispatches to
- (x) `visit_<NodeType>` if you defined one, and `generic_visit` otherwise
- ( ) `visit` for every node
- ( ) Whatever `__match_args__` says
- ( ) Methods in definition order
> Which is why a `visit_X` replaces the descent rather than adding to it.

## A `visit_X` that does not call `generic_visit`
- (x) Stops the walk there, so nothing nested inside is ever visited
- ( ) Visits children twice
- ( ) Raises
- ( ) Is the normal case
> Every mysteriously incomplete AST tool is this.

## In a `NodeTransformer`, returning `None` from a visit method
- (x) Deletes the node
- ( ) Leaves it unchanged
- ( ) Raises
- ( ) Replaces it with `None`
> Returning a node replaces it, and returning a list splices several in.

## After building nodes by hand, `compile` needs
- (x) `ast.fix_missing_locations(tree)`, because constructed nodes have no line or column
- ( ) `ast.dump`
- ( ) `ast.unparse`
- ( ) Nothing extra
> It copies positions down from each node's parent, so it is called once on the finished tree.

## Numeric and string literals are
- (x) `ast.Constant` with a `value`; `Num` and `Str` were removed in 3.12
- ( ) `ast.Num` and `ast.Str`
- ( ) `ast.Literal`
- ( ) `ast.Value`
> While the shims existed, `isinstance(node, ast.Num)` matched nothing and said nothing.

## `Name` nodes distinguish a read from a write by
- (x) `ctx`, which is `Load`, `Store` or `Del`
- ( ) The node type
- ( ) Their position in the parent
- ( ) `lineno`
> The same field covers comprehension targets, `for` targets and `with ... as`.

## The shortest way to find out what a node looks like is
- (x) `ast.dump(ast.parse(source), indent=2)` on an example
- ( ) Reading the grammar
- ( ) `dir(ast)`
- ( ) `help(ast.Assign)`
> Faster than the documentation for anything but the simplest node.

## `ast.unparse`
- (x) Turns a tree back into source, normalised, with comments and formatting gone
- ( ) Reproduces the original text exactly
- ( ) Requires the original source
- ( ) Is a compile step
> A refactoring tool that must leave the file otherwise byte-identical needs LibCST instead.

## `ast.literal_eval` against `eval`, on input from a file or a form
- (x) `literal_eval` parses a literal and refuses calls, names and imports; `eval` runs anything
- ( ) They are equivalent for data
- ( ) `literal_eval` is slower but identical
- ( ) `eval` is safe with a restricted namespace
> If `literal_eval` refuses your input, the input was not data.

## The line between using introspection well and badly is
- (x) Inspecting an object, against depending on who called you
- ( ) Reading against writing
- ( ) `inspect` against `ast`
- ( ) Import time against call time
> Reading a signature to build a CLI is inspection. Dispatching on `inspect.stack()` makes every caller part of the contract.
