---
slug: 27-metaclasses
---

## `type(Point)` where `Point` is a class is
- (x) `type`, unless a metaclass was given
- ( ) `object`
- ( ) `Point`
- ( ) `class`
> A class is an object whose type is `type`, and `type` is a callable that makes them.

## `type("Point", (object,), {"x": 0})`
- (x) Creates a class, which is what a `class` statement compiles to
- ( ) Casts a dict to a class
- ( ) Raises; `type` takes one argument
- ( ) Creates an instance
> Name, bases as a tuple, namespace as a dict. The bases must be a tuple.

## A `class` statement
- (x) Runs the body as code, collects the names into a dict, and calls the metaclass with three arguments
- ( ) Is a declaration the compiler handles
- ( ) Builds the class lazily on first use
- ( ) Copies the base class
> Once that is concrete, `__init_subclass__`, `__set_name__` and every ORM stop being separate mysteries.

## The metaclass used is
- (x) Whatever `metaclass=` says, or the type of the first base, or `type`
- ( ) Always `type` unless declared
- ( ) Inherited from `object`
- ( ) Chosen by the MRO
> Which is why a subclass of an `Enum` gets `EnumMeta` without asking.

## `__init_subclass__` is called
- (x) On the parent, whenever a subclass is created, with the new class as `cls`
- ( ) On the subclass, when it is first instantiated
- ( ) By the metaclass author
- ( ) Once per module
> Implicitly a classmethod, so no decorator is needed.

## Keyword arguments in a class statement, `class Csv(Plugin, name="csv")`
- (x) Are passed to the parent's `__init_subclass__`
- ( ) Are passed to `__init__`
- ( ) Become class attributes
- ( ) Are a syntax error
> Which is how a subclass configures its own registration without a metaclass.

## A class decorator differs from `__init_subclass__` in that it
- (x) Applies to the class it is written on and not to subclasses
- ( ) Runs later
- ( ) Cannot modify the class
- ( ) Requires a metaclass
> That difference is the whole of how to choose between them.

## The order to try, from most visible to most powerful, is
- (x) Class decorator, then `__init_subclass__`, then a metaclass
- ( ) Metaclass, then `__init_subclass__`, then a decorator
- ( ) `__set_name__`, then a metaclass
- ( ) Whichever is shortest
> Each step gives up visibility for reach, and most code never leaves the first.

## A metaclass conflict happens when
- (x) A class inherits from bases whose metaclasses are unrelated
- ( ) Two classes use the same metaclass
- ( ) A metaclass defines `__call__`
- ( ) A metaclass has no `__new__`
> There is no clean fix, which is the practical reason the advice is so one-sided.

## `if bases:` in a metaclass's `__new__` exists to
- (x) Skip the base class, which this metaclass also creates
- ( ) Check for multiple inheritance
- ( ) Detect the MRO
- ( ) Avoid `object`
> Forgetting it gives a registry one entry too many that nobody notices until something iterates it.

## A metaclass's `__new__` that forgets to return
- (x) Binds the class name to `None`, exactly as unit 18's instance bug does
- ( ) Raises immediately
- ( ) Returns the namespace
- ( ) Returns the base class
> The same rule one level up, which is most of what this unit is.

## `Cls(...)` is
- (x) `type(Cls).__call__(Cls, ...)`, which is why instantiation is intercepted on the metaclass
- ( ) `Cls.__call__(...)`
- ( ) `Cls.__new__(Cls, ...)` directly
- ( ) A special form the interpreter handles
> Unit 22's rule, applied one level up. It is the one thing `__init_subclass__` cannot reach.

## `__prepare__` returns
- (x) The mapping the class body executes into, before any of it runs
- ( ) The finished namespace
- ( ) The bases
- ( ) The metaclass
> Still used for a namespace that acts on assignment, which is how `Enum` refuses duplicate names.

## A metaclass is genuinely right when
- (x) Something must happen before the class object exists, and you are writing the framework
- ( ) You want behaviour on every subclass
- ( ) You want to validate subclasses
- ( ) You want a registry
> The last three are `__init_subclass__`. `ABCMeta`, `EnumMeta` and a declarative ORM base are the first.

## When a class behaves in a way its own source does not explain, look at
- (x) `type(Cls)`
- ( ) `Cls.__mro__`
- ( ) `Cls.__dict__`
- ( ) `dir(Cls)`
> If it is anything but `type`, you have found where the behaviour lives.
