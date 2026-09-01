---
slug: 21-mro
---

## The class that reached up instead of along

`Bold.render` names its base class directly. In a diamond that skips whatever the MRO put between them, so `Italic` never runs.

@expect silent
@hint `Formatter.render(self, text)` calls exactly that class. What does the MRO say comes next?
@hint Print `Fancy.__mro__` and read where `Bold` sits.
@diagnose silent It runs, and the italics are gone. `Formatter.render(self, text)` calls that class and no other, which skips everything the MRO placed between `Bold` and `Formatter`. `Fancy.__mro__` is `(Fancy, Bold, Italic, Formatter, object)`, so the class after `Bold` is `Italic`, a class `Bold` does not inherit from and whose author it has never heard of. That is exactly what `super()` is for: it means "then whatever comes next", and the answer is decided when `Fancy` is created, long after `Bold` was written. Naming a base directly is right only when you specifically mean "not the next one, this one", which is rare enough to be worth a comment when you do it.

~~~starter
class Formatter:
    def render(self, text):
        return text


class Bold(Formatter):
    def render(self, text):
        return "**" + Formatter.render(self, text) + "**"


class Italic(Formatter):
    def render(self, text):
        return "_" + super().render(text) + "_"


class Fancy(Bold, Italic):
    pass
~~~

~~~tests
assert Italic().render("hi") == "_hi_"
assert Bold().render("hi") == "**hi**"
assert Fancy().render("hi") == "**_hi_**", f"Fancy rendered {Fancy().render('hi')!r}"
~~~

~~~solution
class Formatter:
    def render(self, text):
        return text


class Bold(Formatter):
    def render(self, text):
        return "**" + super().render(text) + "**"


class Italic(Formatter):
    def render(self, text):
        return "_" + super().render(text) + "_"


class Fancy(Bold, Italic):
    pass
~~~

## The link that ended the chain

`Timestamped.__init__` sets its own attribute and stops. Every class after it in the MRO is skipped, and nothing says so.

@expect raises:AttributeError
@hint A cooperative chain runs because each class passes control along. What happens when one does not?
@hint The error names an attribute. Which class was supposed to set it?
@diagnose AttributeError `Note.__init__` handed off to `Timestamped.__init__`, which set `created_at` and returned without calling `super()`, so `Tagged.__init__` never ran and `tags` was never set. Nothing raised at the point of the mistake; the failure arrives later, at the first read, which is why the missing `super()` call is often several files away from the traceback. The rule is unconditional: every class in a cooperative chain calls `super()`, including the ones that look like leaves, because a class that is a leaf today is in the middle of somebody's MRO tomorrow.

~~~starter
class Timestamped:
    def __init__(self, created_at="now", **kwargs):
        self.created_at = created_at


class Tagged:
    def __init__(self, tags=(), **kwargs):
        super().__init__(**kwargs)
        self.tags = list(tags)


class Note(Timestamped, Tagged):
    def __init__(self, text, **kwargs):
        super().__init__(**kwargs)
        self.text = text
~~~

~~~tests
n = Note("hi", tags=["urgent"])
assert n.text == "hi"
assert n.created_at == "now"
assert n.tags == ["urgent"]
~~~

~~~solution
class Timestamped:
    def __init__(self, created_at="now", **kwargs):
        super().__init__(**kwargs)
        self.created_at = created_at


class Tagged:
    def __init__(self, tags=(), **kwargs):
        super().__init__(**kwargs)
        self.tags = list(tags)


class Note(Timestamped, Tagged):
    def __init__(self, text, **kwargs):
        super().__init__(**kwargs)
        self.text = text
~~~

## An order that cannot exist

`Record` lists a base class alongside one of that class's own subclasses. No ordering satisfies both rules, so Python refuses to create the class.

@expect raises:TypeError
@expect mypy:misc
@hint A class must come before its bases, and the order the bases were written in is preserved. Check both against this list.
@hint One of the two bases already brings the other.
@diagnose misc mypy runs C3 itself and refuses the class for the same reason the interpreter does, which means this one never has to reach a run to be caught. It is a small demonstration of what a type checker is for: the mistake is in the shape of the code, not in any value, so it can be found without executing anything.
@diagnose TypeError `Record(Base, Timestamped)` demands `Base` before `Timestamped`, because that is the order they were written in. But `Timestamped` is a subclass of `Base`, and a class always comes before its bases, so `Timestamped` must come first. The two requirements contradict each other and C3 refuses rather than picking one, which is the right call: a hierarchy whose lookup order depends on which rule the interpreter happens to prefer is one nobody can reason about. Nearly every real occurrence of this error is this exact mistake, and the fix is to drop the redundant base, which was contributing nothing because inheriting from `Timestamped` already brings `Base`.

~~~starter
class Base:
    def describe(self):
        return "base"


class Timestamped(Base):
    def describe(self):
        return "timestamped " + super().describe()


class Record(Base, Timestamped):
    pass
~~~

~~~tests
r = Record()
assert r.describe() == "timestamped base"
assert Record.__mro__ == (Record, Timestamped, Base, object)
~~~

~~~solution
class Base:
    def describe(self):
        return "base"


class Timestamped(Base):
    def describe(self):
        return "timestamped " + super().describe()


class Record(Timestamped):
    pass
~~~

## The keyword that reached the end of the line

`Timestamped` takes its own keyword and forwards it as well as consuming it. The last `super().__init__` in the chain is `object`'s, which accepts nothing.

@expect raises:TypeError
@hint Read the error: which class complained, and about which argument?
@hint A class in a cooperative chain takes its keyword **out** before passing the rest along.
@diagnose TypeError The chain ends at `object.__init__`, which takes no arguments, and `created_at` was still in the dict when it got there. The whole point of the `**kwargs` convention is that each class removes what it recognises and forwards only the remainder, so that the dict is empty by the time it reaches `object`. `created_at` arrives as a named parameter, which already takes it out of `kwargs`; putting it back in the forwarded call means nobody ever consumes it. Reading `object`'s complaint as "somebody forwarded something nobody wanted" makes this error much faster to place than it first looks.

~~~starter
class Timestamped:
    def __init__(self, created_at="now", **kwargs):
        super().__init__(created_at=created_at, **kwargs)
        self.created_at = created_at


class Note(Timestamped):
    def __init__(self, text, **kwargs):
        super().__init__(**kwargs)
        self.text = text
~~~

~~~tests
n = Note("hi", created_at="today")
assert (n.text, n.created_at) == ("hi", "today")
assert Note("hi").created_at == "now"
~~~

~~~solution
class Timestamped:
    def __init__(self, created_at="now", **kwargs):
        super().__init__(**kwargs)
        self.created_at = created_at


class Note(Timestamped):
    def __init__(self, text, **kwargs):
        super().__init__(**kwargs)
        self.text = text
~~~

## An argument that landed in the wrong mixin

The mixins accept their arguments positionally. A caller who passes one positionally has no way to know which class in the MRO will catch it.

@expect silent
@hint Which class is first in the MRO, and which parameter of it does a stray positional argument fill?
@hint A `*` in a signature makes everything after it keyword only.
@diagnose silent Nothing raised, and a list of tags was stored as a timestamp. `Timestamped` comes first in `Note.__mro__`, so the forwarded positional argument filled `created_at`, and `tags` kept its default. Nothing in the chain could detect this, because every class received exactly the number of arguments it declared. Mixin parameters should be keyword only, which is what the bare `*` in a signature declares: it makes a positional call fail loudly at the boundary instead of quietly assigning to whichever class happened to be first. This is a general habit worth forming for any function whose arguments are configuration rather than subject matter, and it is close to mandatory once an MRO decides who catches what.

~~~starter
class Timestamped:
    def __init__(self, created_at=None, **kwargs):
        super().__init__(**kwargs)
        self.created_at = created_at


class Tagged:
    def __init__(self, tags=(), **kwargs):
        super().__init__(**kwargs)
        self.tags = list(tags)


class Note(Timestamped, Tagged):
    def __init__(self, text, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.text = text
~~~

~~~tests
n = Note("hi", tags=["urgent"])
assert n.tags == ["urgent"]
assert n.created_at is None

try:
    Note("hi", ["urgent"])
except TypeError:
    pass
else:
    stray = Note("hi", ["urgent"])
    raise AssertionError(
        f"a positional argument was accepted, and landed in created_at as {stray.created_at!r}"
    )
~~~

~~~solution
class Timestamped:
    def __init__(self, *, created_at=None, **kwargs):
        super().__init__(**kwargs)
        self.created_at = created_at


class Tagged:
    def __init__(self, *, tags=(), **kwargs):
        super().__init__(**kwargs)
        self.tags = list(tags)


class Note(Timestamped, Tagged):
    def __init__(self, text, **kwargs):
        super().__init__(**kwargs)
        self.text = text
~~~

## A contract that was only a comment

`Shape.area` raises to say "subclasses must write this". An incomplete subclass is created and constructed happily, and only fails when something calls the method.

@expect silent
@hint `abc.ABC` and `@abstractmethod` move the complaint from the first call to the construction.
@hint The test tries to build the incomplete subclass and expects that to fail.
@diagnose silent The incomplete subclass was created, instantiated and passed around, and would only have failed at whatever line first called `area`, which may be nowhere near the class that forgot it. Raising `NotImplementedError` documents the contract but does not enforce it. `abc.ABC` with `@abstractmethod` refuses to instantiate any subclass that has not supplied every abstract method, and the error names all of them at once: the mistake is caught at construction, by the code that made the object, with a message that says what is missing. Reach for it when a base class is genuinely a contract several implementations must meet; skip it when the base has real behaviour and subclasses merely extend it.

~~~starter
class Shape:
    def area(self):
        raise NotImplementedError("subclasses must implement area")

    def describe(self):
        return f"area {self.area()}"


class Square(Shape):
    def __init__(self, side):
        self.side = side

    def area(self):
        return self.side**2


class Blob(Shape):
    pass
~~~

~~~tests
assert Square(3).describe() == "area 9"

try:
    Blob()
except TypeError as exc:
    assert "area" in str(exc), f"the error should name the missing method: {exc}"
else:
    raise AssertionError("a shape with no area was constructed without complaint")
~~~

~~~solution
from abc import ABC, abstractmethod


class Shape(ABC):
    @abstractmethod
    def area(self):
        """Subclasses must implement this."""

    def describe(self):
        return f"area {self.area()}"


class Square(Shape):
    def __init__(self, side):
        self.side = side

    def area(self):
        return self.side**2


class Blob(Shape):
    pass
~~~

## Starting the search too far along

`Leaf.describe` spells `super()` out with an explicit class. It names the wrong one, so the search starts after `Middle` and `Middle` is skipped.

@expect silent
@hint `super(X, self)` starts searching **after** `X`. Which class should it start after here?
@hint The zero-argument form fills both in for you, and cannot pick the wrong one.
@diagnose silent It runs, and the middle of the chain is missing from the answer. `super(X, self)` begins the search at the class after `X` in the MRO, so naming `Middle` inside `Middle`'s own subclass skips `Middle` itself. The zero-argument `super()` is compiled with a hidden reference to the class the method was defined in, which is the only answer that is ever right here, and it survives renaming the class. The explicit form still has uses, outside a class body or when you deliberately want to start further along, but inside a method it is duplication waiting to drift.

~~~starter
class Base:
    def describe(self):
        return "base"


class Middle(Base):
    def describe(self):
        return "middle then " + super().describe()


class Leaf(Middle):
    def describe(self):
        return "leaf then " + super(Middle, self).describe()
~~~

~~~tests
assert Middle().describe() == "middle then base"
assert Leaf().describe() == "leaf then middle then base", (
    f"Leaf described itself as {Leaf().describe()!r}"
)
~~~

~~~solution
class Base:
    def describe(self):
        return "base"


class Middle(Base):
    def describe(self):
        return "middle then " + super().describe()


class Leaf(Middle):
    def describe(self):
        return "leaf then " + super().describe()
~~~

## `super()` with nothing to go on

`Loader.load` calls `super()` from inside a nested function. The zero-argument form needs the enclosing method's first parameter, and a nested function does not have one.

@expect raises:TypeError
@hint The zero-argument form reads the instance from the enclosing function's first parameter. Which function is `super()` in, and what is *its* first parameter?
@hint Look the bound method up once, in the method itself, and close over it.
@diagnose TypeError Read the message closely, because it describes the mechanism exactly: `obj (instance of str) is not an instance or subtype of type (Loader)`. The zero-argument `super()` is compiled into `super(__class__, <first parameter>)`, where `__class__` is a hidden reference to the class the code was written in. It found `Loader` correctly. What it read as the instance was `one`'s first parameter, which is `name`, a string. So the failure is not that `super()` had nothing to go on; it is that a nested function's first parameter is not `self` and nothing checks that before the call. The fix is to look the method up once, outside the nested function, and close over the result. Naming the class explicitly, `super(Loader, self).parse(name)`, works too, and brings back the duplication the zero-argument form exists to remove.

~~~starter
class Base:
    def parse(self, name):
        return name.strip().lower()


class Loader(Base):
    def load(self, names):
        def one(name):
            return "loaded:" + super().parse(name)

        return [one(n) for n in names]
~~~

~~~tests
assert Loader().load([" A ", "B"]) == ["loaded:a", "loaded:b"]
assert Loader().load([]) == []
~~~

~~~solution
class Base:
    def parse(self, name):
        return name.strip().lower()


class Loader(Base):
    def load(self, names):
        parse = super().parse

        def one(name):
            return "loaded:" + parse(name)

        return [one(n) for n in names]
~~~
