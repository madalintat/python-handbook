---
slug: 16-generators
---

## The validation that never ran

`parse_all` checks its input and then yields the parsed rows. Because the function contains `yield`, calling it runs none of the body, so the check happens on the first `next` rather than at the call.

@expect silent
@hint A function containing `yield` runs nothing when you call it. When does its first line execute?
@hint Split it: a normal function that validates and returns the generator an inner function produces.
@diagnose silent Nothing raised at the call, and the caller was handed a generator that will raise later, somewhere else, when something finally asks it for a value. This is the least obvious consequence of `yield` being in the body: the whole function becomes lazy, including the parts you wrote to fail early. The fix is to split the two jobs. An ordinary function does the validation eagerly and returns the result of calling an inner generator function, so the check raises at the call site and the yielding still happens lazily. It is worth doing whenever an argument error should be reported to whoever passed the argument.

~~~starter
def parse_all(rows, sep):
    """Parse each row. A blank separator is rejected straight away."""
    if not sep:
        raise ValueError("separator must not be empty")
    for row in rows:
        yield row.split(sep)
~~~

~~~tests
try:
    parse_all(["a,b"], "")
except ValueError:
    pass
else:
    raise AssertionError("the empty separator was accepted at the call")
assert list(parse_all(["a,b", "c,d"], ",")) == [["a", "b"], ["c", "d"]]
~~~

~~~solution
def parse_all(rows, sep):
    """Parse each row. A blank separator is rejected straight away."""
    if not sep:
        raise ValueError("separator must not be empty")

    def parsed():
        for row in rows:
            yield row.split(sep)

    return parsed()
~~~

## return does not yield

`take_until` yields values up to a marker and means to yield a final summary line. `return` inside a generator ends it, and the value goes to the exception rather than to the caller.

@expect silent
@hint What does `return value` do inside a generator? It is not a `yield`.
@hint The value ends up on the `StopIteration`, where a `for` loop never sees it.
@diagnose silent It runs and the final line is missing. Inside a generator `return` stops it, and `return value` attaches the value to the `StopIteration` it raises rather than producing it: a `for` loop catches that exception and discards what it carries, so the value is invisible to every ordinary consumer. It is reachable as `exc.value` and exists mainly so that `yield from` can pass a result back from a delegated generator. If you meant to produce one last item, `yield` it and then `return` with nothing.

~~~starter
def take_until(lines, marker):
    """Yield lines up to the marker, then a final count line."""
    seen = 0
    for line in lines:
        if line == marker:
            return f"{seen} lines"
        seen += 1
        yield line
    return f"{seen} lines"
~~~

~~~tests
assert list(take_until(["a", "b", "STOP", "c"], "STOP")) == ["a", "b", "2 lines"]
assert list(take_until(["a"], "STOP")) == ["a", "1 lines"]
assert list(take_until([], "STOP")) == ["0 lines"]
~~~

~~~solution
def take_until(lines, marker):
    """Yield lines up to the marker, then a final count line."""
    seen = 0
    for line in lines:
        if line == marker:
            break
        seen += 1
        yield line
    yield f"{seen} lines"
~~~

## A bare next inside a generator

`pairs` groups a source into twos. It calls `next` without a default, and when the source runs out at an odd moment that signal escapes the generator.

@expect raises:RuntimeError
@hint What happens to a `StopIteration` raised inside a generator?
@hint `next(source, default)` never raises. That is the whole fix.
@diagnose RuntimeError "generator raised StopIteration". Before Python 3.7 this was far worse: the `StopIteration` escaped and was caught by whatever was iterating the outer generator, which read it as "this generator is finished", so the loop stopped early, silently, with nothing to find. PEP 479 converts it into a `RuntimeError` so the failure is loud and points at the generator. The rule that survives the fix: inside a generator, a bare `next(inner)` is an edge. Give it a default, or catch `StopIteration` and decide what the generator should do, which is nearly always to `return`.

~~~starter
def pairs(source):
    """Yield the values two at a time, padding a final odd one with None."""
    for first in source:
        yield first, next(source)


print(list(pairs(iter([1, 2, 3]))))
~~~

~~~tests
assert list(pairs(iter([1, 2, 3, 4]))) == [(1, 2), (3, 4)]
assert list(pairs(iter([1, 2, 3]))) == [(1, 2), (3, None)]
assert list(pairs(iter([]))) == []
~~~

~~~solution
def pairs(source):
    """Yield the values two at a time, padding a final odd one with None."""
    for first in source:
        yield first, next(source, None)


print(list(pairs(iter([1, 2, 3]))))
~~~

## An iterable that is only iterable once

`Log` makes itself iterable by returning a generator, and stores that generator on the instance so it does not have to build one each time. The saving costs it every walk after the first.

@expect silent
@hint `__iter__` is called once per `for` loop. What should it return each time?
@hint A generator function called twice gives two independent generators.
@diagnose silent Nothing raised, and the second walk found nothing. Building the generator once in `__init__` and handing the same object back from `__iter__` makes this an iterator wearing an iterable's shape, with exactly the single-use problem unit 15's `__iter__ = self` had. A generator function called again gives a completely new generator with its own state, so `__iter__` should *be* the generator function: put the `yield` in `__iter__` itself and every loop gets a fresh one. That is the standard way to make a class reusably iterable, and it is why it costs three lines rather than a class.

~~~starter
class Log:
    def __init__(self, entries):
        self.entries = list(entries)
        self._gen = (e for e in self.entries)

    def __iter__(self):
        return self._gen
~~~

~~~tests
log = Log(["a", "b"])
assert list(log) == ["a", "b"]
assert list(log) == ["a", "b"], "the log was empty the second time"
assert sum(1 for _ in log) == 2
~~~

~~~solution
class Log:
    def __init__(self, entries):
        self.entries = list(entries)

    def __iter__(self):
        yield from self.entries
~~~

## The list in the middle of the pipeline

`recent` filters a stream and takes the first few. It sorts partway through, which forces the whole stream through that point and throws away the laziness of everything upstream.

@expect silent
@hint How many items does the stream produce before this function can return three?
@hint `sorted` has to see everything before it can return anything.
@diagnose silent Nothing raised, and the function consumed the entire source to return three items. A chain of generators does only the work that is used, and one eager step anywhere in the middle destroys that: `sorted` cannot yield its first value until it has seen the last input, so everything upstream runs to completion. So does a list comprehension, a `len`, or a `max`. Here the source is deliberately unbounded-ish and counts how far it was read. When you want the first few in order, `heapq.nsmallest` walks once holding only as many as you asked for, which unit 14 made the case for; when order does not matter, taking values until you have enough and then breaking reads the source only as far as it had to. Unit 17 has `itertools.islice`, which says that in one expression.

~~~starter
def recent(stream, count):
    """Return the first `count` positive values from the stream, in order."""
    positives = (n for n in stream if n > 0)
    ordered = sorted(positives)
    return ordered[:count]
~~~

~~~tests
read = []


def counted(values):
    for v in values:
        read.append(v)
        yield v


values = list(range(1, 5001))
out = recent(counted(values), 3)
assert out == [1, 2, 3], f"got {out}"
assert len(read) < 100, f"read {len(read)} values to return three"
~~~

~~~solution
def recent(stream, count):
    """Return the first `count` positive values from the stream, in order."""
    out = []
    for value in stream:
        if value > 0:
            out.append(value)
            if len(out) == count:
                break
    return out
~~~

## A generator that was never asked

`warm_cache` looks like it fills a cache for each key. It contains `yield`, so calling it does nothing at all, and the caller never consumes the result.

@expect silent
@hint A function with `yield` in it returns a generator and runs none of its body.
@hint If the work should happen when called, the function should not be a generator.
@diagnose silent Nothing raised, and the cache stayed empty, because the body never ran. This is the shape to recognise: a `yield` somewhere in a function turns the whole thing lazy, and a caller who ignores the return value gets no work done and no error either. It is especially easy to write when the `yield` was added later, to report progress, in a function whose job is a side effect. Either drop the `yield` and do the work, or keep it and make every caller consume the result, which usually means the function should not have been a generator in the first place.

~~~starter
def warm_cache(keys, store, load):
    """Load every key into the cache, reporting each one as it is done."""
    for key in keys:
        store[key] = load(key)
        yield key
~~~

~~~tests
store = {}
warm_cache(["a", "b"], store, str.upper)
assert store == {"a": "A", "b": "B"}, f"nothing was loaded: {store}"
~~~

~~~solution
def warm_cache(keys, store, load):
    """Load every key into the cache, reporting each one as it is done."""
    done = []
    for key in keys:
        store[key] = load(key)
        done.append(key)
    return done
~~~

## Delegating, one level short

`flatten` should yield every cell of a grid. It yields each row instead of yielding from it, so the caller gets rows where cells were promised.

@expect silent
@expect ruff:UP028
@hint `yield row` produces the row. What produces the row's contents?
@hint There is a form that delegates to another iterable.
@diagnose UP028 ruff's `UP028` is "replace `yield` over `for` loop with `yield from`". It fires on the shape rather than on the bug, and the two happen to coincide here: the loop it wants replaced is the one yielding the wrong thing.
@diagnose silent It runs and hands back the same shape it was given, one level short of flat. `yield row` produces the row itself as one value; `yield from row` produces every value the row contains, which is what delegation means. The loop equivalent, `for cell in row: yield cell`, is exactly the same for plain iteration, and `yield from` says the intent more plainly and does more besides: it forwards `send`, `throw` and `close` to the inner generator and passes back its return value, which matters as soon as the thing being delegated to is itself a generator with state.

~~~starter
def flatten(grid):
    """Yield every cell of the grid."""
    for row in grid:
        yield row
~~~

~~~tests
assert list(flatten([[1, 2], [3]])) == [1, 2, 3]
assert list(flatten([])) == []
assert list(flatten([[], [1]])) == [1]
~~~

~~~solution
def flatten(grid):
    """Yield every cell of the grid."""
    for row in grid:
        yield from row
~~~

## Priming a generator that receives

`running_total` accepts numbers with `send` and reports the total so far. A freshly created generator is paused before its first line, so there is no `yield` for the first sent value to become.

@expect raises:TypeError
@hint A new generator has not started. Where would `send`'s value be delivered?
@hint It has to be advanced to its first `yield` before it can receive anything.
@diagnose TypeError "can't send non-None value to a just-started generator". A generator that has never been advanced is in the `GEN_CREATED` state: no code has run, so it is not paused at a `yield` and there is nowhere for the value to go. Priming it, with `next(g)` or `g.send(None)`, runs the body up to the first `yield` and leaves it suspended there, ready to receive. This is why two-way generators are usually wrapped in a small function or a decorator that primes them, and it is one of the reasons a class is often clearer when something genuinely needs to receive rather than produce.

~~~starter
def make_total():
    """Return a generator that accumulates numbers sent to it."""
    total = 0
    while True:
        n = yield total
        total += n


acc = make_total()
print(acc.send(10))
~~~

~~~tests
acc = make_total()
assert acc.send(10) == 10
assert acc.send(5) == 15
assert acc.send(0) == 15
~~~

~~~solution
def _accumulate():
    total = 0
    while True:
        n = yield total
        total += n


def make_total():
    """Return a generator that accumulates numbers sent to it, ready to receive."""
    generator = _accumulate()
    next(generator)          # run it up to the first yield
    return generator


acc = make_total()
print(acc.send(10))
~~~
