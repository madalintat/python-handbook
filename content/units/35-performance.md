---
slug: 35-performance
title: Performance
---

One rule dominates this subject, and everything else is detail: **measure first**. Not because guessing is unreliable in some general sense, but because programmers guess wrong about which line is slow with a consistency that is almost useful. The people who wrote the program guess wrong about their own program.

So the order is: find out what is slow, understand why, change that, and measure again.

## Finding out what is slow

`cProfile` gives you every function, how many times it was called and how long it took:

```
python -m cProfile -s cumtime myscript.py | head -30
```

Two columns matter. **`tottime`** is time in the function itself, excluding what it called; a high `tottime` means the work is here. **`cumtime`** includes everything it called; a high `cumtime` with a low `tottime` means the work is underneath, and you should look further down.

Sorting by `cumtime` gives you the call tree from the top, which is where to start, because it tells you which branch of the program the time is in before it tells you which line.

`cProfile` costs perhaps thirty percent overhead and distorts short calls, so treat the ranking as reliable and the absolute numbers as indicative. For a running process rather than a script, a sampling profiler such as `py-spy` attaches without restarting anything and without meaningful overhead, which is what you want in production.

For one line, `timeit` is the tool, and it does the fiddly parts right: many repetitions, best-of rather than mean, and the garbage collector disabled.

```
python -m timeit -s "xs = list(range(1000))" "sum(xs)"
```

Best-of rather than mean matters more than it sounds. A mean is dragged around by whatever else the machine was doing; the minimum is the closest you get to the time the code actually needs.

## Reading a profile

The number to look at is not the largest one; it is the largest one you can change.

A profile dominated by `socket.recv` on a program that fetches things is telling you the program is waiting, and unit 33's answer applies rather than any optimisation. A profile dominated by one of your own functions called four million times is telling you either to make it faster or to call it less, and calling it less is usually the bigger win.

That second observation generalises. The cheapest optimisations are almost never "make this faster"; they are **do it fewer times** (cache, hoist out of the loop, batch the requests) or **do it on less data** (filter first, index instead of scan). Those change the shape of the cost. Making a function twenty percent faster does not.

## Complexity, before any of this

A profiler tells you where the time goes on the input you gave it. It does not tell you what happens when the input is ten times larger, and that is usually the more important question.

The distinction is worth being precise about. A constant-factor problem, a function that is twice as slow as it needs to be, stays twice as slow. An asymptotic problem, an accidental quadratic, is invisible on a hundred rows and fatal on a hundred thousand. Almost every performance emergency is the second kind, and almost every profiling session starts by looking for the first.

So before profiling, ask what the loops do. Two nested loops over the same data is quadratic. A `in list` inside a loop is quadratic. Building a string with `+` in a loop is quadratic. Sorting inside a loop is worse. None of those need a profiler; they need reading, and they are the ones that matter.

The practical test: run it on ten times the data and see whether the time goes up ten times or a hundred. That one measurement distinguishes the two kinds of problem, and it is often the only measurement you need.

## What is actually slow in Python

A small number of things account for most real problems.

**Wrong data structure.** Membership in a list is a scan; in a set or dict it is a hash. A loop with `if x in big_list` inside it is quadratic, and unit 12 made this an exercise because it is the single most common performance bug in real Python.

**Repeated work.** The same computation inside a loop that could have been done once outside it, the same request made per row instead of once for all rows. `functools.cache` is often the whole fix.

**Doing it a row at a time.** A query per item in a loop, a write per line, a call per element. Batching is usually a large multiple, not a percentage.

**Building strings with `+` in a loop.** Each `+` copies, so building a large string a piece at a time is quadratic. `"".join(parts)` is linear.

**Attribute lookups in a hot loop.** `self.thing.method` is three dict lookups per iteration. Hoisting it to a local before the loop is a real, measurable win, and is also the last thing to reach for, because it costs readability.

**Interpreter overhead.** A Python-level loop over a million elements is slow because it is a million interpreter steps. The fix is not to make the loop faster; it is to do the loop in C, which is what `numpy`, `pandas`, `polars` and the standard library's own functions are.

## Where the standard library is already fast

Quite a lot of Python's speed is available by using what is there.

`sum`, `min`, `max`, `any`, `all`, `sorted` and `join` are C loops. `list.sort` is Timsort and will beat anything you write. `collections.deque` is O(1) at both ends where a list is O(n) at the front, which unit 13 made an exercise. `bisect` gives you binary search over a sorted list. `heapq` gives you the smallest n without sorting everything. `set` operations are hash-based and fast in a way that manual comparison is not.

The general shape: a builtin or standard-library function that does what your loop does is almost always faster, because the loop runs in C rather than in the interpreter.

## Measuring honestly

Four ways a measurement lies, and all of them are common.

**The first run is different.** Imports, caches, JIT warm-up and the operating system's file cache all make a first run unrepresentative. Measure the steady state, which is what `timeit` does by repeating.

**The machine is busy.** Another process, a build, a browser. This is why the minimum of many runs is a better estimate than the mean: noise only ever makes things slower.

**The data is not the data.** A profile on a hundred rows tells you about a hundred rows. Optimising against a small sample regularly makes the large case worse, because the algorithm that wins at small n is often the naive one.

**The optimisation was not the change.** Two things changed and one of them was a warm cache. Change one thing, measure, change the next.

The habit that makes all four manageable is to write the measurement down, in a comment or a commit message: what was measured, on what input, and what the number was. A performance change with no recorded baseline is a change nobody can evaluate later, including you.

## The trade you are actually making

Every optimisation costs something, and the cost is usually readability. That is a real price, paid by everybody who reads the code afterwards, and it is worth paying only where the win is real and measured.

So the honest sequence is: is it too slow? If not, stop. If so, profile. Fix the largest thing you can change. Measure again, and if it is fast enough now, stop again.

The temptation is to keep going because the next thing is visible in the profile. Resist it. A function optimised past the point anybody noticed is a function that is now harder to read for nothing.

## When Python is the wrong tool

Sometimes the answer is not Python code.

`numpy` for numerical work over arrays, where the loop moves into C and the speedup is often a hundredfold rather than a percentage. `polars` or `pandas` for tabular data, for the same reason.

`Cython` or `mypyc` compile annotated Python, which is the smallest step out. `Rust` through `PyO3` is the current answer for a genuinely hot extension, and is how `ruff`, `uv` and `pydantic-core` are written, which is why they are fast enough to change how the tools around them are used.

And PyPy runs unmodified Python several times faster for long-running, pure-Python, CPU-bound work, at the cost of C extension compatibility.

Each of those is a real commitment. Reach for one when the profile says the bottleneck is Python's interpreter loop itself, and not before, because until then the problem is something you can fix in an afternoon.
