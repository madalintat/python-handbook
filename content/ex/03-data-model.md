---
slug: 03-data-model
---

## The rendering nobody sees

`Point` implements a nice friendly rendering. Put one inside a list and print the list, or look at one in a REPL, and none of that friendliness appears. The two renderings have two different audiences and this class has written the wrong one.

@expect silent
@hint `print(p)` and `print([p])` use different methods. Work out which one the list is using.
@hint `str()` falls back to the other method when it is missing. The fallback does not go the other way.
@diagnose silent It runs, and every place a programmer would actually look at this object shows `<__main__.Point object at 0x...>`. `__str__` is for the person using the program and is what `print` and `f"{x}"` call. `__repr__` is for the programmer: it is what the REPL shows, what appears for objects nested inside a printed container, and what `!r` and every decent log line uses. If you write only one, write `__repr__`, `str()` falls back to it, and the reverse is not true.

~~~starter
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __str__(self):
        return f"Point({self.x}, {self.y})"
~~~

~~~tests
p = Point(1, 2)
assert str(p) == "Point(1, 2)"
assert repr(p) == "Point(1, 2)", f"repr gave {repr(p)}"
assert repr([p]) == "[Point(1, 2)]", "a Point inside a list is unreadable"
~~~

~~~solution
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __repr__(self):
        return f"Point({self.x}, {self.y})"
~~~

## Equality took hashing with it

`Tag` defines equality so that two tags with the same name compare equal. That single method has quietly removed a capability the class had a moment ago. Run it and read what the interpreter refuses to do.

@expect raises:TypeError
@hint Defining `__eq__` changes what Python does with the class's `__hash__`.
@hint A hash table finds a key by hashing it and then comparing. What must be true of two equal objects for that to work?
@diagnose TypeError Defining `__eq__` sets the class's `__hash__` to `None`, so instances become unhashable and cannot go in a set or be used as a dict key. This is deliberate. A hash table locates a key by hashing it to a bucket and then comparing for equality inside that bucket, so two objects that compare equal must hash equal, or the table will search the wrong bucket and never find what it stored. Rather than let you build that bug, Python withdraws hashing until you state what the hash should be, normally a hash of exactly the fields equality uses.

~~~starter
class Tag:
    def __init__(self, name):
        self.name = name

    def __eq__(self, other):
        return isinstance(other, Tag) and self.name == other.name


print({Tag("a"), Tag("b")})
~~~

~~~tests
assert Tag("a") == Tag("a")
assert Tag("a") != Tag("b")
assert len({Tag("a"), Tag("a"), Tag("b")}) == 2
assert {Tag("a"): 1}[Tag("a")] == 1
~~~

~~~solution
class Tag:
    def __init__(self, name):
        self.name = name

    def __eq__(self, other):
        return isinstance(other, Tag) and self.name == other.name

    def __hash__(self):
        return hash(self.name)


print({Tag("a"), Tag("b")})
~~~

## An empty basket that is not falsy

`Basket` knows perfectly well when it is empty. Ask it in an `if` and it says yes regardless. Work out which method Python consults, and what it does when there is not one.

@expect silent
@hint `if x:` asks the object. What does it do when the object has nothing to say?
@hint One method gives you both `len(basket)` and `if basket:` at once.
@diagnose silent No error, and every basket is true. `if x:` consults `__bool__` first, falls back to `__len__` and calls the object true when the length is non-zero, and, when the class defines neither, calls it true. That default is the trap: an object that clearly represents emptiness is truthy unless you say otherwise. Implementing `__len__` fixes both `len(basket)` and `if basket:` from one method, which is why it is usually the right one to write.

~~~starter
class Basket:
    def __init__(self):
        self.items = []

    def add(self, item):
        self.items.append(item)
~~~

~~~tests
b = Basket()
assert bool(b) is False, "an empty basket was truthy"
assert len(b) == 0
b.add("apple")
assert bool(b) is True
assert len(b) == 1
~~~

~~~solution
class Basket:
    def __init__(self):
        self.items = []

    def add(self, item):
        self.items.append(item)

    def __len__(self):
        return len(self.items)
~~~

## Asking whether something is callable

`describe_all` labels each value by whether you can call it. It asks by poking at a dunder directly, which ruff objects to by name. Read the rule and then work out the case where the handwritten version gives the wrong answer.

@expect ruff:B004
@expect silent
@hint There is a builtin whose entire job is this question.
@hint Dunders are looked up on the type, not the instance. `hasattr` looks at the instance first.
@diagnose B004 ruff's `B004` is "using `hasattr(x, '__call__')` to test if x is callable is unreliable; use `callable(x)`". The unreliability is the point: implicit dunder calls are resolved on the *type*, but `hasattr` searches the instance as well, so an object with a `__call__` attribute stuck on the instance answers yes to `hasattr` and still cannot be called. `callable()` asks the same question the interpreter asks.
@diagnose silent It runs and returns the wrong label for the instance carrying a fake `__call__` attribute. `hasattr` found that attribute; calling the object would still fail, because Python looks `__call__` up on the type when it evaluates `obj()`. This gap between "the instance has an attribute" and "the type implements a protocol" is worth holding on to. Unit 19 is largely about it.

~~~starter
def describe_all(values):
    """Label each value 'callable' or 'value'."""
    labels = []
    for value in values:
        if hasattr(value, "__call__"):
            labels.append("callable")
        else:
            labels.append("value")
    return labels
~~~

~~~tests
class Sneaky:
    pass


s = Sneaky()
setattr(s, "__call__", "not really a method")  # noqa: B010

assert describe_all([len, 3, str]) == ["callable", "value", "callable"]
assert describe_all([s]) == ["value"], "an object with a fake __call__ was called callable"
~~~

~~~solution
def describe_all(values):
    """Label each value 'callable' or 'value'."""
    labels = []
    for value in values:
        if callable(value):
            labels.append("callable")
        else:
            labels.append("value")
    return labels
~~~

## `in` needs to be told how

`Shelf` holds books in a list. Ask whether a title is on the shelf with `in` and the interpreter says it has no idea how to answer. Read the message: it names the protocol it looked for.

@expect raises:TypeError
@expect mypy:operator
@hint `k in a` calls a method. Two different methods can satisfy it, and this class has neither.
@hint The cheap fix delegates to the list the class already holds.
@diagnose operator mypy reports `Unsupported right operand type for in ("Shelf")` without running anything. It knows the class defines neither `__contains__` nor `__iter__`, and therefore that `in` has nothing to call. Every protocol in this unit is visible to a type checker in exactly this way: a missing dunder is a missing method, and a missing method is something mypy can see.
@diagnose TypeError `x in obj` calls `obj.__contains__(x)`. When the class does not define one, Python falls back to iterating with `__iter__` and comparing each item, and when there is no `__iter__` either it gives up with `argument of type 'Shelf' is not iterable`. That message is naming the fallback rather than the first choice, which is worth knowing when you read it. Define `__contains__` for an efficient answer, or `__iter__` if the class should be loopable anyway, and here, defining `__iter__` gets you `in`, `list()`, unpacking and `for` from one method.

~~~starter
class Shelf:
    def __init__(self, books):
        self.books = list(books)


print("Dune" in Shelf(["Dune", "Emma"]))
~~~

~~~tests
shelf = Shelf(["Dune", "Emma"])
assert ("Dune" in shelf) is True
assert ("Ulysses" in shelf) is False
assert list(shelf) == ["Dune", "Emma"], "the shelf should be iterable too"
~~~

~~~solution
class Shelf:
    def __init__(self, books):
        self.books = list(books)

    def __iter__(self):
        return iter(self.books)


print("Dune" in Shelf(["Dune", "Emma"]))
~~~

## `__len__` has to return a length

`Window` reports its size as a nicely formatted string, which is a reasonable thing for a method to do and an unreasonable thing for this particular method to do. Both static judges and the interpreter agree, each in their own words.

@expect raises:TypeError
@expect mypy:return-value
@hint `len()` is documented to return an integer, and the interpreter enforces that rather than trusting you.
@hint If you want a formatted size, that is a different method with a different name.
@diagnose TypeError `len()` does not hand back whatever `__len__` returned. It requires an integer, and converts or rejects accordingly, so returning a string fails with `'str' object cannot be interpreted as an integer`. The dunder protocols carry contracts, and the interpreter enforces several of them: `__len__` must give a non-negative integer, `__bool__` must give a bool, `__hash__` must give an integer.
@diagnose return-value mypy catches it without running anything, because the annotation on `__len__` in its own stubs says the return type is `int` and this override returns `str`. Overriding a method with an incompatible signature is one of the highest-value things a type checker does for you.

~~~starter
class Window:
    def __init__(self, width, height):
        self.width = width
        self.height = height

    def __len__(self) -> int:
        return f"{self.width}x{self.height}"


print(len(Window(3, 4)))
~~~

~~~tests
w = Window(3, 4)
assert len(w) == 12
assert bool(w) is True
assert bool(Window(0, 5)) is False
~~~

~~~solution
class Window:
    def __init__(self, width, height):
        self.width = width
        self.height = height

    def __len__(self) -> int:
        return self.width * self.height


print(len(Window(3, 4)))
~~~

## Declining an operation properly

`Money` adds two amounts. Handed something that is not money it raises immediately, which sounds careful and actually breaks a mechanism you want. The tests add an integer from the left, which a cooperating class would handle.

@expect raises:TypeError
@expect mypy:list-item
@hint When your `__add__` cannot handle the other operand, there is a value to return rather than an exception to raise.
@hint Returning it lets Python offer the operation to the other side.
@diagnose list-item mypy is objecting to the `sum()` call for the same underlying reason, and its complaint spells out the mechanism: `sum` is typed as starting from the integer `0`, so every element has to support being added to an `int`. `Money` does not, because it has no `__radd__`. Once the class declines properly with `NotImplemented` and provides `__radd__`, both the runtime failure and this one go away together.
@diagnose TypeError Raising from inside `__add__` is the mistake, even though a `TypeError` is what should eventually come out. When your method cannot handle the other operand, return the singleton `NotImplemented`: that tells Python "I decline", and Python then offers the operation to the right-hand operand as `__radd__`. Only when both decline does Python raise, with a better message than yours naming both types. Raising immediately means a perfectly good `__radd__`, including the one these tests need for `sum()`, which starts from `0`, is never asked.

~~~starter
class Money:
    def __init__(self, cents):
        self.cents = cents

    def __eq__(self, other):
        return isinstance(other, Money) and self.cents == other.cents

    def __add__(self, other):
        if not isinstance(other, Money):
            raise TypeError("can only add Money to Money")
        return Money(self.cents + other.cents)


print(sum([Money(100), Money(250)]))
~~~

~~~tests
assert Money(100) + Money(250) == Money(350)
assert sum([Money(100), Money(250)]) == Money(350), "sum() starts from the integer 0"
try:
    Money(1) + "x"
except TypeError:
    pass
else:
    raise AssertionError("adding a string should still fail")
~~~

~~~solution
class Money:
    def __init__(self, cents):
        self.cents = cents

    def __eq__(self, other):
        return isinstance(other, Money) and self.cents == other.cents

    def __add__(self, other):
        if isinstance(other, int) and other == 0:
            return self
        if not isinstance(other, Money):
            return NotImplemented
        return Money(self.cents + other.cents)

    def __radd__(self, other):
        return self.__add__(other)


print(sum([Money(100), Money(250)]))
~~~

## Exactly this type, or one of these

`route` dispatches on the type of its argument. It uses an exact type comparison, so it works until somebody subclasses one of these types, which the tests do. This is the same mistake as unit 00's, arriving from a different direction.

@expect silent
@hint `type(x) is C` and `isinstance(x, C)` ask different questions about subclasses.
@hint `bool` is a subclass of `int`. That fact ruins more code than it should.
@diagnose silent It runs and falls through to the default for anything that is not exactly one of these classes. `type(x) is C` demands that exact class and rejects every subclass, which defeats the point of having subclasses at all. `isinstance` accepts derived types, which is nearly always what dispatch wants. Watch the ordering once you switch: `bool` is a subclass of `int`, so an `isinstance(x, int)` branch placed first will swallow every boolean.

~~~starter
def route(value):
    """Label a value by kind."""
    if type(value) is str:
        return "text"
    if type(value) is int:
        return "number"
    return "other"
~~~

~~~tests
class Code(str):
    pass


class Count(int):
    pass


assert route("a") == "text"
assert route(3) == "number"
assert route(3.5) == "other"
assert route(Code("a")) == "text", "a str subclass was not routed as text"
assert route(Count(3)) == "number", "an int subclass was not routed as a number"
~~~

~~~solution
def route(value):
    """Label a value by kind."""
    if isinstance(value, str):
        return "text"
    if isinstance(value, int):
        return "number"
    return "other"
~~~
