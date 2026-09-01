---
slug: 18-classes
title: Classes
---

A class is an object that makes objects. That sentence is not a slogan: `class` is a statement that runs, it produces an object, and that object is callable. Everything about how instances behave follows from where things are stored and in what order they are looked up.

## What `class` actually does

The body of a class runs, top to bottom, like any other block. Names bound in it, including `def`s, end up in a namespace, and that namespace becomes the class object's `__dict__`.

```python
class Point:
    dimensions = 2

    def __init__(self, x, y):
        self.x = x
        self.y = y
```

`dimensions` and `__init__` are both entries in `Point.__dict__`. There is no difference in kind between them; one happens to be an integer and the other a function.

The class body executes once, at import. That is the whole explanation for the shared mutable attribute from unit 01: `items = []` in a class body creates one list, then, for the class, forever.

## Looking at the machinery

Everything above is visible, and looking once removes most of the mystery:

```python
class Point:
    dimensions = 2
    def __init__(self, x, y):
        self.x, self.y = x, y

p = Point(1, 2)
p.__dict__              # {'x': 1, 'y': 2}
Point.__dict__.keys()   # dict_keys(['__module__', 'dimensions', '__init__', ...])
type(p)                 # <class 'Point'>
type(Point)             # <class 'type'>
Point.__mro__           # (<class 'Point'>, <class 'object'>)
```

Two of those are worth pausing on. The instance's `__dict__` holds only what was assigned to `self`, and nothing else: no methods, no class attributes, no inherited anything. And `type(Point)` is `type`, because a class is an object made by a class, which is unit 27's subject and is mentioned here only so that "everything is an object" stops being a slogan.

`vars(p)` is `p.__dict__`, and `dir(p)` lists everything reachable including inherited names, which is the tool for "what can this thing do" at a prompt.

## Naming, and what an underscore means

Python has no private attributes, and the conventions are worth stating because they are conventions rather than rules.

A single leading underscore, `_total`, means "this is internal, do not rely on it". Nothing enforces it. It is a message to a reader, and it is the right choice for anything that is not part of what your class promises.

A double leading underscore, `__total`, triggers **name mangling**: inside class `Account` it becomes `_Account__total`. That is not privacy either, and it is not for hiding. Its purpose is to stop a subclass accidentally colliding with an attribute a base class relies on, which is a real problem in deep hierarchies and almost never one in ordinary code. Reach for it rarely.

A trailing underscore, `class_`, avoids a clash with a keyword or a builtin, which unit 08 recommended for shadowed names.

Dunder names, `__init__` and the rest, belong to the language. Do not invent new ones; a future Python may take the name.

## `__init__` does not construct

Creating an instance calls the class, and calling a class runs two methods.

`__new__` allocates and returns the new object. `__init__` then receives that object as `self` and sets it up. So `__init__` is an **initialiser**, and it must return `None`; returning anything else is a `TypeError`.

You will almost never write `__new__`. It matters for immutable types, where there is no "after" in which to set attributes, and for the rare class that wants to return an existing instance instead of a fresh one.

## Where attributes live

An instance has its own `__dict__`. `self.x = 1` writes there. Reading `self.x` looks in the instance first and then in the class, which is the whole rule and explains three behaviours people find surprising.

**A class attribute is shared until it is written.** Reading `self.dimensions` finds the class's. Assigning `self.dimensions = 3` creates an *instance* attribute that shadows it, leaving the class's untouched and every other instance unaffected.

**`self.count += 1` on a class attribute does not do what it looks like.** It reads from the class and writes to the instance, so the class attribute never changes and each instance quietly gets its own. To change the class's, name the class: `Point.count += 1`.

**A mutable class attribute is shared even without assignment**, because `self.items.append(x)` is a read followed by a mutation, and the read finds the class's one list.

The rule of thumb: class attributes for constants and defaults that will only ever be read; instance attributes, set in `__init__`, for anything that varies per object.

## Methods are functions in the class namespace

`def greet(self)` inside a class stores an ordinary function on the class. What makes it a method is the lookup: accessing it through an instance produces a **bound method**, which is the function with `self` already supplied.

```python
Point.dist          # a plain function
p.dist              # a bound method
p.dist()            # Point.dist(p)
```

Which is why `self` is explicit in the definition and invisible at the call, and why forgetting it produces an error about too many arguments rather than about `self`.

Unit 20 explains the mechanism, and it is worth knowing now that this is not a special case in the interpreter but an ordinary use of the descriptor protocol.

## `classmethod` and `staticmethod`

A `classmethod` receives the class as its first argument instead of the instance:

```python
class Point:
    @classmethod
    def origin(cls):
        return cls(0, 0)
```

The reason to use one is that `cls` is whatever class it was called on. `Point.origin()` builds a `Point`, and a subclass's `origin()` builds the subclass. That makes `classmethod` the right tool for **alternative constructors**, and using a `staticmethod` that hardcodes `Point(...)` there is a bug that only appears when somebody subclasses.

A `staticmethod` receives nothing extra. It is a plain function that lives in the class's namespace because it belongs there conceptually. If it never touches `cls` or `self`, and nothing outside the class would ever want it, a `staticmethod` says so; otherwise a module-level function is simpler.

## Inheritance, in one paragraph for now

A class can name a base, and lookups that fail on the class continue up the chain in a fixed order called the MRO:

```python
class Timer(Base):
    ...

Timer.__mro__      # (Timer, Base, object)
```

Everything inherits from `object`, which is where `__init__`, `__repr__`, `__eq__` and the rest of the defaults come from. Overriding one means putting a name in your class's `__dict__` that is found first, and calling the base's version means `super()`, which unit 21 takes apart properly because what it really does is not what most people assume.

The advice that ages well is to reach for inheritance when a subclass genuinely **is** the base and can be used everywhere the base can. When you merely want to reuse some code, holding an instance of the other class and calling it is simpler, easier to change, and does not commit you to every method the base happens to have.

## Instances compare by identity

Without `__eq__`, two instances are equal only if they are the same object, which unit 04 covered. That default is right for things with an identity, a connection, a widget, a running task, and wrong for things that are values, a point, a money amount, a version.

Writing `__eq__` brings `__hash__` with it, as unit 03 established, and unit 23's dataclasses generate both from the fields, which is why most value-like classes should be dataclasses rather than hand-written ones. The `__repr__` you get by default is the other half of that argument: `<__main__.Point object at 0x10f3a2d50>` in every traceback and every printed list, until you write one or let a dataclass write it for you.

## The shape of a class worth writing

Four questions decide whether a class is the right tool at all, and they are worth asking before the first `def`.

**Is there state that several functions share?** If not, the class is a namespace with extra steps, and a module of functions is simpler. A class whose every method takes the same three arguments and stores nothing is a set of functions wearing a costume.

**Is there more than one instance?** A class instantiated exactly once, holding configuration, is usually better as a module or a dataclass instance built at startup.

**Does it have behaviour, or only data?** Only data means a dataclass or a NamedTuple, which unit 23 covers and which gives you equality, repr and construction for free.

**Would a reader guess what the object represents from its name?** `Order`, `Connection` and `Cache` say what they are. `Manager`, `Helper`, `Processor` and `Handler` mostly do not, and a class whose name is a job title is often a function that has not been recognised yet.

When the answer is yes, the shape that ages well is small: attributes set once in `__init__`, methods that read them, and as few of them as the job needs. A class with fifteen methods and eight attributes is usually two classes, and finding the seam is easier before there are callers than after.

## What to carry forward

A class body runs once and its names become the class's `__dict__`. `__new__` makes the object and `__init__` sets it up, returning `None`. Attribute reads check the instance then the class; writes always go to the instance, which is why `self.x += 1` on a class attribute silently makes an instance one. Methods are functions on the class, bound on access, which is why `self` is explicit. `classmethod` gets the class and is what alternative constructors need; `staticmethod` gets nothing and is often better as a module function. And instances compare by identity until you say otherwise.
