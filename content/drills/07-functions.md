---
slug: 07-functions
---

## When does a `def` statement's default expression run?
- ( ) On every call that omits the argument
- (x) Once, when the `def` statement itself executes
- ( ) On the first call only
- ( ) When the function is first inspected
> The result is stored on the function object as `f.__defaults__` and shared by every call for the life of the process.

## `def stamp(at=time.time())` gives every call
- ( ) The time of that call
- (x) The time the module was imported
- ( ) A TypeError
- ( ) `None`
> A call in a default runs once, at definition time. ruff flags the shape as `B008`.

## `def f(a, b=a)` does what?
- ( ) Defaults `b` to whatever `a` was passed
- (x) Raises NameError when the `def` runs
- ( ) Defaults `b` to `None`
- ( ) Is a SyntaxError
> Defaults are evaluated with no call in progress, so no parameter exists yet. Any default depending on the arguments has to be computed in the body.

## A bare `*` in a parameter list means
- ( ) Collect surplus positional arguments
- (x) Everything after it is keyword-only
- ( ) Everything before it is positional-only
- ( ) Unpack the next argument
> It costs one character and removes the need to go and read the signature from every call site.

## What does `/` mark in a parameter list?
- (x) Everything before it is positional-only
- ( ) Everything after it is keyword-only
- ( ) Integer division of the arguments
- ( ) The end of required parameters
> Which frees you to rename those parameters later, since no caller can depend on the name. Most builtins are positional-only for that reason.

## `def total(*values)` called as `total([1, 2, 3])` receives
- ( ) Three arguments
- (x) One argument, which is a list
- ( ) A TypeError at the call
- ( ) An empty tuple
> `*` collects in a definition and spreads at a call site. `total(*[1, 2, 3])` is the spreading form.

## Inside a function, `kwargs` is
- ( ) A view onto the caller's keyword arguments
- (x) A new dict, built fresh on every call
- ( ) A tuple
- ( ) The same dict on every call
> Mutating it cannot affect the caller. The positional counterpart, `args`, is a tuple.

## `f(x=2, 1)` is
- ( ) Legal; the 1 fills the first free parameter
- (x) A SyntaxError
- ( ) A TypeError at runtime
- ( ) Legal only with `*args`
> Positional arguments must precede keyword arguments, or the reader would have to count to know what `1` fills.

## A function that falls off the end returns
- ( ) Nothing at all
- (x) `None`
- ( ) The last expression evaluated
- ( ) It raises
> Which is why a forgotten `return` surfaces as a `None` somewhere else entirely rather than as an error at the mistake.

## `first, last = full.split()` where `full` has three words
- ( ) Binds the first two words
- ( ) Binds the first and last words
- (x) Raises ValueError
- ( ) Binds `last` to a list of the rest
> Unpacking checks the count and names both numbers. A starred target, `first, *rest`, is how you absorb the surplus.

## A wrapper that must accept anything is defined as
- ( ) `def wrapper(args, kwargs):`
- (x) `def wrapper(*args, **kwargs):`
- ( ) `def wrapper(*args):`
- ( ) `def wrapper(**kwargs):`
> And it forwards with `original(*args, **kwargs)`, using the same two symbols in their spreading sense.

## What do type annotations do at runtime?
- ( ) Reject arguments of the wrong type
- ( ) Convert arguments to the annotated type
- (x) Nothing; they are stored in `__annotations__`
- ( ) Slow the call down
> They are documentation a separate checker can verify. They are also what lets mypy look inside the function at all.

## Passing a list to a function that mutates it means
- (x) The caller sees the change
- ( ) The function works on a copy
- ( ) A TypeError
- ( ) The change is visible only if the function returns it
> Parameters are bound to the caller's objects, exactly like any other name. Nothing is copied at the boundary.

## Which is the better signature for an option a reader could not identify by position?
- ( ) `def render(t, False, 4)`
- (x) `def render(t, *, escape=True, indent=2)`
- ( ) `def render(t, escape, indent)`
- ( ) `def render(t, **opts)`
> The bare `*` makes `render(t, escape=False, indent=4)` the only legal call, so a call site three files away reads without a lookup.

## A docstring is
- ( ) A comment the interpreter discards
- (x) A string literal stored as `__doc__`
- ( ) Required on every function
- ( ) Only used by linters
> It is what `help()` prints and what an editor shows on hover, and unit 20 makes the examples inside it run as tests.
