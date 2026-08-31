---
slug: 03-data-model
title: The data model
---

"Everything is an object" is the first sentence anyone tells you about Python, and on its own it is nearly useless. It sounds like a slogan about object-oriented programming. It is actually a statement about uniformity, and the useful version is the second sentence: **every operation in the language is a method call on an object, and you can implement those methods yourself.**

That is the data model. It is what makes `len(x)`, `x + y`, `x[0]`, `for i in x`, `with x:`, `x()` and `print(x)` all work on types nobody at the Python Software Foundation has ever seen.

## Everything really does mean everything

An object is anything with an identity, a type and a value. In Python that includes the things you expect and quite a few you may not:

```python
def greet(): pass

print(type(greet))          # <class 'function'>
print(type(int))            # <class 'type'>
print(type(len))            # <class 'builtin_function_or_method'>
import math
print(type(math))           # <class 'module'>
```

Functions are objects, so they can be stored in a list, passed as arguments and given attributes. Classes are objects, so they can be passed around and made at runtime. Modules are objects. Even `type` is an object, and its type is itself.

The practical consequence is that there is no separate category of "things you can only use in certain places". If you can name it, you can pass it to a function, and that single fact is the foundation of decorators, callbacks, dispatch tables and most of what units 16 and 26 are about.

## Operators are method calls

`a + b` is not a primitive. It is a request, which Python turns into `type(a).__add__(a, b)`. When that returns the special value `NotImplemented`, Python tries the reflected form on the right operand, `type(b).__radd__(b, a)`, and only when both decline does it raise `TypeError`.

Every operator works this way, and the double-underscore methods — *dunders* — are how you take part:

| You write | Python calls |
| --- | --- |
| `a + b` | `a.__add__(b)` |
| `a == b` | `a.__eq__(b)` |
| `a < b` | `a.__lt__(b)` |
| `len(a)` | `a.__len__()` |
| `a[k]` | `a.__getitem__(k)` |
| `k in a` | `a.__contains__(k)` |
| `for x in a` | `a.__iter__()` |
| `a()` | `a.__call__()` |
| `str(a)`, `print(a)` | `a.__str__()` |
| `repr(a)` | `a.__repr__()` |
| `with a:` | `a.__enter__()`, `a.__exit__()` |
| `if a:` | `a.__bool__()`, or `a.__len__()` |

None of these are hooks bolted on for extensibility. They are the actual implementation: `len("abc")` really does call `str.__len__`. Your own classes are not second-class citizens of the language, they are participants in the same protocol as everything built in.

One important detail: for these implicit calls Python looks the dunder up **on the type**, not on the instance. Assigning `obj.__len__ = ...` does not change what `len(obj)` does. That is why the table above says `type(a).__add__` rather than `a.__add__`, and unit 20 explains why it has to work that way.

## `__repr__` and `__str__` are for different readers

Two renderings, two audiences, and getting them the wrong way round makes debugging much harder than it needs to be.

`__str__` is for the person using your program. It is what `print` and `f"{x}"` use, and it can be as friendly and lossy as you like.

`__repr__` is for the programmer. It is what the REPL shows, what appears when an object is inside a list you print, and what `f"{x!r}"` and every good log line uses. The convention is that it should look like the expression that would recreate the object:

```python
class Point:
    def __init__(self, x, y):
        self.x, self.y = x, y

    def __repr__(self):
        return f"Point({self.x!r}, {self.y!r})"
```

If you write only one of the two, write `__repr__`. `str()` falls back to `__repr__` when there is no `__str__`, so one method covers both cases; the reverse is not true. A class with only `__str__` still shows up in every traceback and every list as `<__main__.Point object at 0x10f3a2d50>`, which tells you nothing at all.

## Truthiness

`if x:` does not test whether `x` is `None` or non-empty. It asks the object, in a specific order: use `__bool__` if there is one, otherwise use `__len__` and call it true when the length is non-zero, otherwise call it true.

That last clause is the one that catches people. **An object with neither method is always truthy**, so a class representing an empty basket is true in a boolean context unless you tell Python otherwise. Implement `__len__` and you get both `len(basket)` and `if basket:` from the same method, which is usually what you want.

## Duck typing, stated precisely

"If it walks like a duck and quacks like a duck" is the slogan. The precise version is: **Python decides what an object can do by looking for the methods the operation needs, not by checking its class.**

Anything with `__iter__` can be used in a `for` loop, whether or not it inherits from anything. Anything with `__len__` works with `len()`. There is no interface to declare and no base class to inherit from, and a function written against "something I can iterate" works with lists, files, generators, database cursors and a class you write this afternoon.

The cost is that the requirement is invisible. A function that calls `.read()` on its argument documents that requirement nowhere the reader or the type checker can see. `typing.Protocol` is the fix — the same structural idea, written down so mypy can check it — and unit 24 gets to it.

## What `type` and `isinstance` ask

`type(x) is C` asks whether `x` is exactly a `C`. `isinstance(x, C)` asks whether `x` is a `C` or anything derived from one.

Almost always you want `isinstance`, because rejecting subclasses defeats the point of having them. And usually you want neither: the duck-typed version — try the operation, or check for the method — accommodates types you have never heard of. A tower of `isinstance` checks is often a hint that the behaviour belongs on the objects themselves as a method they each implement differently.

## `NotImplemented` is a value, not an error

When your `__add__` is handed something it does not know how to add, the temptation is to raise `TypeError` immediately. Do not. Return the singleton `NotImplemented` instead, and let Python carry on.

Returning it tells the interpreter "I decline, try someone else", and Python then offers the operation to the other operand as `__radd__`. Only when both sides decline does Python raise the `TypeError`, and it produces a far better message than you would have, naming both types. Raising it yourself short-circuits that entire mechanism, so a perfectly good `__radd__` on the right-hand operand never gets asked.

This is how a third-party numeric type can make `2 * vector` work without `int` knowing anything about vectors: `int.__mul__` is offered the vector, declines with `NotImplemented`, and the vector's `__rmul__` handles it.

Note the name carefully. `NotImplemented` is a value you return. `NotImplementedError` is an exception you raise, and it means something different: this method is deliberately abstract and a subclass is supposed to override it. Returning the exception class by mistake produces a truthy object, so the comparison quietly succeeds and something far downstream goes wrong.

## Equality and hashing travel together

Two dunders that must be written as a pair, because Python enforces a relationship between them.

Define `__eq__` on a class and Python sets that class's `__hash__` to `None`, making instances unhashable — they can no longer go in a set or be used as a dict key. This is not spite. A hash table finds a key by hashing it and then comparing for equality, so two objects that compare equal must hash equal, or the table will look in the wrong bucket and never find what it stored. Rather than let you build that bug, Python removes hashing until you say what the hash should be.

If your objects are immutable in the fields that define equality, write `__hash__` returning a hash of the same fields, usually `hash((self.x, self.y))`. If they are mutable, leaving them unhashable is the correct outcome — a key whose hash changes after insertion is genuinely lost inside the dictionary. Unit 04 works this through properly; the thing to carry from here is that the two methods are one decision.

## Which protocols are worth knowing

There are around a hundred dunders. You will use perhaps fifteen, and they cluster:

**Representation**: `__repr__`, `__str__`, `__format__`. **Comparison**: `__eq__`, `__lt__` and friends, plus `__hash__`. **Containers**: `__len__`, `__getitem__`, `__setitem__`, `__contains__`, `__iter__`. **Context**: `__enter__` and `__exit__`, which are what `with` compiles into. **Callables**: `__call__`, which makes an instance usable as a function. **Attributes**: `__getattr__`, `__setattr__`, `__getattribute__`, covered in unit 19.

The rest — numeric operators, buffers, coroutines, pickling — you implement when you are building the specific kind of thing that needs them, and look up at the time. The Python data model reference is one page and worth reading once, slowly, at some point after unit 22.

## What to carry forward

Every value is an object with a type, and every syntactic operation is a method call the type can implement. Dunders are looked up on the type, not the instance. `__repr__` is for you and `__str__` is for your users; if you write one, write `__repr__`. An object with no `__bool__` and no `__len__` is always true. And what an object can do is decided by the methods it has, not the class it came from.

From here the language stops being a list of features and becomes a small set of protocols. Almost every remaining unit is one of them in detail.
