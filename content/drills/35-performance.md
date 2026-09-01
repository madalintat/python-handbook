---
slug: 35-performance
---

## The first rule of performance work is
- (x) Measure, because programmers guess wrong about which line is slow with great consistency
- ( ) Avoid loops
- ( ) Use C extensions
- ( ) Cache everything
> Including the people who wrote the program, about their own program.

## In a profile, `tottime` is
- (x) Time in the function itself, excluding what it called
- ( ) Total time including callees
- ( ) Time per call
- ( ) Wall-clock time
> A large `cumtime` with a small `tottime` means the work is underneath. Keep looking down.

## `timeit` reports the best of many runs rather than the mean because
- (x) Noise only ever makes things slower, so the minimum is closest to the time the code needs
- ( ) The mean is harder to compute
- ( ) The first run is always fastest
- ( ) It is a convention
> It also repeats, which measures the steady state rather than the cold start.

## Before profiling, the more important question is
- (x) How the cost grows with the input, because almost every emergency is an accidental quadratic
- ( ) Which function is called most
- ( ) How much memory is used
- ( ) Which library is slowest
> Run it on ten times the data and see whether the time goes up ten times or a hundred.

## `if x in big_list` inside a loop is
- (x) Quadratic, and the fix is a set
- ( ) Linear
- ( ) Constant, because lists are indexed
- ( ) Fine below a million elements
> The single most common performance bug in real Python.

## Building a string with `+=` in a loop
- (x) Copies everything accumulated so far on each step, so the total is quadratic
- ( ) Extends the string in place
- ( ) Is the fastest way
- ( ) Is linear
> `"".join(parts)` adds up the lengths, allocates once, and fills it.

## The cheapest optimisations are usually
- (x) Doing the work fewer times, or on less data
- ( ) Making the function faster
- ( ) Rewriting in C
- ( ) Adding threads
> Those change the shape of the cost. A twenty percent speedup is a percentage; batching is a multiple.

## An N+1 query is
- (x) One request per row where one request would have done
- ( ) A query with a subquery
- ( ) An off-by-one in pagination
- ( ) A missing index
> The tell in a profile is a large `cumtime`, a small `tottime`, and a very large call count.

## `heapq.nsmallest(3, items)` against `sorted(items)[:3]`
- (x) Keeps a heap of size 3 and walks the input once, rather than ordering everything
- ( ) Is the same thing
- ( ) Is slower but clearer
- ( ) Requires a sorted input
> The same family as `bisect` for search and `Counter.most_common`: a narrower question, a smaller cost.

## `sum`, `sorted`, `any` and `join` are faster than a hand-written loop because
- (x) They run the loop in C rather than as interpreter steps
- ( ) They are cached
- ( ) They use several threads
- ( ) They avoid function calls
> Which is also why the ceiling is low: when the loop itself is the cost, the loop has to leave Python.

## `any(check(r) for r in rows)` against `any([check(r) for r in rows])`
- (x) The first short-circuits; the second builds the whole list, checking everything
- ( ) They are equivalent
- ( ) The second is faster
- ( ) The first is lazy but checks everything anyway
> Which matters whenever the check costs something.

## Optimising against a small sample
- (x) Regularly makes the large case worse, because the algorithm that wins at small n is the naive one
- ( ) Is a good approximation
- ( ) Is the only practical approach
- ( ) Works if the sample is random
> Measure how each one grows, not which is faster on ten rows.

## The number in a profile worth acting on is
- (x) The largest one you can change
- ( ) The largest one
- ( ) The one with the most calls
- ( ) The one at the top
> A profile dominated by `socket.recv` is telling you to look at concurrency, not at optimisation.

## Every optimisation costs
- (x) Readability, paid by everybody who reads the code afterwards
- ( ) Memory
- ( ) Correctness
- ( ) Nothing, if measured
> Which is why the sequence ends with "if it is fast enough now, stop".

## Reaching for `numpy`, Cython or Rust is right when
- (x) The profile says the bottleneck is Python's interpreter loop itself
- ( ) The program feels slow
- ( ) The data is large
- ( ) There are many loops
> Until then the problem is usually something you can fix in an afternoon.
