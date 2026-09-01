---
slug: 25-typecheck
---

## Running mypy on a codebase with no annotations reports
- (x) Almost nothing, because an unannotated function is invisible to it
- ( ) An error for every function
- ( ) Every possible type error
- ( ) A summary of inferred types
> Which is why the file looks clean while being entirely unchecked.

## `disallow_untyped_defs` turns
- (x) An unannotated function from a blind spot into an error
- ( ) An unannotated variable into an error
- ( ) `Any` into `object`
- ( ) Missing stubs into errors
> It is what makes "mypy passes" a statement about the whole file rather than the annotated half.

## `warn_return_any` catches
- (x) A function annotated `-> int` that returns something the checker only knows as `Any`
- ( ) Any use of `Any`
- ( ) A missing return statement
- ( ) An unannotated return
> The most common way types quietly stop meaning anything, usually at the edge of an untyped library.

## `union-attr` is the checker asking for
- (x) A guard, because one member of the union does not have that attribute
- ( ) A cast
- ( ) A wider annotation
- ( ) An `Any`
> In practice the member without it is `None`.

## `no-any-return` and `no-untyped-call` mark
- (x) Where the guarantees end, at the boundary with untyped code
- ( ) Deprecated syntax
- ( ) Missing annotations on your own code
- ( ) Performance problems
> Which is why they are the errors people silence first and should not.

## A bare `# type: ignore`
- (x) Silences every error on that line, including the one that appears there next year
- ( ) Silences the first error only
- ( ) Is equivalent to naming the code
- ( ) Is an error under strict
> Always name the code. `warn_unused_ignores` then tells you when it can go.

## `cast(str, value)` at run time
- (x) Returns its argument unchanged; nothing is converted and nothing is checked
- ( ) Raises if the type is wrong
- ( ) Converts the value
- ( ) Is removed by the compiler
> Honest about being an assertion, which is why it beats an ignore and loses to `isinstance`.

## The best of the three escape hatches, when you can afford it, is
- (x) `assert isinstance(x, Foo)`, because it narrows and is genuinely checked
- ( ) `# type: ignore[code]`
- ( ) `cast`
- ( ) `Any`
> It cannot silently become wrong, which the other two can.

## `reveal_type(x)`
- (x) Makes mypy print what it believes `x` to be; it is not a real function and will fail at run time
- ( ) Prints the type at run time
- ( ) Needs importing from `typing`
- ( ) Is a strict-mode error
> A question you ask the checker and then delete.

## When a file reports several errors, read
- (x) The last one first, because an early mistake often cascades
- ( ) The first one first
- ( ) Only the ones in your own code
- ( ) Them in order of severity
> Fixing the first frequently removes the rest.

## The way to bring a checker to a large untyped codebase is
- (x) Defaults everywhere, then tighten module by module with overrides
- ( ) Turn on strict and work through the list
- ( ) Annotate everything first, then run it
- ( ) Only check new files
> Choose modules where a mistake is expensive, not the ones that look easy.

## A third-party library with no types is handled by
- (x) Installing its stubs if they exist, and `ignore_missing_imports` for that module if not
- ( ) `# type: ignore` at each import
- ( ) Annotating its functions yourself
- ( ) Turning off strict
> One override in the config, rather than a comment in every file that imports it.

## `ruff` and `mypy`
- (x) Overlap almost not at all; ruff does not check types
- ( ) Do the same job
- ( ) Conflict, so pick one
- ( ) Are the same tool under different names
> Running both is normal.

## `pyright` against `mypy`
- (x) Different inference in places, so a codebase can pass one and not the other
- ( ) Identical behaviour, different speed
- ( ) `pyright` is a linter
- ( ) `pyright` cannot run in CI
> Pick one for CI and let the other be an editor convenience.

## Types repay effort least on
- (x) Local variables with obvious values, and code that will be deleted next week
- ( ) Public function signatures
- ( ) Module boundaries
- ( ) Code several people change
> A type expression that needs three lines is telling you something about the function, not the types.
