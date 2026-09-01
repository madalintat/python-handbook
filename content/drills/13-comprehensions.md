---
slug: 13-comprehensions
---

## `(f(x) for x in items)` builds
- ( ) A tuple
- (x) A generator, which produces values one at a time and stores none
- ( ) A list
- ( ) A set
> Round brackets make it lazy. The other three forms build the whole collection immediately.

## Where does the filtering `if` go?
- ( ) At the front, before the expression
- (x) At the end, after the `for`
- ( ) Either; they mean the same
- ( ) Inside the expression
> A trailing `if` decides membership. A leading `if/else` is a conditional expression and produces a value for every item.

## `[x if x > 0 else 0 for x in items]` returns how many elements?
- (x) The same number that went in
- ( ) Only the positive ones
- ( ) None
- ( ) It raises
> A conditional expression must produce a value, so it cannot skip an item. There is no filtering form at the front.

## `[(r, c) for r in rows for c in cols]` nests
- (x) `rows` outermost, in the order you would write the loops
- ( ) `cols` outermost
- ( ) In parallel, like `zip`
- ( ) It is a syntax error
> The expression comes first and the clauses then read in normal order, which is worth checking against your intuition once.

## `[[f(c) for c in row] for row in grid]` produces
- ( ) A flat list
- (x) A list of lists
- ( ) A generator
- ( ) A dict
> A comprehension inside another one nests. Two `for` clauses in a single comprehension flatten.

## A comprehension's loop variable after it finishes
- ( ) Holds the last value
- (x) Does not exist; the comprehension has its own scope
- ( ) Holds `None`
- ( ) Holds the whole list
> Which is why a comprehension can never quietly clobber a name you were using.

## Which part of a comprehension is evaluated in the enclosing scope?
- (x) The first iterable
- ( ) The expression
- ( ) The filter
- ( ) All of it
> Which is why a comprehension in a class body can iterate a class attribute and cannot refer to one inside its body.

## `[log(x) for x in items]` is
- ( ) The idiomatic way to run a loop
- (x) A list of `None` that nobody wants, hiding the intent
- ( ) Faster than a `for` statement
- ( ) A syntax error
> A comprehension is for producing a value. When the loop is for its effect, a `for` statement says so.

## `any(row.failed for row in rows)` versus `any([row.failed for row in rows])`
- ( ) Identical
- (x) The generator stops at the first true value and builds nothing; the list walks everything
- ( ) The list version is faster
- ( ) The generator version is wrong
> The same holds for `all`, `sum`, `min` and `max`.

## A generator bound to a name and used twice
- ( ) Works, producing the same values both times
- (x) Is empty the second time, because it is exhausted after one pass
- ( ) Raises on the second use
- ( ) Restarts automatically
> No memory and one pass is the trade the round brackets buy. Build a list when you need it twice.

## `{v: k for k, v in d.items()}` assumes
- (x) That the values are unique, and silently keeps the last one when they are not
- ( ) That the keys are strings
- ( ) That the dict is sorted
- ( ) Nothing
> When the relationship is one-to-many, group into lists instead.

## `list.pop(0)` costs
- ( ) Constant time, like `pop()`
- (x) Linear time, because every remaining element shifts down
- ( ) Logarithmic time
- ( ) It raises on a long list
> `collections.deque` is constant at both ends, which makes it the right type for a queue.

## `collections.Counter` is
- (x) A dict that starts every key at zero and counts an iterable in one pass
- ( ) An ordered list of counts
- ( ) A generator
- ( ) A set with multiplicities that cannot be read
> `most_common(n)` ranks them, and it supports arithmetic, so `Counter(a) - Counter(b)` is what is in one beyond the other.

## `ChainMap` is for
- ( ) Merging dicts into one
- (x) Presenting several mappings as one, searched in order, without copying
- ( ) Chaining iterables
- ( ) Linking a dict to its parent class
> Which keeps which layer a value came from, where merging into one dict throws that away.

## A comprehension is faster than the equivalent loop mainly because
- ( ) It runs in C
- (x) It appends with a dedicated instruction instead of looking up and calling `.append` each time
- ( ) It is parallelised
- ( ) It skips the loop variable
> The difference is modest. The reason to prefer one is that it states what is being built in its first three words.
