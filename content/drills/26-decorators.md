---
slug: 26-decorators
---

## `@log` above `def fetch` means
- (x) `fetch = log(fetch)`
- ( ) `log` is called each time `fetch` is called
- ( ) `fetch` inherits from `log`
- ( ) `log` is registered as a hook
> Every property of decorators follows from that one line.

## Decorators run
- (x) At definition time, which for a module-level function means at import
- ( ) At each call
- ( ) At the first call
- ( ) When the module is unloaded
> Which is exactly what registration decorators rely on.

## Stacked decorators apply
- (x) Bottom up: the one nearest the `def` wraps the function first
- ( ) Top down
- ( ) In an unspecified order
- ( ) Alphabetically
> So the one at the top is outermost and sees the call first.

## Something that can reject a call belongs
- (x) At the top of the stack, where nothing below can answer first
- ( ) Nearest the `def`
- ( ) Inside the function
- ( ) Anywhere; order does not matter
> Otherwise a cache below it serves the request the check would have refused.

## The most common decorator bug is
- (x) A wrapper that calls the function and does not return its result
- ( ) A missing `functools.wraps`
- ( ) Wrong stacking order
- ( ) Using a class
> Quiet in the worst way: functions used for effects keep working, functions used for values return `None`.

## Without `functools.wraps`, the decorated function
- (x) Has the wrapper's `__name__`, no docstring, and a `(*args, **kwargs)` signature
- ( ) Cannot be called
- ( ) Loses its arguments
- ( ) Is slower
> Which breaks `help`, Sphinx, pytest names, tracebacks and anything dispatching on the name.

## `functools.wraps` also sets
- (x) `__wrapped__`, so the original stays reachable
- ( ) `__slots__`
- ( ) `__call__`
- ( ) `__module__` only
> `inspect.unwrap` follows that chain when there are several layers.

## `@retry(times=3)` expands to
- (x) `f = retry(times=3)(f)`
- ( ) `f = retry(f, times=3)`
- ( ) `f = retry(times=3, f)`
- ( ) `retry(f).times = 3`
> Two calls, which is why a decorator with arguments needs three levels.

## `@thing` where `@thing()` was needed
- (x) Passes the function in as the first configuration argument, failing somewhere downstream
- ( ) Raises at the decoration
- ( ) Uses the defaults
- ( ) Is equivalent
> The usual answer is to require the parentheses and let the failure be loud.

## `@retry(SETTINGS["attempts"])` reads the setting
- (x) Once, when the module is imported
- ( ) On every call
- ( ) On the first call
- ( ) Whenever `SETTINGS` changes
> Unit 07's mutable-default surprise in a new setting: an expression in a position that runs once.

## A class-based decorator on a **method**
- (x) Breaks, because an instance is not a descriptor and nothing binds `self`
- ( ) Works exactly as on a function
- ( ) Requires `@staticmethod`
- ( ) Cannot be written
> Unit 20's protocol arriving where you would not expect it. A closure is a function, and functions are descriptors.

## For a class-based decorator, the metadata is copied with
- (x) `functools.update_wrapper(self, func)`
- ( ) `functools.wraps`
- ( ) `copy.copy`
- ( ) Nothing; it is automatic
> `wraps` is the decorator form of the same thing, for wrapping through a function.

## A registration decorator such as `@app.route("/")`
- (x) Puts the function in a table and returns it unchanged
- ( ) Wraps it in a request handler
- ( ) Replaces it with a route object
- ( ) Defers it until the server starts
> The most common kind in real code and the least like the tutorial shape. It still has to return the function.

## Library decorators use `ParamSpec` to
- (x) Say "the same parameters as the function I wrapped", so annotations survive the wrapper
- ( ) Validate arguments
- ( ) Accept both call forms
- ( ) Speed up dispatch
> A bare `*args, **kwargs` erases the signature as far as a checker is concerned.

## The test for whether behaviour belongs in a decorator is
- (x) Whether a reader looking only at the call site would be surprised
- ( ) Whether it is reusable
- ( ) Whether it fits in one function
- ( ) Whether the standard library has one
> `@cache` passes. A decorator that raises for reasons the function's body does not contain does not.
