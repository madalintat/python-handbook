---
slug: 27-metaclasses
---

## The base class that registered itself

`Registry` records every class it creates. It creates the base class too, so the registry holds an entry for the abstract thing nobody meant to register.

@expect silent
@hint The base class is created by this metaclass as well. What distinguishes it from its subclasses?
@hint Look at `bases` for the base class itself.
@diagnose silent It runs, and the registry holds three entries where two were meant. `Plugin` is created by `Registry` like everything else, with an empty `bases` tuple, because it inherits from nothing. `if bases:` is the standard guard for exactly this, and every registry built with a metaclass or with `__init_subclass__` needs some version of it. The bug is quiet until something iterates the registry and tries to use the abstract base as though it were an implementation, which is usually a long way from here.

~~~starter
REGISTRY: dict[str, type] = {}


class Registry(type):
    def __new__(mcls, name, bases, namespace, **kwargs):
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        REGISTRY[name] = cls
        return cls


class Plugin(metaclass=Registry):
    def run(self):
        raise NotImplementedError


class Csv(Plugin):
    def run(self):
        return "csv"


class Json(Plugin):
    def run(self):
        return "json"
~~~

~~~tests
assert sorted(REGISTRY) == ["Csv", "Json"], f"the registry holds {sorted(REGISTRY)}"
assert REGISTRY["Csv"]().run() == "csv"
~~~

~~~solution
REGISTRY: dict[str, type] = {}


class Registry(type):
    def __new__(mcls, name, bases, namespace, **kwargs):
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if bases:
            REGISTRY[name] = cls
        return cls


class Plugin(metaclass=Registry):
    def run(self):
        raise NotImplementedError


class Csv(Plugin):
    def run(self):
        return "csv"


class Json(Plugin):
    def run(self):
        return "json"
~~~

## A metaclass that never returned the class

`Registry.__new__` builds the class and registers it, and does not hand it back. `__new__` returns the object, one level up from unit 18.

@expect raises:TypeError
@hint This is unit 18's `__new__` bug, applied to a class instead of an instance.
@hint What does the `class` statement bind the name to?
@diagnose TypeError `__new__` returned `None`, so the `class` statement bound `Csv` to `None`, and subclassing `None` fails at the next class body. It is the same rule as unit 18: `__new__` makes the object and must return it, and here the object being made is a class. The whole of this unit is that identity, so a bug that looked specific to instances turns out to apply verbatim one level up. A metaclass's `__new__` almost always ends in `return cls` for exactly this reason, and the version that assigns to a local and forgets the last line is the version that gets written.

~~~starter
REGISTRY: dict[str, type] = {}


class Registry(type):
    def __new__(mcls, name, bases, namespace, **kwargs):
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if bases:
            REGISTRY[name] = cls


class Plugin(metaclass=Registry):
    pass


class Csv(Plugin):
    def run(self):
        return "csv"
~~~

~~~tests
assert REGISTRY["Csv"] is Csv
assert Csv().run() == "csv"
assert isinstance(Csv, Registry)
~~~

~~~solution
REGISTRY: dict[str, type] = {}


class Registry(type):
    def __new__(mcls, name, bases, namespace, **kwargs):
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if bases:
            REGISTRY[name] = cls
        return cls


class Plugin(metaclass=Registry):
    pass


class Csv(Plugin):
    def run(self):
        return "csv"
~~~

## A decorator that does not reach the subclasses

`@register` is a class decorator, so it applies to the class it is written on and nothing else. The subclasses were expected to register themselves and do not.

@expect silent
@hint A decorator decorates one class. Which hook is called for every subclass?
@hint The hook lives on the parent and receives the new class.
@diagnose silent Nothing raised, and the registry holds only the class the decorator was written on. This is the whole of the difference between the three options in this unit: a class decorator applies to exactly one class, and `__init_subclass__` is called on the parent whenever any subclass is created, with the new class as `cls`. It is implicitly a classmethod, so no decorator is needed. Keyword arguments in the class statement, `class Csv(Plugin, name="csv")`, arrive as its keyword arguments, which is how a subclass configures its own registration without a metaclass anywhere.

~~~starter
REGISTRY: dict[str, type] = {}


def register(cls):
    REGISTRY[cls.__name__] = cls
    return cls


@register
class Plugin:
    pass


class Csv(Plugin):
    def run(self):
        return "csv"


class Json(Plugin):
    def run(self):
        return "json"
~~~

~~~tests
assert sorted(REGISTRY) == ["Csv", "Json"], f"the registry holds {sorted(REGISTRY)}"
assert REGISTRY["Json"]().run() == "json"
~~~

~~~solution
REGISTRY: dict[str, type] = {}


class Plugin:
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        REGISTRY[cls.__name__] = cls


class Csv(Plugin):
    def run(self):
        return "csv"


class Json(Plugin):
    def run(self):
        return "json"
~~~

## A keyword the class statement could not place

`Csv` passes `name="csv"` in its class statement. `__init_subclass__` does not accept it, so the keyword has nowhere to go.

@expect raises:TypeError
@expect mypy:call-arg
@hint Keyword arguments in a class statement are passed to `__init_subclass__`. Read its parameters.
@hint The hook should also pass what it does not recognise along.
@diagnose call-arg mypy reports an unexpected keyword argument for `__init_subclass__`, having matched the class statement's keywords against the hook's signature. It knows this rule, which is a small piece of evidence for how much of the language a checker models: a keyword in a class statement is a call it can check like any other.
@diagnose TypeError A keyword in a class statement, `class Csv(Plugin, name="csv")`, is handed to the parent's `__init_subclass__`, and this one declares no parameter for it. Adding `name=None` accepts it, and `**kwargs` forwarded to `super().__init_subclass__(**kwargs)` passes on anything meant for a class further up, which is the same cooperative rule unit 21 established for `__init__`. The `super()` call looks pointless when there is nothing above but `object`, and it is exactly the call whose absence breaks the chain the moment somebody adds a mixin.

~~~starter
REGISTRY: dict[str, type] = {}


class Plugin:
    def __init_subclass__(cls):
        REGISTRY[cls.__name__] = cls


class Csv(Plugin, name="csv"):
    def run(self):
        return "csv"
~~~

~~~tests
assert sorted(REGISTRY) == ["csv"], f"the registry holds {sorted(REGISTRY)}"
assert REGISTRY["csv"]().run() == "csv"
~~~

~~~solution
REGISTRY: dict[str, type] = {}


class Plugin:
    def __init_subclass__(cls, /, name=None, **kwargs):
        super().__init_subclass__(**kwargs)
        REGISTRY[name or cls.__name__] = cls


class Csv(Plugin, name="csv"):
    def run(self):
        return "csv"
~~~

## Two metaclasses, one slot

`Audited` and `Registered` are both metaclasses. A class trying to inherit from one of each has no single metaclass that satisfies both.

@expect raises:TypeError
@expect mypy:metaclass
@hint A class has exactly one metaclass, and it must be a subclass of every base's.
@hint The error names the requirement. Build something that meets it.
@diagnose metaclass mypy has a dedicated code for this, which tells you something about how often it happens. It computes the same rule the interpreter does and reports the conflict without running anything, so in a project with a checker in CI this one never reaches a person at run time.
@diagnose TypeError The message says the rule: the metaclass of a derived class must be a subclass of the metaclasses of all its bases, and neither `Audited` nor `Registered` is a subclass of the other. There is no clean fix. You write a third metaclass inheriting from both and hope they compose, which is what the solution does and which works here only because these two do not touch the same thing. When the metaclasses come from two libraries, they usually do, and then the answer is to stop using one of them. This is the practical reason the advice about metaclasses is so one-sided: a metaclass is a slot only one library can hold, and `__init_subclass__` costs nobody anything.

~~~starter
LOG: list[str] = []
REGISTRY: dict[str, type] = {}


class Audited(type):
    def __new__(mcls, name, bases, namespace, **kwargs):
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        LOG.append(name)
        return cls


class Registered(type):
    def __new__(mcls, name, bases, namespace, **kwargs):
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        REGISTRY[name] = cls
        return cls


class Loud(metaclass=Audited):
    pass


class Known(metaclass=Registered):
    pass


class Both(Loud, Known):
    pass
~~~

~~~tests
assert "Both" in LOG
assert REGISTRY["Both"] is Both
assert isinstance(Both, Audited)
assert isinstance(Both, Registered)
~~~

~~~solution
LOG: list[str] = []
REGISTRY: dict[str, type] = {}


class Audited(type):
    def __new__(mcls, name, bases, namespace, **kwargs):
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        LOG.append(name)
        return cls


class Registered(type):
    def __new__(mcls, name, bases, namespace, **kwargs):
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        REGISTRY[name] = cls
        return cls


class AuditedAndRegistered(Audited, Registered):
    pass


class Loud(metaclass=Audited):
    pass


class Known(metaclass=Registered):
    pass


class Both(Loud, Known, metaclass=AuditedAndRegistered):
    pass
~~~

## Building a class by hand

`make_shape` should produce a class at run time. It builds the pieces and never calls the thing that turns them into a class.

@expect raises:TypeError
@hint `type` with three arguments is what a `class` statement does.
@hint The name, the bases as a tuple, and the namespace as a dict.
@diagnose TypeError A dict is not a class, so subscripting the result and calling it went wrong. `type(name, bases, namespace)` is the three-argument form, and it is genuinely what a `class` statement compiles to: the body runs as code, the names it defined become a dict, and that dict is handed to `type` along with the name and the bases. Seeing it written out once is what makes the rest of this unit concrete, because a metaclass is nothing more than something other than `type` in that position. Note the bases must be a **tuple**: a list raises, and a single class without the trailing comma is not a tuple at all.

~~~starter
def make_shape(name, sides):
    """Build a shape class at run time."""
    namespace = {
        "sides": sides,
        "describe": lambda self: f"{name} has {self.sides} sides",
    }
    return namespace


Square = make_shape("Square", 4)
~~~

~~~tests
Triangle = make_shape("Triangle", 3)
assert Triangle().describe() == "Triangle has 3 sides"
assert Triangle.__name__ == "Triangle"
assert isinstance(Triangle, type)
assert Square().sides == 4
~~~

~~~solution
def make_shape(name, sides):
    """Build a shape class at run time."""
    namespace = {
        "sides": sides,
        "describe": lambda self: f"{name} has {self.sides} sides",
    }
    return type(name, (object,), namespace)


Square = make_shape("Square", 4)
~~~

## A check that ran too late to help

`Plugin` wants every subclass to define `run`. The check is written as a method on the base, so it only fires when somebody calls it.

@expect silent
@hint The failure should happen when the class is defined, not when it is used.
@hint Which hook runs at class creation and can see what the subclass defined?
@diagnose silent Nothing raised, and a plugin with no `run` was defined and instantiated without complaint. A check written as an ordinary method runs when called, which is too late to be useful: the mistake is in a class definition and the failure is wherever somebody first uses it. `__init_subclass__` runs when the subclass is created, with the new class as `cls`, so `"run" not in cls.__dict__` catches it at the `class` statement itself, naming the class that is wrong. Unit 21's `abc.ABCMeta` is the other answer and moves the failure to instantiation instead, which is later but still early enough, and is the right tool when a whole set of methods is required.

~~~starter
class Plugin:
    def check(self):
        if not hasattr(type(self), "run"):
            raise TypeError(f"{type(self).__name__} must define run")


class Csv(Plugin):
    def run(self):
        return "csv"


class Broken(Plugin):
    pass
~~~

~~~tests
assert Csv().run() == "csv"

try:
    class AlsoBroken(Plugin):
        pass
except TypeError as exc:
    assert "AlsoBroken" in str(exc), f"the error should name the class: {exc}"
else:
    raise AssertionError("a plugin with no run was defined without complaint")
~~~

~~~solution
class Plugin:
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if "run" not in cls.__dict__:
            raise TypeError(f"{cls.__name__} must define run")


class Csv(Plugin):
    def run(self):
        return "csv"
~~~

## Calling a class is a method call on its metaclass

`Single` should hand back one shared instance. It intervenes in the wrong place: instance creation is `type(Cls).__call__`, and the metaclass is where that lives.

@expect silent
@hint `Cls(...)` is `type(Cls).__call__(Cls, ...)`. Which class defines that?
@hint The metaclass has a `__call__` too, and it is the one that runs.
@diagnose silent Nothing raised, and every call produced a new instance, because `__call__` on the class defines what calling an *instance* does, not what calling the class does. `Cls(...)` is `type(Cls).__call__(Cls, ...)`, exactly the same rule unit 22 gave for every other operator, applied one level up: the lookup goes to the type, and the type of a class is its metaclass. Putting `__call__` on the metaclass is therefore how instantiation itself is intercepted, and it is the one thing `__init_subclass__` cannot reach, which is why `ABCMeta` and singleton patterns are genuinely metaclasses.

~~~starter
class Single(type):
    pass


class Connection(metaclass=Single):
    def __call__(cls, *args, **kwargs):
        if not hasattr(cls, "_instance"):
            cls._instance = super().__call__(*args, **kwargs)
        return cls._instance

    def __init__(self, host):
        self.host = host
~~~

~~~tests
a = Connection("localhost")
b = Connection("elsewhere")
assert a is b, "two calls produced two connections"
assert a.host == "localhost"
~~~

~~~solution
class Single(type):
    def __call__(cls, *args, **kwargs):
        if not hasattr(cls, "_instance"):
            cls._instance = super().__call__(*args, **kwargs)
        return cls._instance


class Connection(metaclass=Single):
    def __init__(self, host):
        self.host = host
~~~
