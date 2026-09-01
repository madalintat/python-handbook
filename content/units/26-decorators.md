---
slug: 26-decorators
title: Decorators
---

A decorator is a function that takes a function and returns a function. That is the whole definition, and every decorator you have used, `@property`, `@classmethod`, `@dataclass`, `@cached_property`, is an instance of it. This unit is where the syntax stops being an incantation.

## The syntax is one line of sugar

```python
@log
def fetch(url): ...
```

means exactly:

```python
def fetch(url): ...
fetch = log(fetch)
```

That is all `@` does. It calls a function with the thing below it and rebinds the name to the result. Every property of decorators follows from this, including the ones that surprise people: decorators run at **definition** time, not at call time, and they run **bottom up** when stacked, because the innermost rebinding happens first.

Here is the shape you will write most often:

```python
import functools


def log(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        print(f"calling {func.__name__}")
        return func(*args, **kwargs)

    return wrapper
```

Three things are doing work. `*args, **kwargs` accepts whatever the wrapped function accepts, which is what makes the decorator apply to anything. `return func(...)` passes the result back, and forgetting it is the single most common decorator bug, because it turns every decorated function into one that returns `None`. And `functools.wraps` is not optional.

## `functools.wraps`

Without it, the decorated function **is** the wrapper, so it has the wrapper's identity:

```python
fetch.__name__      # 'wrapper'
fetch.__doc__       # None
help(fetch)         # useless
inspect.signature(fetch)    # (*args, **kwargs)
```

Every tool that reads a function's metadata now sees the wrong thing: your logging, your tracebacks, `help`, Sphinx, pytest's test names, and anything that dispatches on `__name__`. `@functools.wraps(func)` copies `__name__`, `__doc__`, `__module__`, `__qualname__` and `__dict__` across, and sets `__wrapped__` so the original is still reachable.

There is no case where you want a wrapper without it. Write it every time, and treat a decorator without one as a bug in the same way as a missing `return`.

## Decorators that take arguments

This is the part that reads strangely until you apply the sugar rule.

```python
@retry(times=3)
def fetch(url): ...
```

expands to `fetch = retry(times=3)(fetch)`. Two calls: `retry(times=3)` runs first and returns a decorator, which is then applied. So a decorator with arguments is a function that returns a function that takes a function and returns a function, which is three levels, and there is no way around it:

```python
def retry(times):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(times):
                try:
                    return func(*args, **kwargs)
                except Exception:
                    if attempt == times - 1:
                        raise
        return wrapper
    return decorator
```

Read it from the inside out and it is ordinary: `wrapper` does the work, `decorator` attaches it, `retry` captures the configuration. The three names are worth keeping, because `def inner` at every level is how these become unreadable.

The awkward consequence of this shape is that `@retry` and `@retry()` are different things, and the first quietly passes the function in as `times`. Making a decorator work both ways is possible and fiddly; the usual answer is to require the parentheses and let the error be obvious.

## Stacking, and the order that trips people

Two decorators on one function apply bottom up:

```python
@timed
@cached
def fetch(url): ...
```

is `fetch = timed(cached(fetch))`, so `cached` wraps the original and `timed` wraps that. Calling `fetch` runs `timed`'s wrapper first, then `cached`'s, then the function. Written out, the rule is obvious; read off the page top to bottom, it is backwards from what people expect, and it matters more than it sounds. Swap those two and you are timing only the calls that missed the cache, or timing every call including the free ones, and which of those you wanted is a real question with a real answer.

The rule for deciding: the decorator nearest the `def` is closest to the function, so it sees every call. The one at the top is outermost, so it sees what the layers below chose to do. Authentication belongs at the top, because a rejected request should never reach the cache. Caching belongs low, because a cached call should skip as much work as possible.

## What runs when

Decorators run when the `def` runs, which for a module-level function means at import. That has two consequences worth holding.

A decorator that does something expensive does it at import time, once, for every decorated function in the file, whether or not any of them is ever called. Registration decorators rely on this and it is exactly what they want: importing the module is what fills the table.

And a decorator that reads state at definition time captures that state, not the state at call time. `@retry(times=CONFIG["retries"])` reads the config when the module is imported, so changing the config later changes nothing, which is unit 07's mutable-default surprise in a new setting: an expression in a position that runs once.

## Decorators that are classes

Anything callable can decorate, so a class with `__call__` works, and unit 22 covered why:

```python
class CountCalls:
    def __init__(self, func):
        functools.update_wrapper(self, func)
        self.func = func
        self.count = 0

    def __call__(self, *args, **kwargs):
        self.count += 1
        return self.func(*args, **kwargs)
```

The advantage is state with a name, `fetch.count` rather than a closure variable nobody can reach. The disadvantage is that an instance is not a function, so it does not become a bound method when it decorates one, and `@CountCalls` on a method breaks in a way that takes a while to diagnose. Unit 20 explains exactly why: functions are descriptors and your class is not.

Use `functools.update_wrapper` rather than `wraps` in this case, because you are copying onto an instance rather than through a decorator.

## What decorators are actually good for

The honest list is short, and it is the list because these are the concerns that are genuinely orthogonal to what a function does.

Caching, `functools.cache` and `lru_cache`. Timing and logging. Retries and rate limiting. Registration, adding the function to a table, which is how routing works in every web framework you will meet. Access control. And unit 22's `contextlib.contextmanager`, which is a decorator that turns a generator into a context manager.

What they are bad at is anything that needs to see the arguments by name, anything that changes the function's meaning rather than its surroundings, and anything the reader needs to know about to understand the call site. A decorator is invisible at the point of use, which is its whole appeal and its whole danger.

The test that settles most cases: would a reader looking only at the call site be surprised by what happens? `@cache` passes, because a cached call is indistinguishable from an uncached one except in speed. `@validate_arguments` fails, because a function that raises for reasons its own body does not contain is a function you cannot read. When the answer is "they would be surprised", the behaviour wants to be in the function, or in an explicit call the reader can see.

## Why real ones look different

Open a library and the decorators look nothing like the tutorial ones, for three reasons worth recognising.

**They preserve types.** A wrapper taking `*args, **kwargs` erases the signature as far as a checker is concerned. Modern libraries use `ParamSpec` to say "the same parameters as the function I wrapped", which is what keeps unit 24's annotations working through a decorator.

**They handle both call forms.** Library decorators usually accept `@thing` and `@thing(...)`, which needs the argument-inspecting dance described above.

**They register rather than wrap.** `@app.route("/")` and `@pytest.fixture` mostly put the function in a table and hand it straight back unchanged. This is the most common decorator in real code and the least like the tutorial shape: there is no wrapper at all.

## `functools`, before you write your own

Several of the decorators worth having are already written, and unit 17 met the module they live in.

`@cache` memoises with no bound, and `@lru_cache(maxsize=128)` with one. Both require hashable arguments, both keep every result alive for the life of the process, and `cache_clear()` is the way out.

`@singledispatch` turns a function into one that dispatches on the type of its first argument, with `@thing.register` adding cases. It is the honest replacement for a chain of `isinstance` branches, and unit 21 said why that chain is usually the wrong shape.

`@wraps` and `update_wrapper` this unit has covered. `@total_ordering` came up in unit 22.

Checking whether the thing you are about to write already exists is worth thirty seconds, because a decorator in the standard library has had its edge cases found by somebody else.

## Reading one

When a decorated function behaves oddly, three questions settle it.

Does the wrapper `return`? A decorated function returning `None` for no reason is this, almost always.

Is `functools.wraps` there? If `__name__` is `"wrapper"`, no tool downstream can be trusted.

And `func.__wrapped__` gives you the original, which is how you find out what is actually being called when a function has three decorators on it and one of them is lying. `inspect.unwrap(func)` follows that chain all the way down, which is the version to reach for when there are several.

There is one failure that none of those three catch, and it is worth knowing because the symptom is so unhelpful. A decorator applied to a method has to hand back something that behaves like a function, or the descriptor protocol from unit 20 has nothing to bind and `self` never arrives. A plain wrapper function is fine, because functions are descriptors. A class instance is not, and the error you get is about argument counts, several frames away from the decorator that caused it.
