---
slug: 19-attributes
---

## The setter that called itself

`Account.balance` is a property that validates before storing. The setter stores by assigning `self.balance`, which is the property, so the assignment goes straight back into the setter.

@expect raises:RecursionError
@hint Assigning `self.balance` runs whatever handles assignment to `balance`. What handles it?
@hint The stored value needs a name of its own, and by convention it is the same name with a leading underscore.
@diagnose RecursionError The setter assigned to the very name it handles, so it called itself until the stack ran out. A property replaces `obj.x` with a method call in both directions, which means the real value has to live somewhere else, conventionally `self._x`. That underscore is not privacy, as unit 18 said; it is a note to a reader that `_balance` is storage and `balance` is the interface. The getter has the same problem for the same reason, and the same fix. Recognise the shape and you have most of `__setattr__` too: code that handles assignment must not assign to the thing it handles.

~~~starter
class Account:
    def __init__(self, balance):
        self.balance = balance

    @property
    def balance(self):
        return self.balance

    @balance.setter
    def balance(self, value):
        if value < 0:
            raise ValueError("a balance cannot be negative")
        self.balance = value
~~~

~~~tests
a = Account(10)
assert a.balance == 10

a.balance = 25
assert a.balance == 25

try:
    a.balance = -1
except ValueError:
    pass
else:
    raise AssertionError("a negative balance was accepted")
assert a.balance == 25, "the rejected assignment changed the balance anyway"
~~~

~~~solution
class Account:
    def __init__(self, balance):
        self.balance = balance

    @property
    def balance(self):
        return self._balance

    @balance.setter
    def balance(self, value):
        if value < 0:
            raise ValueError("a balance cannot be negative")
        self._balance = value
~~~

## Intercepting every read instead of the failed ones

`Row` reports a missing column as `None` rather than raising. It hooks the wrong method: `__getattribute__` runs on every access, so it swallows the ones that would have worked.

@expect raises:TypeError
@hint One of these two hooks runs always, and the other only after normal lookup has failed.
@hint Read the error and ask what `r.columns` evaluated to before the call.
@diagnose TypeError `r.columns` went through the hook like everything else, found no `"columns"` key, and returned `None`, so the call tried to call `None`. `__getattribute__` is the entire lookup and runs on every attribute access, methods included; `__getattr__` is the fallback Python calls only after the normal lookup has already failed. Almost every "give me a default for missing attributes" class wants the second one, and gets it in a line, because the normal lookup keeps working underneath. Override `__getattribute__` and you own everything, including the parts that were fine.

~~~starter
class Row:
    """A row whose missing columns read as None."""

    def __init__(self, **fields):
        self.fields = fields

    def columns(self):
        return list(self.fields)

    def __getattribute__(self, name):
        return object.__getattribute__(self, "fields").get(name)
~~~

~~~tests
r = Row(name="ada", age=36)
assert r.name == "ada"
assert r.age == 36
assert r.missing is None
assert r.columns() == ["name", "age"]
~~~

~~~solution
class Row:
    """A row whose missing columns read as None."""

    def __init__(self, **fields):
        self.fields = fields

    def columns(self):
        return list(self.fields)

    def __getattr__(self, name):
        return self.fields.get(name)
~~~

## The fallback that answers to any name

`Settings` exposes a mapping as attributes. Its `__getattr__` returns `None` for a name it does not have, so a misspelled setting reads as "not configured" instead of failing.

@expect silent
@hint `.get` returns `None` for a missing key. What should attribute access do for a missing attribute?
@hint `__getattr__` is allowed to raise. That is how a name stays unknown.
@diagnose silent Nothing raised, and a misspelled setting quietly read as `None`. A `__getattr__` that answers every name makes `hasattr` return `True` for everything and turns every typo into a silent default, which is a worse bug than the one it was written to avoid. It is the same trade-off as `dict.get` against `dict[key]`, moved somewhere far less visible: the reader of `settings.timout` has no way to see that a lookup happened at all. Raise `AttributeError` for names you do not have, and let a caller that wants a default ask for one with `getattr(settings, "timeout", 30)`.

~~~starter
class Settings:
    """Reads settings from a mapping, with attribute access."""

    def __init__(self, values):
        self._values = values

    def __getattr__(self, name):
        return self._values.get(name)
~~~

~~~tests
s = Settings({"timeout": 30, "retries": 3})
assert s.timeout == 30
assert s.retries == 3

try:
    s.timout
except AttributeError:
    pass
else:
    raise AssertionError("a misspelled setting returned a value instead of raising")

assert not hasattr(s, "timout")
assert getattr(s, "timout", 99) == 99, "a caller asking for a default should still get one"
~~~

~~~solution
class Settings:
    """Reads settings from a mapping, with attribute access."""

    def __init__(self, values):
        self._values = values

    def __getattr__(self, name):
        try:
            return self._values[name]
        except KeyError:
            raise AttributeError(name) from None
~~~

## A field that was never declared

`Reading` declares `__slots__` to keep a great many of these small. `__init__` assigns a third attribute that the declaration does not list.

@expect raises:AttributeError
@hint With `__slots__`, an instance has no `__dict__` for an undeclared name to land in.
@hint The error names the attribute. Compare it against the declaration.
@diagnose AttributeError This is `__slots__` doing its job. Without it, `self.unit = unit` would have created the attribute in the instance dict and nobody would have noticed; with it, the instance has a fixed set of named slots and no dict, so a name that was not declared has nowhere to go and the assignment fails at once. Turning a silent typo into an immediate error is the underrated half of what `__slots__` buys, alongside the memory. Note what it does not buy: it is not privacy, not immutability, and not a type declaration, and it costs you the ability to attach anything ad hoc later.

~~~starter
class Reading:
    __slots__ = ("sensor", "value")

    def __init__(self, sensor, value, unit):
        self.sensor = sensor
        self.value = value
        self.unit = unit
~~~

~~~tests
r = Reading("t1", 21.5, "C")
assert (r.sensor, r.value, r.unit) == ("t1", 21.5, "C")
assert not hasattr(r, "__dict__"), "slots were declared but the instance still carries a dict"
~~~

~~~solution
class Reading:
    __slots__ = ("sensor", "value", "unit")

    def __init__(self, sensor, value, unit):
        self.sensor = sensor
        self.value = value
        self.unit = unit
~~~

## The subclass that handed the dict back

`Node` uses `__slots__` because a list of these gets long. `Counted` extends it and declares no slots of its own, so its instances get a `__dict__` again and the guarantee is gone.

@expect silent
@hint `__slots__` describes one class. What does a subclass that declares none have?
@hint The test asks the instance whether it has a `__dict__`.
@diagnose silent It runs, and the subclass's instances carry a `__dict__` after all, which means the memory saving is gone and undeclared names are silently accepted again. `__slots__` is a statement about one class, not a promise that inherits: a subclass without its own declaration gets a dict, and one entry in that dict costs more than every slot the base class saved. The subclass lists only what it adds, never the inherited names, because repeating a base class's slot allocates a second one that shadows the first. If a class hierarchy is using slots for memory, every class in it has to say so.

~~~starter
class Node:
    __slots__ = ("value", "next")

    def __init__(self, value, nxt=None):
        self.value = value
        self.next = nxt


class Counted(Node):
    def __init__(self, value, nxt=None):
        Node.__init__(self, value, nxt)
        self.hits = 0
~~~

~~~tests
c = Counted(1)
assert (c.value, c.hits) == (1, 0)
assert not hasattr(c, "__dict__"), (
    "the subclass declared no __slots__, so its instances got a dict back"
)

c.hits = 5
try:
    c.hts = 5
except AttributeError:
    pass
else:
    raise AssertionError("a typo'd attribute was silently created on the subclass")
~~~

~~~solution
class Node:
    __slots__ = ("value", "next")

    def __init__(self, value, nxt=None):
        self.value = value
        self.next = nxt


class Counted(Node):
    __slots__ = ("hits",)

    def __init__(self, value, nxt=None):
        Node.__init__(self, value, nxt)
        self.hits = 0
~~~

## The write hook that wrote through itself

`Frozen` lets each attribute be set once. `__setattr__` stores the value with an ordinary assignment, which is the one thing it cannot do.

@expect raises:RecursionError
@hint `__setattr__` runs on every assignment to an attribute, including the ones inside `__setattr__`.
@hint There is a way to store a value without going through the hook. Two, in fact.
@diagnose RecursionError `self.name = value` inside `__setattr__` calls `__setattr__`, which does it again, until the stack runs out. It is the property-setter bug from earlier in this unit in different clothing, and `__setattr__` has no escape hatch of its own: unlike `__getattr__`, it runs on **every** assignment, not only the ones that would otherwise fail. Store through `object.__setattr__(self, name, value)`, which reaches the machinery underneath, or through `self.__dict__[name] = value`. Prefer the first, because it keeps working when the class also uses `__slots__` and therefore has no dict to write into. There is a second bug hiding in the same line: `self.name` assigns the literal attribute `name` rather than the one the caller asked for.

~~~starter
class Frozen:
    """Attributes can be set once and never changed."""

    def __init__(self, **fields):
        for name, value in fields.items():
            setattr(self, name, value)

    def __setattr__(self, name, value):
        if hasattr(self, name):
            raise AttributeError(f"{name} is already set")
        self.name = value
~~~

~~~tests
f = Frozen(host="localhost", port=8080)
assert (f.host, f.port) == ("localhost", 8080)

try:
    f.port = 9090
except AttributeError:
    pass
else:
    raise AssertionError("a frozen attribute was reassigned")
assert f.port == 8080
~~~

~~~solution
class Frozen:
    """Attributes can be set once and never changed."""

    def __init__(self, **fields):
        for name, value in fields.items():
            setattr(self, name, value)

    def __setattr__(self, name, value):
        if hasattr(self, name):
            raise AttributeError(f"{name} is already set")
        object.__setattr__(self, name, value)
~~~

## The bug that `hasattr` swallowed

`describe` asks whether a report can compute an average before asking for one. The property has a typo in it, and the typo raises the same exception `hasattr` uses to mean "no".

@expect silent
@hint `hasattr` is a `try`/`except AttributeError` with the exception thrown away. Whose exception?
@hint Read the property body one name at a time against what `__init__` stored.
@diagnose silent Nothing raised, and a report with three rows reported that it had no average. `hasattr(obj, "name")` calls `getattr` and returns `False` if it raises `AttributeError`, and it cannot tell an attribute that is missing from a property whose body raised `AttributeError` for a reason of its own. So a typo inside the property, `self.row` for `self.rows`, is reported to the caller as "the attribute is not there", and the caller takes the wrong branch on a value that exists. The calling code reads correctly, which is why this survives review. Two habits avoid it: prefer `getattr(obj, "name", default)` when you want a default, and keep a property's body from raising `AttributeError` on its own account.

~~~starter
class Report:
    def __init__(self, rows):
        self.rows = rows

    @property
    def average(self):
        return sum(self.rows) / len(self.row)


def describe(report):
    """Return the report's average, or a note when it has none."""
    if hasattr(report, "average"):
        return report.average
    return "no average available"
~~~

~~~tests
r = Report([1, 2, 3])
assert describe(r) == 2.0, f"describe returned {describe(r)!r} for a report with three rows"
assert hasattr(r, "average")
assert Report([10]).average == 10.0
~~~

~~~solution
class Report:
    def __init__(self, rows):
        self.rows = rows

    @property
    def average(self):
        return sum(self.rows) / len(self.rows)


def describe(report):
    """Return the report's average, or a note when it has none."""
    if hasattr(report, "average"):
        return report.average
    return "no average available"
~~~

## A lookup table rebuilt on every read

`Dataset.index` builds a dict from id to row. It is a plain property, so every read builds the whole thing again.

@expect silent
@hint A property runs its body on every access. How many times does the test read `index`?
@hint `functools` from unit 17 has a decorator for a property computed once.
@diagnose silent It gives the right answer and builds it three times, once per read, which the test counted by watching how often the rows were walked. `functools.cached_property` runs the body on the first access, stores the result in the instance `__dict__` under the same name, and every later access finds it there instead. That works because of the lookup order in this unit's note: `cached_property` is a non-data descriptor, so step 2, the instance dict, wins over it, which is exactly what a plain `property` refuses to allow. The price is that it never invalidates, so it belongs on a value derived from state that will not change, and the instance needs a `__dict__`, which rules out `__slots__`.

~~~starter
class Dataset:
    def __init__(self, rows):
        self.rows = rows

    @property
    def index(self):
        """Maps each row's id to the row itself."""
        return {row["id"]: row for row in self.rows}
~~~

~~~tests
class Watched(list):
    """A list that records how often something walked it."""

    walks = 0

    def __iter__(self):
        Watched.walks += 1
        return list.__iter__(self)


d = Dataset(Watched([{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]))
assert d.index[1]["name"] == "a"
assert d.index[2]["name"] == "b"
assert d.index[1]["name"] == "a"
assert Watched.walks == 1, (
    f"the rows were walked {Watched.walks} times to build one lookup table"
)
~~~

~~~solution
from functools import cached_property


class Dataset:
    def __init__(self, rows):
        self.rows = rows

    @cached_property
    def index(self):
        """Maps each row's id to the row itself."""
        return {row["id"]: row for row in self.rows}
~~~
