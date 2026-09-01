---
slug: 07-functions
title: Functions
---

A `def` statement is an instruction that runs. When it runs it builds a function object, evaluating the default expressions on the way, and binds a name to it. Everything surprising about Python functions follows from those two facts, and this unit spends most of its time on the parameter list, which is more expressive than almost anyone uses.

## Parameters and arguments

A **parameter** is a name in the definition. An **argument** is a value at the call site. Keeping the words apart makes the rest of this readable.

Python matches them in a fixed order. Positional arguments fill parameters left to right, keyword arguments fill by name, and anything left over goes to `*args` or `**kwargs` if they exist and is an error if they do not. A parameter filled twice, once positionally and once by name, is an error too, and the message says so.

At the call site, positional arguments must come before keyword arguments. `f(1, x=2)` is fine; `f(x=2, 1)` is a `SyntaxError`, because otherwise the reader would have to count to know which parameter `1` fills.

## Arguments are bound, never copied

Unit 01 established this and it is worth restating in the vocabulary of this unit, because it is the fact that decides what a function can and cannot do to its caller.

Calling a function binds its parameter names to the very objects the caller passed. Nothing is copied on the way in. So a function can mutate a list it was given and the caller sees it, and a function cannot rebind a name in the caller no matter what it does, because rebinding a parameter only moves that function's local name.

The often-repeated question "is Python pass by value or pass by reference?" has no useful answer, because it is neither in the sense those terms usually carry. The value passed is a reference, and the name receiving it is an ordinary local name. Once you think in names and objects the question stops being interesting.

The practical rule that falls out: if a function must not modify what it was handed, either copy it at the top of the body or, better, do not modify it at all. Build and return something new. And when you do intend to modify, say so in the name. `sort_in_place(rows)` and `sorted_rows(rows)` are both fine; `process(rows)` tells the reader nothing about which one it is.

## The full parameter list

The complete form has five sections, and the two markers are punctuation rather than parameters:

```python
def f(a, b, /, c, d, *args, e, f=1, **kwargs):
```

Everything before `/` is **positional-only**: it cannot be passed by name. Everything between `/` and `*` is ordinary. `*args` collects surplus positional arguments into a tuple. Everything after `*args`, or after a bare `*`, is **keyword-only**: it cannot be passed positionally. `**kwargs` collects surplus keyword arguments into a dict.

You will rarely use all five. The two worth reaching for deliberately:

**Keyword-only parameters**, written with a bare `*`, make a call site self-documenting and stop a boolean flag from arriving as a bare `True` that nobody can read:

```python
def connect(host, *, timeout=30, retry=True):
connect("db.local", timeout=5)        # the only legal form
```

**Positional-only parameters**, with `/`, free you to rename a parameter later without breaking callers, because nobody can depend on the name. Most builtins are positional-only for exactly that reason, `len(obj=x)` is an error.

## Defaults are evaluated once, at definition time

The single most important fact about parameters, and the source of two distinct bugs.

```python
def stamp(at=time.time()):
    return at
```

`time.time()` runs once, when the `def` statement executes, and the result is stored on the function object. Every call that omits the argument gets that same moment, forever. Unit 02 covered the mutable version of this (the `[]` that every caller shares), and this is the same mechanism with a different symptom: not a shared object that grows, but a value frozen at import time.

You can inspect the stored defaults directly:

```python
print(stamp.__defaults__)
```

The idiom for both cases is a `None` sentinel with the real default computed in the body, where it runs per call. ruff flags the general shape as `B008`, "do not perform function call in argument defaults", with a carve-out for calls whose result cannot change.

A related rule: a default expression cannot refer to another parameter. `def f(a, b=a)` raises `NameError`, because at the moment the defaults are evaluated no call is happening and `a` does not exist. The same sentinel pattern applies.

## `*args` and `**kwargs`

Inside the function, `args` is a tuple and `kwargs` is a dict, real objects, built fresh on every call, and `kwargs` in particular is a new dictionary each time, so mutating it cannot affect the caller.

At the call site the same symbols mean the opposite thing: they **spread** rather than collect.

```python
def total(*values): ...

total(1, 2, 3)            # three arguments, collected into (1, 2, 3)
total([1, 2, 3])          # ONE argument, which is a list
total(*[1, 2, 3])         # three arguments again
```

That middle line is the mistake worth watching for: a function taking `*values` handed a list receives a one-element tuple containing a list. It usually fails somewhere downstream rather than at the call, which is what makes it annoying.

The forwarding idiom uses both meanings in one line, and is how decorators and wrappers pass everything through untouched:

```python
def wrapper(*args, **kwargs):
    return original(*args, **kwargs)
```

## Return

Every function returns something. A bare `return` returns `None`, and falling off the end returns `None`, which is why a forgotten `return` produces a `None` several lines away from the mistake rather than an error at the mistake.

`return a, b` returns one object, a tuple, because it is the comma that builds it. The caller usually unpacks it, and unpacking is checked: too many or too few values raises `ValueError` naming both counts.

The standard library's convention, from unit 02, is worth restating as a rule for your own functions: if it mutates, return `None`; if it computes, return the result and leave the inputs alone.

## Functions are objects

`def` binds a name to an object, and that object can be passed, stored, returned and given attributes:

```python
handlers = {"start": on_start, "stop": on_stop}
handlers[command]()
```

It also carries useful metadata: `__name__`, `__doc__`, `__defaults__`, `__annotations__`, and `__code__` with the compiled body. `inspect.signature(f)` renders the parameter list, and is what tooling uses to know how to call something.

This is why a dispatch dictionary is usually better than a chain of `elif`, why decorators are possible at all, and why unit 26 can talk about functions that take and return functions without any new machinery.

## Docstrings and signatures are part of the interface

A docstring is not a comment. It is a string literal in the first statement position, stored as `__doc__`, and it is what `help()` prints and what an editor shows on hover. Unit 20 makes them executable, because the examples inside them can be run as tests.

The convention is one summary line in the imperative mood, a blank line, then detail if there is any. What is worth documenting is the part the signature cannot say: what the function does with its arguments, what it raises, and anything a caller must not assume. Restating the parameter names in prose adds nothing that the signature does not already carry.

Two habits make signatures do more work. Keep parameter counts small: a function needing six arguments is usually two functions, or one that should take an object. And prefer keyword-only parameters for anything a reader could not identify from position alone, which in practice means every boolean and every optional tuning value.

```python
def render(template, *, escape=True, indent=2):
```

Compare `render(t, False, 4)` with `render(t, escape=False, indent=4)` at a call site three files away. The first requires the reader to go and look; the second does not, and the bare `*` is what makes the second the only form that compiles.

## Closures, briefly

A function defined inside another function can read names from the enclosing scope, and it keeps access to them after the outer call has returned:

```python
def multiplier(n):
    def multiply(x):
        return x * n
    return multiply

double = multiplier(2)
```

`double` still knows what `n` is, because the inner function captured the enclosing variable rather than copying its value. That distinction (variable, not value) is the whole content of unit 08, and it is the reason building functions in a loop rarely does what people expect the first time.

## Annotations do nothing

```python
def area(r: float) -> float:
    return 3.14159 * r * r
```

The annotations are evaluated and stored in `area.__annotations__`, and **nothing checks them**. Passing a string raises only when the arithmetic fails, and passing something that happens to work does not raise at all. They are documentation that a separate tool (mypy, in this book) can verify.

That is a deliberate design choice rather than an omission, and unit 24 covers what it buys and costs. The practical note here is that annotating a function is what allows the second of this book's three judges to say anything about it at all: mypy does not look inside unannotated functions by default.

## What to carry forward

Defaults are evaluated once, when `def` runs, and stored on the function object. Positional-only and keyword-only parameters are worth using deliberately, the second especially for flags. `*` and `**` collect in a definition and spread at a call, so passing a list to a `*args` function gives you a tuple containing a list. Falling off the end returns `None`. Functions are objects with names, docs and signatures. And annotations are metadata, not enforcement.
