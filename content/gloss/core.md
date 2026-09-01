---
slug: core
---

## Aliasing
Two or more names bound to the same object, so a change made through one is visible through all of them. Not a bug in itself; a bug when you expected a copy. See [[binding]] and [[mutation]].

## Binding
What `=` actually does: it associates a name in a namespace with an object. It never copies, and the name has no type of its own. See [[name]] and [[rebinding]].

## Bytecode
The instruction set CPython compiles your source into before running it. `dis.dis(f)` prints it for any function, which is the fastest way to settle an argument about what a line really does.

## Closure
A function that has captured names from an enclosing scope. It captures the variable, not the value, which is why a function made inside a loop sees the loop variable's final value. See [[late-binding]].

## Comprehension
A compiled expression that builds a list, dict, set or generator in one pass. It has its own scope, so its loop variable does not leak into the surrounding function.

## Coroutine
A function defined with `async def`. Calling it does not run it. It returns an object that does nothing until something awaits it. See [[event-loop]].

## Descriptor
An object defining `__get__`, `__set__` or `__delete__`, which the attribute machinery calls when it is found on a class. `property`, methods, `classmethod` and `staticmethod` are all descriptors; learning the protocol explains all four at once.

## Duck typing
Deciding what an object can do by whether it has the right methods rather than by what class it is. The formal version of it is a `Protocol`, which lets a type checker verify the same idea. See [[protocol]].

## EAFP
"Easier to ask forgiveness than permission": try the operation and catch the exception, rather than testing first. Idiomatic in Python because the test-first version has a race in it and costs a second lookup. Contrast [[lbyl]].

## Event loop
The scheduler that runs coroutines. It holds a set of tasks, runs one until it awaits something, and switches to another. There is exactly one running per thread, and blocking it blocks everything.

## Exhaustion
The permanent state an iterator reaches once it has yielded its last item. A second pass over the same iterator produces nothing at all, which is the most common surprise in iterator code.

## GIL
The global interpreter lock: a mutex meaning only one thread executes Python bytecode at a time in the standard build. It makes threads useless for CPU-bound work and perfectly good for I/O-bound work. The free-threaded build removes it.

## Hashable
An object with a `__hash__` that never changes and an `__eq__` consistent with it. Only hashable objects can be dict keys or set members, which is why a list cannot be one.

## Identity
The question `is` asks: are these two expressions the same object? Distinct from equality, which is the question `==` asks. See [[aliasing]].

## Immutable
A type with no operation that changes an existing instance. `str`, `bytes`, `int`, `float`, `tuple` and `frozenset` are immutable; every method that looks like it edits one actually returns a new object.

## Iterator
An object with `__next__`, which yields the next item or raises `StopIteration`. `for` works on anything that can produce one. See [[exhaustion]].

## Late binding
The rule that a closure looks up its captured name when it runs, not when it was created. Why every function built in a loop sees the same final value, and why the fix is a default argument or `functools.partial`.

## LBYL
"Look before you leap": check a condition before acting. Correct in places, but in Python it is often both slower and racier than trying the thing. Contrast [[eafp]].

## Mutation
Changing an object in place, so every name bound to it sees the change. The opposite of [[rebinding]], and telling them apart is most of what makes Python predictable.

## MRO
Method resolution order: the linearised sequence of classes Python searches for an attribute. Computed by the C3 algorithm, visible as `Cls.__mro__`, and what `super()` actually walks.

## Name
A label in a namespace that refers to an object. Python has names, not variables: a name has no type, no box, and no memory of what it referred to before. See [[binding]].

## Namespace
A mapping from names to objects. Module globals and instance attributes are real dicts you can inspect; function locals are optimised into an array but behave the same way.

## Protocol
A `typing.Protocol` class: a set of methods a type must have, checked structurally rather than by inheritance. Duck typing that a type checker can verify. See [[duck-typing]].

## Rebinding
Pointing an existing name at a different object. Affects only that name, which is why assigning to a parameter inside a function is invisible to the caller. Contrast [[mutation]].

## Reference count
The number of references to an object. CPython destroys an object the instant its count hits zero, which is why objects usually die predictably and why a stray reference in a cache is a leak.

## Shallow copy
A copy of a container that shares the objects inside it. What a slice, `list()`, `dict()` and `copy.copy` give you. Independent at the top level and shared one level down.

## Slice
An object describing a range of indices, `start:stop:step`. `a[1:3]` is really `a[slice(1, 3)]`, and the type has its own semantics for assignment and deletion.

## Traceback
The record of the call stack at the moment an exception was raised. Read it from the bottom for what went wrong and from the top for how you got there.

## Type hint
An annotation describing what a name is expected to hold. Stored as runtime metadata and never enforced by the interpreter; a separate checker like mypy is what makes it mean anything.
