---
slug: 08-scope
---

## Python searches namespaces in which order?
- (x) Local, enclosing, global, built-in
- ( ) Global, local, enclosing, built-in
- ( ) Built-in, global, enclosing, local
- ( ) Local, global, built-in, enclosing
> The first namespace holding the name wins, which is why an inner name shadows an outer one for the whole of that scope.

## Which of these introduces a new scope?
- ( ) A `for` loop
- ( ) An `if` block
- ( ) A `with` block
- (x) A comprehension
> Only functions, classes, modules and comprehensions do. A `for` variable outlives its loop and holds the last value.

## What makes a name local to a function?
- ( ) Reading it
- (x) Assigning to it anywhere in the body
- ( ) Declaring it at the top
- ( ) Using it in a nested function
> And it is local for the whole body, including the lines above the assignment, because the decision is made when the function is compiled.

## `count = 0` at module level; a function does `print(count)` then `count += 1`. The print
- ( ) Shows 0
- (x) Raises UnboundLocalError
- ( ) Raises NameError
- ( ) Shows None
> `+=` is an assignment, so `count` is local throughout, so the read finds an unfilled local slot.

## `UnboundLocalError` differs from `NameError` in that
- (x) The compiler knew the name should have been local
- ( ) It only happens in nested functions
- ( ) It is raised at compile time
- ( ) It cannot be caught
> It is a subclass of `NameError` with a more specific story attached.

## `global x` in a function means
- ( ) Read `x` from module level
- (x) Assignments to `x` here bind at module level
- ( ) Create `x` if it does not exist
- ( ) Prevent `x` from being shadowed
> Reading a module-level name never needed a declaration. Only rebinding does.

## `nonlocal x` binds in
- ( ) The module namespace
- (x) The nearest enclosing function scope
- ( ) The built-in namespace
- ( ) The class body
> And it is an error if there is no such binding to find, which makes it safer than `global`.

## Which needs no `global` or `nonlocal` declaration?
- ( ) `x = x + [1]` on a module-level list
- (x) `x.append(1)` on a module-level list
- ( ) `x += [1]` on a module-level list
- ( ) `x = []` on a module-level list
> Mutation is a method call on an object, not an assignment to a name. Only rebinding needs a declaration.

## A closure captures
- ( ) The value at the moment the closure was created
- (x) The variable, read when the closure runs
- ( ) A copy of the enclosing scope
- ( ) Nothing; it re-looks-up by name at module level
> Which is the entire reason functions built in a loop all see the loop's final value.

## `[lambda: i for i in range(3)]`, all called, gives
- ( ) `[0, 1, 2]`
- (x) `[2, 2, 2]`
- ( ) `[0, 0, 0]`
- ( ) A NameError
> There is one variable, shared by all three closures, and the loop has finished before any of them runs.

## Which fixes that loop?
- ( ) Wrapping the lambda in `list()`
- (x) `lambda i=i: i`, so the value is captured at definition time
- ( ) Declaring `nonlocal i`
- ( ) Using a `while` loop instead
> A factory function taking `i` as a parameter does the same thing and makes the fresh scope visible.

## After `[x for x in range(3)]`, reading `x` gives
- ( ) `2`
- ( ) `3`
- (x) NameError
- ( ) `[0, 1, 2]`
> A comprehension has its own scope, so its variable cannot clobber a name you were using.

## Inside a method, a bare reference to a class attribute
- ( ) Works, because the class body is an enclosing scope
- (x) Raises NameError; the attribute needs `self.` or the class name
- ( ) Works only for constants
- ( ) Shadows the builtin of that name
> A class body is a scope but deliberately not an *enclosing* scope for functions defined inside it.

## Why does a comprehension in a class body fail to see the class's other names?
- ( ) Comprehensions cannot appear in a class body
- (x) The comprehension body is an implicit function, and class scope does not enclose functions
- ( ) The names are not yet defined at that point
- ( ) It only fails for mutable attributes
> The first iterable is the exception: it is evaluated in the enclosing scope, which is why `for k in KEYS` works.

## Why is shadowing a builtin worse than shadowing a local?
- ( ) It is a SyntaxError
- (x) Builtins are searched last, so the failure appears wherever the builtin is next needed
- ( ) Builtins cannot be shadowed at all
- ( ) It leaks into other modules
> `list`, `dict`, `type`, `id` and `input` are all ordinary names. A trailing underscore is the usual escape.
