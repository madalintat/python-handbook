---
slug: 19-attributes
---

## `p.x` is shorthand for
- (x) `type(p).__getattribute__(p, "x")`
- ( ) `p.__dict__["x"]`
- ( ) `type(p).__dict__["x"]`
- ( ) `p.__getattr__("x")`
> Every attribute access in the language goes through that one method.

## `__getattr__` is called
- ( ) On every attribute access
- (x) Only after the normal lookup has already failed
- ( ) Only for names starting with an underscore
- ( ) Before `__getattribute__`
> Which is why a class that defines it keeps working normally for names it does have.

## `__getattribute__` is called
- (x) On every attribute access, methods included
- ( ) Only when the name is missing
- ( ) Only for class attributes
- ( ) Only when `__getattr__` is absent
> Override it and you own everything, including the parts that were fine.

## `vars(p)` gives you
- (x) `p.__dict__`, holding only what was assigned to `self`
- ( ) Everything reachable on `p`, inherited names included
- ( ) The class's attributes
- ( ) The local variables of the last method called
> `dir(p)` is the one that walks the class and its bases.

## A data descriptor on the class, against an entry in the instance dict
- (x) The descriptor wins
- ( ) The instance dict wins
- ( ) Whichever was set last
- ( ) Raises `AttributeError`
> Which is how a `property` intercepts a read even when the instance dict has that name.

## `getattr(p, "x", 0)`
- (x) Returns `0` instead of raising when `x` is missing
- ( ) Sets `x` to `0`
- ( ) Raises unless `x` is `0`
- ( ) Is the same as `p.x or 0`
> And it is clearer than `hasattr` followed by an access, as well as shorter.

## `hasattr(obj, "name")` returns `False` when
- ( ) The attribute is missing
- (x) Anything in the lookup raises `AttributeError`, the attribute's own body included
- ( ) The attribute is `None`
- ( ) The attribute is falsy
> Which is how a typo inside a property gets reported to the caller as "not there".

## A setter for `x` that assigns `self.x`
- ( ) Stores the value
- (x) Calls itself until the stack runs out
- ( ) Raises `AttributeError`
- ( ) Bypasses the property
> The stored value needs its own name, conventionally `self._x`.

## `@area.setter` works because
- (x) `area` is already a property object, and `.setter` returns a new one with the setter attached
- ( ) `setter` is a keyword
- ( ) Python matches decorators by name
- ( ) The getter and setter are the same function
> Which is why the name is repeated and why the getter has to come first.

## A property with a getter and no setter gives you
- (x) A read-only attribute; assigning raises `AttributeError`
- ( ) A writable attribute
- ( ) A class attribute
- ( ) A slot
> The cheapest way to say "derived, do not assign".

## The best argument for starting with a plain attribute
- ( ) Properties are slow
- (x) A plain attribute can become a property later without changing a single call site
- ( ) Properties cannot be inherited
- ( ) Plain attributes are private
> Which is why translating Java-style getter and setter pairs into properties is wasted work.

## `functools.cached_property` stores its result
- (x) In the instance `__dict__`, under the same name, where later reads find it first
- ( ) In a module-level dict keyed by the instance
- ( ) On the class
- ( ) Nowhere; it recomputes
> A non-data descriptor, so the instance dict wins over it. That is the whole mechanism.

## `__slots__` buys you
- (x) Less memory per instance, and an error instead of a silent typo
- ( ) Private attributes
- ( ) Immutable instances
- ( ) Type checking
> A memory optimisation, so it earns its place when the objects are many and small.

## A subclass of a slotted class that declares no `__slots__`
- ( ) Inherits the restriction
- (x) Gets a `__dict__` back, and with it the memory and the typos
- ( ) Fails at class creation
- ( ) Shares the base class's slots
> Every class in the hierarchy has to say so, and each lists only what it adds.

## Inside `__setattr__`, storing a value
- ( ) `self.name = value`
- (x) `object.__setattr__(self, name, value)`
- ( ) `self.__setattr__(name, value)`
- ( ) `setattr(self, name, value)`
> `self.__dict__[name] = value` also works, until the class uses `__slots__` and has no dict.
