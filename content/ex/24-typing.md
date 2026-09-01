---
slug: 24-typing
---

## A promise the function does not keep

`find_user` says it returns a `User`. It returns `None` when there is no match, so every caller is written against a promise the function breaks.

@expect mypy:return-value
@expect raises:AttributeError
@hint The annotation says `User`. Read the last line of the body.
@hint `X | None` is how a signature admits it might find nothing.
@diagnose return-value mypy reports that the return value is `None` where a `User` was declared. This is the single highest-value thing a checker does in ordinary code: an annotation of `User | None` makes every call site handle the missing case, and mypy names the ones that do not. Annotating it as `User` does not make it true; it makes the checker agree with the bug.
@diagnose AttributeError `None` has no `.name`. The traceback points at the caller, which is honest and unhelpful, because the mistake is in a function that promised something it could not deliver. Say `-> User | None` and the failure moves from here to a list of call sites a checker can hand you before the program ever runs.

~~~starter
class User:
    def __init__(self, name: str) -> None:
        self.name = name


USERS = {1: User("ada")}


def find_user(user_id: int) -> User:
    """Return the user with this id, if there is one."""
    return USERS.get(user_id)


def greet(user_id: int) -> str:
    user = find_user(user_id)
    return f"hello {user.name}"


print(greet(99))
~~~

~~~tests
assert greet(1) == "hello ada"
assert greet(99) == "hello stranger"
~~~

~~~solution
class User:
    def __init__(self, name: str) -> None:
        self.name = name


USERS = {1: User("ada")}


def find_user(user_id: int) -> User | None:
    """Return the user with this id, if there is one."""
    return USERS.get(user_id)


def greet(user_id: int) -> str:
    user = find_user(user_id)
    if user is None:
        return "hello stranger"
    return f"hello {user.name}"


print(greet(99))
~~~

## A list of dogs that a function put a cat in

`add_stray` takes a `list[Animal]` and appends to it. A caller passes a `list[Dog]`, and now the dogs are not all dogs.

@expect mypy:arg-type
@expect silent
@hint Ask what the function is allowed to put into the list it was given.
@hint Which container type in `collections.abc` promises the function will only read?
@diagnose arg-type mypy refuses `list[Dog]` where `list[Animal]` is wanted, which looks wrong until you see this exercise. A `list` can be appended to, so accepting the narrower list would let the function put an `Animal` that is not a `Dog` into it. The rule is not about dogs and animals; it is that a mutable container's element type cannot be narrowed, in either direction, without letting somebody break somebody else's invariant.
@diagnose silent Nothing raised, and the caller's list of dogs now contains a cat, which will fail somewhere else entirely, at whatever line first calls a dog method. `Sequence[Animal]` is the fix when the function only reads, because a sequence has no `append` and the narrowing is therefore safe. This is the reason the read-only container types are the right default for parameters: they say what the function does, and they accept more.

~~~starter
class Animal:
    def __init__(self, name: str) -> None:
        self.name = name

    def speak(self) -> str:
        return "..."


class Dog(Animal):
    def speak(self) -> str:
        return "woof"


class Cat(Animal):
    def speak(self) -> str:
        return "meow"


def loudest(animals: list[Animal]) -> str:
    """Return the name of the first animal, after noting a stray."""
    animals.append(Cat("stray"))
    return animals[0].name


def kennel_report(dogs: list[Dog]) -> str:
    return loudest(dogs)
~~~

~~~tests
dogs = [Dog("rex"), Dog("fido")]
assert kennel_report(dogs) == "rex"
assert all(isinstance(d, Dog) for d in dogs), (
    f"the kennel now holds {[type(d).__name__ for d in dogs]}"
)
~~~

~~~solution
from collections.abc import Sequence


class Animal:
    def __init__(self, name: str) -> None:
        self.name = name

    def speak(self) -> str:
        return "..."


class Dog(Animal):
    def speak(self) -> str:
        return "woof"


class Cat(Animal):
    def speak(self) -> str:
        return "meow"


def loudest(animals: Sequence[Animal]) -> str:
    """Return the name of the first animal."""
    return animals[0].name


def kennel_report(dogs: list[Dog]) -> str:
    return loudest(dogs)
~~~

## A key that only looks right

`Row` describes the shape of the incoming data. The function reads a key that is not in it, and a `TypedDict` is what turns that from a run-time surprise into a reported error.

@expect mypy:typeddict-item
@expect raises:KeyError
@hint Compare the key the function reads against the keys the shape declares.
@hint The whole reason to declare the shape is that a checker can then compare them for you.
@diagnose typeddict-item mypy reports that `"scr"` is not a key of `Row`. That is the entire value of a `TypedDict`: it is an ordinary dict at run time, nothing is created and nothing is checked when the program runs, but a checker now knows which keys exist and can say so about every access in the file. It is the right tool for a shape somebody else defined, such as JSON arriving from an API. When you control the shape, unit 23's dataclass is better, because it also exists.
@diagnose KeyError The dict has no `scr`, and the failure arrives at the read rather than at the typo. In real code the data usually comes from a network, so this fails on some rows and not others, which is the worst version of the same bug. Declaring the shape once makes the misspelling a static error in every file that touches it.

~~~starter
from typing import TypedDict


class Row(TypedDict):
    name: str
    score: int


def best(rows: list[Row]) -> str:
    """Return the name of the highest scoring row."""
    return max(rows, key=lambda r: r["scr"])["name"]
~~~

~~~tests
rows: list[Row] = [{"name": "ada", "score": 9}, {"name": "bob", "score": 4}]
assert best(rows) == "ada"
assert best([{"name": "solo", "score": 0}]) == "solo"
~~~

~~~solution
from typing import TypedDict


class Row(TypedDict):
    name: str
    score: int


def best(rows: list[Row]) -> str:
    """Return the name of the highest scoring row."""
    return max(rows, key=lambda r: r["score"])["name"]
~~~

## One of a fixed set, spelled wrong

`align` accepts `"left"` or `"right"` and nothing else, which `Literal` states. The caller passes a third thing, and the function's fallback quietly treats it as one of them.

@expect mypy:arg-type
@expect silent
@hint The annotation lists the allowed values. Compare them against the call.
@hint Nothing at run time enforces a `Literal`, which is why the checker matters here.
@diagnose arg-type mypy reports that `"rihgt"` is not one of the literals `align` accepts. The value is a perfectly ordinary string, so nothing at run time will ever object; the annotation is what makes the typo findable, and it costs one import. Unit 23's enum is the heavier version of the same idea and is better when the set is used in many places or wants behaviour attached, but for a parameter with two or three allowed spellings, `Literal` is the whole job.
@diagnose silent Nothing raised, and the text came back left aligned because the misspelled value fell through to the `else`. A fallback branch is what makes this silent: without one there would at least be a `KeyError` or an unhandled case. Writing the fallback as an explicit failure, rather than as one of the valid outcomes, is the run-time half of the same defence.

~~~starter
from typing import Literal


def align(text: str, side: Literal["left", "right"], width: int) -> str:
    """Pad text to width, against the given side."""
    if side == "right":
        return text.rjust(width)
    return text.ljust(width)


def render(text: str) -> str:
    return align(text, "rihgt", 8)
~~~

~~~tests
assert align("hi", "left", 4) == "hi  "
assert align("hi", "right", 4) == "  hi"
assert render("hi") == "      hi", f"render gave {render('hi')!r}"
~~~

~~~solution
from typing import Literal


def align(text: str, side: Literal["left", "right"], width: int) -> str:
    """Pad text to width, against the given side."""
    if side == "right":
        return text.rjust(width)
    return text.ljust(width)


def render(text: str) -> str:
    return align(text, "right", 8)
~~~

## The annotation that turned the checker off

`summarise` accepts `Any`, so nothing it does to the value is checked. The body calls a string method on something that is not a string, and no tool says a word.

@expect raises:AttributeError
@hint `Any` is compatible with everything, in both directions. What does that leave for mypy to check?
@hint There is a type that accepts anything and permits nothing until you narrow it.
@diagnose AttributeError mypy reported nothing at all, which is the lesson. `Any` is not "some type I have not decided"; it switches checking off for every expression it touches, in both directions, so the body can call any method on the value and pass it anywhere. `object` is the honest annotation for "genuinely anything": it accepts every argument exactly as `Any` does, and permits nothing on the value until you narrow it with `isinstance`, which is what the function had to do anyway. Reach for `Any` when you are describing something genuinely dynamic, and treat every other use as a surrender worth a second look.

~~~starter
from typing import Any


def summarise(value: Any) -> str:
    """Describe a value in one line."""
    return value.strip().title()
~~~

~~~tests
assert summarise("  ada lovelace ") == "Ada Lovelace"
assert summarise(42) == "42"
assert summarise(["a", "b"]) == "2 items"
~~~

~~~solution
def summarise(value: object) -> str:
    """Describe a value in one line."""
    if isinstance(value, str):
        return value.strip().title()
    if isinstance(value, list):
        return f"{len(value)} items"
    return str(value)
~~~

## Demanding a base class where a method would do

`shutdown` takes a `Resource` and checks for it with `isinstance`. Anything else with a `close` method is refused, including a class from a library that has never heard of `Resource`.

@expect mypy:arg-type
@expect silent
@hint The function uses exactly one method. What does it actually need from its argument?
@hint `Protocol` describes a shape rather than an ancestry.
@diagnose arg-type mypy refuses the socket, because it does not inherit from `Resource`, and the checker is agreeing with a restriction the function never needed. Annotating a `Protocol` instead describes what the function uses rather than where the argument came from, and any class with a matching `close` satisfies it, including one you do not own and cannot change. This is duck typing with a name a checker can verify, and it is why unit 21 said that needing several unrelated types to support the same operation was never a reason for a shared base class.
@diagnose silent Nothing raised, and the socket was silently reported as unclosable, because the `isinstance` check sent it down the other branch. The run-time check and the annotation are the same mistake twice: both ask about ancestry when the function's actual requirement is a method. Deleting the check and annotating a `Protocol` fixes both, and leaves a function that says exactly what it needs.

~~~starter
class Resource:
    def close(self) -> None:
        """Release whatever this holds."""


class Database(Resource):
    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


class Socket:
    """From a library that has never heard of Resource."""

    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


def shutdown(resource: Resource) -> str:
    if not isinstance(resource, Resource):
        return "not closeable"
    resource.close()
    return "closed"


print(shutdown(Socket()))
~~~

~~~tests
db = Database()
assert shutdown(db) == "closed"
assert db.closed

sock = Socket()
assert shutdown(sock) == "closed", f"the socket was reported as {shutdown(sock)!r}"
assert sock.closed
~~~

~~~solution
from typing import Protocol


class Closeable(Protocol):
    def close(self) -> None: ...


class Database:
    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


class Socket:
    """From a library that has never heard of Closeable."""

    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


def shutdown(resource: Closeable) -> str:
    resource.close()
    return "closed"
~~~

## A function of the wrong shape

`apply_twice` declares the shape of the function it takes. The one passed to it needs two arguments, which `Callable` describes precisely enough for a checker to notice.

@expect mypy:arg-type
@expect raises:TypeError
@hint `Callable[[int], int]` says one parameter. Count the parameters of what is passed.
@hint The fix is at the call, not in the annotation.
@diagnose arg-type mypy compares the shape of `scale` against the `Callable[[int], int]` the parameter declares and reports the mismatch. This is where annotating a function-valued parameter starts paying: without it, `f` would be `Any` and the error would arrive only when `f(x)` ran, which in real code is often inside a callback, far from the line that supplied it.
@diagnose TypeError `scale` wants two arguments and got one. `functools.partial(scale, 3)` builds a one-argument function from it, which is exactly the shape declared, and says at the call site what was intended. A `lambda x: scale(3, x)` does the same and is fine; `partial` is worth knowing because it is what unit 17's `functools` offers for this and because it keeps working when the function is looked up dynamically.

~~~starter
from collections.abc import Callable


def apply_twice(f: Callable[[int], int], x: int) -> int:
    """Apply f to x, then to the result."""
    return f(f(x))


def scale(factor: int, n: int) -> int:
    return factor * n


print(apply_twice(scale, 2))
~~~

~~~tests
from functools import partial

assert apply_twice(lambda n: n + 1, 0) == 2
assert apply_twice(partial(scale, 3), 2) == 18
~~~

~~~solution
from collections.abc import Callable
from functools import partial


def apply_twice(f: Callable[[int], int], x: int) -> int:
    """Apply f to x, then to the result."""
    return f(f(x))


def scale(factor: int, n: int) -> int:
    return factor * n


print(apply_twice(partial(scale, 2), 2))
~~~

## Reading through a maybe

`display` takes a value that might be `None` and uses it without asking. The annotation is honest; the body ignores it.

@expect mypy:union-attr
@expect raises:AttributeError
@hint The parameter is `str | None`. Which half has `.upper`?
@hint An early return removes a possibility from everything below it.
@diagnose union-attr mypy reports that `None` has no attribute `upper`, having read the annotation and worked out that one member of the union does not support the access. A checker follows control flow, so an `if value is None` before this line would have narrowed the type and the report would be gone. `isinstance`, `assert`, truthiness tests and early returns all narrow the same way.
@diagnose AttributeError The run-time half of the same thing. This is why guard clauses check so much more cleanly than a deep `if`: each early return removes a possibility from every line below it, so by the time the real work happens the type is whatever is left. Writing the guard first is a habit worth forming for its own sake, and a checker rewards it immediately.

~~~starter
def display(value: str | None) -> str:
    """Show a value in upper case, or say it is missing."""
    return value.upper()
~~~

~~~tests
assert display("ada") == "ADA"
assert display(None) == "(missing)"
~~~

~~~solution
def display(value: str | None) -> str:
    """Show a value in upper case, or say it is missing."""
    if value is None:
        return "(missing)"
    return value.upper()
~~~
