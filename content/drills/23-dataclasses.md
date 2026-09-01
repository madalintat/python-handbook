---
slug: 23-dataclasses
---

## `@dataclass` generates
- (x) `__init__`, `__repr__` and `__eq__` from the annotated fields
- ( ) Only `__init__`
- ( ) Getters and setters
- ( ) Type checking at run time
> Which is the majority of what units 18 through 22 taught you to write by hand.

## A class attribute with no annotation
- ( ) Becomes a field with that default
- (x) Is not a field at all, and never reaches `__init__`
- ( ) Raises at class creation
- ( ) Becomes a keyword-only field
> The decorator reads `__annotations__`, so the annotation is the declaration, not documentation.

## `x: float` on a dataclass field
- ( ) Rejects a string at run time
- (x) Names the field and nothing more; nothing checks the type when the object is built
- ( ) Converts the value to a float
- ( ) Is required for `__eq__`
> mypy will complain. The interpreter will not. This is the most common misunderstanding about dataclasses.

## A plain `@dataclass` is unhashable because
- (x) Generating `__eq__` sets `__hash__` to `None`, exactly as for a hand-written class
- ( ) Dataclasses cannot define `__hash__`
- ( ) Its fields might be unhashable
- ( ) It has no `__slots__`
> Correct rather than annoying: a mutable object's hash goes stale the moment a field changes.

## `frozen=True` gives you
- (x) Assignment that raises, and a `__hash__` derived from the fields
- ( ) A copy on every access
- ( ) `__slots__`
- ( ) Validation
> Worth being the default for anything that represents a value.

## `items: list[str] = []` on a dataclass
- ( ) Gives each instance its own list
- ( ) Shares one list between instances
- (x) Is refused at class creation, telling you to use `default_factory`
- ( ) Is a type error only
> The one construct in Python that catches unit 02's mutable default for you.

## `field(compare=False)` keeps the field out of
- (x) `__eq__` and the generated ordering
- ( ) `__repr__`
- ( ) `__init__`
- ( ) `__hash__` only
> What you want for an id, a cache or a timestamp. `repr=False` is its sibling.

## `order=True` compares
- (x) The fields as a tuple, in declaration order
- ( ) Alphabetically by field name
- ( ) By `__hash__`
- ( ) Only the first field
> So field order becomes sort order, which is a trap when the fields were written in the order they came to mind.

## Your own setup on a dataclass goes in
- (x) `__post_init__`, which runs after the generated `__init__`
- ( ) `__init__`, which you write alongside
- ( ) `__new__`
- ( ) A method you remember to call
> Validation and derived fields both live there.

## The way to "modify" a frozen dataclass is
- (x) `dataclasses.replace(obj, field=value)`, which makes a new one
- ( ) `object.__setattr__`
- ( ) `copy.deepcopy` then assign
- ( ) You cannot
> The operation that makes immutability comfortable rather than annoying.

## A `NamedTuple`
- (x) Is a tuple: it unpacks, it indexes, and it compares equal to a plain tuple of the same values
- ( ) Is a frozen dataclass
- ( ) Cannot have methods
- ( ) Is mutable
> The reason to choose it and the reason to avoid it, depending on whether the type is part of the meaning.

## `NamedTuple` against a `frozen=True` dataclass, as a rule of thumb
- (x) `NamedTuple` for a return value, frozen dataclass for a domain object
- ( ) `NamedTuple` always; it is faster
- ( ) Dataclass always; `NamedTuple` is legacy
- ( ) They are interchangeable
> A tuple's length is part of its interface, so a class that will grow should not be one.

## An `Enum` prevents
- (x) A misspelled member, which raises where a misspelled string is silently never equal
- ( ) Duplicate values
- ( ) Mutation
- ( ) Serialisation
> `@unique` is the one that refuses duplicates; without it they become silent aliases.

## `StrEnum` members
- (x) Can be used anywhere a string is expected, at the cost of comparing equal to bare strings again
- ( ) Are ordinary `Enum` members with a `str` value
- ( ) Cannot be serialised
- ( ) Are automatically unique
> Useful at the edges, where a value gets written into JSON or a URL.

## `pydantic` differs from `dataclasses` in that it
- (x) Parses and validates at run time, using the annotations as the specification
- ( ) Generates faster methods
- ( ) Adds `__slots__`
- ( ) Replaces mypy
> Which is why it belongs at the boundary, where the data came from somewhere you do not control.
