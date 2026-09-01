---
slug: 23-dataclasses
title: Modern data modelling
---

Five units of machinery, and now the part where you stop using most of it by hand. `dataclass` writes `__init__`, `__repr__` and `__eq__` from a list of annotated fields, which is the majority of what units 18 through 22 taught you to write. This unit is about which tool to reach for, and the answer is usually the boring one.

## `dataclass`

```python
from dataclasses import dataclass


@dataclass
class Point:
    x: float
    y: float
```

That is a complete class with an `__init__` taking `x` and `y`, a `__repr__` reading `Point(x=1, y=2)`, and an `__eq__` comparing the fields as a tuple. Ten lines of the hand-written version, generated from two annotations.

The annotations are what the decorator reads. A class attribute without one is not a field: it stays an ordinary class attribute and never reaches `__init__`, which is a quiet and common mistake.

Three arguments cover nearly all real use.

**`frozen=True`** makes instances immutable: assignment raises `FrozenInstanceError`, and the class gets a `__hash__` derived from its fields, so instances work as dict keys and in sets. This should be your default for anything that represents a value. Unit 02's whole argument about mutable shared state applies, and frozen is how you opt out of it.

**`order=True`** generates `__lt__`, `__le__`, `__gt__` and `__ge__` comparing the fields as a tuple, in declaration order. Useful and easy to misuse: field order becomes sort order, so declaring `name` before `priority` sorts alphabetically, which was probably not the intent.

**`slots=True`** applies unit 19's `__slots__` without you writing the list twice.

## Fields that need more than a name

`field()` handles the cases a bare annotation cannot.

```python
from dataclasses import dataclass, field


@dataclass
class Basket:
    owner: str
    items: list[str] = field(default_factory=list)
    _cache: dict = field(default_factory=dict, repr=False, compare=False)
```

`default_factory` is unit 02's mutable-default bug, solved properly. `items: list[str] = []` is refused outright by `dataclasses`, with an error telling you to use `default_factory`, which is the only place in the language that catches that mistake for you.

`repr=False` keeps a field out of the generated `__repr__`, which is what you want for anything large, secret or noisy. `compare=False` keeps it out of `__eq__` and the ordering, which is what you want for a cache, a timestamp or an id that should not affect whether two records are the same thing.

`__post_init__` runs after the generated `__init__` and is where validation and derived fields go:

```python
    def __post_init__(self):
        if not self.owner:
            raise ValueError("a basket needs an owner")
```

Ordinary methods work exactly as they do on any class. A dataclass is a normal class that had three methods written for it, not a different kind of object.

## What is generated, and what is not

It is worth being precise about the boundary, because most surprises with dataclasses live exactly on it.

Generated for you: `__init__`, `__repr__`, `__eq__`, and with `order=True` the four comparisons, and with `frozen=True` a `__hash__` and a `__setattr__` that refuses. Provided as functions rather than methods: `dataclasses.asdict`, `astuple`, `replace` and `fields`. `replace(point, x=5)` is the way to "modify" a frozen instance, by making a new one, and it is the operation that makes immutability comfortable rather than annoying.

Not generated, and not checked: anything to do with the types you wrote. `x: float` does not stop `Point("hello", [])`. The annotation is read for the field's name and order and nothing else; mypy will complain, and at run time nothing will. Unit 24 makes this point properly, and it is the single most common misunderstanding about dataclasses.

Also not generated: `__hash__` for a mutable dataclass. Defining `__eq__`, which the decorator does, sets `__hash__` to `None`, exactly as unit 04 described for a hand-written class. A plain `@dataclass` is therefore unhashable, which is correct: it can change, so any hash it produced would go stale inside a set. `frozen=True` is what makes hashing safe and is why it is the right default.

## `NamedTuple`

```python
from typing import NamedTuple


class Point(NamedTuple):
    x: float
    y: float
```

Same declaration, different object. This one **is a tuple**: it unpacks, it indexes, it is immutable and hashable, and it compares equal to a plain tuple of the same values. That last property is the reason to choose it and the reason to avoid it. It is exactly right when the thing genuinely is a small fixed sequence and you want to give its positions names, which is the common case for returning several values from a function. It is wrong when you do not want `Point(1, 2) == (1, 2)` to be true, or when the class will grow, because a tuple's shape is part of its interface.

The rule of thumb: `NamedTuple` for a return value, `frozen=True` dataclass for a domain object.

## `Enum`

```python
from enum import Enum


class Status(Enum):
    PENDING = "pending"
    ACTIVE = "active"
```

A fixed set of named values, and the point is what it prevents. `status == "activ"` is silently `False` forever; `Status.ACTIV` raises `AttributeError` immediately. Members compare by identity, so `is` is the right operator, and iterating the class gives the members in declaration order.

`StrEnum` (and `IntEnum`) additionally subclass `str`, so members can be used anywhere a string is expected, which is what you want at the edges of a program where a value gets serialised into JSON or a URL. The cost is that the type safety you came for is weakened, since a `StrEnum` member and a bare string compare equal again.

`auto()` supplies values when only the names matter, and `@unique` refuses duplicates, which are otherwise silently created as aliases: two names with the same value give you one member reachable under both spellings, and `len(Status)` counting one fewer than you wrote is how you find out.

An enum can carry methods, which is the feature people discover late and then use constantly. Putting the behaviour that varies by case on the enum itself replaces the `if status == ...` chain that would otherwise be copied into four call sites. Add a member later and there is one place to extend rather than four to find.

## Choosing

Walk down this list and stop at the first that fits.

- A handful of related values passed around together, and you never need methods on them: a `NamedTuple`, or a plain tuple if there are two of them and the meaning is obvious.
- A fixed set of choices: an `Enum`.
- A value object, compared by its contents: a `frozen=True` dataclass.
- An object with identity and changing state, a connection, a session, a running job: a plain class. Dataclasses are not for these, and `__eq__` by fields is actively wrong for them.
- Data arriving from outside the program, from JSON, a form, an API: this is where a dependency starts earning its keep.

## When a library earns the dependency

`dataclasses` is in the standard library and validates nothing. That is a deliberate boundary, not an omission: it generates methods, and checking that a value is a positive integer is a different job.

**`attrs`** is what `dataclasses` was based on and stayed ahead of. Validators, converters, and `__slots__` by default. Reach for it when you want the generation to do more and you are willing to add a dependency; a great deal of existing code uses it, so you will read it regardless.

**`pydantic`** does something different, and the difference is the whole decision. It **parses and validates at run time**, from untrusted input, using the annotations as the specification. A `pydantic` model given `{"age": "37"}` gives you `age=37` as an integer, or a precise error naming the field. That is not what a dataclass does, and it is not what mypy does either: unit 24 will make the point that annotations are not checked at run time, and pydantic is the tool that chooses to check them.

The decision rule is about where the data came from. Inside your program, where you constructed the object yourself, a dataclass is right and a validating model is overhead on every construction. At the boundary, where the data came from a network, a file, a form or another team, a dataclass is a promise nobody checked. FastAPI's whole design is this observation applied consistently: pydantic at the edge, ordinary objects within.

## Inheritance, briefly

Dataclasses inherit, and the rule has one sharp edge. Fields accumulate down the hierarchy in MRO order, base class fields first, and a subclass cannot add a field without a default after a base class supplied one with a default, because the generated `__init__` would have a non-default parameter following a default one. The error names the field, and the fix is either to give the new field a default too or to make it keyword only.

Unit 21's advice applies unchanged: shallow is better. A dataclass hierarchy three deep produces an `__init__` whose parameter list nobody can predict without reading four files.

## The advice

Start with a `frozen=True` dataclass. It is one line of decoration, it gives you the three methods you would otherwise write and get subtly wrong, it makes the object hashable and safe to share, and it is easy to change your mind about later. Reach for something else when this unit has given you a reason to, and not before.

Everything Phase 4 covered is still there underneath. The reason to have learned it is not that you will write it often, but that when a generated method does something unexpected, you know exactly which mechanism produced it.
