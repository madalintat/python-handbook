---
slug: 20-descriptors
---

## A descriptor is any object that defines
- (x) `__get__`, and optionally `__set__` and `__delete__`
- ( ) `__getattr__`
- ( ) `__getitem__`
- ( ) `__call__`
> Found on a class, Python calls it instead of handing it to you.

## In `__get__(self, obj, objtype)`, `obj` is
- (x) The instance the access came through, or `None` when it came through the class
- ( ) The descriptor
- ( ) The class
- ( ) The value being read
> Which is why `Thing.x` and `thing.x` can mean different things.

## A data descriptor is one that defines
- (x) `__set__` or `__delete__`, and it wins over the instance dict
- ( ) `__get__` only, and the instance dict wins over it
- ( ) `__set_name__`
- ( ) `__init__`
> One asymmetry, and it explains both `property` and `cached_property`.

## `cached_property` works because it is
- (x) A non-data descriptor, so the value it writes into the instance dict wins from then on
- ( ) A data descriptor with a cache inside it
- ( ) A class attribute
- ( ) A `property` with memoisation
> A `property` cannot cache itself this way, because defining `__set__` puts it ahead of the dict.

## A plain function stored on a class is
- (x) A non-data descriptor whose `__get__` returns a bound method
- ( ) A special case in the interpreter
- ( ) A data descriptor
- ( ) Not a descriptor at all
> Which is the entire mechanism behind `self`.

## `classmethod.__get__` differs from a function's in that it binds
- ( ) Nothing
- (x) `objtype` rather than `obj`
- ( ) Both
- ( ) The module
> One difference, and it is the whole reason `cls` is the class you called it on.

## `staticmethod.__get__` returns
- (x) The function, with nothing bound
- ( ) A method bound to the instance
- ( ) A method bound to the class
- ( ) The descriptor
> Which is why it takes no implicit first argument.

## Each name in `__slots__` becomes
- (x) A data descriptor on the class, reading and writing a fixed position
- ( ) An entry in the instance dict
- ( ) A property
- ( ) A type annotation
> Which is why slots beat the instance dict, and why there is no dict to beat.

## `__set_name__(self, owner, name)` is called
- (x) Once, by Python, when the class body finishes
- ( ) On every access
- ( ) On every assignment
- ( ) When the instance is created
> Which is how a descriptor learns the name it was bound to without being told twice.

## A descriptor assigned to an **instance** rather than a class
- ( ) Works the same way
- (x) Is an ordinary value; the protocol never fires
- ( ) Raises `TypeError`
- ( ) Shadows the class's
> The lookup searches the type for a descriptor and the instance dict for a value.

## `self.value = value` inside `__set__`
- ( ) Stores per instance
- (x) Stores one value shared by every instance of the owning class
- ( ) Raises
- ( ) Stores on the class
> The descriptor is created once in the class body. Unit 18's shared class attribute, with more ceremony.

## `setattr(obj, self.name, value)` inside `__set__`, where `name` is the bound name
- ( ) Writes to the instance dict
- (x) Calls `__set__` again, forever
- ( ) Writes to the class
- ( ) Raises `AttributeError`
> The third time this has come up: code that handles attribute access must not reach for the attribute it handles.

## `if obj is None: return self` at the top of `__get__`
- (x) Handles access through the class, and returning the descriptor is the useful answer
- ( ) Guards against uninitialised instances
- ( ) Is optional decoration
- ( ) Makes the descriptor read only
> It is what `property` does, and what lets tooling find the descriptor on the class.

## Leaving `__set__` out to make an attribute read only
- ( ) Works
- (x) Makes it overridable instead: an assignment writes past the descriptor into the instance dict
- ( ) Raises at class creation
- ( ) Makes it a data descriptor
> Refusing a write means defining `__set__` and raising from it.

## The best reason to write a descriptor rather than a property
- ( ) It is faster
- (x) The same rule applies to several attributes or several classes, and a property would repeat it
- ( ) Properties cannot validate
- ( ) Properties cannot be inherited
> At one field it is questionable. At two it starts paying.
