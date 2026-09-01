---
slug: 22-protocols
title: Dunder protocols
---

Unit 03 said that Python's syntax is a set of calls to methods with double underscores in their names, and every unit since has leaned on that without pursuing it. This is where it gets pursued. `len(x)`, `x[k]`, `x + y`, `for i in x`, `with x:` and `print(x)` are all one mechanism: an operation looks for a method on the **type** and calls it. Implement the method, and your object works with the syntax that everybody already knows.

That last sentence is the payoff, and it is worth stating as a design principle before any of the mechanics. The alternative to a protocol is a method with a name you invented, which every caller has to learn. `basket.add(item)` is fine. `basket + item` is only better if addition is genuinely what it means, and worse otherwise. Protocols are for operations whose meaning is already agreed.

## Representation, and the one you actually need

Two methods make an object printable, and they are not interchangeable.

`__repr__` is for you. It should be unambiguous, precise, and if at all possible look like the expression that would rebuild the object: `Point(x=1, y=2)`. It is what the REPL shows, what a traceback shows, what a list of your objects shows, and what a debugger shows. **If you write only one, write this one.**

`__str__` is for a reader of the program's output. It is what `print(x)` and `f"{x}"` use, and it should be readable rather than precise. When it is missing, Python falls back to `__repr__`, which is why implementing `__repr__` alone gives you both and implementing `__str__` alone gives you `<__main__.Point object at 0x10f3a2d50>` in every traceback you will ever have to read.

```python
def __repr__(self):
    return f"Point(x={self.x!r}, y={self.y!r})"
```

The `!r` matters: it calls `repr` on the fields, so a string field comes out quoted and a nested object comes out in its own unambiguous form. A `__repr__` built with `!s` or bare interpolation produces `Point(x=hello)`, which cannot be distinguished from a variable named `hello`.

## Operators

Each operator maps to a method: `+` to `__add__`, `-` to `__sub__`, `*` to `__mul__`, `==` to `__eq__`, `<` to `__lt__`, and so on down a long and entirely mechanical list. Three things about them are not mechanical.

**The reflected form.** `a + b` first tries `type(a).__add__(a, b)`. If that returns the special value `NotImplemented`, Python tries `type(b).__radd__(b, a)`. This is how `2 * vector` works when `int` has never heard of your class. Return `NotImplemented`, not `None` and not a raised exception, when your method does not know how to handle the other operand: it is the signal that lets Python go and ask the other side.

**Comparison comes in a set.** `functools.total_ordering` fills in the rest from `__eq__` and one of `__lt__`, which saves writing four nearly identical methods. Unit 04's rule still applies underneath: `__eq__` without `__hash__` makes the object unhashable, and a mutable object that is both is a bug waiting for a dict to find it.

**In-place is separate.** `__iadd__` implements `+=`, and if you do not define it, `a += b` falls back to `a = a + b`. Defining it is how a mutable container makes `+=` mutate rather than rebind, and getting that distinction backwards is unit 02's mutability problem wearing an operator.

## Containers

Four methods, and each one buys a piece of syntax.

`__len__` gives you `len(x)`, and it also gives you truthiness: an object with no `__bool__` is falsy exactly when its length is zero. That coupling catches people, because it means a container that is legitimately empty is `False` in an `if`.

`__getitem__` gives you `x[k]`. It receives whatever was in the brackets, so `x[1]`, `x["a"]` and `x[1:3]` all arrive here, the last as a `slice` object.

`__setitem__` and `__delitem__` give you assignment and `del`.

`__contains__` gives you `in`. Without it, `in` falls back to iterating and comparing, which is correct and linear, so define it when you can answer faster.

`__iter__` gives you `for`, unpacking, and every function that takes an iterable. Unit 15 covered what it must return.

Implement `__len__`, `__getitem__`, `__setitem__` and `__iter__`, and your class behaves like a sequence everywhere in the language. `collections.abc.Sequence` will then fill in `__contains__`, `index`, `count` and reversed iteration for free if you inherit from it, which is a genuine use of the multiple inheritance unit 21 was cautious about.

## Looked up on the type, always

One rule governs every protocol in this unit and explains a class of bug that otherwise looks like magic: **implicit dunder lookups skip the instance.** `len(x)` is `type(x).__len__(x)`, not `x.__len__()`. Putting a `__len__` in an instance's `__dict__` does nothing:

```python
x = Basket()
x.__len__ = lambda: 5
len(x)          # still whatever the class says, or TypeError
```

This is the same restriction unit 20 met for descriptors, and it comes from the same place. It is not an oversight: looking up `__repr__` on the instance would mean every `repr()` call searched an instance dict first, and a class whose instances could each redefine `+` would be unpredictable to read. It also means a `__getattr__` that answers every name, unit 19's trap, does **not** accidentally make an object iterable or callable, which is the one mercy in that design.

The practical consequence is that a protocol has to be defined in the class body, or assigned to the class afterwards. Per-instance behaviour goes in a plain attribute the class's dunder reads.

## Context managers

`with` is a protocol, and a small one:

```python
class Timer:
    def __enter__(self):
        self.start = time.monotonic()
        return self

    def __exit__(self, exc_type, exc, tb):
        self.elapsed = time.monotonic() - self.start
```

`with expr as name` calls `__enter__` and binds what it returns to `name`, which is why `__enter__` usually returns `self` and why forgetting the `return` gives you a silent `None`. `__exit__` runs on the way out **whatever happens**, and receives the exception if there was one, or three `None`s if there was not.

The return value of `__exit__` is the subtle part. A truthy return **suppresses the exception**. That is occasionally what you want and almost never what you meant, so return nothing unless you are deliberately writing something like `contextlib.suppress`.

For most cases `contextlib.contextmanager` is less code and reads better:

```python
@contextmanager
def timer():
    start = time.monotonic()
    try:
        yield
    finally:
        print(time.monotonic() - start)
```

Everything before `yield` is `__enter__`, everything after is `__exit__`, and the `try`/`finally` is what makes the cleanup run when the body raises. Leaving it out is the standard bug in a hand-written context manager: it works for a year and then leaks the one time something goes wrong.

`contextlib` has three more things worth knowing before you write your own. `closing(obj)` calls `obj.close()` on the way out, which adapts anything with a `close` method. `suppress(FileNotFoundError)` is the honest spelling of a `try`/`except`/`pass` and says so at the top rather than the bottom. And `ExitStack` handles the case a `with` statement cannot: a number of context managers known only at run time, entered in a loop and unwound correctly whatever happens.

## Callable, and the rest

`__call__` makes an instance callable. It is how an object that carries configuration can be passed where a function is expected, and it is what a decorator implemented as a class uses.

`__bool__` overrides the truthiness that `__len__` would otherwise supply. `__hash__` and `__eq__` came in unit 04. `__format__` backs `f"{x:>10}"`. `__index__` lets an object be used where an integer index is required.

There is no need to learn the list. The useful shape to carry is the question: *when Python does something to my object, which method is it looking for?* The answer is always a dunder, it is always looked up on the type rather than the instance, and `dir(int)` or the data model page of the docs will name it in a few seconds.

## When the protocol is missing a piece

Python is willing to build one operation out of another, and knowing which fallbacks exist saves writing methods you do not need.

`in` falls back to `__iter__` when there is no `__contains__`. `for` falls back to `__getitem__` with `0, 1, 2, …` when there is no `__iter__`, stopping at the first `IndexError`, which is a compatibility path from before iterators existed and is worth recognising rather than relying on. `!=` is derived from `__eq__` unless you override it, so writing `__ne__` is almost always redundant. `>` is `__lt__` with the operands swapped. And truthiness falls back to `__len__`, then to "always true".

What has no fallback is worth knowing too. `__hash__` is not derived from `__eq__`; defining `__eq__` sets it to `None` and makes the object unhashable until you say otherwise. `+=` falls back to `+`, but `+` is never built from `+=`. And `__repr__` has a default, the angle-bracket one, which is precisely the problem: nothing will ever tell you it is missing.

## Deciding what to implement

The cost of a protocol is that it makes your object behave like something familiar. That is the whole benefit, and it is also the risk: a `__len__` that returns something other than a count, or a `+` that is not associative, produces code that reads correctly and does something else.

So the test is a question about meaning, not convenience. Would a reader who has never seen your class predict what `len(x)`, `x[0]` or `a + b` does? If yes, implement it. If you find yourself writing a docstring to explain what your `+` means, the operation wanted a name.

Two implementations are close to always worth writing: `__repr__`, because every traceback and every debugging session gets better, and `__eq__` for anything that is a value rather than an identity. Unit 23 is about the decorator that writes both of those for you, along with most of the rest of this unit, from a list of fields.
