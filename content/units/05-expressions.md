---
slug: 05-expressions
title: Expressions and statements
---

Python divides everything you write into two categories, and the division decides where you are allowed to put things. An **expression** produces a value. A **statement** does something. `x + 1` is an expression; `x = 1` is a statement; and the fact that assignment is not an expression is a deliberate choice that this unit spends most of its time on.

## The line between them

An expression can go anywhere a value can: as an argument, on the right of an assignment, inside a list, as the condition of an `if`. Literals, names, calls, arithmetic, comparisons, comprehensions, lambdas and conditional expressions are all expressions.

Statements cannot. `if`, `for`, `while`, `def`, `class`, `return`, `import`, `raise`, `assert`, `pass` and plain assignment are statements, which is why none of them can appear inside a list or be passed to a function.

```python
[x = 1]              # SyntaxError
f(if x: y)           # SyntaxError
```

This is why Python has both `if` statements and conditional expressions, and both `def` and `lambda`: each pair is the same idea in the two categories.

C and its descendants make assignment an expression, which allows `while ((n = read()) > 0)` and also allows `if (x = 1)` when you meant `==`. Python removed a whole class of typo by refusing, and then, in 3.8, added a separate operator for the cases where the C version was genuinely useful.

## The walrus

`:=` assigns **and** produces the value, so it can be used where only an expression is allowed:

```python
if (line := source.readline()):
    process(line)

while (chunk := f.read(8192)):
    handle(chunk)

[y for x in data if (y := transform(x)) is not None]
```

Its whole purpose is to remove a repeated evaluation. Without it, each of these either computes something twice or needs an extra line and a wider scope for the name.

Use it when the alternative is calling the same thing twice, or when a loop would otherwise need its first read duplicated before the loop and again at the bottom. Do not use it merely to compress two clear lines into one dense one; the parentheses it usually needs are a fair warning that you are near the limit.

## `and` and `or` return operands

This surprises people from other languages: Python's boolean operators do not return `True` or `False`. They return one of their operands.

`a or b` evaluates `a`; if it is truthy it returns `a` itself, otherwise it returns `b`. `a and b` returns `a` if it is falsy, otherwise `b`. Both short-circuit, meaning the right side is never evaluated when the left has already decided the answer.

That makes `or` a convenient default:

```python
name = supplied or "anonymous"
```

And it makes `or` a bug whenever a legitimate value is falsy:

```python
retries = configured or 3     # a configured 0 becomes 3
```

Which is the same trap as unit 04's `if not timeout:`, in a different costume. When zero, empty string or empty list are real answers, test for `None` explicitly.

Short-circuiting is what makes guard clauses work: `if data and data[0] == "x"` is safe because `data[0]` is never reached when `data` is empty. Written the other way round it raises, and the order of the two halves is doing real work.

## Chained comparison

`0 < x < 10` is one expression, not two, and it means what a mathematician expects: `x` is evaluated once and compared against both bounds, with short-circuiting.

The chain applies to every comparison operator, including `==` and `is`, and that is where it stops being intuitive:

```python
a == b == c          # a == b and b == c
False == False in [False]    # True: (False == False) and (False in [False])
```

The second one is a party trick rather than something you will write. The one worth knowing is that `a < b < c` is *not* `(a < b) < c`, which would compare a boolean against `c`. Parenthesising a chain changes its meaning.

## The comparison people actually get wrong

```python
if answer == "y" or "Y":
```

This is always true, and it compiles cleanly, and no linter fires by default. Precedence groups it as `(answer == "y") or ("Y")`, and a non-empty string is truthy, so the whole condition is truthy regardless of `answer`.

The fix is to say both comparisons, or better, to use `in`:

```python
if answer in ("y", "Y"):
```

The same shape appears as `if x == 1 or 2:` and `if kind is None or "":`. The tell is a bare value on one side of `or` where a comparison ought to be.

## Evaluation order

Python evaluates left to right, and it evaluates the operands before the operator. In a call, arguments are evaluated left to right before the function is entered. In `a[i] = f()`, the right-hand side is evaluated first, then the target.

Two places this matters. Multiple assignment evaluates the entire right side before binding anything, which is why the swap works and why it needs no temporary:

```python
a, b = b, a
```

The right side builds a tuple of the old values first. And `f() + g()` calls `f` first, so if either has side effects, reordering the operands changes the program even though addition is commutative.

## Conditional expressions

```python
status = "on" if enabled else "off"
```

The value-producing counterpart of `if`. The condition sits in the middle, which reads oddly at first and is deliberate: the common case comes first.

It binds very loosely, looser than arithmetic, so `a if c else b + 1` is `a if c else (b + 1)` and not `(a if c else b) + 1`. Parenthesise whenever the expression continues after the `else`, and prefer a real `if` statement once there is a second condition: nested conditional expressions are legal and nearly unreadable.

## Unpacking is an expression shape too

The left-hand side of an assignment is not limited to a single name, and the rules are worth stating because they show up everywhere from `for` loops to function signatures.

```python
a, b = 1, 2
first, *rest = [1, 2, 3, 4]      # rest is [2, 3, 4]
*init, last = [1, 2, 3, 4]       # init is [1, 2, 3]
(a, b), c = (1, 2), 3            # nested patterns work
```

The starred name collects whatever is left over, always as a list, and there may be at most one of them because two would be ambiguous. If the shape does not match, you get a `ValueError` naming the counts, "too many values to unpack" is one of the more helpful messages in the language.

The same star works in calls and in literals, where it means "spread this out":

```python
combined = [*first_list, *second_list]
merged = {**defaults, **overrides}
f(*args, **kwargs)
```

That dictionary form is the idiomatic way to merge with later keys winning, and it builds a new dictionary rather than mutating either input, which, after unit 02, you will recognise as the safer of the two options.

## Precedence, and the four rules worth memorising

Python has around seventeen levels of operator precedence and nobody sensible remembers all of them. Four cause almost every real mistake.

**Comparison binds tighter than `and` and `or`.** So `a == b and c == d` groups the way you want without parentheses, and `a == b or c` groups as `(a == b) or c`, which is the trap from the previous section.

**`not` binds tighter than `and` and `or`, but looser than comparison.** `not a == b` is `not (a == b)`, which is `a != b` and should be written that way; ruff's `SIM201` says so. But `not a in b` is `not (a in b)`, which should be `a not in b`.

**Arithmetic binds tighter than comparison.** `a + 1 < b` needs no parentheses.

**The conditional expression binds looser than nearly everything**, which is the previous section's warning.

Everything else (bitwise operators sitting between arithmetic and comparison, `**` binding tighter than unary minus so that `-2 ** 2` is `-4`) is worth parenthesising rather than remembering. Parentheses cost nothing and a reader should never have to consult a table to know what a line does.

## Where an expression can hide a statement's job

Because comprehensions and conditional expressions are expressions, it is possible to write a great deal of a program without any statements at all. This is occasionally elegant and usually a mistake, and it is worth knowing why the line falls where it does.

A comprehension is for building a collection from another one. When the loop exists for its side effects rather than its result, a `for` statement says so and a comprehension actively lies. It constructs a list of `None`s that nobody wants, and it hides the intent behind machinery for producing a value you then discard.

The same applies to `and` and `or` used for control flow. `check() and do_thing()` works, because of short-circuiting, and it says nothing about what it is for. `if check(): do_thing()` is one character longer and is a sentence.

The rule that falls out: reach for an expression when you want the value, and for a statement when you want the effect. Python gives you both forms of nearly every construct precisely so that you never have to choose the wrong one for syntactic reasons.

## Statements that look like expressions

A few shapes produce values where you might not expect one, and one produces a value where people expect none.

A trailing comma makes a tuple. `x = 1,` binds a one-element tuple, not the integer, and it is a genuinely difficult typo to spot. `return a, b` is the same rule and is how a function appears to return two things.

A bare expression on its own line is a legal statement whose value is discarded. That is what makes `s.upper()` on its own line do nothing, and why `x == 1` as a statement is a silent no-op rather than an error.

And every function returns something: falling off the end returns `None`, which is why forgetting a `return` gives you `None` downstream rather than an error at the point of the mistake.

## What to carry forward

Expressions produce values and can go anywhere a value can; statements do things and cannot. Assignment is a statement, and `:=` is the expression version, for removing a repeated evaluation. `and` and `or` return an operand rather than a boolean and short-circuit, which makes `or` both a good default and a trap around zero. Comparisons chain, and parenthesising a chain changes its meaning. `x == 1 or 2` is always true. And a trailing comma builds a tuple.
