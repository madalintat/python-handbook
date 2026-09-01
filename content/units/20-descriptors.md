---
slug: 20-descriptors
title: Descriptors
---

Unit 19 said that `property` intercepts attribute access, and that `cached_property` gets out of the way once it has a value. It also said that a function stored on a class turns into a bound method when you read it through an instance. Those look like three separate pieces of machinery. They are one, and this is the unit where a lot of Python stops being a list of features and becomes a single mechanism you can predict.

## The protocol

A **descriptor** is any object that defines `__get__`, and optionally `__set__` and `__delete__`. When such an object is found on a class during attribute lookup, Python does not hand it to you. It calls it.

```python
class Loud:
    def __get__(self, obj, objtype=None):
        return f"read from {obj!r}"


class Thing:
    x = Loud()


Thing().x        # 'read from <Thing object ...>'
```

`Thing.x` is a `Loud` instance sitting in the class dict, and `Thing().x` never returns it. The three parameters of `__get__` are the whole story: `self` is the descriptor, shared by every instance of the class; `obj` is the instance the access came through, or `None` when the access came through the class itself; `objtype` is the class. That `None` is why `Thing.x` and `instance.x` can mean different things, and it is how `classmethod` and `property` behave sensibly when reached on the class.

## Data and non-data

The distinction unit 19's lookup order turned on has a definition now:

- A **data descriptor** defines `__set__` or `__delete__`. It wins over the instance dict.
- A **non-data descriptor** defines only `__get__`. The instance dict wins over it.

That single asymmetry explains two things that otherwise look arbitrary. A `property` defines `__set__`, even when you never wrote a setter, which is why assigning to a read-only property raises `AttributeError` rather than quietly shadowing it in the instance dict. And `cached_property` defines only `__get__`, which is why writing the computed value into the instance dict under the same name is enough to stop it ever running again. Neither is a special case. They are two positions on one rule.

Reading that list next to unit 19's five-step lookup is worth doing once, slowly, because they are the same list. Step 1 was "a data descriptor on the class wins", step 2 was "the instance dict", step 3 was "whatever else the class had", and step 3 is where a non-data descriptor gets its turn. The reason the instance dict sits in the middle rather than at either end is precisely so that both kinds can exist: something that must always intercept, and something that only wants the first access.

There is a matching rule for writes, and it is shorter. `obj.x = v` calls `type(obj).__setattr__`, which looks for a **data descriptor** on the class and calls its `__set__` if it finds one; otherwise it writes to the instance dict. Nothing consults a non-data descriptor on the way in, which is exactly why assigning over a `cached_property` is allowed and assigning over a `property` is not.

## What this explains

**Methods.** A plain function is a non-data descriptor: functions define `__get__`, and it returns a bound method. That is the entire mechanism behind `self`.

```python
Point.area              # <function Point.area at 0x...>
Point(1, 2).area        # <bound method Point.area of <Point object ...>>
Point.area.__get__(p)   # the same bound method, spelled out
```

Reaching a function through the class gives `obj=None`, and the function's `__get__` returns the function unchanged. Reaching it through an instance gives `obj=p`, and it returns an object that remembers `p` and passes it as the first argument. Unit 18's two errors, calling `Parser.parse("text")` on the class and defining `def total()` without `self`, are now the same fact seen from either side.

**`staticmethod` and `classmethod`.** Both are descriptors whose `__get__` decides what to bind. `staticmethod.__get__` returns the function with nothing attached, which is why it takes no implicit first argument. `classmethod.__get__` binds `objtype` rather than `obj`, which is why `cls` is the class you called it on and why unit 18's alternative constructor works for subclasses.

**`property`.** A data descriptor holding up to three functions. `__get__` calls the getter, `__set__` calls the setter or raises if there is none, `__delete__` calls the deleter. `@area.setter` returns a new property carrying the same getter and the new setter, which is why the getter must come first.

**`__slots__`.** Each slot name becomes a data descriptor on the class that reads and writes a fixed position in the instance's storage. That is why slots beat the instance dict, and why there is no dict to beat.

Five features, one protocol. If you can recite the lookup order and the data/non-data rule, you can predict all five without remembering any of them individually.

## Only on the class

There is one restriction that catches everybody once, and it follows from the lookup order rather than from any rule about descriptors. **The protocol only fires for descriptors found on the class.** Putting one in an instance's `__dict__` does nothing at all:

```python
p = Point(1, 2)
p.loud = Loud()
p.loud            # <Loud object at 0x...>, not 'read from ...'
```

`type(p).__getattribute__` looks up the type for a descriptor and looks up the instance dict for a value, and a value is all an instance dict can hold. The same is true one level up: a descriptor assigned to a class after the fact still works, because a class is an object whose type is `type`, and the lookup for `Point.x` searches `type(Point)`. Assigning a descriptor to an *instance* of a class puts it where nothing looks for one.

This is also why `__set_name__` fires only in a class body. Python calls it when the class is created, once, for every descriptor it finds. A descriptor attached later has never been told its name, and has to be given one by hand.

## When it is the wrong tool

Three failure modes account for most of the descriptors that should not have been written.

**State on the descriptor.** `self.value = value` inside `__set__` stores one value shared by every instance of the owning class, because the descriptor is a class attribute created once. It is unit 18's mutable class attribute with more ceremony, and it passes every test written against a single object.

**A property would have done.** One attribute, one class, one rule: write the property. A descriptor earns its extra indirection when the same rule applies to several attributes or several classes, and not before. `Positive()` above is worth it at two fields and questionable at one.

**A `dataclass` or a validation library would have done.** Unit 23 covers the first and unit 32 the second, and between them they cover most of what people write descriptors for. Reach for the protocol when you are building the thing that others declare against, not when you are the one declaring.

## Writing one

The honest answer to "when should I write a descriptor" is: rarely, and you will know. A property covers one attribute on one class. A descriptor covers the same behaviour applied to many attributes, or many classes, without repeating it. Validation is the canonical example, because the alternative is a property per field that differs only in a bound:

```python
class Positive:
    def __set_name__(self, owner, name):
        self.name = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.name)

    def __set__(self, obj, value):
        if value <= 0:
            raise ValueError(f"{self.name[1:]} must be positive")
        setattr(obj, self.name, value)


class Order:
    quantity = Positive()
    price = Positive()
```

Three details in there are the ones people get wrong.

`__set_name__` is called by Python when the class body finishes, with the name the descriptor was assigned to. Before it existed you had to write `quantity = Positive("quantity")` and keep the two spellings in sync forever. Now the descriptor learns its own name, and that is the only reason this pattern is pleasant to use.

The storage is per instance, not per descriptor. `Positive()` is created once, in the class body, and shared by every `Order` ever made, exactly like any other class attribute. Storing the value on `self` would make every order share one quantity. The value goes on `obj`, under a name derived from `__set_name__`, and the leading underscore keeps it from colliding with the descriptor itself.

The `obj is None` branch handles access through the class. `Order.quantity` has no instance to read from, and returning the descriptor is the useful answer: it is what lets tooling find it, and it is what `property` does too.

## Where you already rely on this

Descriptors are why the ORM and validation libraries you will meet in unit 32 can write `name = Column(String)` and have it behave like an attribute. They are why `dataclasses` in unit 23 can turn class-level annotations into per-instance fields. Django, SQLAlchemy and pydantic are all, at the layer where they touch your class, this protocol.

One practical habit falls out of that. When an attribute surprises you, print `type(SomeClass).__mro__` if you must, but start with `vars(SomeClass)["x"]`, which shows you the object actually stored on the class rather than the value `SomeClass.x` computes. If what comes back has a `__get__`, you are looking at a descriptor and the surprise has an explanation; if it also has a `__set__`, that explanation extends to writes. Two lines in a REPL, and the mystery is usually over.

You will read far more descriptors than you write. The value of this unit is not the ability to write one; it is that `obj.x` stopped being a mystery. When an attribute behaves in a way a plain value could not, you now know exactly which four questions to ask: is there something on the class, does it define `__get__`, does it also define `__set__`, and what is in the instance dict.
