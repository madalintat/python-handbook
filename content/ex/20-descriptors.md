---
slug: 20-descriptors
---

## Every order sharing one quantity

`Positive` validates a number and stores it. It stores it on the descriptor, which the class body created once, so all orders share the same value.

@expect silent
@hint The descriptor is a class attribute. How many of it exist?
@hint `__set__` is handed the instance it should store on. Look at its parameters.
@diagnose silent Nothing raised, and setting one order's quantity changed every order's. `Positive()` runs once, in the class body, so there is exactly one descriptor shared by every instance, exactly like any other class attribute from unit 18. Storing on `self` therefore stores on that one shared object. The value belongs on `obj`, the instance the access came through, which is why `__get__` and `__set__` are handed it. This is the same bug as the shared mutable class attribute, dressed up: per-instance state has to be stored per instance, and a descriptor makes it easy to forget which of the two objects in scope is the instance.

~~~starter
class Positive:
    def __set_name__(self, owner, name):
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return self.value

    def __set__(self, obj, value):
        if value <= 0:
            raise ValueError("must be positive")
        self.value = value


class Order:
    quantity = Positive()
~~~

~~~tests
a = Order()
b = Order()
a.quantity = 3
b.quantity = 7
assert a.quantity == 3, f"the first order's quantity became {a.quantity}"
assert b.quantity == 7
~~~

~~~solution
class Positive:
    def __set_name__(self, owner, name):
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage)

    def __set__(self, obj, value):
        if value <= 0:
            raise ValueError("must be positive")
        setattr(obj, self.storage, value)


class Order:
    quantity = Positive()
~~~

## Two fields, one storage name

`Field` keeps its value on the instance, under a name it chose when it was written. Both fields chose the same one, so the second overwrites the first.

@expect silent
@hint The descriptor knows the name it was assigned to. Which method tells it?
@hint `"_value"` is hardcoded. What should it be derived from?
@diagnose silent It runs, and reading either field gives whatever was written last, because both descriptors store on the instance under `_value`. A descriptor has to derive its storage name from the name it was bound to, and `__set_name__(self, owner, name)` is how Python tells it: the interpreter calls it once when the class body finishes, with the attribute name. Before `__set_name__` existed you wrote `price = Field("price")` and kept the two spellings in sync by hand, which is the sort of duplication that is wrong in one file out of ten forever. The underscore prefix on the derived name matters too, because storing under the bare name would collide with the descriptor's own entry on the class.

~~~starter
class Field:
    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return obj.__dict__["_value"]

    def __set__(self, obj, value):
        obj.__dict__["_value"] = value


class Order:
    price = Field()
    quantity = Field()
~~~

~~~tests
o = Order()
o.price = 10
o.quantity = 3
assert o.price == 10, f"price read back as {o.price} after quantity was set"
assert o.quantity == 3
~~~

~~~solution
class Field:
    def __set_name__(self, owner, name):
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return obj.__dict__[self.storage]

    def __set__(self, obj, value):
        obj.__dict__[self.storage] = value


class Order:
    price = Field()
    quantity = Field()
~~~

## The cache that never took

`Expensive` computes a value once and writes it into the instance dict so later reads find it there. It also defines `__set__`, which makes it a data descriptor, and a data descriptor beats the instance dict every time.

@expect silent
@hint Which of the two kinds of descriptor does the instance dict win against?
@hint Count what the descriptor defines, then look at unit 19's lookup order.
@diagnose silent It gives the right answer and computes it on every read, because defining `__set__` made this a **data descriptor**, and a data descriptor is consulted before the instance dict. So the value written into `obj.__dict__` is never reached. Removing `__set__` makes it a non-data descriptor, the instance dict wins from the second access onward, and the cache works. That is exactly the mechanism behind `functools.cached_property`, and exactly why `property`, which does define `__set__`, cannot cache itself this way. The cost of dropping `__set__` is that assignment is now allowed, which for a cache is the point.

~~~starter
class Expensive:
    def __set_name__(self, owner, name):
        self.name = name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        obj.calls += 1
        value = sum(obj.rows)
        obj.__dict__[self.name] = value
        return value

    def __set__(self, obj, value):
        obj.__dict__[self.name] = value


class Report:
    total = Expensive()

    def __init__(self, rows):
        self.rows = rows
        self.calls = 0
~~~

~~~tests
r = Report([1, 2, 3])
assert r.total == 6
assert r.total == 6
assert r.total == 6
assert r.calls == 1, f"the value was computed {r.calls} times instead of once"
~~~

~~~solution
class Expensive:
    def __set_name__(self, owner, name):
        self.name = name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        obj.calls += 1
        value = sum(obj.rows)
        obj.__dict__[self.name] = value
        return value


class Report:
    total = Expensive()

    def __init__(self, rows):
        self.rows = rows
        self.calls = 0
~~~

## Reached through the class

`Registry.field` is a descriptor. Something asks the class for it rather than an instance, and `__get__` reads from an instance that is not there.

@expect raises:AttributeError
@hint What is `obj` when the access came through the class rather than an instance?
@hint Every descriptor in this unit starts its `__get__` with the same two lines.
@diagnose AttributeError `Registry.field` calls `__get__` with `obj` set to `None`, because there is no instance, and `None` has no `_field`. Every `__get__` needs to decide what class-level access means, and the convention is to return the descriptor itself: it is what `property` does, it is what lets tooling inspect the class, and it is why `vars(cls)["x"]` and `cls.x` can both be useful. Those two lines, `if obj is None: return self`, are boilerplate in the strict sense that you write them every time and they always say the same thing.

~~~starter
class Field:
    def __set_name__(self, owner, name):
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        return getattr(obj, self.storage)

    def __set__(self, obj, value):
        setattr(obj, self.storage, value)


class Registry:
    field = Field()


print(Registry.field)
~~~

~~~tests
assert isinstance(Registry.field, Field), "class access should give back the descriptor"

r = Registry()
r.field = "x"
assert r.field == "x"
~~~

~~~solution
class Field:
    def __set_name__(self, owner, name):
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage)

    def __set__(self, obj, value):
        setattr(obj, self.storage, value)


class Registry:
    field = Field()


print(Registry.field)
~~~

## A descriptor put where nothing looks for it

`configure` attaches a descriptor to an object after the fact. Descriptors are only consulted when they are found on the class, so this one is just a value in an instance dict.

@expect silent
@hint Which dict does the lookup search for a descriptor, and which does it search for a value?
@hint The fix does not change `Upper` at all.
@diagnose silent It runs, and reading the attribute gives back the descriptor object rather than calling it. The protocol fires for descriptors found on the **class**: `type(obj).__getattribute__` searches the type for a descriptor and the instance dict for a value, and a value is all an instance dict can hold. Assigning `Upper()` to an instance therefore stores an ordinary object. Setting it on the class works, and so does declaring it in the class body, which additionally gets `__set_name__` called. This is the restriction that catches everybody once, and it follows from the lookup order rather than from any rule of its own.

~~~starter
class Upper:
    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return obj.raw.upper()


class Label:
    def __init__(self, raw):
        self.raw = raw


def configure(label):
    """Give this label a computed `shout` attribute."""
    label.shout = Upper()
    return label
~~~

~~~tests
lab = configure(Label("hi"))
assert lab.shout == "HI", f"shout gave {lab.shout!r}"
assert configure(Label("bye")).shout == "BYE"
~~~

~~~solution
class Upper:
    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return obj.raw.upper()


class Label:
    def __init__(self, raw):
        self.raw = raw


def configure(label):
    """Give this label a computed `shout` attribute."""
    type(label).shout = Upper()
    return label
~~~

## Binding the instance where the class was wanted

`Shape.of` is an alternative constructor. It is written as a plain method, so its `__get__` binds the instance, and there is no instance to bind.

@expect raises:TypeError
@expect mypy:arg-type
@expect mypy:call-arg
@hint A function's `__get__` binds `obj`. Which decorator's `__get__` binds `objtype` instead?
@hint Unit 18 met this from the other side, without knowing why.
@diagnose call-arg mypy reports a missing argument, because reached on the class the method still wants the parameter the author called `cls`. Naming a parameter `cls` does not make it one; only the `classmethod` decorator does.
@diagnose arg-type And it reports the type, because `"square"` lands in the first parameter, where mypy expected a `Shape`. Between the two messages mypy has described the binding rule without being told about it.
@diagnose TypeError A function is a non-data descriptor whose `__get__` returns a method bound to `obj`, and reaching it through the class gives `obj = None`, so nothing is bound and the call is one argument short. `classmethod` is a descriptor too, and the only interesting thing it does is bind `objtype` rather than `obj`. That one difference is the whole reason `cls` is the class you called it on, and the reason unit 18's alternative constructor kept working for subclasses. Three decorators, one protocol: `staticmethod.__get__` binds nothing, `classmethod.__get__` binds the class, and a bare function binds the instance.

~~~starter
class Shape:
    def __init__(self, sides):
        self.sides = sides

    def of(cls, name):
        """Build a shape from a common name."""
        return cls({"triangle": 3, "square": 4}[name])


print(Shape.of("square").sides)
~~~

~~~tests
s = Shape.of("square")
assert s.sides == 4


class Coloured(Shape):
    def describe(self):
        return f"{self.sides} sides"


c = Coloured.of("triangle")
assert isinstance(c, Coloured), f"a subclass got back a {type(c).__name__}"
assert c.describe() == "3 sides"
~~~

~~~solution
class Shape:
    def __init__(self, sides):
        self.sides = sides

    @classmethod
    def of(cls, name):
        """Build a shape from a common name."""
        return cls({"triangle": 3, "square": 4}[name])


print(Shape.of("square").sides)
~~~

## Storing under the name it answers to

`Cached` stores its value on the instance under the same name it is bound to on the class. It is a data descriptor, so it intercepts the write too, and the write goes straight back into itself.

@expect raises:RecursionError
@hint `setattr(obj, self.name, value)` goes through attribute lookup. What does it find on the class?
@hint The property setter from unit 19 had this exact shape.
@diagnose RecursionError `setattr(obj, "total", value)` calls `type(obj).__setattr__`, which finds this data descriptor on the class and calls `__set__`, which calls `setattr` again. It is unit 19's property-setter bug at one more level of abstraction, and the fix is the same: the storage needs a name of its own. `obj.__dict__[name] = value` avoids it too, by writing past the lookup entirely, and is what a descriptor usually wants because it is explicit about where the value went. Anything that handles attribute access must not reach for the attribute it handles, which is now the third time this unit and the last have said so.

~~~starter
class Cached:
    def __set_name__(self, owner, name):
        self.name = name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.name)

    def __set__(self, obj, value):
        setattr(obj, self.name, value)


class Report:
    total = Cached()
~~~

~~~tests
r = Report()
r.total = 6
assert r.total == 6

other = Report()
other.total = 9
assert (r.total, other.total) == (6, 9), "the two reports share a value"
~~~

~~~solution
class Cached:
    def __set_name__(self, owner, name):
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage)

    def __set__(self, obj, value):
        setattr(obj, self.storage, value)


class Report:
    total = Cached()
~~~

## A read-only attribute that was not

`Version.number` should be read only. It is written with `__get__` alone, which makes it a non-data descriptor, and the instance dict wins against those.

@expect silent
@hint Which kind of descriptor does an assignment write past?
@hint A read-only attribute needs a `__set__` that refuses, not an absent one.
@diagnose silent Nothing raised, and the assignment stuck. A non-data descriptor defines only `__get__`, so `obj.number = 2` writes an ordinary entry into the instance dict, and from then on step 2 of the lookup finds it before step 3 ever reaches the descriptor. Leaving `__set__` out does not make an attribute read only; it makes it overridable. To refuse a write you have to define `__set__` and raise from it, which is precisely what `property` does when you give it a getter and no setter, and precisely why that raises `AttributeError` instead of silently shadowing.

~~~starter
class Constant:
    def __init__(self, value):
        self.value = value

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return self.value


class Version:
    number = Constant(1)
~~~

~~~tests
v = Version()
assert v.number == 1

try:
    v.number = 2
except AttributeError:
    pass
else:
    raise AssertionError("a read-only attribute accepted an assignment")
assert v.number == 1
~~~

~~~solution
class Constant:
    def __init__(self, value):
        self.value = value

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return self.value

    def __set__(self, obj, value):
        raise AttributeError("this attribute is read only")


class Version:
    number = Constant(1)
~~~
