---
slug: 21-mro
---

## The MRO is
- (x) A flat list of classes, searched in order for any attribute
- ( ) A tree walked depth first
- ( ) The list of base classes
- ( ) Computed on each access
> Computed once, when the class is created, and printed by `Cls.__mro__`.

## `super()` in a method of `C`, on an instance of `T`, finds
- ( ) `C`'s base class
- (x) The class after `C` in `type(T).__mro__`
- ( ) The first base of `T`
- ( ) `object`
> The MRO belongs to the instance's class, not to the class the method was written in.

## "`super()` means my parent class" is
- ( ) Correct
- (x) Correct only under single inheritance, where the next class always happens to be the base
- ( ) Never correct
- ( ) Correct for `__init__` only
> Which is why the belief survives so long and breaks so confusingly.

## C3 guarantees all of these except
- ( ) A class comes before its bases
- ( ) The order bases were written in is preserved
- ( ) Every class appears exactly once
- (x) The hierarchy is at most two levels deep
> When no order satisfies the first three, Python refuses to create the class.

## `class C(A, B)` where `B` inherits from `A`
- ( ) Puts `A` first
- ( ) Puts `B` first
- (x) Raises `TypeError`: no order satisfies both rules
- ( ) Silently reorders
> The redundant base was contributing nothing; inheriting from `B` already brings `A`.

## One class in a cooperative chain that forgets `super()`
- ( ) Raises immediately
- (x) Silently skips every class after it in the MRO
- ( ) Is skipped itself
- ( ) Ends the program
> The symptom arrives later, as an attribute nobody set.

## `object.__init__` accepts
- (x) Nothing, which is why cooperative chains must consume their keywords before forwarding
- ( ) Any keyword arguments
- ( ) Any positional arguments
- ( ) Whatever the subclass declared
> An error from `object` means somebody forwarded something nobody wanted.

## `super()` with no arguments works because
- (x) Python compiles in a hidden reference to the defining class and reads the instance from the first parameter
- ( ) It inspects the call stack at run time
- ( ) It looks at `__bases__`
- ( ) It is a keyword
> Which is why it fails in a nested function, where the first parameter is not `self`.

## `super(Middle, self)` inside a subclass of `Middle`
- ( ) Starts at `Middle`
- (x) Starts after `Middle`, skipping it
- ( ) Is the same as `super()`
- ( ) Raises
> `super(X, self)` always begins the search at the class after `X`.

## `A.method(self)` instead of `super().method()`
- ( ) Is equivalent
- (x) Calls exactly that class, skipping anything the MRO put in between
- ( ) Raises `TypeError`
- ( ) Is faster and equivalent
> Right only when you specifically mean "not the next one, this one", which is worth a comment.

## Mixin parameters should be keyword only because
- (x) An MRO decides which class catches a positional argument, and the caller cannot see the order
- ( ) Keywords are faster
- ( ) Positional arguments are deprecated
- ( ) It is required by `super()`
> A bare `*` in the signature makes a positional call fail at the boundary instead of misassigning.

## A good mixin
- (x) Supplies one orthogonal capability, holds little or no state, and is never instantiated alone
- ( ) Is a base class with shared behaviour
- ( ) Replaces composition
- ( ) Defines `__init__` and nothing else
> If reordering two of them changes behaviour surprisingly, they are not orthogonal.

## Before reaching for multiple inheritance, prefer
- (x) Composition: hold the other object and call it
- ( ) A deeper hierarchy
- ( ) A metaclass
- ( ) Copying the methods
> The answer whenever the relationship is "has a" rather than "is a".

## `@abstractmethod` on an `abc.ABC` moves the failure
- (x) To construction, naming every missing method at once
- ( ) To import
- ( ) To the first call
- ( ) To type checking only
> `raise NotImplementedError` documents the contract; this enforces it.

## `vars(Cls)` against `Cls.x`
- (x) `vars` shows what that class itself defines, with nothing inherited and nothing computed
- ( ) They are the same
- ( ) `vars` includes inherited names
- ( ) `vars` only works on instances
> Between `__mro__` and `vars`, "where does this come from" is a two-line question.
