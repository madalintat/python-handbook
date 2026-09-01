---
slug: 18-classes
---

## The initialiser that returned something

`Point.__init__` sets the coordinates and helpfully hands back the instance. `__init__` initialises an object that already exists, and Python requires it to return nothing.

@expect raises:TypeError
@hint Which method creates the object, and which one sets it up?
@hint The error names the type it got and the type it wanted.
@diagnose TypeError "__init__() should return None". Creating an instance runs two methods: `__new__` allocates the object and returns it, then `__init__` receives that object as `self` and sets it up. So `__init__` is an initialiser rather than a constructor, and returning anything from it is meaningless, because the object has already been made and the caller is getting `__new__`'s result regardless. Python enforces that rather than silently ignoring the value, which is worth being glad about: a returned `self` would look like it worked and quietly do nothing.

~~~starter
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y
        return self


print(Point(1, 2).x)
~~~

~~~tests
p = Point(1, 2)
assert (p.x, p.y) == (1, 2)
~~~

~~~solution
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y


print(Point(1, 2).x)
~~~

## The method that forgot itself

`Basket.total` computes a sum and takes no `self`. A method is an ordinary function on the class, and calling it through an instance supplies the instance as the first argument.

@expect raises:TypeError
@expect ruff:F821
@expect mypy:misc
@hint Accessing a function through an instance produces a bound method. What does binding supply?
@hint Read the error: it says the call took more arguments than the function accepts.
@diagnose F821 ruff reports `Undefined name self`, which is the same finding from the other end: with no parameter called `self`, the name in the body refers to nothing at all. A method's `self` is an ordinary parameter, and leaving it out makes every use of it an undefined name.
@diagnose misc mypy reports that the method is missing its `self` argument. It knows the rule for a function defined in a class body, which is why this shows up statically as well as at the call.
@diagnose TypeError The error complains about the number of arguments rather than about `self`, which is the clue to what is really happening. `def total()` inside a class stores a plain function taking nothing; accessing it as `basket.total` produces a **bound method**, which is that function with the instance already supplied as its first argument. So `basket.total()` is `Basket.total(basket)`, and a function accepting nothing is handed one thing. That is why `self` is explicit in the definition and invisible at the call site, and it is an ordinary use of the descriptor protocol rather than a special case, which unit 20 takes apart.

~~~starter
class Basket:
    def __init__(self, prices):
        self.prices = list(prices)

    def total():
        return sum(self.prices)


print(Basket([1, 2]).total())
~~~

~~~tests
b = Basket([1, 2, 3])
assert b.total() == 6
assert Basket([]).total() == 0
~~~

~~~solution
class Basket:
    def __init__(self, prices):
        self.prices = list(prices)

    def total(self):
        return sum(self.prices)


print(Basket([1, 2]).total())
~~~

## Counting on the class, writing to the instance

`Widget` counts how many have been made, in a class attribute. The increment reads from the class and writes to the instance, so the count never moves.

@expect silent
@hint `self.made += 1` is a read followed by a write. Where does each of those go?
@hint Attribute reads check the instance then the class. Writes always go to the instance.
@diagnose silent Nothing raised, and the counter stayed at one for every widget. `self.made += 1` expands to a read and a write: the read finds nothing on the instance and falls back to the class, so it gets the class's value; the write always goes to the instance, creating an attribute there that shadows the class's from then on. So each widget quietly gets its own counter starting from one, and `Widget.made` never changes. To modify the class's attribute, name the class: `Widget.made += 1`, or better, use a `classmethod` so a subclass counts on its own class rather than the base.

~~~starter
class Widget:
    made = 0

    def __init__(self):
        self.made += 1
~~~

~~~tests
Widget()
Widget()
Widget()
assert Widget.made == 3, f"the class counter is {Widget.made}"
~~~

~~~solution
class Widget:
    made = 0

    def __init__(self):
        Widget.made += 1
~~~

## The alternative constructor that hardcoded its class

`Temperature.from_string` parses a value and builds an instance. It is a `staticmethod` naming the class directly, so a subclass calling it gets the base class back.

@expect silent
@hint A `staticmethod` receives nothing. A `classmethod` receives the class it was called on.
@hint Ask what a subclass gets back from this.
@diagnose silent Nothing raised, and a subclass's alternative constructor returned the base class, so every method the subclass added is missing from the result. A `staticmethod` gets no reference to the class it was reached through, so it has to name one, and the name it picks is fixed at the moment the code is written. A `classmethod` receives that class as `cls`, so `cls(...)` builds whatever it was called on: `Temperature.from_string` gives a `Temperature` and `Kelvin.from_string` gives a `Kelvin`. That is the reason alternative constructors are classmethods, and the bug is invisible until somebody subclasses, which may be long after the code was written.

~~~starter
class Temperature:
    def __init__(self, degrees):
        self.degrees = degrees

    @staticmethod
    def from_string(text):
        return Temperature(float(text.rstrip("C")))
~~~

~~~tests
class Kelvin(Temperature):
    def absolute(self):
        return self.degrees + 273.15


t = Temperature.from_string("21C")
assert t.degrees == 21.0

k = Kelvin.from_string("21C")
assert isinstance(k, Kelvin), f"a subclass got back a {type(k).__name__}"
assert k.absolute() == 294.15
~~~

~~~solution
class Temperature:
    def __init__(self, degrees):
        self.degrees = degrees

    @classmethod
    def from_string(cls, text):
        return cls(float(text.rstrip("C")))
~~~

## Two objects that are the same and not equal

`Money` holds an amount. Two amounts of the same value compare unequal, because without `__eq__` an instance is equal only to itself.

@expect silent
@hint What does `==` do for a class that does not define `__eq__`?
@hint The default is inherited from `object`, and it compares identity.
@diagnose silent Nothing raised, and two objects that represent the same amount compared unequal. Without `__eq__`, a class inherits `object`'s, which compares identity: an instance is equal only to itself. That default is right for things that have an identity, a connection, a widget, a running task, and wrong for things that are values, which is what this class is. Writing `__eq__` brings `__hash__` with it, as unit 03 covered, so both are needed for the object to work in a set or as a dict key. For a class this shape, a dataclass generates both from the fields and is what unit 23 will recommend.

~~~starter
class Money:
    def __init__(self, pence):
        self.pence = pence
~~~

~~~tests
assert Money(500) == Money(500), "two equal amounts compared unequal"
assert Money(500) != Money(300)
assert len({Money(500), Money(500)}) == 1, "equal amounts should collapse in a set"
~~~

~~~solution
class Money:
    def __init__(self, pence):
        self.pence = pence

    def __eq__(self, other):
        return isinstance(other, Money) and self.pence == other.pence

    def __hash__(self):
        return hash(self.pence)
~~~

## A default that every instance shares

`Config` gives each instance a list of tags, as a class attribute. Nothing assigns to it, so nothing shadows it, and every instance appends to the same list.

@expect silent
@expect mypy:var-annotated
@hint Assigning creates an instance attribute. Does `append` assign?
@hint The class body runs once. How many lists does it make?
@diagnose var-annotated mypy cannot infer what an empty list holds and asks for an annotation. Not the bug, and worth noticing where it points: a bare `[]` in a class body is the exact shape this exercise is about, so the checker is drawing attention to the right line for the wrong reason.
@diagnose silent It runs, and every config shares one list. This is the other half of the class-attribute rule: assignment creates an instance attribute that shadows the class's, but `self.tags.append(x)` is a **read** followed by a mutation, and the read finds the class's single list. So the shadowing that saves you in the counter case never happens here. The class body runs once, at import, so there is exactly one list for the life of the process. Per-instance state has to be created per instance, which means in `__init__`. Class attributes are for constants and defaults that will only ever be read.

~~~starter
class Config:
    tags = []

    def add(self, tag):
        self.tags.append(tag)
        return self.tags
~~~

~~~tests
a = Config()
b = Config()
a.add("x")
assert b.tags == [], f"the second config already has {b.tags}"
assert a.tags == ["x"]
~~~

~~~solution
class Config:
    def __init__(self):
        self.tags = []

    def add(self, tag):
        self.tags.append(tag)
        return self.tags
~~~

## `__new__` that returned nothing

`Singleton.__new__` arranges for one shared instance and forgets to hand it back. `__new__` returns the object, and a `None` return means nothing is created.

@expect raises:AttributeError
@hint `__new__` allocates and **returns** the object. What is `self` if it returns nothing?
@hint When `__new__` returns something that is not an instance of the class, `__init__` is not called either.
@diagnose AttributeError `__new__` returned `None`, so calling the class produced `None`, and the attribute access on it failed. This is the one place the two creation steps become visible: `__new__` makes the object and must return it, and Python only calls `__init__` when what came back is an instance of the class. Forgetting the `return` gives you a class whose instances are all `None`, with no complaint at the point of the mistake. It is also worth noting how rarely `__new__` is needed at all: immutable types, which have no "after" in which to set attributes, and classes that want to hand back an existing instance, as here.

~~~starter
class Registry:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = object.__new__(cls)
            cls._instance.items = []

    def add(self, item):
        self.items.append(item)


print(Registry().add("a"))
~~~

~~~tests
# the module-level call above already added "a" to the one shared instance
a = Registry()
b = Registry()
a.add("x")
assert a is b, "the registry should hand back one shared instance"
assert b.items == ["a", "x"], f"got {b.items}"
~~~

~~~solution
class Registry:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = object.__new__(cls)
            cls._instance.items = []
        return cls._instance

    def add(self, item):
        self.items.append(item)


print(Registry().add("a"))
~~~

## Reaching a method without an instance

`Parser.parse` is called on the class rather than on an instance, because the caller has nothing to make one from. It is written as an ordinary method, so it wants a `self` that nobody has.

@expect raises:TypeError
@expect mypy:arg-type
@expect mypy:call-arg
@hint A plain method accessed on the class is just a function, and it still wants its first argument.
@hint This one never uses `self`. Say so.
@diagnose call-arg mypy reports a missing argument: reached on the class rather than on an instance, `parse` still wants its `self`, and the call supplies only one thing.
@diagnose arg-type And it reports the type as well, because the string being passed lands in the `self` position, where a `Parser` was expected. The two messages together describe the whole mistake more precisely than the runtime error does.
@diagnose TypeError Accessing `Parser.parse` on the class gives the plain function, not a bound method, so nothing supplies the first argument and the call is one short. The interesting question is what the method should have been. It never touches `self`, so it is not really an instance method: a `staticmethod` says exactly that and makes `Parser.parse(text)` legal. A `classmethod` would be right if it needed the class, to build one or to read a class attribute. And if nothing outside the class would ever want it, a module-level function is simpler still, which is worth asking before adding a `staticmethod` out of habit.

~~~starter
class Parser:
    def parse(self, text):
        return [part.strip() for part in text.split(",")]


print(Parser.parse("a, b"))
~~~

~~~tests
assert Parser.parse("a, b") == ["a", "b"]
assert Parser.parse("") == [""]
~~~

~~~solution
class Parser:
    @staticmethod
    def parse(text):
        return [part.strip() for part in text.split(",")]


print(Parser.parse("a, b"))
~~~
