---
slug: 08-scope
title: Scope and closures
---

Unit 01 established that a name is a label in a namespace. This unit is about which namespace, and about the one rule that decides it: **the compiler works out where every name lives before your function ever runs.**

## LEGB

When Python evaluates a name it searches four namespaces in order.

**Local**: the function currently executing. **Enclosing**: any function this one is defined inside, from nearest outward. **Global**: the module. **Built-in**: the names that are always there, like `len` and `print`.

The first namespace holding that name wins, and if none of them do you get a `NameError`. Because the search stops at the first hit, an inner name **shadows** an outer one of the same name for the whole of that scope. A local called `list` makes the builtin unreachable from that function, and a module-level `id` makes the builtin unreachable from the whole file.

Two things that are not scopes, and surprise people:

A `for` loop is not a scope. Its variable lives in the enclosing function and is still there afterwards, holding the last value. Neither is an `if` or a `with` or a `try`. Only functions, classes, modules and comprehensions introduce one.

A class body **is** a scope, but not an enclosing one for its methods. Names defined in a class body are attributes of the class, and a method cannot see them as plain names. Inside a method, `self.total` works and a bare `total` raises `NameError`.

## Assignment makes a name local, everywhere in the function

This is the rule everything else follows from.

At compile time Python scans each function for assignments. Any name assigned anywhere in the body is local for the **whole** body, including the lines above the assignment.

```python
count = 0

def tick():
    print(count)      # UnboundLocalError
    count = count + 1
```

`count` is assigned on the last line, so it is local throughout, so the `print` reads a local that has not been given a value yet. The module-level `count` is never consulted. `UnboundLocalError` is what a `NameError` is called when the compiler knows the name should have been local.

Reading alone does not make a name local. A function that only reads `count` sees the global one. It is assignment, in any form, that decides: `=`, `+=`, `for count in ...`, `with ... as count`, `import count`, and a `def count` all count.

That is why `+=` on a global is the classic trap. It is an assignment, so the name becomes local, so the read on its right-hand side fails.

## Why the rule is a compile-time one

It would be possible to design a language that decides where a name lives when the line runs. Python does not, and knowing that it decides earlier explains behaviour that otherwise looks arbitrary.

When a function is compiled, its local names are collected and turned into slots in a fixed-size array. Reading a local is then an array index rather than a dictionary lookup, which is a large part of why Python functions are faster than module-level code doing the same work. You can see the decision in the compiled function:

```python
def tick():
    print(count)
    count = count + 1

print(tick.__code__.co_varnames)     # ('count',)
print(tick.__code__.co_names)        # ('print',)
```

`count` is already in `co_varnames` before the function has ever run. That is the compiler having read the whole body and concluded that `count` is local, and it is why moving the assignment to the last line does not help: there is no line-by-line reconsideration.

It also explains why `locals()` inside a function hands you a snapshot rather than a live dictionary, and why you cannot create a local name dynamically by writing into it. The slots were fixed when the function was compiled.

## `global` and `nonlocal`

Two declarations that change what an assignment binds.

`global name` says: assignments to this name in this function bind at module level. `nonlocal name` says: bind in the nearest enclosing **function** scope, and it is an error if there is no such binding to find.

```python
def counter():
    n = 0
    def tick():
        nonlocal n
        n += 1
        return n
    return tick
```

Without `nonlocal`, `n += 1` makes `n` local to `tick` and fails on the read. With it, `tick` rebinds the `n` that lives in `counter`.

`global` is worth being suspicious of. A function that rebinds module state has an effect no caller can see from the call site, and it makes the module's value depend on call order. `nonlocal` is narrower and usually fine, because the state it touches is private to the closure.

Neither is needed to **mutate**. `scores.append(x)` on a global list works without any declaration, because that is a method call on an object, not an assignment to a name. This is unit 02's distinction again: mutation reaches through the name, rebinding replaces it, and only rebinding needs a declaration.

## Closures capture variables, not values

A function defined inside another can read the enclosing function's names, and keeps that access after the outer call has returned:

```python
def multiplier(n):
    def multiply(x):
        return x * n
    return multiply

double = multiplier(2)
double(5)          # 10
```

The inner function is a **closure**: the function plus a reference to the enclosing variables it uses. Those variables are stored in cell objects that outlive the call, which you can look at:

```python
print(double.__closure__[0].cell_contents)    # 2
print(multiply.__code__.co_freevars)          # ('n',)
```

The important word is *variable*. A closure does not copy the value at the moment it was created. It holds a reference to the variable and reads it **when the inner function runs**. If the variable changes afterwards, the closure sees the new value.

## The loop trap

Which produces the single most reported surprise in this area:

```python
funcs = []
for i in range(3):
    funcs.append(lambda: i)

[f() for f in funcs]      # [2, 2, 2], not [0, 1, 2]
```

There is one variable `i`, belonging to the enclosing function, reused by every iteration. All three closures reference that one variable, and by the time any of them runs the loop has finished and `i` is `2`.

The fix is to give each closure its own variable. A default argument is evaluated at definition time, so it captures the value:

```python
funcs.append(lambda i=i: i)
```

`functools.partial(operator.mul, i)` does the same thing more explicitly, and a factory function is the clearest of all, because it makes the fresh scope visible:

```python
def make(i):
    return lambda: i
funcs.append(make(i))
```

## Shadowing, and the names worth not reusing

Because the search stops at the first namespace holding the name, a local quietly replaces anything outer with the same spelling. Most of the time that is exactly what you want and is why local names are safe to choose freely.

The exception is the built-in namespace, which is searched last and is therefore the easiest to hide by accident. `list`, `dict`, `set`, `type`, `id`, `input`, `str`, `next`, `filter`, `format` and `hash` are all ordinary names, and all of them are plausible as a variable:

```python
def summarise(input):
    type = input["type"]
    list = sorted(input["items"])       # `list` is now a list
    return list, type
```

Every line here works. The cost arrives later, when something in the same scope tries to call `list(...)` or `type(x)` and gets a `TypeError` about an object not being callable, several lines away from the shadowing that caused it.

The habit that avoids it is a trailing underscore when the obvious name is taken: `type_`, `input_`, `list_`. Linters flag the common ones, and it is worth listening to them, because the failure is remote from its cause.

## Where closures are actually useful

The loop trap makes closures look like a hazard, so it is worth saying what they are for.

They give you a function carrying private state that nothing else can reach. A counter, a rate limiter, a memoiser, a callback that remembers which row it belongs to, a partially applied function waiting for its last argument. In every case the alternatives are a global, which anything can touch, or a class, which is more ceremony for one function.

```python
def make_limiter(maximum):
    used = 0
    def allow(n):
        nonlocal used
        if used + n > maximum:
            return False
        used += n
        return True
    return allow
```

`used` is genuinely private. There is no attribute to reach for and no module-level name to collide with, and two limiters made from the same factory share nothing at all.

The decision between this and a small class is mostly about how many operations there are. One operation and a closure is lighter; two or more, or anything a caller needs to inspect, and a class says more. Unit 26 builds on closures directly, because a decorator is a closure over the function it wraps.

## Comprehensions have their own scope

A comprehension runs in its own function-like scope, so its loop variable does not leak:

```python
[x for x in range(3)]
print(x)        # NameError
```

That is a deliberate fix for the `for` loop's behaviour, and it is why a comprehension cannot accidentally clobber a name you were using. The first iterable is evaluated in the enclosing scope; everything else runs inside.

One consequence catches people: a comprehension in a **class body** cannot see the class's other names, because the class scope is not an enclosing scope for the implicit function.

```python
class Config:
    keys = ["a", "b"]
    upper = [k.upper() for k in keys]           # works: first iterable
    pairs = [(k, keys) for k in keys]           # NameError on the inner keys
```

## What to carry forward

Names resolve local, enclosing, global, built-in, and the first hit wins. Assignment anywhere in a function makes the name local everywhere in that function, which is what `UnboundLocalError` is telling you. `global` and `nonlocal` change what an assignment binds, and neither is needed to mutate. A closure captures the variable, not the value, so functions built in a loop all see the loop's final value unless each is given a scope of its own. And a comprehension has its own scope, which is why its variable does not leak.
