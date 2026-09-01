---
slug: 19-attributes
title: Attribute access
---

Unit 18 said that a read of `self.x` checks the instance and then the class, and that a write always goes to the instance. That is the useful summary, and it is not the whole rule. The whole rule is a method, `__getattribute__`, that runs on every single attribute access in the language, and once you can see it, `property`, `__slots__`, methods, `classmethod` and half of what looks like magic stop being magic.

## Where attributes actually live

An instance keeps its attributes in a dict:

```python
class Point:
    kind = "2d"

    def __init__(self, x, y):
        self.x = x
        self.y = y


p = Point(1, 2)
p.__dict__          # {'x': 1, 'y': 2}
Point.__dict__      # kind, __init__, __dict__, __weakref__, ...
```

Two dicts, and the instance's holds only what was assigned to `self`. `kind` and `__init__` are on the class, which is why every point shares them and why there is one copy rather than a million. `dir(p)` is the one that lists everything reachable, walking the class and its bases; `vars(p)` is `p.__dict__`.

That is also why attribute names are strings, and why `getattr(p, "x")` is the same operation as `p.x` written out longhand. `getattr`, `setattr`, `hasattr` and `delattr` all take the name as a string, which is what you reach for when the name is computed:

```python
for field in ("x", "y"):
    print(field, getattr(p, field))
```

If you ever find yourself writing `eval("p." + field)`, this is the function you wanted.

The instance dict is an ordinary dict, which has a consequence worth stating plainly: two objects of the same class can carry different attributes. Nothing declares the set of fields a `Point` has. `__init__` merely happens to assign two of them, and a later `p.z = 3` is legal and creates a third on that one point. Coming from a language where a class fixes its layout, this is the surprise, and it is why a typo in an assignment is silent by default rather than an error. `__slots__`, later in this unit, is the opt-in that takes the flexibility back in exchange for the check.

## The full lookup order

When you write `p.x`, Python calls `type(p).__getattribute__(p, "x")`, and the default implementation on `object` does roughly this:

1. Look for `x` in `type(p)` and its bases. If what it finds is a **data descriptor** (an object with both `__get__` and `__set__`), use it, and stop.
2. Look in `p.__dict__`. If `x` is there, return it, and stop.
3. Fall back to what step 1 found on the class: a non-data descriptor, such as a function, or a plain class attribute.
4. If nothing was found, call `type(p).__getattr__(p, "x")` if the class defines one.
5. Otherwise raise `AttributeError`.

Steps 2 and 3 are unit 18's summary. Step 1 is the part that surprises people: a data descriptor on the class beats the instance dict. That is precisely how a `property` can intercept `p.x` even though `p.__dict__` might contain an `x`. Unit 20 is about that protocol; this unit is about living with the consequences.

Step 4 is the other one worth holding onto. `__getattr__` is a **fallback**, called only when the normal lookup has already failed. `__getattribute__` is the whole lookup, called on every access, including the ones that would have succeeded. Writing `__getattribute__` when you meant `__getattr__` is how you break a class comprehensively in three lines: every method access goes through your code too, and if you forget to defer to `object.__getattribute__`, nothing works at all.

## `property`, and when it earns its place

A `property` turns attribute access into a method call while leaving the syntax alone:

```python
class Circle:
    def __init__(self, radius):
        self.radius = radius

    @property
    def area(self):
        return math.pi * self.radius**2
```

`c.area` runs the function. There are no parentheses, and there is deliberately no way for a caller to tell that `area` is computed rather than stored, which is the entire point.

That last sentence is also the rule for when to use one. Do not write a property for every attribute, and never translate a Java-style `get_name`/`set_name` pair mechanically into one. Python has no privacy to protect and a plain attribute is a complete, respectable public interface. Reach for a property when one of these is true:

- The value is **derived** from other state, and storing it would create two sources of truth that can disagree.
- A plain attribute needs to **grow behaviour** later, validation, a cached lookup, a deprecation warning, and you want to add it without changing a single call site. This is the argument that matters, because it means starting with the plain attribute is safe. You are never forced to guess up front.
- The value should be **read-only**, which a property with no setter gives you.

A setter is a separate decorator naming the property:

```python
    @area.setter
    def area(self, value):
        self.radius = math.sqrt(value / math.pi)
```

Note what `@area.setter` means: it takes the existing property object and returns a new one with the setter attached, which is why the name is repeated and why the getter must come first.

The classic bug lives here. A setter for `x` that assigns `self.x` calls itself, forever, because the assignment goes through the same property. The backing attribute needs a different name, conventionally `self._x`. The single underscore is a note to a reader that this is not part of the interface, and nothing more; unit 18 covered what Python does and does not enforce.

`functools.cached_property` is the variant worth knowing from unit 17's module. It computes once, stores the result in the instance `__dict__` under the same name, and every later access finds it at step 2 above and never calls the function again. It is a non-data descriptor, which is exactly why the instance dict can win. The cost is that it never invalidates, so it belongs on values derived from state that does not change.

## `__slots__`

Every instance carrying a dict is flexible and not free. `__slots__` replaces that dict with a fixed array of named fields:

```python
class Point:
    __slots__ = ("x", "y")
```

Instances now have no `__dict__`, use noticeably less memory, and are a little faster to read. Assigning any name not in the list raises `AttributeError` instead of silently creating it, which turns a typo from a lingering mystery into an immediate error.

Three things to know before reaching for it. It is a memory optimisation, so it earns its place when you have a great many small objects and not otherwise. A subclass that does not declare `__slots__` of its own quietly gets a `__dict__` back, and with it the memory and the typos, so the guarantee does not inherit. And a name in `__slots__` cannot also be a class attribute, because the slot and the attribute would occupy the same entry on the class; Python refuses at class creation rather than later.

## The write side

Writes have their own hook, and it has no fallback twin. `__setattr__` is called on **every** assignment to an attribute, whether or not the name already exists, so there is no `__setattr__` equivalent of `__getattr__`'s "only when it failed" behaviour. That single fact is the whole reason it is easy to get wrong:

```python
class Frozen:
    def __setattr__(self, name, value):
        if hasattr(self, name):
            raise AttributeError(f"{name} is already set")
        self.__dict__[name] = value        # not self.name = value
```

Writing `self.name = value` inside `__setattr__` calls `__setattr__`, which calls it again, until the stack runs out. The way through is to write to the underlying storage directly, either `self.__dict__[name] = value` or `object.__setattr__(self, name, value)`. The second is the better habit, because it still works when the class uses `__slots__` and therefore has no `__dict__` to write into.

`__delattr__` is the same story for `del obj.x`, with the same recursion available if you write `del self.x` inside it.

The property setter bug from earlier in this unit is this bug wearing a different hat: in both cases an assignment inside the code that handles assignments routes straight back to itself. Recognising the shape is worth more than remembering the two fixes, because it shows up again in `__getattribute__`, in `__eq__` written in terms of `==`, and in any dunder implemented using the syntax it defines.

Deleting attributes deserves one note of its own. `del p.x` removes the name from the instance dict, and a subsequent read then falls through to the class, so deleting an instance attribute can uncover a class attribute rather than making the name go away. It is unit 18's shadowing rule running backwards, and it is occasionally what you want and more often a surprise.

## `hasattr` is a `try` in disguise

`hasattr(obj, "name")` calls `getattr` and returns `False` if it raises `AttributeError`. That is fine for a plain attribute and a trap for a property: if the property's own body raises `AttributeError` because of a bug inside it, `hasattr` reports `False` and the caller takes the "not there" branch on a value that is very much there. The failure is invisible, and it survives review because the calling code reads correctly.

Two habits avoid it. Prefer `getattr(obj, "name", default)` when you want a default, which is clearer about intent and just as short. And when you genuinely need to ask whether something exists, keep the property's body from raising `AttributeError` for reasons of its own.

## The shape of this unit

Almost everything here is a way of intervening in a read or a write that used to be plain. That power is worth using sparingly, because every intervention makes `obj.x` mean something a reader cannot see. Start with plain attributes. Add a property when the value is derived or needs to become derived. Add `__slots__` when the object count justifies it. Reach for `__getattr__` for genuine dynamic proxying, and for `__getattribute__` almost never.

The dynamic cases are real, though, and worth recognising so you know when the rule bends. A wrapper that forwards unknown attributes to something it holds is `__getattr__` in three lines and would be a hundred written out. A module that defers an expensive import until somebody actually touches the name it provides uses the module-level version of the same hook. A settings object backed by a mapping reads better as `config.timeout` than `config["timeout"]`, and `__getattr__` is how you get there. What these share is that the set of names genuinely is not known when the class is written. When you do know the names, write them down: an attribute a reader can find by searching for it beats one conjured at runtime, every time.
