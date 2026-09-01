---
slug: 27-metaclasses
title: Metaclasses and `__init_subclass__`
---

Unit 18 mentioned in passing that `type(Point) is type`, and left it there. This unit picks it up, and the honest framing is worth stating first: you will almost certainly never write a metaclass, and the reason to understand them is that they explain things you will definitely read.

## A class is an object

Everything in Python is an object, and classes are not an exception. A class is an object whose type is `type`, made at run time by the `class` statement, and `type` is a callable that makes them:

```python
Point = type("Point", (object,), {"x": 0, "kind": "2d"})
```

Three arguments: the name, the bases as a tuple, and the namespace as a dict. That is genuinely what a `class` statement does. It runs the class body as a block of code, collects the names it defined into a dict, and calls `type` with the three pieces.

So `type` is a class whose instances are classes. A **metaclass** is any class that plays that role, and `type` is the default one.

## What the `class` statement actually does

```python
class Point(Base, metaclass=Meta):
    x = 0
```

1. Run the body in a fresh namespace, producing `{"x": 0, ...}`.
2. Work out the metaclass: whatever `metaclass=` says, or the type of the first base, or `type`.
3. Call it: `Meta("Point", (Base,), namespace)`.
4. That call runs `Meta.__call__`, which runs `Meta.__new__` to make the class object and `Meta.__init__` to set it up.
5. Bind the result to the name `Point`.

Step 4 is the same two-step creation unit 18 described for instances, one level up. A metaclass's `__new__` receives the namespace before the class exists and can change it; its `__init__` receives the finished class.

That is the whole mechanism. `__init_subclass__` and `__set_name__`, which you have already met, are hooks the default metaclass calls on your behalf, which is why they cover most of what people reach for metaclasses to do.

## Writing one

```python
class Registry(type):
    def __new__(mcls, name, bases, namespace, **kwargs):
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if bases:
            REGISTRY[name] = cls
        return cls


class Plugin(metaclass=Registry):
    pass


class Csv(Plugin):
    pass          # now in REGISTRY, without anybody doing anything
```

`if bases:` is the standard guard, and it is worth understanding rather than copying. `Plugin` itself is created by this metaclass too, with empty bases, and registering the base class alongside its implementations is almost never what a registry wants. Every metaclass and every `__init_subclass__` that builds a table needs some version of this test, and forgetting it produces a registry with one entry too many that nobody notices until something iterates it.

The parameter is `mcls` rather than `cls` by convention, because `cls` here would mean the class being created, which is the thing being returned rather than the thing doing the creating.

## `__init_subclass__` does this better

Almost every real use of a metaclass is "do something whenever a subclass is defined", and there is a hook for exactly that, on an ordinary class:

```python
class Plugin:
    def __init_subclass__(cls, /, name=None, **kwargs):
        super().__init_subclass__(**kwargs)
        REGISTRY[name or cls.__name__] = cls


class Csv(Plugin, name="csv"):
    pass
```

`__init_subclass__` is called on the **parent** whenever a subclass is created, with the new class as `cls`. It is implicitly a classmethod, so no decorator is needed and adding one is a common and harmless confusion. Keyword arguments in the class statement, `name="csv"` above, arrive as its keyword arguments, which is how a subclass configures its own registration.

It is better than a metaclass in every way that matters here. There is no separate class to understand, it does not affect the type of anything, and it cannot conflict, which is the point of the next section.

The other hook you already know is `__set_name__`, from unit 20: called on every descriptor in the class body once the class exists. Between them, these two cover validation of subclasses, registration, automatic naming, and attribute post-processing, which is most of the list.

## The class decorator, which is usually the answer

There is a third option, and it is the one to try first because unit 26 already explains it. A decorator on a class is a function that takes a class and returns one:

```python
def register(cls):
    REGISTRY[cls.__name__] = cls
    return cls


@register
class Csv:
    pass
```

`@dataclass` is exactly this: it reads the annotations, writes some methods onto the class, and hands it back. So is `@functools.total_ordering`. The advantage over both other options is that it is **visible at the point of use**. Somebody reading `Csv` sees that something happens to it; with a metaclass or `__init_subclass__` on a base three files away, they do not.

The limitation is the one that decides between the three: a class decorator applies to the class it is written on and nothing else. Subclasses are not decorated. When the behaviour must reach every subclass, that is precisely the case `__init_subclass__` exists for, and it is the whole of the difference between them.

So the order to try is: class decorator, then `__init_subclass__`, then a metaclass. Each step gives up some visibility for some reach, and most code never needs to leave the first.

## Why metaclasses conflict

A class can have exactly one metaclass, and the metaclass of a subclass must be a subclass of the metaclasses of all its bases. Combine two libraries that each use one and you get:

```
TypeError: metaclass conflict: the metaclass of a derived class must be a
(non-strict) subclass of the metaclasses of all its bases
```

There is no clean fix. You write a third metaclass inheriting from both and hope they compose, which they often do not, or you stop using one of the libraries. This is the practical reason the advice is so one-sided: a metaclass is a claim on a slot that only one library can hold, and `__init_subclass__` costs nobody anything.

## When one is genuinely right

The cases are real but narrow, and they share a shape: something has to happen **before the class object exists**.

`abc.ABCMeta` needs to collect abstract methods and refuse instantiation, which means intervening in class creation and in `__call__`.

`enum.EnumMeta` turns the class body's plain assignments into members and makes the class iterable and non-instantiable, which is not something a class can do to itself.

An ORM that needs the namespace itself, to rewrite `Column` assignments into something else before the class is built, rather than after.

Notice that all three are the framework, not the application. If you are writing the thing other people declare against, and you have checked that `__init_subclass__` and `__set_name__` do not reach, a metaclass may be right. Otherwise it is not.

## `__prepare__`, briefly

There is one thing a metaclass can do that nothing else can, and it explains a feature of `Enum` that otherwise looks impossible. `__prepare__` returns the mapping the class body is executed into, before any of it runs:

```python
class Ordered(type):
    @classmethod
    def __prepare__(mcls, name, bases, **kwargs):
        return collections.OrderedDict()
```

Since 3.7 the default namespace already preserves order, so this particular example is obsolete, which is a good illustration of how narrow the remaining uses are. What it is still used for is a namespace that does something on assignment: `Enum` uses one to reject duplicate member names, which an ordinary dict would silently allow by overwriting.

If you find yourself needing to observe assignments as the class body executes, this is the hook. If you do not, you will never see it again outside a standard library source file.

## Reading a framework

The practical payoff of this unit is that framework source stops being opaque. Three patterns account for most of it.

A **declarative base** with a metaclass that scans the namespace for descriptor-like objects and records them: SQLAlchemy's models, Django's, older versions of most ORMs. What looks like magic is a metaclass reading the dict the class body produced.

A **registry** that fills itself as modules are imported, which is `__init_subclass__` or a decorator plus the fact from unit 26 that decorators run at import. When a plugin "appears" merely because a file was imported, this is why, and it is also why the file has to be imported at all, which is the bug people hit.

**Instantiation control**, an `ABCMeta`-style refusal or a singleton, which needs a metaclass because it intervenes in `Cls(...)`, and `Cls(...)` is `type(Cls).__call__(Cls, ...)`. That last identity is worth holding on to: calling a class is a method call on its metaclass, which is the same rule as everything else in unit 22, applied one level up.

## What to take away

Read the two questions this unit answers, and let the rest go.

*How does a class come to exist?* The body runs as code, its namespace becomes a dict, and a callable is called with the name, the bases and that dict. Once that is concrete, `type()` with three arguments, `__init_subclass__`, `__set_name__`, `ABCMeta` and every ORM's declarative base stop being separate mysteries.

One more thing follows from all of it, and it is the most useful practical habit: when a class behaves in a way its own source does not explain, look at `type(Cls)`. If it is anything but `type`, you have found where the behaviour lives, and reading that metaclass is a smaller job than reading the framework.

*What should I reach for?* A decorator on the class if you can, because it is visible at the point of use. `__init_subclass__` if the behaviour has to reach subclasses. A metaclass only if something must happen before the class exists, and then knowing you have taken a slot nobody else can use.
