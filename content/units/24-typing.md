---
slug: 24-typing
title: Type hints
---

Start with the sentence everything else in this unit depends on: **Python does not check annotations at run time.** None of them. `def total(prices: list[int]) -> int` will accept a string, a dict, or `None`, and return whatever the body returns.

```python
def double(n: int) -> int:
    return n * 2


double("ha")        # 'haha'. No error. Ever.
```

Annotations are metadata. They are stored on the object, they are read by tools, and the interpreter's only interest in them is putting them somewhere findable. Unit 23 made the same point about dataclass fields; this is where the reason becomes clear, because the checking is somebody else's job by design.

That somebody is mypy, or pyright, or your editor, and unit 25 is about living with one. This unit is about what you are writing for them to read.

## The basics, and what has changed

```python
def greet(name: str, times: int = 1) -> str: ...

names: list[str] = []
lookup: dict[str, int] = {}
pair: tuple[int, str] = (1, "a")
```

Built-in generics have worked since 3.9, so `list[str]` rather than `typing.List[str]`. The old capitalised forms still exist and you will read them in older code; there is no reason to write them.

`X | None` is the modern spelling of `Optional[X]`, and `int | str` of `Union[int, str]`, since 3.10. Prefer the bar.

**`Optional[X]` means "X or None"**, and never "this argument may be omitted". That misreading is common and consequential. A parameter is optional because it has a default; `Optional` is about the value, not the call.

One rule about `None` in signatures is worth adopting outright: a function that can return nothing should say so. `def find(id: int) -> User | None` forces every caller to consider the missing case, and mypy will point at the ones that did not. This is the single highest-value thing type hints do in ordinary code, because it converts an `AttributeError` on `None` from a run-time surprise into a compile-time list.

## Containers, and variance without the vocabulary

Annotate a parameter with the least specific type the body actually needs:

```python
from collections.abc import Iterable, Sequence, Mapping

def total(prices: Iterable[int]) -> int: ...        # I only iterate it
def median(values: Sequence[float]) -> float: ...   # I index and len it
def render(options: Mapping[str, str]) -> str: ...  # I only read keys
```

`Iterable` accepts a list, a tuple, a generator, a set. `list` accepts a list. Since a caller with a tuple is not doing anything wrong, the narrow annotation refuses code that would have worked.

There is one asymmetry that surprises people: `list[Dog]` is **not** acceptable where `list[Animal]` is expected. It looks wrong until you see why. If it were allowed, the function could append a `Cat` to it, and the caller's list of dogs would now contain a cat. `Sequence[Animal]` is fine, because a sequence is read-only from the annotation's point of view. That is the whole story, and it is why the read-only container types are the right default for parameters.

The other half of the same rule: return the concrete type. `-> list[str]` tells a caller what they can do with it. Being vague on the way out helps nobody.

One more consequence of "not checked at run time" is worth stating before it bites you: annotations can be wrong. Nothing keeps them in step with the code, so an annotation that was accurate when written and is stale now is a lie the checker believes and repeats. This is the argument for running a checker in CI rather than occasionally by hand, and it is the reason a codebase with hints nobody verifies is in some ways worse off than one with none: the hints are read as documentation, and documentation that lies is worse than documentation that is missing.

## The pieces worth knowing

**`Literal`** restricts a value to specific constants.

```python
def align(text: str, side: Literal["left", "right"]) -> str: ...
```

A typo in the caller is now an error rather than a run-time surprise. Unit 23's enum is the heavier version of the same idea, and better when the set is used in many places or needs behaviour.

**`TypedDict`** describes the shape of a dict, which is what you have when data arrives as JSON.

```python
class Row(TypedDict):
    name: str
    score: int
```

It is still an ordinary dict at run time; nothing is created and nothing is checked. It buys you a checker that knows `row["nmae"]` is wrong. When you control the shape, a dataclass is better. When you are describing a shape somebody else defined, this is the tool.

**`Protocol`** is structural typing, and it is the piece that makes typing feel like Python rather than like Java:

```python
class Closeable(Protocol):
    def close(self) -> None: ...


def shutdown(resource: Closeable) -> None:
    resource.close()
```

Anything with a `close` method satisfies this. Nothing inherits from `Closeable`, nothing registers, and the class being passed can be from a library that has never heard of your code. This is duck typing with a name the checker can verify, and it is why unit 21 could say that needing several unrelated types to support the same operations was never a reason for a shared base class.

**`Any`** disables checking for whatever it touches. It is occasionally correct and usually a surrender. `object` is the honest alternative when you truly accept anything: it accepts everything and lets you do nothing without narrowing first, which is what you actually meant.

## Generics

When a function's output type depends on its input type, saying so needs a variable that stands for a type:

```python
def first[T](items: Sequence[T]) -> T:
    return items[0]
```

`first([1, 2, 3])` is an `int` and `first(["a"])` is a `str`, and the checker knows which without being told twice. The alternative, `-> Any`, throws that away at exactly the point it was most useful, and `-> object` makes the caller narrow something they already knew.

The square brackets on the `def` are the 3.12 syntax. Older code writes it with an explicit variable, and you will read a great deal of it:

```python
T = TypeVar("T")

def first(items: Sequence[T]) -> T: ...
```

The two mean the same thing. The newer form scopes `T` to the function that uses it, which is what everybody assumed the old one did.

A type variable can be constrained, and there are two ways that differ more than they look. `T: float` is a **bound**: any type that is acceptable where a float is. `T: (int, str)` is a **constraint list**: exactly one of those, and not a subclass mix. Bounds are what you usually want.

Classes take parameters the same way, and this is how a container says what it holds:

```python
class Stack[T]:
    def __init__(self) -> None:
        self._items: list[T] = []

    def push(self, item: T) -> None:
        self._items.append(item)

    def pop(self) -> T:
        return self._items.pop()
```

`Stack[int]()` then gives a checker enough to reject `stack.push("a")`, with no run-time cost at all, because nothing about the class changed.

## Functions as values

`Callable` describes the shape of a function, which matters as soon as one is passed as an argument:

```python
def apply_twice(f: Callable[[int], int], x: int) -> int:
    return f(f(x))
```

The first bracket holds the parameter types and the second position is the return. `Callable[..., str]` means "any parameters, returns a string", and is the escape hatch when the signature genuinely varies. Unit 26's decorators are where this stops being decoration and starts being the difference between a decorator that preserves a signature and one that erases it.

## Narrowing

A checker follows control flow, and this is the part that feels like magic until you see the rule.

```python
def name_of(user: User | None) -> str:
    if user is None:
        return "anonymous"
    return user.name          # here, mypy knows user is a User
```

The `is None` check narrowed the type for the rest of the function. `isinstance`, `assert`, truthiness tests and early returns all narrow. This is why early returns and guard clauses check so much more cleanly than a deep `if`: each one removes a possibility from everything below it.

When you know something the checker cannot, `assert isinstance(x, Foo)` states it and narrows, and it is honest, because it is also checked at run time.

## Types on the way in

Annotations live in `__annotations__`, and since 3.14 they are **evaluated lazily**: the `def` stores a description of the expression and nothing computes it until something reads it. A method can therefore annotate its own class, which used to require quoting the name:

```python
class Node:
    def merge(self, other: Node) -> Node: ...      # fine on 3.14
```

You will still read a great deal of code with quoted annotations and with `from __future__ import annotations` at the top, both of which were the older ways to get this, and both of which still work. On 3.14 neither is needed for forward references.

What has not changed is that anything reading annotations at run time, pydantic, dataclasses, a dependency injector, forces the evaluation at that moment, and a name that is not importable then will raise. `typing.get_type_hints` is the function that resolves them, and the failure it produces is the subject of an exercise in unit 29.

## How much to write

Types cost effort and repay it unevenly, so it is worth being deliberate.

Annotate **function signatures**: parameters and returns, at every boundary of a module. That is where the information is dense and where a checker gets the most out of it.

Do not annotate what is obvious. `count: int = 0` says nothing that `= 0` did not.

Do not contort the code to satisfy a checker. A type expression that takes three lines and a `TypeVar` to describe a function is usually telling you the function does two things.

One habit is worth more than any of the individual rules: annotate as you write, not afterwards. Adding hints to a function you are writing takes seconds, because you already know what the parameters hold. Adding them to a function written last year means reading it to find out, which is the expensive part, and is why "we will add types later" so reliably means "we will not".

Types are worth most in code that is read more than written, crossed by more than one person, or old enough that nobody remembers what a parameter holds. They are worth least in a fifty-line script. Unit 25 is about the strictness dials, the errors you will actually hit, and the point where the marginal type stops paying for itself.
