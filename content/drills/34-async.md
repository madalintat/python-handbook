---
slug: 34-async
---

## A coroutine is
- (x) A generator that yields when it would otherwise wait
- ( ) A thread the interpreter manages
- ( ) A process with a shared heap
- ( ) A callback registered with the loop
> The event loop is a `while` loop that keeps sending values back into whichever one is ready.

## Calling an `async def`
- (x) Returns a coroutine object and runs none of the body
- ( ) Runs the body to the first `await`
- ( ) Schedules it on the loop
- ( ) Runs it to completion
> Unit 16's rule about generators, in different words and for the same reason.

## `await` means
- (x) I am not ready; run something else and come back
- ( ) Wait here until this finishes
- ( ) Block this thread
- ( ) Start this concurrently
> A coroutine that never awaits never gives anything else a turn.

## Two `await`s one after the other
- (x) Are sequential, and take as long as the sum
- ( ) Overlap automatically
- ( ) Are a syntax error
- ( ) Run on separate threads
> Nothing runs concurrently until you use `gather` or a task group.

## `asyncio.gather` returns results
- (x) In the order you passed the coroutines, not the order they finished
- ( ) In completion order
- ( ) As they arrive
- ( ) Unordered
> Which is the right default, and wrong when you want the fast answers first.

## When one task in a `TaskGroup` raises, the others are
- (x) Cancelled, and an `ExceptionGroup` carries every failure
- ( ) Left to run, and the first exception is returned
- ( ) Left to run, and all exceptions are returned
- ( ) Retried
> `gather`'s default is the second, which discards the rest. `except*` matches inside a group.

## Structured concurrency means
- (x) Tasks cannot outlive the block that created them
- ( ) Tasks run in a fixed order
- ( ) Each task has its own loop
- ( ) Exceptions are grouped
> Unit 22's argument for `with`, applied to work rather than to files.

## `return` inside an `except*` block
- (x) Is not allowed, because the block may run once per matching exception type
- ( ) Returns the first match
- ( ) Is allowed
- ( ) Ends the group
> Assign to a name and return after the `try`.

## A synchronous call inside a coroutine
- (x) Stops every other coroutine, because the loop is a `while` loop in the same thread
- ( ) Runs on a worker thread
- ( ) Is scheduled after the current task
- ( ) Raises
> The failure that makes people conclude async is slow, and it is always this.

## A library with no async version is bridged with
- (x) `await asyncio.to_thread(func, *args)`
- ( ) `asyncio.run` inside the coroutine
- ( ) `await` on the synchronous call
- ( ) A second event loop
> And unit 33's rule about the GIL then decides whether a thread is enough.

## `asyncio.CancelledError` inherits from
- (x) `BaseException`, so `except Exception:` does not catch it
- ( ) `Exception`
- ( ) `RuntimeError`
- ( ) `TimeoutError`
> Deliberately, which is one more reason a bare `except:` in a coroutine is dangerous.

## A task that catches `CancelledError` and returns normally
- (x) Lies about its own state to whoever cancelled it; re-raise, or clean up in `finally`
- ( ) Is correctly handling cancellation
- ( ) Is cancelled anyway
- ( ) Raises at the next `await`
> `finally` needs no catch at all and runs as the exception passes through.

## `asyncio.Semaphore(n)`
- (x) Limits how many things run at once, which is the rate limit
- ( ) Limits total tasks
- ( ) Orders tasks
- ( ) Bounds memory
> A bounded `asyncio.Queue` is the other half: it gives a fast producer backpressure.

## A task nobody holds a reference to
- (x) Can be collected mid-flight, and its exception reported late or not at all
- ( ) Runs to completion regardless
- ( ) Is cancelled at once
- ( ) Raises immediately
> The strongest argument for using a `TaskGroup` by default.

## An `async def` containing `yield`
- (x) Is an async generator, iterated with `async for` via `__aiter__` and `__anext__`
- ( ) Is a syntax error
- ( ) Is an ordinary generator
- ( ) Returns a coroutine
> Every protocol from unit 22 has an async twin, spelled the same way with an `a`.
