---
slug: 22-protocols
---

## If you write only one of the two representations, write
- (x) `__repr__`, because the REPL, tracebacks, lists and debuggers all use it
- ( ) `__str__`, because `print` uses it
- ( ) Both, always
- ( ) `__format__`
> A missing `__str__` falls back to `__repr__`. A missing `__repr__` has a default nothing warns you about.

## `!r` in an f-string
- (x) Calls `repr` on the field, so strings come out quoted
- ( ) Escapes the value
- ( ) Formats it as raw text
- ( ) Rounds it
> The goal is output that could be pasted back in to rebuild the object.

## A binary method that cannot handle the other operand should
- (x) Return `NotImplemented`, so Python can try the reflected method
- ( ) Raise `TypeError`
- ( ) Return `None`
- ( ) Return `False`
> Raising skips the other operand's turn. If nobody can do it, Python raises a better error than yours.

## `a + b` where `type(a).__add__` returns `NotImplemented` tries
- (x) `type(b).__radd__(b, a)`
- ( ) `type(a).__radd__(a, b)`
- ( ) `type(b).__add__(b, a)`
- ( ) Nothing; it raises
> Which is how `2 * vector` works when `int` has never heard of your class.

## Not defining `__iadd__`
- (x) Makes `a += b` fall back to `a = a + b`
- ( ) Makes `+=` raise
- ( ) Makes `+=` mutate in place
- ( ) Has no effect on `+=`
> Defining it is how a mutable container makes `+=` mutate rather than rebind.

## `functools.total_ordering` fills in the comparisons from
- (x) `__eq__` and one of the ordering methods
- ( ) `__lt__` alone
- ( ) `__hash__`
- ( ) `__repr__`
> Saving four nearly identical methods. `__eq__` without `__hash__` still makes the object unhashable.

## An object with `__len__` and no `__bool__` is falsy when
- (x) Its length is zero
- ( ) It is `None`
- ( ) Always
- ( ) Never
> Which is wrong for anything where "empty" and "absent" are different questions.

## `x[1:3]` arrives at `__getitem__` as
- (x) A `slice` object
- ( ) Two arguments
- ( ) A tuple of ints
- ( ) A `range`
> `__getitem__` receives whatever was between the brackets, whatever that was.

## Without `__contains__`, `in`
- (x) Falls back to iterating and comparing, which is correct and linear
- ( ) Raises `TypeError`
- ( ) Returns `False`
- ( ) Uses `__getitem__` only
> So define it when you can answer faster than a walk.

## `with expr as name` binds
- (x) Whatever `__enter__` returns
- ( ) `expr`
- ( ) `None`
- ( ) The result of `__exit__`
> Which is why most `__enter__` methods return `self`, and why forgetting the `return` gives you `None`.

## `__exit__` returning a truthy value
- (x) Suppresses the exception
- ( ) Signals that cleanup succeeded
- ( ) Re-raises the exception
- ( ) Is ignored
> Almost never what a cleanup method meant. Return nothing.

## `__exit__` runs
- (x) On the way out whatever happens, with the exception if there was one
- ( ) Only when the block completes normally
- ( ) Only when the block raises
- ( ) Before `__enter__` on failure
> Which is the whole reason a context manager exists.

## A `@contextmanager` function needs `try`/`finally` because
- (x) An exception in the body is thrown back in at the `yield`, skipping everything after it
- ( ) The decorator requires it
- ( ) `yield` cannot appear alone
- ( ) It makes the generator reusable
> The standard bug: works for a year, leaks the first time something fails.

## `len(x)` looks for `__len__` on
- (x) `type(x)`, never the instance
- ( ) `x`, then `type(x)`
- ( ) `x.__dict__`
- ( ) The module
> True of every implicit dunder, which is why a `__getattr__` that answers everything cannot accidentally make an object callable.

## The test for whether to implement an operator is
- (x) Whether a reader who has never seen the class would predict what it does
- ( ) Whether it saves typing
- ( ) Whether the operation is common
- ( ) Whether the type is a container
> If you need a docstring to explain what your `+` means, the operation wanted a name.
