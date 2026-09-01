---
slug: 18-classes
---

## A class body
- (x) Runs once, at import, and its names become the class's `__dict__`
- ( ) Runs each time an instance is made
- ( ) Is only a declaration and does not execute
- ( ) Runs when a method is first called
> Which is the whole explanation for a shared mutable class attribute.

## Which method creates the object?
- ( ) `__init__`
- (x) `__new__`
- ( ) `__call__`
- ( ) `__create__`
> `__init__` receives the already-made object as `self` and sets it up, which is why it is an initialiser rather than a constructor.

## `__init__` returning a value
- ( ) Is how you return the instance
- (x) Raises TypeError; it must return None
- ( ) Is ignored
- ( ) Replaces the instance
> Enforced rather than ignored, which is worth being glad about: a returned `self` would look like it worked.

## Reading `self.x` looks
- (x) In the instance first, then the class
- ( ) In the class first, then the instance
- ( ) Only in the instance
- ( ) In the module namespace
> And writing `self.x` always goes to the instance, which is the asymmetry every surprise in this unit comes from.

## `self.count += 1` where `count` is a class attribute
- ( ) Increments the class attribute
- (x) Reads the class's value and writes a new instance attribute
- ( ) Raises AttributeError
- ( ) Increments both
> Name the class to change the class's: `Widget.count += 1`.

## `self.items.append(x)` where `items` is a class attribute
- ( ) Creates an instance attribute
- (x) Mutates the one shared list, because a read finds the class's
- ( ) Raises
- ( ) Copies the list first
> Assignment shadows; mutation does not. Per-instance state has to be created in `__init__`.

## `p.method` where `method` is defined in the class gives
- ( ) The plain function
- (x) A bound method, with the instance already supplied as the first argument
- ( ) A copy of the function
- ( ) An error unless called
> `Point.method` gives the plain function, which is why calling it on the class needs an explicit instance.

## An alternative constructor should be a
- ( ) `staticmethod`
- (x) `classmethod`, so `cls(...)` builds whatever class it was called on
- ( ) plain method
- ( ) module function
> A `staticmethod` has to name a class, and the name it picks is wrong for every subclass.

## A `staticmethod` receives
- ( ) The instance
- ( ) The class
- (x) Nothing extra
- ( ) The metaclass
> If nothing outside the class would ever want it, a `staticmethod` says so; otherwise a module function is simpler.

## Two instances with the same attribute values, and no `__eq__`
- ( ) Compare equal
- (x) Compare unequal, because the default compares identity
- ( ) Raise TypeError
- ( ) Compare equal only if hashable
> Right for things with an identity; wrong for things that are values.

## An instance's `__dict__` holds
- (x) Only what was assigned to `self`
- ( ) Its methods too
- ( ) Everything inherited
- ( ) The class attributes as well
> `dir(p)` is the one that lists everything reachable, including inherited names.

## `type(Point)` where `Point` is a class is
- ( ) `object`
- (x) `type`
- ( ) `Point`
- ( ) `class`
> A class is an object made by a class, which is unit 27's subject.

## A double leading underscore, `__total`, gives you
- ( ) Privacy
- (x) Name mangling, to stop a subclass colliding with a base class's attribute
- ( ) A read-only attribute
- ( ) A class attribute
> Python has no private attributes. A single underscore is a message to a reader and nothing more.

## `__new__` that returns nothing gives you
- ( ) An empty instance
- (x) `None` from calling the class, with no complaint at the mistake
- ( ) A TypeError
- ( ) The class itself
> And `__init__` is only called when what came back is an instance of the class.

## A class whose every method takes the same arguments and stores nothing is
- ( ) Well designed
- (x) A set of functions wearing a costume
- ( ) A singleton
- ( ) A dataclass
> If there is no state several functions share, a module of functions is simpler.
