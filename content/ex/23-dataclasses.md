---
slug: 23-dataclasses
---

## The field that was not one

`Config` declares three attributes. One of them has no annotation, so the decorator never sees it as a field and it never reaches `__init__`.

@expect raises:TypeError
@hint What does `@dataclass` read to decide what the fields are?
@hint Two of these three lines look the same. Compare them character by character.
@diagnose TypeError `retries = 3` has no annotation, so `@dataclass` did not treat it as a field: it stayed an ordinary class attribute, `__init__` takes only two parameters, and passing a third is one too many. The decorator reads `__annotations__`, which means the annotation is not documentation here but the declaration itself. The mistake is quiet in the other direction too: had nobody passed `retries` in, the class would work, every instance would share the class attribute, and the field would be missing from `__repr__` and `__eq__` without anything ever saying so. Annotate every field, and let `int = 3` be the way you spell a default.

~~~starter
from dataclasses import dataclass


@dataclass
class Config:
    host: str
    port: int = 8080
    retries = 3
~~~

~~~tests
c = Config("localhost", 9090, 5)
assert (c.host, c.port, c.retries) == ("localhost", 9090, 5)
assert repr(c) == "Config(host='localhost', port=9090, retries=5)"
assert Config("a") == Config("a")
assert Config("a") != Config("a", retries=1)
~~~

~~~solution
from dataclasses import dataclass


@dataclass
class Config:
    host: str
    port: int = 8080
    retries: int = 3
~~~

## A value object that cannot be a key

`Money` is a value: two of them with the same amount are the same money. A plain `@dataclass` generates `__eq__`, which sets `__hash__` to `None`, so it cannot go in a set.

@expect raises:TypeError
@hint Unit 04's rule, generated instead of hand-written. What does defining `__eq__` do to `__hash__`?
@hint One argument to the decorator fixes both this and a bigger problem.
@diagnose TypeError `@dataclass` generates `__eq__`, and defining `__eq__` sets `__hash__` to `None`, exactly as unit 04 described for a hand-written class. The refusal is correct rather than annoying: a mutable object's hash would go stale the moment a field changed, leaving it lost in a set that still holds it. `frozen=True` makes assignment raise and generates a `__hash__` from the fields, which is safe precisely because nothing can change. It is worth being the default for anything that represents a value. `eq=False` would also make the class hashable, by identity, but that gives up the comparison the class exists for.

~~~starter
from dataclasses import dataclass


@dataclass
class Money:
    pence: int
    currency: str = "GBP"


print({Money(500)})
~~~

~~~tests
assert Money(500) == Money(500)
assert len({Money(500), Money(500), Money(300)}) == 2

m = Money(500)
try:
    m.pence = 1
except Exception as exc:
    assert type(exc).__name__ == "FrozenInstanceError", f"got {type(exc).__name__}"
else:
    raise AssertionError("a value object accepted an assignment")
~~~

~~~solution
from dataclasses import dataclass


@dataclass(frozen=True)
class Money:
    pence: int
    currency: str = "GBP"


print({Money(500)})
~~~

## The default that every basket shares

`Basket` gives `items` a default of an empty list. `dataclasses` refuses this outright, which is the only place in the language that catches unit 02's mutable default for you.

@expect raises:ValueError
@hint This is the mutable-default bug from unit 02, and the decorator will not let it past.
@hint The error message names the function you need.
@diagnose ValueError The decorator refuses at class creation, and the message says exactly what to use: `mutable default <class 'list'> for field items is not allowed: use default_factory`. A bare `= []` in a class body creates one list, once, shared by every instance, which unit 02 covered as a function default and unit 18 covered as a class attribute. `field(default_factory=list)` stores the callable instead of the value, and the generated `__init__` calls it once per instance. This is the one construct in Python that catches the mistake for you, which is worth knowing precisely because the same shape is silent everywhere else.

~~~starter
from dataclasses import dataclass


@dataclass
class Basket:
    owner: str
    items: list[str] = []
~~~

~~~tests
a = Basket("ada")
b = Basket("bob")
a.items.append("apple")
assert a.items == ["apple"]
assert b.items == [], f"the second basket already holds {b.items}"
~~~

~~~solution
from dataclasses import dataclass, field


@dataclass
class Basket:
    owner: str
    items: list[str] = field(default_factory=list)
~~~

## Two records that are the same but not equal

`Record` carries a generated id alongside its content. The id is a field like any other, so two records with identical content compare unequal.

@expect silent
@hint `__eq__` compares every field. Should it compare this one?
@hint `field()` takes an argument for exactly this.
@diagnose silent Nothing raised, and two records holding the same data compared unequal, because `__eq__` compares every field as a tuple and the ids differ. `field(compare=False)` keeps a field out of `__eq__` and out of the generated ordering, which is what you want for an id, a cache, a timestamp or anything else that is bookkeeping rather than content. Its sibling `repr=False` keeps a field out of `__repr__`, for anything large, secret or noisy. Both are worth reaching for early: a `__repr__` that dumps a whole payload and an `__eq__` that compares a timestamp are the two ways a generated method quietly stops being useful.

~~~starter
import itertools
from dataclasses import dataclass, field

_ids = itertools.count()


@dataclass
class Record:
    content: str
    record_id: int = field(default_factory=lambda: next(_ids))
~~~

~~~tests
a = Record("hello")
b = Record("hello")
assert a.record_id != b.record_id
assert a == b, f"two records holding {a.content!r} compared unequal"
assert a != Record("goodbye")
~~~

~~~solution
import itertools
from dataclasses import dataclass, field

_ids = itertools.count()


@dataclass
class Record:
    content: str
    record_id: int = field(default_factory=lambda: next(_ids), compare=False)
~~~

## Sorted by the wrong field

`Task` sets `order=True`, which compares the fields as a tuple in declaration order. `name` is declared first, so tasks sort alphabetically rather than by priority.

@expect silent
@hint What does `order=True` compare, and in what order?
@hint The fix is not a new method.
@diagnose silent It runs, and the tasks came out alphabetical. `order=True` generates comparisons that build a tuple of every field in **declaration order** and compare those, so the first field declared is the primary sort key. That is convenient when the order is deliberate and a trap when the fields were written in the order they came to mind. Moving `priority` first fixes it and changes the `__init__` signature with it, which is the honest cost. When the sort key is genuinely unrelated to how the class should read, `sorted(tasks, key=attrgetter("priority"))` from unit 14 says so at the call site instead, and leaves the class alone.

~~~starter
from dataclasses import dataclass


@dataclass(order=True)
class Task:
    name: str
    priority: int
~~~

~~~tests
tasks = [
    Task(name="wash up", priority=3),
    Task(name="aardvark", priority=9),
    Task(name="deploy", priority=1),
]
assert [t.name for t in sorted(tasks)] == ["deploy", "wash up", "aardvark"], (
    f"sorted as {[t.name for t in sorted(tasks)]}"
)
assert min(tasks).priority == 1
~~~

~~~solution
from dataclasses import dataclass


@dataclass(order=True)
class Task:
    priority: int
    name: str
~~~

## Validation that never ran

`Order.__init__` is generated, so the validation written as a separate method is never called. `__post_init__` is the hook that runs after it.

@expect silent
@hint The decorator writes `__init__`. Where does your own setup go?
@hint The method has the right body and the wrong name.
@diagnose silent Nothing raised, and an order with a negative quantity was constructed happily. `@dataclass` generates `__init__` and calls nothing of yours from it, except one method with a fixed name: `__post_init__`, which runs after every field has been assigned. Validation, derived fields and any other setup go there. Writing a `validate` method and remembering to call it is the alternative, and it is the same class of mistake as a comment that documents an invariant nobody enforces: it works until the one call site that forgets. Note what `__post_init__` cannot do on a frozen class, which is assign; `object.__setattr__` is the documented way through, and needing it is usually a sign the value should have been computed by a property instead.

~~~starter
from dataclasses import dataclass


@dataclass
class Order:
    item: str
    quantity: int

    def validate(self):
        if self.quantity <= 0:
            raise ValueError("quantity must be positive")
~~~

~~~tests
assert Order("apple", 3).quantity == 3

try:
    Order("apple", -1)
except ValueError:
    pass
else:
    raise AssertionError("an order with a negative quantity was constructed")
~~~

~~~solution
from dataclasses import dataclass


@dataclass
class Order:
    item: str
    quantity: int

    def __post_init__(self):
        if self.quantity <= 0:
            raise ValueError("quantity must be positive")
~~~

## A status that is a string, and a typo that is not a status

`Status` is a plain class of string constants, and `process` compares against a literal rather than a member. The literal is misspelled, so that branch is unreachable and nothing ever says so.

@expect silent
@hint A misspelled string is a valid string. What kind of type makes a misspelled member fail instead?
@hint `Status.ACTIV` raises. `"activ"` does not.
@diagnose silent It runs, and an active order was reported as unknown, because `"activ"` is a perfectly good string that simply never matches. This is the entire argument for an enum: a fixed set of choices, where a misspelled member raises `AttributeError` at the moment it is written rather than quietly failing forever. Members compare by identity, so `is` is the right operator, and iterating the class gives them in declaration order. `StrEnum` additionally subclasses `str` for the edges of a program, where a value gets serialised into JSON or a URL, at the cost of letting a bare string compare equal again, which is exactly the safety you came for.

~~~starter
class Status:
    PENDING = "pending"
    ACTIVE = "active"


def process(status):
    """Describe what should happen to an order in this state."""
    if status == Status.PENDING:
        return "waiting"
    if status == "activ":
        return "working"
    return "unknown"
~~~

~~~tests
from enum import Enum

assert process(Status.PENDING) == "waiting"
assert process(Status.ACTIVE) == "working"
assert issubclass(Status, Enum)
assert [s.name for s in Status] == ["PENDING", "ACTIVE"]

try:
    Status.ACTIV
except AttributeError:
    pass
else:
    raise AssertionError("a misspelled member should not exist")
~~~

~~~solution
from enum import Enum


class Status(Enum):
    PENDING = "pending"
    ACTIVE = "active"


def process(status):
    """Describe what should happen to an order in this state."""
    if status is Status.PENDING:
        return "waiting"
    if status is Status.ACTIVE:
        return "working"
    return "unknown"
~~~

## Equal to a bare tuple

`Point` is a `NamedTuple`, so it **is** a tuple and compares equal to any tuple with the same values. Here that means a point and a pair of unrelated numbers are the same thing.

@expect silent
@hint What does a `NamedTuple` compare equal to, besides another one?
@hint The other declaration in this unit generates `__eq__` that checks the type first.
@diagnose silent Nothing raised, and a point compared equal to a plain tuple holding a width and a height. A `NamedTuple` is a tuple: it unpacks, it indexes, and it compares by value against any other tuple, which is the reason to choose it and the reason to avoid it. It is right when the thing genuinely is a small fixed sequence whose positions deserve names, which is the common case for returning several values from a function. It is wrong when the type is part of the meaning, or when the class will grow, because a tuple's length is part of its interface. A `frozen=True` dataclass gives you the same immutability and hashability with an `__eq__` that checks the type first.

~~~starter
from typing import NamedTuple


class Point(NamedTuple):
    x: float
    y: float
~~~

~~~tests
assert Point(1, 2) == Point(1, 2)
assert Point(1, 2) != (1, 2), "a point compared equal to a bare pair of numbers"

p = Point(1, 2)
assert (p.x, p.y) == (1, 2)
assert hash(p) == hash(Point(1, 2))
~~~

~~~solution
from dataclasses import dataclass


@dataclass(frozen=True)
class Point:
    x: float
    y: float
~~~
