---
slug: 16-generators
---

## Calling a function that contains `yield`
- ( ) Runs the body and returns the values
- (x) Runs none of the body and returns a generator
- ( ) Raises unless you use `next`
- ( ) Runs up to the first `yield`
> The body starts only when something asks for the first value, which is why validation written inside a generator happens late.

## `yield` differs from `return` in that
- (x) It suspends the function with all its local state intact, to be resumed
- ( ) It is faster
- ( ) It can only appear once
- ( ) It converts the value to a string
> The locals, the position in the loop and the point inside a `try` are all still there when it resumes.

## `return value` inside a generator
- ( ) Yields the value last
- (x) Ends the generator, attaching the value to `StopIteration`
- ( ) Is a SyntaxError
- ( ) Restarts the generator
> A `for` loop discards it. It exists mainly so `yield from` can pass a result back.

## A generator function called twice gives
- (x) Two independent generators
- ( ) The same generator
- ( ) A TypeError on the second call
- ( ) A copy sharing state
> Which is how a class becomes reusably iterable: put the `yield` in `__iter__`.

## A `StopIteration` raised inside a generator
- ( ) Ends the generator quietly
- (x) Becomes a RuntimeError, since Python 3.7
- ( ) Is caught by the caller's `for` loop
- ( ) Is a SyntaxError
> Before PEP 479 it escaped and read as "finished", so the outer loop stopped early with nothing to find.

## `yield from row` differs from `for x in row: yield x` in that
- ( ) It is the only one that works
- (x) It also forwards `send`, `throw` and `close`, and passes back the return value
- ( ) It flattens recursively
- ( ) It is lazy where the loop is not
> For plain iteration they are equivalent, and ruff's `UP028` suggests the shorter one.

## `g.send(10)` on a freshly created generator
- ( ) Returns the first value
- (x) Raises TypeError, because there is no paused `yield` to receive it
- ( ) Ignores the value
- ( ) Starts the generator
> Priming it with `next(g)` runs the body up to the first `yield` and leaves it ready to receive.

## `n = yield total` means
- (x) Yield `total`, then when resumed, `n` becomes whatever was sent
- ( ) Assign `total` to `n` and yield it
- ( ) Yield both
- ( ) A SyntaxError
> This two-way machinery is what `async`/`await` was built on.

## A `finally` around a `yield` runs
- ( ) Immediately after the yield
- (x) When the generator is closed or collected, which may not be at once
- ( ) Never
- ( ) Only on an exception
> Which is why a `with` inside the generator says it better when the resource matters.

## A chain of generators does
- (x) Only the work the consumer asks for, unless something in the middle is eager
- ( ) All the work up front
- ( ) The work in parallel
- ( ) The work twice
> One `sorted`, one list comprehension or one `len` in the middle forces everything through it.

## `sorted(gen)` inside a pipeline
- ( ) Preserves laziness
- (x) Consumes the whole source before it can yield anything
- ( ) Raises on an infinite generator only
- ( ) Is the same as `list(gen)`
> It cannot return its first value until it has seen the last input, which is what makes it eager.

## A paused generator holds
- ( ) Nothing
- (x) Its frame, including all its local variables
- ( ) A copy of the values produced so far
- ( ) The consumer's stack
> Which is the memory cost: the saving is against materialising the values, not against having none.

## `inspect.getgeneratorstate(g)` on a generator that has never run gives
- (x) `GEN_CREATED`
- ( ) `GEN_SUSPENDED`
- ( ) `GEN_RUNNING`
- ( ) `GEN_CLOSED`
> Which is exactly why `send` with a non-None value fails there.

## Prefer a generator function over a generator expression when
- ( ) The input is large
- (x) The logic has structure: a condition, state between items, a `try`, or a name worth having
- ( ) You need it to be lazy
- ( ) The output is a dict
> Roughly the point where a comprehension stops being readable, which is not a coincidence.

## Returning a generator when the caller needs the length is
- ( ) Fine; they can call `len`
- (x) Unkind: they have to materialise it, so the function may as well
- ( ) Faster
- ( ) Required by the protocol
> The same holds when they need it twice or need to index it.
