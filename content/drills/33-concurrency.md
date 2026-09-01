---
slug: 33-concurrency
---

## The GIL guarantees
- (x) One thread executes Python bytecode at a time, in one process
- ( ) One thread runs at a time across all processes
- ( ) Each line of Python is atomic
- ( ) Shared data needs no locks
> It exists to make reference counting correct without a lock on every object.

## Threads make CPU-bound Python
- (x) No faster, and sometimes slower once you count the switching
- ( ) Faster in proportion to cores
- ( ) Faster only above four cores
- ( ) Faster if you use more of them
> The lock is held while computing. It is released around waiting.

## The whole decision rule is
- (x) Is the work waiting, or computing
- ( ) How many cores are there
- ( ) How much memory is available
- ( ) How many tasks are there
> Waiting means threads or async. Computing means processes.

## `x += 1` on a shared counter is
- (x) A read, an add and a write, so a switch between any two loses an update
- ( ) Atomic under the GIL
- ( ) Atomic for integers
- ( ) Safe if the value is small
> The GIL guarantees one bytecode at a time, not one line at a time.

## Relying on which operations happen to be atomic is
- (x) A bad idea: it is an implementation detail, and the reasoning is invisible on the page
- ( ) Fine; the set is documented
- ( ) Faster than locking
- ( ) Required for lock-free code
> An uncontended lock costs far less than the bug does.

## `if k not in d: d[k] = v`
- (x) Is two operations with a window between them, where a second worker reaches the same conclusion
- ( ) Is atomic
- ( ) Is safe because `d[k] = v` is one bytecode
- ( ) Raises under contention
> `setdefault` does both as one operation, and `defaultdict` does it with a factory.

## Two locks taken in different orders by two workers
- (x) Deadlock, and the fix is a global order for acquiring them
- ( ) Deadlock, and the fix is a timeout
- ( ) Are safe if both are released
- ( ) Cannot happen with `with`
> Neither function is wrong alone. The bug exists only in the combination.

## Processes differ from threads in that
- (x) They have separate interpreters and separate locks, and share nothing
- ( ) They are cheaper to start
- ( ) They share memory
- ( ) They are limited by the GIL
> Which makes them genuinely parallel, and makes everything crossing between them a copy.

## Passing a large dataset to a process pool
- (x) Costs pickling, copying and unpickling, which can exceed the work saved
- ( ) Is free; memory is shared
- ( ) Is done by reference
- ( ) Is faster than threads always
> Invisible in a small test and decisive in a real one.

## An exception raised inside a worker
- (x) Is stored in its `Future` and re-raised when somebody calls `.result()`
- ( ) Propagates immediately
- ( ) Kills the pool
- ( ) Is printed and ignored
> `.done()` is true either way, so a pool nobody reads swallows every failure.

## `pool.map` against `as_completed`
- (x) `map` gives results in input order; `as_completed` yields them as they finish
- ( ) They are the same
- ( ) `map` is faster
- ( ) `as_completed` preserves order too
> Choosing between them is a question about what the caller does with the results.

## A running thread
- (x) Cannot be killed; it has to check a signal between units of work
- ( ) Can be stopped with `thread.stop()`
- ( ) Is killed when the main thread exits
- ( ) Can be interrupted with an exception
> Stopping one at an arbitrary instruction would leave whatever it held in an unknown state.

## `daemon=True` on a thread
- (x) Means the interpreter does not wait for it at exit, stopping it wherever it is
- ( ) Restarts it if it dies
- ( ) Gives it lower priority
- ( ) Makes it interruptible
> Right for a background heartbeat, wrong for anything holding data.

## Between threads and `asyncio` for I/O
- (x) Threads are simpler; async scales further. A hundred tasks: either. Ten thousand: async
- ( ) Async is always better
- ( ) Threads are always better
- ( ) They perform identically
> A thread each at ten thousand connections is too much memory before it is too slow.

## A concurrency test that passes
- (x) Proves little, because the failure depends on an interleaving you do not control
- ( ) Proves the code is correct
- ( ) Should be run once
- ( ) Is enough with 100% coverage
> Run it many times and under load, and prefer a design that removes the race to a test that hopes to catch one.
