---
slug: 34-async
title: async and await
---

Unit 33 said `asyncio` is the answer for waiting at high concurrency. This unit is what it actually is, and the useful mental model is smaller than the API suggests: **a coroutine is a generator that yields when it would otherwise wait, and the event loop is a `while` loop that keeps sending values back into whichever one is ready.**

Everything else is convenience over that.

## Coroutines

`async def` makes a function that returns a coroutine object when called. Calling it runs none of the body:

```python
async def fetch(url):
    await asyncio.sleep(1)
    return f"body of {url}"


coro = fetch("/a")      # nothing has happened yet
```

That is unit 16's rule about generators, in different words and for the same reason. `await` suspends the coroutine and hands control back to whatever is driving it, which is the event loop, which then runs something else.

The thing you have to internalise is that **`await` is not "wait here"**. It is "I am not ready; run something else and come back". A coroutine that never awaits never gives anything else a turn, which is the source of the most common async performance surprise.

## Running one

```python
asyncio.run(main())
```

`asyncio.run` creates an event loop, runs the coroutine to completion, and closes the loop. One call, at the top of the program, and everything below it is `async`.

That last part is the constraint people call "function colouring": an `async def` can only be awaited from another `async def`, so `async` propagates up the call stack until it reaches `asyncio.run`. It is not a design flaw so much as the honest consequence of the model, and the practical effect is that async is a decision about a whole program rather than about one function.

Calling a coroutine and not awaiting it produces a coroutine object and a `RuntimeWarning: coroutine was never awaited`. That warning is worth treating as an error, because the code did not run at all and everything downstream is looking at a coroutine where it expected a value.

## Concurrency, which is the point

`await` on its own gives you nothing but a slower program written awkwardly:

```python
async def main():
    a = await fetch("/a")       # one second
    b = await fetch("/b")       # then another
    return a, b                 # two seconds
```

That is sequential. To overlap, hand several coroutines to something that schedules them:

```python
async def main():
    a, b = await asyncio.gather(fetch("/a"), fetch("/b"))    # one second
```

`gather` starts them all and waits for all of them, returning results in the order you passed them, not the order they finished.

The modern spelling is a **task group**, and it is what to reach for:

```python
async def main():
    async with asyncio.TaskGroup() as group:
        a = group.create_task(fetch("/a"))
        b = group.create_task(fetch("/b"))
    return a.result(), b.result()
```

The difference is what happens when one fails. `gather` by default cancels nothing and lets the others run to completion, and you get the first exception; the rest are discarded. A `TaskGroup` cancels the remaining tasks and raises an `ExceptionGroup` containing everything that failed, which is almost always what you want, and is the reason `except*` exists.

This is **structured concurrency**: tasks cannot outlive the block that created them. It is the same argument as `with` for files, applied to work.

## Driving one by hand

The claim at the top of this unit is worth demonstrating rather than asserting, because once you have seen it the rest of `asyncio` stops being magic.

A coroutine supports `send`, exactly as a generator does. Driving one with no event loop at all takes three lines:

```python
async def add(a, b):
    return a + b


coro = add(1, 2)
try:
    coro.send(None)          # start it; it runs to the first suspend
except StopIteration as stop:
    print(stop.value)        # 3
```

`send(None)` runs the body, and because this coroutine never awaits anything that actually suspends, it finishes immediately and reports its return value by raising `StopIteration`. That is the same protocol unit 16 described for generators, unchanged.

An event loop is a `while` loop around that: keep a collection of coroutines, `send` into each one that is ready, and when one suspends, note what it is waiting for and move on to the next. When something it waited for is available, send that value back in. Timers, sockets and futures are the three kinds of thing it waits for, and the rest of `asyncio` is bookkeeping.

Knowing this settles a class of question that is otherwise confusing. Why does a coroutine not start until awaited? Because nothing has sent into it. Why does a blocking call stop everything? Because the loop is one `while` loop in one thread, and it is inside your function. Why can `await` only appear in an `async def`? Because it compiles to a suspend, and only a coroutine can suspend.

## Blocking the loop

One thread, one task at a time. So any synchronous call that takes time stops **everything**:

```python
async def handler():
    time.sleep(1)               # the whole program stops for a second
    requests.get(url)           # so does this
    heavy_computation()         # and this
```

Every other connection waits. This is the failure that makes people conclude async is slow, and it is always this.

Three fixes. Use an async library for I/O: `httpx` or `aiohttp` rather than `requests`, `asyncpg` or an async driver rather than a blocking one, `asyncio.sleep` rather than `time.sleep`. For CPU work or a library with no async version, `await asyncio.to_thread(func, *args)` moves it to a thread and lets the loop carry on. And for genuinely heavy computation, a process pool, because unit 33's rule about the GIL has not gone away.

The diagnostic is `asyncio.run(main(), debug=True)`, which logs any callback that takes too long and names it.

## Cancellation

Cancelling a task raises `asyncio.CancelledError` inside it at its next `await`. Two things follow.

`CancelledError` inherits from `BaseException`, not `Exception`, so `except Exception:` does not catch it. That is deliberate, and it is why unit 32's advice against a bare `except:` matters even more here: a bare except in a coroutine swallows cancellation and produces a task that cannot be stopped.

Cleanup goes in `finally`, which runs when the exception passes through. If you catch `CancelledError` to clean up, re-raise it, because a task that swallows cancellation and returns normally lies to whoever cancelled it.

`asyncio.timeout(5)` as a context manager is the readable way to bound something, and it cancels what is inside on expiry.

## Where async is worth it

Many concurrent operations that spend their time waiting: an API server, a crawler, a chat gateway, anything holding thousands of connections. Ten thousand coroutines is ordinary; ten thousand threads is not.

It is not worth it for a script that makes four requests, where threads are simpler and the difference is unmeasurable. It is not worth it for CPU-bound work, which it cannot help with at all. And it is a real cost in a codebase, because of colouring, because the debugging is harder, and because every dependency now has to have an async version.

The rule that keeps this honest: reach for `asyncio` when the concurrency is the point, not when the code merely does some I/O.

## The pieces you will actually use

Beyond `gather` and `TaskGroup`, four things cover most real programs.

`asyncio.Queue` is the async version of unit 33's queue and is how producers hand work to a pool of consumers. It gives you backpressure for free: a bounded queue makes a fast producer wait, which is what stops a crawler eating all the memory it can find.

`asyncio.Semaphore` limits how many things happen at once. Ten thousand coroutines that all open a connection at the same moment is a way to be blocked by the other end, and a semaphore around the request is the rate limit.

`asyncio.to_thread(func, *args)` is the bridge to synchronous code, and is the answer whenever a library you need has no async version.

`async for` and `async with` are the protocol versions of unit 22's, with `__aiter__`/`__anext__` and `__aenter__`/`__aexit__`. An async generator, an `async def` containing `yield`, is how you write something that is iterated with `async for`, and is the natural shape for a paginated API.

## Debugging it

Three habits, because async failures look different from ordinary ones.

**Name your tasks.** `asyncio.create_task(coro, name="fetch-page")` costs nothing and turns an unhelpful traceback into one that says which task.

**Never fire and forget.** A task nobody holds a reference to can be garbage collected mid-flight, and an exception in a task nobody awaits is reported only when it is collected, sometimes long afterwards, sometimes not at all. A `TaskGroup` removes this whole class of problem, which is the strongest argument for using it by default.

**Read the exception group.** When a `TaskGroup` fails you get an `ExceptionGroup`, and the traceback shows every failure with the tree structure that produced it. `except*` matches by type inside one. It looks unfamiliar for a week and then reads better than the alternative, because several things genuinely did fail and pretending otherwise loses information.

## What to hold on to

A coroutine is a generator that yields at every `await`. The loop drives them. Nothing runs concurrently until you use `gather` or a `TaskGroup`. Anything blocking stops all of it. And a task group is the default, because work that cannot outlive its block is work you can reason about.

If you remember one practical rule rather than the model: when an async program is slower than you expected, look for a synchronous call. It is almost never the loop, the library or the design, and it is almost always one function in the middle of a handler that does not have `await` in front of it.
