---
slug: 34-async
---

## Awaited one after the other

`fetch_all` awaits each fetch in turn, so the second starts only once the first has finished. Awaiting in sequence is not concurrency.

@expect silent
@hint `await` means "I am not ready, run something else". What else is there to run?
@hint Hand all the coroutines to something that schedules them together.
@diagnose silent It runs and gives the right answers, one after another, taking as long as the sum of the parts. `await` on its own does not overlap anything: it suspends this coroutine and lets the loop run whatever else it has, and in a sequential chain there is nothing else. `asyncio.gather(*coros)` starts them all and waits for all of them, returning results in the order you passed them rather than the order they finished. This is the single most common misunderstanding about async, and it produces a program that is exactly as slow as the synchronous version with more syntax.

~~~starter
import asyncio

STARTED: list[str] = []


async def fetch(name):
    STARTED.append(f"{name} start")
    await asyncio.sleep(0)
    STARTED.append(f"{name} end")
    return f"body of {name}"


async def fetch_all(names):
    """Fetch every name, at the same time."""
    results = []
    for name in names:
        results.append(await fetch(name))
    return results
~~~

~~~tests
STARTED.clear()
out = asyncio.run(fetch_all(["a", "b", "c"]))
assert out == ["body of a", "body of b", "body of c"]

# overlapped: every fetch starts before any of them finishes
assert STARTED == ["a start", "b start", "c start", "a end", "b end", "c end"], (
    f"the fetches ran one after another: {STARTED}"
)
~~~

~~~solution
import asyncio

STARTED: list[str] = []


async def fetch(name):
    STARTED.append(f"{name} start")
    await asyncio.sleep(0)
    STARTED.append(f"{name} end")
    return f"body of {name}"


async def fetch_all(names):
    """Fetch every name, at the same time."""
    return list(await asyncio.gather(*(fetch(name) for name in names)))
~~~

## A coroutine that was never awaited

`schedule` calls the coroutine function and stores what comes back. Calling an `async def` runs none of the body; it builds a coroutine object.

@expect silent
@hint What does calling an `async def` return, and how much of the body has run?
@hint Unit 16's rule about generators, in different words.
@diagnose silent Nothing raised, and no work was done: `record(name)` built a coroutine object and stored it, and the body never ran. Python emits `RuntimeWarning: coroutine was never awaited` for this, and it is worth treating as an error, because the code did not run at all and everything downstream is holding a coroutine where it expected a value. The fix depends on what you meant. To run it now and use the answer, `await` it. To start it and carry on, `asyncio.create_task(...)`, which schedules it and returns a handle. To run several, `gather` or a task group.

~~~starter
import asyncio

DONE: list[str] = []


async def record(name):
    await asyncio.sleep(0)
    DONE.append(name)
    return name


async def schedule(names):
    """Record every name."""
    results = [record(name) for name in names]
    return results
~~~

~~~tests
DONE.clear()
out = asyncio.run(schedule(["a", "b"]))
assert DONE == ["a", "b"], f"after scheduling, {DONE} had been recorded"
assert out == ["a", "b"]
~~~

~~~solution
import asyncio

DONE: list[str] = []


async def record(name):
    await asyncio.sleep(0)
    DONE.append(name)
    return name


async def schedule(names):
    """Record every name."""
    return list(await asyncio.gather(*(record(name) for name in names)))
~~~

## A synchronous call in the middle of the loop

`handler` fetches with the synchronous client. One thread, one task at a time, so a blocking call stops every other coroutine as well.

@expect silent
@hint How many threads is the event loop running on?
@hint There is an async version of exactly this call.
@diagnose silent It runs, and nothing overlapped: while `handler` was inside `fetch_sync`, the loop had no opportunity to run anything, because the loop is a `while` loop in the same thread and it was inside your function. This is the failure that makes people conclude async is slow, and it is always this. The primary fix is to use the async client, which suspends instead of blocking, and the substitution is the same across the board: `httpx` or `aiohttp` rather than `requests`, an async database driver rather than a blocking one, `asyncio.sleep` rather than `time.sleep`. When a library has no async version, or the work is computation rather than waiting, `await asyncio.to_thread(func, *args)` moves it off the loop, and unit 33's rule about the GIL then decides whether a thread is enough or a process pool is needed.

~~~starter
import asyncio

ORDER: list[str] = []


def fetch_sync(name):
    """The blocking client. Nothing else runs while it works."""
    return f"data for {name}"


async def fetch_async(name):
    """The async client. Suspends, so the loop can run something else."""
    await asyncio.sleep(0)
    return f"data for {name}"


async def handler(name):
    ORDER.append(f"{name} start")
    fetch_sync(name)
    ORDER.append(f"{name} end")
    return name


async def serve(names):
    """Handle every request, overlapping the waiting."""
    return list(await asyncio.gather(*(handler(name) for name in names)))
~~~

~~~tests
ORDER.clear()
assert asyncio.run(serve(["a", "b"])) == ["a", "b"]
assert ORDER == ["a start", "b start", "a end", "b end"], (
    f"the handlers ran one after the other: {ORDER}"
)
~~~

~~~solution
import asyncio

ORDER: list[str] = []


def fetch_sync(name):
    """The blocking client. Nothing else runs while it works."""
    return f"data for {name}"


async def fetch_async(name):
    """The async client. Suspends, so the loop can run something else."""
    await asyncio.sleep(0)
    return f"data for {name}"


async def handler(name):
    ORDER.append(f"{name} start")
    await fetch_async(name)
    ORDER.append(f"{name} end")
    return name


async def serve(names):
    """Handle every request, overlapping the waiting."""
    return list(await asyncio.gather(*(handler(name) for name in names)))
~~~

## One task failed and the others carried on

`run_all` uses `gather`. When one task raises, the others are left running and only the first exception comes back, so the rest of the failures are lost.

@expect silent
@hint What does a `TaskGroup` do to its siblings when one of them raises?
@hint The exception it raises holds more than one thing.
@diagnose silent It runs and reports one failure where two happened, because `gather` returns the first exception and discards the rest, having let every other task run to completion. An `asyncio.TaskGroup` cancels the remaining tasks as soon as one fails and raises an `ExceptionGroup` containing everything that went wrong, which is almost always what you want and is the reason `except*` exists. This is **structured concurrency**: tasks cannot outlive the block that created them, which is unit 22's argument for `with` applied to work rather than to files. It also removes the fire-and-forget problem, where a task nobody holds is collected mid-flight and its exception is reported late or never. One syntactic detail worth knowing before you write your first one: `return`, `break` and `continue` are not allowed inside an `except*` block, because the block may run several times, once per matching exception type. Assign to a name and return after the `try`.

~~~starter
import asyncio


async def job(name, fails):
    await asyncio.sleep(0)
    if fails:
        raise ValueError(name)
    return name


async def run_all(jobs):
    """Run every job. Report every failure, not just the first."""
    try:
        await asyncio.gather(*(job(name, fails) for name, fails in jobs))
    except ValueError as exc:
        return [str(exc)]
    return []
~~~

~~~tests
assert asyncio.run(run_all([("a", False), ("b", False)])) == []

failures = asyncio.run(run_all([("a", True), ("b", False), ("c", True)]))
assert sorted(failures) == ["a", "c"], f"reported {failures}"
~~~

~~~solution
import asyncio


async def job(name, fails):
    await asyncio.sleep(0)
    if fails:
        raise ValueError(name)
    return name


async def run_all(jobs):
    """Run every job. Report every failure, not just the first."""
    failures: list[str] = []
    try:
        async with asyncio.TaskGroup() as group:
            for name, fails in jobs:
                group.create_task(job(name, fails))
    except* ValueError as group_error:
        failures = [str(exc) for exc in group_error.exceptions]
    return failures
~~~

## Cancellation caught and kept

`worker` cleans up when it is cancelled and returns normally afterwards. Swallowing `CancelledError` tells whoever cancelled it that it stopped when it did not.

@expect silent
@hint What should a task do after cleaning up in response to cancellation?
@hint The exception has to carry on.
@diagnose silent Nothing raised, and the cancelled task reported a normal result, so the caller believes work completed that was actually abandoned halfway. Cancelling a task raises `asyncio.CancelledError` inside it at its next `await`; catching it to clean up is fine, and then it must be re-raised, because a task that swallows cancellation lies about its own state. Better still, put the cleanup in `finally`, which runs as the exception passes through and needs no catch at all. Note also that `CancelledError` inherits from `BaseException` rather than `Exception`, deliberately, so `except Exception:` does not catch it, which is one more reason unit 32's advice against a bare `except:` matters here.

~~~starter
import asyncio

CLEANED: list[str] = []


async def worker(name):
    try:
        await asyncio.sleep(10)
        return f"{name} finished"
    except asyncio.CancelledError:
        CLEANED.append(name)
        return f"{name} cleaned up"


async def main():
    task = asyncio.create_task(worker("a"))
    await asyncio.sleep(0)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        return "cancelled"
    return "completed"
~~~

~~~tests
CLEANED.clear()
assert asyncio.run(main()) == "cancelled", "the task swallowed its own cancellation"
assert CLEANED == ["a"], "the cleanup should still have run"
~~~

~~~solution
import asyncio

CLEANED: list[str] = []


async def worker(name):
    try:
        await asyncio.sleep(10)
        return f"{name} finished"
    finally:
        CLEANED.append(name)


async def main():
    task = asyncio.create_task(worker("a"))
    await asyncio.sleep(0)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        return "cancelled"
    return "completed"
~~~

## Every request at once

`fetch_all` starts a coroutine per name with nothing limiting how many run together. Ten thousand at once is a way to be refused by the other end.

@expect silent
@hint What limits how many things are in flight at the same time?
@hint `asyncio.Semaphore`, held around the part that must be limited.
@diagnose silent It runs, and every request was in flight at once, which for two names is fine and for ten thousand is a denial of service you performed on somebody else. `asyncio.Semaphore(n)` allows `n` holders at a time and makes the rest wait, and `async with limit:` around the request is the whole of it. The related tool is `asyncio.Queue` with a bounded size, which gives you backpressure from the other direction: a fast producer waits when the queue is full, which is what stops a crawler eating all the memory it can find. Between them they are most of what makes an async program that talks to the network survivable.

~~~starter
import asyncio

IN_FLIGHT: list[int] = []


async def fetch(name, live):
    live.append(name)
    IN_FLIGHT.append(len(live))
    await asyncio.sleep(0)
    live.remove(name)
    return name


async def fetch_all(names, limit):
    """Fetch every name, at most `limit` at a time."""
    live: list[str] = []
    return list(await asyncio.gather(*(fetch(name, live) for name in names)))
~~~

~~~tests
IN_FLIGHT.clear()
assert asyncio.run(fetch_all(["a", "b", "c", "d"], limit=2)) == ["a", "b", "c", "d"]
assert max(IN_FLIGHT) <= 2, f"{max(IN_FLIGHT)} requests were in flight at once"
~~~

~~~solution
import asyncio

IN_FLIGHT: list[int] = []


async def fetch(name, live, limit):
    async with limit:
        live.append(name)
        IN_FLIGHT.append(len(live))
        await asyncio.sleep(0)
        live.remove(name)
        return name


async def fetch_all(names, limit):
    """Fetch every name, at most `limit` at a time."""
    live: list[str] = []
    gate = asyncio.Semaphore(limit)
    return list(await asyncio.gather(*(fetch(name, live, gate) for name in names)))
~~~

## A coroutine driven by hand

`drive` runs a coroutine with no event loop at all. It sends into it once and never reads what came back out.

@expect raises:StopIteration
@hint A coroutine reports its return value the way a generator does. How?
@hint Unit 16 said what `StopIteration` carries.
@diagnose StopIteration This is the whole mechanism, uncovered. A coroutine supports `send`, exactly as a generator does: `send(None)` starts it, it runs to its first suspension, and when it finishes it raises `StopIteration` carrying the return value in `.value`. There is no event loop here and none is needed, because this coroutine never awaits anything that actually suspends. An event loop is a `while` loop around this: send into whatever is ready, note what each one suspended waiting for, and send the value back in when it arrives. Seeing it once settles the questions that make async confusing, including why a coroutine does nothing until awaited, and why a blocking call stops everything.

~~~starter
async def add(a, b):
    return a + b


def drive(coro):
    """Run a coroutine to completion without an event loop, and return its value."""
    coro.send(None)


print(drive(add(1, 2)))
~~~

~~~tests
assert drive(add(1, 2)) == 3
assert drive(add(0, 0)) == 0


async def nothing():
    pass


assert drive(nothing()) is None
~~~

~~~solution
async def add(a, b):
    return a + b


def drive(coro):
    """Run a coroutine to completion without an event loop, and return its value."""
    try:
        coro.send(None)
    except StopIteration as stop:
        return stop.value
    raise RuntimeError("the coroutine suspended, and nothing here can resume it")


print(drive(add(1, 2)))
~~~

## Iterated the synchronous way

`collect` walks an async generator with an ordinary `for`. An async generator is iterated with `async for`, and nothing else will do.

@expect raises:TypeError
@hint The object defines `__aiter__` and `__anext__`, not `__iter__` and `__next__`.
@hint Unit 22's protocols, with an `a` on the front.
@diagnose TypeError An `async def` containing `yield` is an **async generator**, and it implements `__aiter__` and `__anext__` rather than `__iter__` and `__next__`, so an ordinary `for` finds nothing to iterate. `async for` is the form that uses them, and it awaits each step, which is the point: it is how you consume something that has to wait between items, such as a paginated API or a stream of rows. `async with` is the same idea for unit 22's context manager protocol, using `__aenter__` and `__aexit__`. The rule is worth stating plainly: every protocol from unit 22 has an async twin, spelled the same way with an `a`, and the async form can await where the synchronous one cannot.

~~~starter
import asyncio


async def pages(count):
    """Yield each page, waiting between them the way a real API would."""
    for number in range(count):
        await asyncio.sleep(0)
        yield f"page {number}"


async def collect(count):
    """Every page, in order."""
    out = []
    for page in pages(count):
        out.append(page)
    return out
~~~

~~~tests
assert asyncio.run(collect(3)) == ["page 0", "page 1", "page 2"]
assert asyncio.run(collect(0)) == []
~~~

~~~solution
import asyncio


async def pages(count):
    """Yield each page, waiting between them the way a real API would."""
    for number in range(count):
        await asyncio.sleep(0)
        yield f"page {number}"


async def collect(count):
    """Every page, in order."""
    out = []
    async for page in pages(count):
        out.append(page)
    return out
~~~
