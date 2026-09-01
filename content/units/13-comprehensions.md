---
slug: 13-comprehensions
title: Comprehensions and collections
---

A comprehension builds a collection from another one in a single expression. It is not shorthand for a loop, and treating it as one leads to writing the wrong ones. It is a construct with its own scope, its own bytecode, and a fairly narrow job: **take a sequence of things, and produce a sequence of things**.

## The four forms

```python
[f(x) for x in items]              # list
{f(x) for x in items}              # set
{k(x): v(x) for x in items}        # dict
(f(x) for x in items)              # generator, lazy
```

The first three build a whole collection immediately. The fourth builds nothing: it produces a generator that yields one value at a time, and unit 16 is about what that changes. When a generator expression is the only argument to a function you can drop the extra parentheses, which is why `sum(x * 2 for x in items)` reads as it does.

A filter goes on the end, and it decides whether an item is included at all:

```python
[x for x in items if x > 0]
```

A conditional *expression* goes at the front, and it decides what value each item produces:

```python
[x if x > 0 else 0 for x in items]
```

The two look similar and do different jobs. `if` at the end filters; `if/else` at the front transforms. There is no way to filter with the front form, because a conditional expression must produce a value, which is a useful thing to know when the syntax will not do what you are trying to make it do.

## What a comprehension compiles to

It is worth seeing once that a comprehension is a real construct rather than a rewriting of a loop, because it explains the scope rule and the speed difference in one go.

```python
import dis
dis.dis(lambda items: [x * 2 for x in items])
```

You will see the comprehension's body compiled inline, with the loop variable stored in a fast local slot and the result built with a dedicated `LIST_APPEND` instruction. The equivalent loop instead looks up `out.append` by name on every iteration and calls it, which is an attribute lookup plus a call each time round.

That is where the speed comes from, and it is modest: perhaps a third faster for a simple body, less when the body does real work. Speed is not the reason to prefer one. The reason is that a comprehension states what is being built in its first three words, where a loop makes the reader assemble that from an empty list, a body and an append.

Before 3.12 the comprehension was compiled as a genuine nested function and called; since 3.12 it is inlined, which removed the function call overhead and is why comprehensions got noticeably faster in that release without anything changing about how they are written.

## Reading one aloud

A comprehension is dense, and the habit that makes them tractable is to read the parts in a fixed order rather than left to right.

Start in the middle. `for row in rows` tells you what is being walked. Then the end: `if row.active` tells you which of those survive. Then the front: `row.name` tells you what each one becomes. "For every row, keeping the active ones, take the name."

Written out that way, a comprehension that resists the reading is usually one that should not have been written. If naming what is walked takes a clause of its own, or the filter needs two conditions and a helper, the loop version will be shorter to understand even when it is longer to read.

The other habit worth having: when a comprehension's expression is a call to a function you had to invent, the function is doing the work and the comprehension is just mapping it. That is fine, and it is also a sign that `map(f, items)` would say the same thing, which unit 17 gets to.

## Nesting reads left to right

Multiple `for` clauses nest, outermost first, in the same order you would write the loops:

```python
[(r, c) for r in rows for c in cols]

for r in rows:
    for c in cols:
        ...
```

That is worth checking against your intuition once, because the *expression* comes first and the loops then read in normal order, so the whole thing is neither purely left-to-right nor purely inside-out.

Flattening is the common case:

```python
[item for row in grid for item in row]
```

A nested comprehension, one comprehension inside another's expression, is a different shape and produces a nested result:

```python
[[cell * 2 for cell in row] for row in grid]
```

Two `for` clauses give you one flat sequence; a comprehension inside a comprehension gives you a sequence of sequences. Mixing those up is the commonest way a comprehension produces something the wrong shape.

## The scope, and why it exists

A comprehension runs in its own function-like scope, which unit 08 covered. Its loop variable does not leak, so a comprehension can never quietly clobber a name you were using.

The exception is the **first** iterable, which is evaluated in the enclosing scope before the implicit function is entered. That is why a comprehension in a class body can iterate another class attribute and cannot refer to one inside its body.

The walrus operator does reach out: a name bound with `:=` inside a comprehension binds in the enclosing scope, deliberately, so that this works:

```python
[y for x in items if (y := f(x)) is not None]
```

## When not to write one

A comprehension is for producing a value. When the loop exists for its effect, a `for` statement says so and a comprehension actively lies: it builds a list of `None`s that nobody wants and hides the intent behind machinery for a result you discard.

```python
[log(x) for x in items]       # builds a list of None. Do not.
for x in items:
    log(x)
```

Three more places to stop. When the logic needs a `try`, a `break`, or more than one statement, a comprehension cannot express it and the workarounds are worse than the loop. When it grows past about one line, the reader has to hold the whole thing at once to understand any of it. And when a builtin already says it: `any`, `all`, `sum`, `min`, `max` and `sorted` each take an iterable and say what they are for.

```python
if any(row.failed for row in rows):        # not len([r for r in rows if r.failed]) > 0
```

The generator form inside those is the one to use, because it short-circuits and builds nothing.

## Building a dict, and the shapes that come up

The dict form is the one people reach for least and probably want most, because so much data work is turning one mapping into another.

```python
{k: v for k, v in pairs}                      # from pairs
{name: len(name) for name in names}           # computed values
{k: v for k, v in d.items() if v is not None}  # dropping empties
{v: k for k, v in d.items()}                  # inverting
{k: heavy(v) for k, v in d.items()}           # transforming values
```

Two cautions. Inverting assumes the values are unique, and silently keeps whichever key came last when they are not; if that matters, group into lists instead. And a dict comprehension over `.items()` is one pass, where the same thing written as a loop with `d[k] = ...` inside is easy to get subtly wrong by mutating the dict you are iterating.

The set form deserves a mention for the same reason: `{f(x) for x in items}` deduplicates as it builds, which is a one-character difference from the list form and often exactly what was wanted.

## `collections`, and the five worth knowing

**`Counter`** tallies. It is a dict that starts every key at zero, counts an iterable in one pass, and `most_common(n)` ranks them. It also supports arithmetic, so `Counter(a) - Counter(b)` gives you what is in `a` beyond `b`.

**`defaultdict`** calls a factory for a missing key, which unit 12 covered along with the sharp edge that reading inserts.

**`deque`** is a list with fast operations at *both* ends. `list.pop(0)` and `list.insert(0, x)` shift every element and are therefore linear; `deque.popleft()` and `appendleft()` are constant. It is the right type for a queue, for a sliding window, and with `maxlen` for keeping the last n of something.

**`namedtuple`** is a tuple whose fields have names. It is immutable, it compares and unpacks like a tuple, and it costs no more memory than one. For most new code a `dataclass` says more, and unit 23 makes that comparison; `namedtuple` still wins when you need tuple behaviour, such as using it as a dict key.

**`ChainMap`** presents several mappings as one, searching them in order without copying. It is the honest structure for layered configuration: defaults, then a file, then the environment, consulted in a fixed order and still separable afterwards, where merging them into one dict throws away which layer a value came from.

The two that most often replace code you have already written are `Counter` and `deque`. A hand-rolled tally with `d[k] = d.get(k, 0) + 1` is a `Counter`, and a hand-rolled queue that does `list.pop(0)` is a `deque` waiting to be several times faster.

## Laziness, in one paragraph

The generator form is the same syntax with round brackets and a completely different cost. `[f(x) for x in huge]` builds the whole list before anything else happens; `(f(x) for x in huge)` builds nothing and produces values as they are asked for. For a pipeline that ends in `sum`, `any` or a `for` loop, the generator does the same work with none of the memory, and it stops early when the consumer does. For anything you need to walk twice, or index, or take the length of, the list is what you want, because a generator is exhausted after one pass. Unit 16 makes this properly.

## What to carry forward

Four comprehension forms, of which one is lazy. A trailing `if` filters and a leading `if/else` transforms. Multiple `for` clauses flatten in the order you would write the loops; a comprehension inside a comprehension nests. The loop variable does not leak, but the first iterable is evaluated outside. Do not write one for its side effects, or when a builtin already names what you are doing. And of the `collections` types, `Counter` and `deque` are the two that will change code you have already written.
