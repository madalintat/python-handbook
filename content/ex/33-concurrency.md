---
slug: 33-concurrency
---

## A counter two threads agree on the wrong number for

`increment` reads, adds and writes. `interleave` runs two of them the way a scheduler might, switching between the steps, and the result is lost updates.

@expect silent
@hint How many operations is `count += 1`? Where can a switch happen?
@hint Nothing here is atomic. The fix has to make the three steps one.
@diagnose silent It runs and reports fewer than it should, because `count += 1` is a read, an add and a write, and a switch between any two of them means both workers read the same value and both write the same result. The GIL does not prevent this: it guarantees that one thread executes bytecode at a time, not that a line of Python is one bytecode, and almost everything interesting is read-modify-write. Holding a lock across all three steps is the direct fix. Not sharing the counter at all, giving each worker its own and adding them at the end, is the better one, because it removes the problem instead of managing it.

~~~starter
class Counter:
    def __init__(self):
        self.count = 0
        self.locked = False

    def increment(self):
        """Yield between each step, the way a thread switch would."""
        yield
        value = self.count
        yield
        self.count = value + 1
        yield


def interleave(workers):
    """Run these generators one step at a time, in turn."""
    running = list(workers)
    while running:
        for worker in list(running):
            if next(worker, "done") == "done":
                running.remove(worker)
    return running
~~~

~~~tests
c = Counter()
interleave([c.increment() for _ in range(2)])
assert c.count == 2, f"two increments produced {c.count}"

d = Counter()
interleave([d.increment() for _ in range(5)])
assert d.count == 5
~~~

~~~solution
class Counter:
    def __init__(self):
        self.count = 0
        self.locked = False

    def increment(self):
        """Yield between each step, the way a thread switch would."""
        while self.locked:
            yield
        self.locked = True
        value = self.count
        yield
        self.count = value + 1
        self.locked = False
        yield


def interleave(workers):
    """Run these generators one step at a time, in turn."""
    running = list(workers)
    while running:
        for worker in list(running):
            if next(worker, "done") == "done":
                running.remove(worker)
    return running
~~~

## Two locks taken in two orders

`transfer` locks the account it takes from and then the one it pays into. Two transfers in opposite directions each hold what the other is waiting for.

@expect raises:Deadlock
@hint Write down which lock each transfer holds and which it wants.
@hint The fix is not a timeout. It is an order.
@diagnose Deadlock The two transfers deadlocked: each held one lock and waited for the other, so neither could proceed. Nothing about either function is wrong on its own, which is what makes this so hard to find; the bug exists only in the combination, and only when the two run at the same time. The fix is a **global order**: every piece of code that needs several locks takes them in the same order, here by sorting on the account name, so a cycle cannot form. That rule is worth adopting outright, because the alternatives, timeouts and retries, turn a deadlock into a livelock and hide the design problem rather than removing it.

~~~starter
class Deadlock(RuntimeError):
    """Every transfer is waiting for a lock somebody else holds."""


def transfer(source, target, amount, held):
    """Lock both accounts, then move the money."""
    return [source, target], amount


def run_transfers(transfers):
    """Interleave transfers: each takes its first lock, then its second."""
    held: dict[str, int] = {}
    plans = [transfer(*t, held) for t in transfers]
    for index, (order, _amount) in enumerate(plans):
        held[order[0]] = index
    for index, (order, _amount) in enumerate(plans):
        owner = held.get(order[1])
        if owner is not None and owner != index:
            raise Deadlock(f"transfer {index} waits for a lock held by {owner}")
    return [amount for _order, amount in plans]
~~~

~~~tests
assert run_transfers([("alice", "bob", 10)]) == [10]
assert run_transfers([("alice", "bob", 10), ("bob", "alice", 5)]) == [10, 5]
assert run_transfers([("alice", "bob", 1), ("alice", "carol", 2)]) == [1, 2]
~~~

~~~solution
class Deadlock(RuntimeError):
    """Every transfer is waiting for a lock somebody else holds."""


def transfer(source, target, amount, held):
    """Lock both accounts in a fixed global order, then move the money."""
    return sorted([source, target]), amount


def run_transfers(transfers):
    """Interleave transfers: each takes its first lock, then its second."""
    held: dict[str, int] = {}
    plans = [transfer(*t, held) for t in transfers]
    for index, (order, _amount) in enumerate(plans):
        held[order[0]] = index
    for index, (order, _amount) in enumerate(plans):
        owner = held.get(order[1])
        if owner is not None and owner != index:
            raise Deadlock(f"transfer {index} waits for a lock held by {owner}")
    return [amount for _order, amount in plans]
~~~

## Threads for work that never waits

`choose_pool` picks a pool for a job. It picks threads for everything, so the CPU-bound job gets no parallelism at all.

@expect silent
@hint The GIL means one thread runs Python at a time. What does that leave threads good for?
@hint Ask what the work is doing: waiting, or computing.
@diagnose silent Nothing raised, and the CPU-bound job was given threads, which for arithmetic in one process is one core plus the cost of switching, and is sometimes slower than not bothering. The whole decision rule is one question: **is the work waiting, or computing?** Waiting work releases the lock, so threads genuinely overlap; computing work holds it, so they do not. Processes have separate interpreters and separate locks, so they genuinely run in parallel, at the cost of starting them and of copying everything in and out. `concurrent.futures` gives both the same interface precisely so that changing your mind is a one-word edit.

~~~starter
JOBS = {
    "fetch_urls": "waiting",
    "resize_images": "computing",
    "read_files": "waiting",
    "hash_passwords": "computing",
}


def choose_pool(job):
    """Which executor this job should run on."""
    return "ThreadPoolExecutor"
~~~

~~~tests
assert choose_pool("fetch_urls") == "ThreadPoolExecutor"
assert choose_pool("read_files") == "ThreadPoolExecutor"
assert choose_pool("resize_images") == "ProcessPoolExecutor", (
    f"CPU-bound work was given {choose_pool('resize_images')}"
)
assert choose_pool("hash_passwords") == "ProcessPoolExecutor"
~~~

~~~solution
JOBS = {
    "fetch_urls": "waiting",
    "resize_images": "computing",
    "read_files": "waiting",
    "hash_passwords": "computing",
}


def choose_pool(job):
    """Which executor this job should run on."""
    if JOBS[job] == "computing":
        return "ProcessPoolExecutor"
    return "ThreadPoolExecutor"
~~~

## A failure stored in a future nobody read

`run_all` submits every task and collects the ones that finished. An exception in a worker is kept in its future until somebody asks, and nobody asks.

@expect silent
@hint Where does an exception raised inside a worker go?
@hint `future.result()` re-raises it. What does this code call instead?
@diagnose silent Nothing raised, and a task that failed was reported as having succeeded. A `Future` holds either a result or an exception, and reading `.result()` is what re-raises it; checking `.done()` tells you only that the worker stopped, which it does either way. So a pool of tasks where nobody reads the results swallows every failure silently, and the work quietly did not happen. This is the most common way concurrent code goes wrong without anybody noticing, and the fix is to read every result, or to call `.exception()` deliberately when a failure is expected and should be counted rather than raised.

~~~starter
class Future:
    """A result that is not ready yet, or an exception that was raised."""

    def __init__(self, fn):
        self._value = self._error = None
        try:
            self._value = fn()
        except Exception as exc:
            self._error = exc

    def done(self):
        return True

    def result(self):
        if self._error is not None:
            raise self._error
        return self._value


def run_all(tasks):
    """Run every task, and report which succeeded."""
    futures = [Future(task) for task in tasks]
    return [f.done() for f in futures]
~~~

~~~tests
def ok():
    return "ok"


def broken():
    raise ValueError("no")


assert run_all([ok, ok]) == [True, True]
assert run_all([ok, broken]) == [True, False], (
    f"a failing task was reported as {run_all([ok, broken])}"
)
~~~

~~~solution
class Future:
    """A result that is not ready yet, or an exception that was raised."""

    def __init__(self, fn):
        self._value = self._error = None
        try:
            self._value = fn()
        except Exception as exc:
            self._error = exc

    def done(self):
        return True

    def result(self):
        if self._error is not None:
            raise self._error
        return self._value


def run_all(tasks):
    """Run every task, and report which succeeded."""
    futures = [Future(task) for task in tasks]
    succeeded = []
    for future in futures:
        try:
            future.result()
        except Exception:
            succeeded.append(False)
        else:
            succeeded.append(True)
    return succeeded
~~~

## A worker with nowhere to notice it should stop

`work` loops until it is done and never looks at the stop signal. A thread cannot be killed, so a worker that does not check never stops.

@expect silent
@hint There is no `thread.stop()`, on purpose. So how does a worker learn it should finish?
@hint The loop needs somewhere to look, once per unit of work.
@diagnose silent Nothing raised, and the worker processed everything after being asked to stop, because nothing in its loop looks at the signal. There is deliberately no way to kill a thread: stopping one at an arbitrary instruction would leave whatever it held in an unknown state, with no `finally` and no cleanup. So the only mechanism is cooperative, and the standard shape is a `threading.Event` the worker checks between units of work. That is a design constraint rather than an afterthought: every long-running worker needs somewhere to check, and deciding where that is belongs at the point you write the loop rather than the day you first need to shut it down.

~~~starter
class StopSignal:
    def __init__(self):
        self.set = False


def work(items, stop, budget):
    """Process items until they run out, or until asked to stop."""
    done = []
    for step, item in enumerate(items):
        if step >= budget:
            raise TimeoutError(f"still running after {budget} steps")
        done.append(item)
    return done
~~~

~~~tests
stop = StopSignal()
assert work([1, 2, 3], stop, budget=10) == [1, 2, 3]

stop.set = True
assert work([1, 2, 3], stop, budget=10) == [], "the worker ignored the stop signal"

late = StopSignal()
assert work(range(100), late, budget=200) == list(range(100))
~~~

~~~solution
class StopSignal:
    def __init__(self):
        self.set = False


def work(items, stop, budget):
    """Process items until they run out, or until asked to stop."""
    done = []
    for step, item in enumerate(items):
        if stop.set:
            return done
        if step >= budget:
            raise TimeoutError(f"still running after {budget} steps")
        done.append(item)
    return done
~~~

## A check and an insert with a gap between them

`get_or_create` tests whether a key is present and then adds it. Two workers reaching that gap together both decide to create.

@expect silent
@hint Two operations with a window between them. What happens if a switch lands in the window?
@hint `dict.setdefault` does both in one step.
@diagnose silent Both workers created a connection, so one of them was thrown away and the count is wrong. `if key not in d: d[key] = value` is two operations, and the window between them is exactly where the second worker does the same test and reaches the same conclusion. It is worth being precise about why relying on atomicity does not save you here: `d[k] = v` on its own happens to be a single bytecode today, but this is two of them, and the sequence is what matters. `setdefault` performs the test and the insert as one operation, and `collections.defaultdict` does the same thing with a factory, which unit 12 covered for a different reason.

~~~starter
CREATED: list[str] = []


def connect(name):
    CREATED.append(name)
    return f"connection to {name}"


def get_or_create(pool, name, switch_after_check=False):
    """Return the pooled connection for this name, making one if needed."""
    if name not in pool:
        if switch_after_check:
            get_or_create(pool, name)
        pool[name] = connect(name)
    return pool[name]
~~~

~~~tests
CREATED.clear()
pool: dict[str, str] = {}
first = get_or_create(pool, "db", switch_after_check=True)
assert CREATED == ["db"], f"the connection was made {len(CREATED)} times"
assert pool["db"] is first, "the pool holds a connection the first caller never got"
~~~

~~~solution
CREATED: list[str] = []


def connect(name):
    CREATED.append(name)
    return f"connection to {name}"


def get_or_create(pool, name, switch_after_check=False):
    """Return the pooled connection for this name, making one if needed."""
    if switch_after_check and name not in pool:
        get_or_create(pool, name)
    if name not in pool:
        pool[name] = connect(name)
    return pool[name]
~~~

## More work sent than the work is worth

`plan` decides how to split a job across processes. It sends the whole dataset to each worker, so the copying costs more than the computing saves.

@expect silent
@hint Processes share nothing. What has to happen to the arguments and the results?
@hint Each worker only needs its own slice.
@diagnose silent It runs, and each of the four workers was sent the entire dataset, so four times the data was pickled, copied and unpickled to do a quarter of the work each. Processes have separate interpreters, which is what makes them genuinely parallel and what makes everything crossing between them a copy. That cost is invisible in a small test and decisive in a real one: pickling a gigabyte to save a second of arithmetic is a loss. The rule is to send each worker only what it needs, and before reaching for processes at all, to compare the size of the data against the size of the work.

~~~starter
def plan(data, workers):
    """What each worker should be sent."""
    return [list(data) for _ in range(workers)]
~~~

~~~tests
data = list(range(8))
sent = plan(data, 4)
assert len(sent) == 4
assert sum(len(chunk) for chunk in sent) == 8, (
    f"{sum(len(c) for c in sent)} items were sent to do 8 items of work"
)
assert sorted(item for chunk in sent for item in chunk) == data
assert plan([], 3) == [[], [], []]
~~~

~~~solution
def plan(data, workers):
    """What each worker should be sent."""
    items = list(data)
    size = -(-len(items) // workers) if workers else 0
    return [items[i * size : (i + 1) * size] for i in range(workers)]
~~~

## Results in the order they were asked for

`first_answers` wants the fastest results first, to report progress. It reads the futures in submission order, so a slow first task blocks every fast one behind it.

@expect silent
@hint `pool.map` preserves input order. Which function yields futures as they finish?
@hint The tasks record how long they took. Use it.
@diagnose silent It runs and returns the results in the order they were submitted, so a slow first task holds up every fast one behind it. `pool.map` preserving input order is the right default and exactly wrong when you want the fast answers first: for reporting progress, for taking the first acceptable answer, or for anything where a straggler should not block the rest. `concurrent.futures.as_completed(futures)` yields each future as it finishes, in completion order, and is the whole of the fix. The two are worth knowing as a pair, because choosing between them is a question about what the caller does with the results rather than about performance.

~~~starter
TASKS = [("slow", 30), ("quick", 1), ("medium", 10)]


def first_answers(tasks):
    """Task names in the order their results actually become available."""
    return [name for name, _duration in tasks]
~~~

~~~tests
assert first_answers(TASKS) == ["quick", "medium", "slow"], (
    f"got {first_answers(TASKS)}"
)
assert first_answers([("only", 5)]) == ["only"]
assert first_answers([]) == []
~~~

~~~solution
TASKS = [("slow", 30), ("quick", 1), ("medium", 10)]


def first_answers(tasks):
    """Task names in the order their results actually become available."""
    return [name for name, _duration in sorted(tasks, key=lambda t: t[1])]
~~~
