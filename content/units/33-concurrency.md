---
slug: 33-concurrency
title: Concurrency models
---

Python gives you three ways to do more than one thing, and choosing wrongly costs more than any amount of tuning within the wrong choice. This unit is about which to reach for and why, and the answer follows almost entirely from one fact.

## The GIL

CPython has a **global interpreter lock**: one lock that must be held to execute Python bytecode. One thread runs Python at a time, in one process, however many threads you start and however many cores you have.

It exists because it makes reference counting, and therefore the whole memory model, correct without a lock on every object. That trade has been made and remade for thirty years, and the current answer is that removing it costs single-threaded speed, which most programs care about more.

Two consequences, and they are the whole of this unit's advice.

**Threads do not make CPU-bound Python faster.** Four threads doing arithmetic take as long as one, plus the switching. Sometimes longer.

**Threads do help with waiting.** The lock is released around I/O: a socket read, a file read, a `time.sleep`. So a hundred threads waiting on a hundred requests genuinely wait at the same time.

That is the whole decision rule. **Is the work waiting, or is it computing?**

Two footnotes worth having. Some C extensions release the lock while working, which is why `numpy` on a large array does use several cores. And 3.13 introduced a genuinely free-threaded build, without the lock, which is opt-in, still maturing, and slower on single-threaded code; it is worth watching and not yet the default answer.

## The three models

**Threads**, `threading` and `concurrent.futures.ThreadPoolExecutor`. Several threads in one process, sharing memory. Right for I/O-bound work. Cheap to start, and they share everything, which is both the convenience and the danger.

**Processes**, `multiprocessing` and `ProcessPoolExecutor`. Separate interpreters with separate GILs, so they genuinely run in parallel. Right for CPU-bound work. Expensive to start, and nothing is shared: arguments and results are pickled and copied, which means passing a large array costs more than the work sometimes.

**async**, `asyncio`. One thread, one task at a time, switching at every `await`. Right for I/O-bound work at high concurrency, thousands of connections, where a thread each would be too much memory. Unit 34 is about it in full.

Between threads and async for I/O the honest answer is that threads are simpler and async scales further. A hundred concurrent requests: either. Ten thousand: async.

## What sharing memory costs

Threads share everything, which is why they are easy and why they are dangerous.

```python
count = 0

def increment():
    global count
    for _ in range(100_000):
        count += 1
```

Two threads running that do not produce 200,000. `count += 1` is a read, an add and a write, and a thread can be switched out between any two of them, so both read the same value and both write the same result.

The GIL does not save you. It guarantees one thread executes bytecode at a time, not that a line of Python is one bytecode. Anything that is read-modify-write is a race, and that is most things.

The fixes, in order of preference.

**Do not share.** Give each thread its own data and combine the results at the end. This is what a `ThreadPoolExecutor` with a return value does naturally, and it removes the problem rather than managing it.

**Use a queue.** `queue.Queue` is thread-safe and is the standard way to hand work between threads. Producers put, consumers get, and no lock appears in your code.

**Use a lock.** `with lock:` around the read-modify-write. Correct and the easiest to get wrong at scale, because two locks taken in different orders by two threads is a deadlock, and the fix is a global order for acquiring them.

## What is and is not atomic

The question "is this operation safe without a lock" comes up constantly, and the honest answer is that the rule is not worth learning.

A single bytecode cannot be interrupted, so `list.append(x)` is atomic today and `d[k] = v` is atomic today, because each is one call into C that does not run Python. `x += 1` is not, because it is three bytecodes. `if k not in d: d[k] = v` is emphatically not, because it is two operations with a window between them, and that window is where the second thread does the same test.

Two reasons not to rely on any of it. The set of atomic operations is a CPython implementation detail rather than a promise, and it has changed. And code that is correct only because of which operations happen to be single bytecodes is code nobody can review, because the reasoning is invisible on the page.

Write the lock, or better, arrange not to need one. The performance cost of an uncontended lock is far smaller than the cost of the bug.

## Cancellation and shutdown

A thread cannot be killed. There is no `thread.stop()`, deliberately, because stopping a thread at an arbitrary point would leave whatever it held in an unknown state.

What you do instead is ask. A `threading.Event` that the worker checks between units of work is the standard shape: the main thread sets it, the worker notices and returns. That means every long-running worker needs a loop with somewhere to check, which is a design constraint worth knowing before you write one rather than after.

`daemon=True` marks a thread the interpreter will not wait for at exit. It is the right answer for a background heartbeat and the wrong one for anything holding data, because the thread is stopped wherever it happens to be, with no cleanup and no `finally`.

Processes can be killed, with `terminate()`, and the same warning applies one level up: whatever it was writing is left as it was.

## `concurrent.futures`

One interface over both threads and processes, and the one to reach for by default:

```python
from concurrent.futures import ThreadPoolExecutor

with ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(fetch, urls))
```

Changing `ThreadPoolExecutor` to `ProcessPoolExecutor` changes the model and nothing else, which makes it cheap to find out which is faster instead of arguing about it.

`pool.map` returns results in input order and raises the first exception when you reach it. `pool.submit` returns a `Future`, and `as_completed` yields them in finishing order, which is what you want when you are reporting progress or want the fast answers first.

The `with` block waits for everything to finish. A pool you forget to shut down keeps the program alive, which is unit 22's argument for the protocol.

## Testing concurrent code

Two properties make a concurrency bug different from every other kind, and both follow from the same thing: the failure depends on an interleaving you do not control.

It is **intermittent**, so a passing test proves nothing. A race that appears one run in a thousand passes your suite every day and fails in production on a loaded machine.

And it is **not reproducible from the traceback**, because the traceback shows where the damage was noticed rather than where it was done.

The practical consequences are worth adopting. Run the concurrent test many times, not once, and under load if you can. Prefer a design that removes the race to a test that hopes to catch one. And where the logic can be separated from the concurrency, test the logic on its own: a function that takes the shared state as an argument is testable without a single thread, and that is usually the better structure anyway.

This book's own build applies the same principle to a smaller version of the problem, running every exercise under two hash seeds so that an accidental dependence on set ordering fails immediately rather than one time in twenty.

## The mistakes worth naming

**Sharing a mutable object between threads without a lock.** The bug appears on a loaded machine, in production, once a week.

**Assuming threads help with CPU work.** Measure. It is usually slower.

**Passing large data to processes.** Pickling a gigabyte to save a second of work is a loss, and it is invisible in a small test.

**Starting more workers than the work needs.** More threads than cores does nothing for CPU work; more than a few dozen for I/O work usually means async was the answer.

**Catching nothing from a future.** An exception in a worker is stored in the `Future` and raised when you read the result. If nobody reads it, it disappears, and the task silently did nothing.

## Choosing, in one paragraph

If the work is waiting on the network, disk or another process, use threads for tens of tasks and `asyncio` for thousands. If the work is computing, use processes, and check that the data you have to send is small compared with the work. If you cannot tell which it is, measure one before building either, because unit 35's first rule is that nobody guesses this correctly, including the people who wrote the program.
