---
slug: 06-control-flow
---

## A `for` loop works on anything that
- ( ) Has a length
- (x) Can produce an iterator
- ( ) Is a sequence
- ( ) Supports indexing
> Which is why `for` works on files, generators and database cursors, and why there is no index anywhere in it.

## `for name in scores` where `scores` is a dict iterates over
- (x) The keys
- ( ) The values
- ( ) `(key, value)` pairs
- ( ) Nothing; dicts are not iterable
> `.values()` and `.items()` are how you ask for the other two.

## A `for ... else` runs its `else` clause when
- ( ) The loop body never ran
- ( ) The collection was empty
- (x) The loop finished without hitting a `break`
- ( ) The loop raised
> An empty collection completes without breaking, so the `else` runs. Read it as "if we got all the way through without finding anything".

## How do you break out of two nested loops?
- ( ) `break 2`
- ( ) `break outer`
- (x) Put them in a function and `return`
- ( ) `continue` twice
> Python has no labelled break. A flag, or flattening with `itertools.product`, are the other two honest options.

## In a `match`, `case RED:` where `RED` is a module-level constant
- ( ) Compares the subject against `RED`
- (x) Matches anything and rebinds `RED`
- ( ) Raises `NameError`
- ( ) Only matches strings
> A bare name in a pattern is a capture. If any case follows it, Python refuses to compile with "makes remaining patterns unreachable".

## How do you compare against a constant in a `match` pattern?
- ( ) Quote it
- (x) Use a dotted name, like `Status.ACTIVE`
- ( ) Prefix it with `==`
- ( ) Wrap it in `literal()`
> Which is why constants used in patterns need to live on a class, an enum or a module.

## Does `case [a, b]:` match the string `"xy"`?
- ( ) Yes, strings are sequences
- (x) No, `str` and `bytes` are deliberately excluded from sequence patterns
- ( ) Only with `strict=True`
- ( ) Only for two-character strings
> Otherwise every two-character string would quietly match, which is almost never what anyone means.

## `case {"action": "quit"}:` matches
- ( ) Only a dict with exactly that one key
- (x) Any mapping containing that key with that value
- ( ) Any dict with an "action" key
- ( ) Nothing; mapping patterns need all keys
> Mapping patterns match on a subset, which makes them useful for message envelopes and parsed JSON.

## `zip(a, b)` where `a` is longer than `b`
- ( ) Raises ValueError
- (x) Stops at the shorter one, silently
- ( ) Pads with None
- ( ) Repeats the shorter one
> `strict=True`, added in 3.10, turns the mismatch into an error. ruff's `B905` asks you to state which you meant.

## `enumerate(rows, start=1)` is useful because
- ( ) It is faster
- (x) Counting from one is right for anything a human reads
- ( ) It avoids an off-by-one in indexing
- ( ) It makes the loop variable immutable
> The default of zero is right for indices and wrong for line numbers and rankings.

## `range(len(values) + 1)` used to index `values`
- ( ) Covers every element
- (x) Asks for one index past the end
- ( ) Is the idiomatic way to include the last element
- ( ) Is empty
> `range` excludes its stop value, so `range(len(x))` already yields exactly the valid indices.

## `range(1_000_000_000)` costs
- ( ) About 8 GB of memory
- (x) Almost nothing until you iterate it
- ( ) A ValueError
- ( ) The same as a list of that length
> `range` computes values on demand and still supports `in`, indexing and slicing.

## Which replaces `for x in xs: if p(x): return True` / `return False`?
- (x) `return any(p(x) for x in xs)`
- ( ) `return all(p(x) for x in xs)`
- ( ) `return sum(p(x) for x in xs)`
- ( ) `return filter(p, xs)`
> `any` short-circuits on the first true value, exactly as the loop did. ruff's `SIM110` suggests this rewrite.

## In a `match` pattern, `_`
- (x) Matches anything and binds nothing
- ( ) Matches only `None`
- ( ) Is an ordinary name like anywhere else
- ( ) Is a syntax error
> It is the one place in Python where `_` is genuinely special rather than a convention.

## `while` with a condition that starts false
- ( ) Runs once, then stops
- (x) Never runs
- ( ) Raises
- ( ) Runs forever
> Python has no do-while; the idiom is `while True` with a `break` where the answer becomes known.
