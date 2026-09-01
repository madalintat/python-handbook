---
slug: 24-typing
---

## At run time, an annotation
- (x) Is metadata stored on the object and checked by nothing
- ( ) Raises `TypeError` when the argument does not match
- ( ) Converts the argument
- ( ) Is removed by the compiler
> `def double(n: int)` will happily take a string and return `"haha"`.

## `Optional[int]` means
- (x) `int` or `None`
- ( ) The argument may be omitted
- ( ) The argument has a default
- ( ) Any integer-like value
> A parameter is optional because it has a default. `Optional` is about the value, not the call.

## The modern spelling of `Optional[str]` is
- (x) `str | None`
- ( ) `str?`
- ( ) `Maybe[str]`
- ( ) `typing.Optional[str]` still
> And `int | str` for `Union[int, str]`. Prefer the bar.

## `list[str]` rather than `typing.List[str]` has worked since
- (x) 3.9
- ( ) 3.12
- ( ) It has not; `List` is required
- ( ) 3.5
> The capitalised forms still exist and you will read them, but there is no reason to write them.

## For a parameter you only iterate, annotate
- (x) `Iterable[T]`
- ( ) `list[T]`
- ( ) `Sequence[T]`
- ( ) `Any`
> A caller with a tuple is not doing anything wrong, and the narrow annotation refuses code that would have worked.

## `list[Dog]` where `list[Animal]` is expected is
- (x) Refused, because the function could append a `Cat` to the caller's list
- ( ) Accepted, because `Dog` is an `Animal`
- ( ) Accepted with a warning
- ( ) Refused because lists are invariant in both directions only for builtins
> `Sequence[Animal]` is fine, because a sequence cannot be appended to.

## Return types should be
- (x) Concrete, so the caller knows what they can do with the value
- ( ) As general as the parameters
- ( ) `Any` when unsure
- ( ) Omitted when obvious
> Be generous in what you accept and specific about what you hand back.

## `Literal["left", "right"]` is enforced
- (x) By the checker only; any string passes at run time
- ( ) By the interpreter, which raises on anything else
- ( ) By `__post_init__`
- ( ) Only inside a dataclass
> Which is exactly why a misspelled literal is worth catching statically.

## A `TypedDict` at run time is
- (x) An ordinary dict; nothing is created and nothing is checked
- ( ) A new class with slots
- ( ) A validating wrapper
- ( ) A `NamedTuple`
> It buys a checker that knows `row["nmae"]` is wrong. When you control the shape, a dataclass is better.

## A class satisfies a `Protocol` by
- (x) Having the right methods, with no inheritance and no registration
- ( ) Inheriting from it
- ( ) Calling `register`
- ( ) Declaring it in `__protocols__`
> Duck typing with a name a checker can verify, including for classes you do not own.

## `Any`
- (x) Switches checking off for every expression it touches, in both directions
- ( ) Means "some type I have not decided yet"
- ( ) Is the same as `object`
- ( ) Accepts anything but permits nothing
> `object` is the honest annotation for "genuinely anything": it accepts everything and permits nothing until you narrow.

## After `if user is None: return ...`, a checker knows the rest of the function has
- (x) A non-`None` user
- ( ) A `User | None` still
- ( ) An `Any`
- ( ) Nothing; narrowing needs `assert`
> `isinstance`, `assert`, truthiness tests and early returns all narrow.

## `def first[T](items: Sequence[T]) -> T` says
- (x) The return type is whatever the elements are
- ( ) The return type is `Any`
- ( ) `T` must be declared with `TypeVar` first
- ( ) `items` must be a list
> The 3.12 syntax scopes `T` to the function, which is what everybody assumed the old `TypeVar` did.

## `Callable[[int], int]` describes a function that
- (x) Takes one `int` and returns an `int`
- ( ) Takes any arguments and returns an `int`
- ( ) Takes a list of ints
- ( ) Returns a callable
> `Callable[..., str]` is the escape hatch when the parameters genuinely vary.

## `from __future__ import annotations`
- (x) Makes every annotation a string, so a class can refer to itself without quotes
- ( ) Enables run-time checking
- ( ) Is required for `X | None`
- ( ) Speeds up mypy
> Anything reading annotations at run time then has to resolve them, which `typing.get_type_hints` does.
