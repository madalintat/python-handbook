---
slug: 03-data-model
---

## `a + b` is turned into
- ( ) A primitive addition instruction with no method involved
- (x) `type(a).__add__(a, b)`, with a fallback to `type(b).__radd__(b, a)`
- ( ) `a.add(b)`
- ( ) A call to the builtin `sum`
> Every operator is a method call the type can implement, which is why your own classes can take part in the same syntax as the built-in ones.

## Where does Python look up a dunder for an implicit call like `len(x)`?
- ( ) On the instance, then the type
- (x) On the type only
- ( ) On the instance only
- ( ) On the module the class was defined in
> Which is why assigning `obj.__len__ = f` does not change what `len(obj)` does, and why `hasattr(x, "__call__")` is unreliable.

## If you implement only one of `__str__` and `__repr__`, which should it be?
- (x) `__repr__`
- ( ) `__str__`
- ( ) Neither is more useful than the other
- ( ) Both are mandatory
> `str()` falls back to `__repr__`, so one method covers both. The reverse fallback does not exist.

## Which uses `__repr__`?
- ( ) `print(x)`
- ( ) `f"{x}"`
- (x) Printing a list that contains `x`
- ( ) `str(x)`
> A container's own repr renders its elements with `repr`, which is why an object with only `__str__` is unreadable inside a list.

## An object whose class defines neither `__bool__` nor `__len__` is
- (x) Always true
- ( ) Always false
- ( ) True only if it has attributes
- ( ) An error in a boolean context
> The default is truthy, which is why a class representing something empty is true unless you say otherwise.

## `if x:` consults, in order
- ( ) `__len__`, then `__bool__`
- (x) `__bool__`, then `__len__`, then defaults to true
- ( ) `__eq__` against `None`
- ( ) `__bool__` only
> Implementing `__len__` therefore gives you both `len(x)` and correct truthiness from a single method.

## Defining `__eq__` on a class does what to `__hash__`?
- ( ) Nothing
- (x) Sets it to `None`, making instances unhashable
- ( ) Generates a matching `__hash__` automatically
- ( ) Makes the class immutable
> A hash table compares for equality inside a bucket, so equal objects must hash equal. Python withdraws hashing rather than let you build that bug.

## Your `__add__` is handed a type it cannot add. What should it do?
- ( ) Raise `TypeError`
- (x) Return `NotImplemented`
- ( ) Raise `NotImplementedError`
- ( ) Return `None`
> Returning `NotImplemented` lets Python try the other operand's `__radd__` and, if that also declines, raise a better error than you would have written.

## `NotImplemented` and `NotImplementedError` are
- ( ) Two names for the same thing
- (x) A value you return and an exception you raise, meaning different things
- ( ) Both exceptions
- ( ) Both values
> `NotImplemented` means "I decline this operand, try someone else". `NotImplementedError` means "this abstract method needs overriding".

## `x in obj` when the class has neither `__contains__` nor `__iter__`
- ( ) Returns False
- (x) Raises TypeError saying the object is not iterable
- ( ) Compares `x` to the object itself
- ( ) Searches the instance dictionary
> `in` falls back from `__contains__` to iteration, and the error names the fallback rather than the first choice.

## `len()` on an object whose `__len__` returns `"3x4"`
- ( ) Returns the string
- (x) Raises TypeError
- ( ) Returns 3
- ( ) Returns the length of the string
> Several dunder contracts are enforced by the interpreter rather than trusted: `__len__` must give a non-negative integer, `__bool__` a bool, `__hash__` an integer.

## `type(x) is C` differs from `isinstance(x, C)` in that
- ( ) One is faster
- (x) `type(x) is C` rejects subclasses of C
- ( ) `isinstance` only works on built-in types
- ( ) They are identical for user-defined classes
> Rejecting subclasses defeats the point of having them, so `isinstance` is nearly always the one you want.

## Why does an `isinstance(x, int)` branch need care when booleans are involved?
- ( ) Booleans are not objects
- (x) `bool` is a subclass of `int`, so that branch catches `True` and `False` too
- ( ) `isinstance` does not accept `bool`
- ( ) Booleans have no `__eq__`
> Put the `bool` branch first if the two need distinguishing.

## Which of these is not an object in Python?
- ( ) A function
- ( ) A module
- ( ) A class
- (x) None of them; all three are objects
> Functions, classes and modules are all ordinary objects, which is what makes decorators and dispatch tables possible.

## Duck typing means Python decides what an object can do by
- ( ) Its declared interfaces
- ( ) Its base classes
- (x) Whether it has the methods the operation needs
- ( ) Its type annotations at runtime
> The cost is that the requirement is invisible to readers and checkers, which is what `typing.Protocol` exists to fix.
