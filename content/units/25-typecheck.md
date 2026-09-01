---
slug: 25-typecheck
title: Type checking in practice
---

Unit 24 covered what to write. This one is about the tool that reads it, which is a different skill: knowing what to turn on, what the errors mean, how to bring a checker into code that has never seen one, and when to stop.

## Getting a useful answer

```
mypy src/
```

Out of the box, mypy checks the functions you annotated and ignores the ones you did not. That default is deliberate and it is why running mypy on an unannotated codebase reports almost nothing: an unannotated function is invisible to it, so the file appears clean while being entirely unchecked.

Configuration goes in `pyproject.toml`, which unit 00 already put in your project:

```toml
[tool.mypy]
python_version = "3.14"
strict = true
```

`strict = true` is a bundle of about a dozen flags, and if you are starting a new project it is the right setting. Two of them do most of the work.

`disallow_untyped_defs` makes an unannotated function an error rather than a blind spot, which is what turns "mypy passes" into a statement about the whole file rather than about the annotated half.

`warn_return_any` catches the most common way types quietly stop meaning anything: a function annotated `-> int` that returns something the checker only knows as `Any`, usually because it came out of an untyped library.

The rest of strict is worth reading once. `no_implicit_optional` in particular used to be off and caught a real class of bug: `def f(x: int = None)` was once silently `int | None`.

## The five errors you will actually hit

**`arg-type`** and **`return-value`**: something of the wrong type went in or came out. Usually the annotation is right and the code is wrong. Occasionally the reverse, and the fix is the annotation.

**`union-attr`**: an attribute access on a union where one member does not have it, which in practice means `None`. Unit 24 covered narrowing; this error is the checker asking for a guard.

**`no-any-return`** and **`no-untyped-call`**: the boundary with untyped code. Something crossed into your typed module carrying no information, and the checker is telling you that everything downstream of it is now unchecked. These are the errors people silence first and should not, because they are the ones marking where the guarantees end.

**`assignment`**: a value of one type assigned where another was declared. Frequently a variable being reused for two different purposes, which is worth fixing for reasons that have nothing to do with types.

**`attr-defined`**: no such attribute. A typo, or an attribute the checker cannot see. It learns a class's attributes from the class body and from assignments in the class's own methods, so an attribute set only from outside the class is invisible to it. Declaring it in the class body with an annotation and no value is the fix, and it also tells a reader what the object holds.

A sixth is worth mentioning because it confuses people out of proportion to how often it appears. **`var-annotated`**: mypy cannot infer what an empty container holds, so `items = []` needs `items: list[str] = []`. It is not a bug report; it is the checker saying it has nothing to go on. It appears less often than you would expect, because mypy will infer the element type from the first thing appended and only asks when there is nothing at all to go on.

## Reading an error message

mypy's messages are terser than a traceback and follow a fixed shape:

```
src/orders.py:42: error: Argument 1 to "total" has incompatible type
    "list[str]"; expected "Iterable[int]"  [arg-type]
```

File, line, what it expected, what it got, and the code in brackets. The code is the part to pay attention to, because it is what you look up, what you silence if you must, and what tells you which of the five categories above you are in.

Two habits make the messages much easier. **Read the last error first** when a file reports several: an early mistake often produces a cascade, and fixing the first one frequently removes the rest. And **`reveal_type(x)`** is the debugging tool: put it on a line, run mypy, and it prints what the checker believes `x` to be at that point. It is not a real function, it does not need importing, and it will fail at run time, which is deliberate: it is a question you ask the checker and then delete.

`reveal_type` is worth reaching for the moment an error surprises you, because most surprising type errors come from the checker knowing something narrower or wider than you assumed, usually several lines earlier.

## Escape hatches, in order of preference

Sometimes you know better than the checker. Say so precisely.

`# type: ignore[arg-type]` silences one error code on one line. **Always name the code.** A bare `# type: ignore` silences everything on that line, including the real error that appears there next year. `warn_unused_ignores` in strict mode then tells you when an ignore has become unnecessary, which is how they get cleaned up rather than accumulating.

`cast(list[str], value)` asserts a type without checking anything at run time. It is honest about being an assertion, and it is preferable to an ignore because it says what you believe rather than merely that you disagree.

`assert isinstance(x, Foo)` narrows and is genuinely checked when the program runs. It is the best of the three when the cost is acceptable, because it cannot silently become wrong.

`Any` is the largest hammer, and unit 24 said what it costs.

The general rule is to reach for the narrowest one that works, and to leave a comment saying why, because every one of these is a place where the next reader has to take your word for it.

## Bringing a checker to code that has none

The failure mode here is turning on `strict` for a hundred thousand lines, seeing four thousand errors, and turning it off again. The approach that works is per module and permanent.

Start with mypy's defaults across the whole project and fix what it reports. That will be a small number, and some of them will be real.

Then pick modules, and tighten them individually:

```toml
[[tool.mypy.overrides]]
module = "myapp.payments.*"
disallow_untyped_defs = true
```

Choose the ones where a mistake is expensive rather than the ones that look easy. Payment handling and data parsing repay this; a module of glue code does not.

For third-party libraries with no types, install their stubs if they exist, `types-requests` and its many siblings, and otherwise silence the import in one place:

```toml
[[tool.mypy.overrides]]
module = "ancient_library.*"
ignore_missing_imports = true
```

Then run it in CI, on every change, from the first day. A checker that runs sometimes finds nothing, because annotations drift the moment they stop being verified, and unit 24 made the case that a stale annotation is worse than a missing one.

There is one more move worth knowing for a codebase mid-migration. `--strict` on a file that is nearly there, run by hand, tells you the distance without committing to it. Keeping a list of modules that pass strict, and adding to it rather than flipping a global switch, turns the work into something a team can do a module at a time between other things, which is the only form in which it actually gets done.

## `mypy`, `pyright`, and the editor

`mypy` is the reference implementation and the one to run in CI.

`pyright` is faster, stricter about a few things, and is what powers Pylance in VS Code, so a great many people are running it without knowing the name. Its inference is better in places, which means a codebase can pass one and not the other. Pick one for CI and let the other be an editor convenience.

`ruff` does not check types. It is a linter, and unit 00 covered what it does. Running both is normal; they overlap almost not at all.

The editor is where a checker actually changes how you work. A red underline as you type is a different experience from a list of four hundred errors in a terminal, and it is most of why annotating as you write costs so little.

## When types stop paying

Types repay effort unevenly, and knowing where the curve flattens is part of using them well.

They are worth the most on **public function signatures**, on **anything crossing a module boundary**, and in **code that is old, shared, or frequently changed**. Those are the places where a reader cannot see the answer and a checker can.

They are worth the least on **local variables with obvious values**, on **short scripts**, and on **exploratory code that will be deleted next week**.

And there is a point past which they cost more than they return. A type expression that needs three lines, two type variables and an overload to describe one function is telling you something about the function, and the useful response is usually to split it rather than to describe it more precisely. `Any` in one spot, with a comment, is often the better engineering decision than a correct annotation nobody can read.

The goal is not to make the checker happy. It is to make wrong code fail to compile, and only where that trade is worth making.
