---
slug: 05-expressions
---

## Which of these is an expression?
- ( ) `x = 1`
- ( ) `import math`
- (x) `x if c else y`
- ( ) `return x`
> Expressions produce a value and can go anywhere a value can. Assignment, import and return are statements.

## Why can't you write `if (x = 1):` in Python?
- ( ) Parentheses are not allowed in conditions
- (x) Assignment is a statement, not an expression
- ( ) `if` requires a comparison
- ( ) You can; it assigns and tests
> Which removes a whole class of `=` for `==` typo. `:=` was added later for the cases where the C form was genuinely useful.

## What does `:=` do that `=` does not?
- ( ) Assign without creating a name
- (x) Produce the assigned value, so it can be used where an expression is required
- ( ) Assign to an outer scope
- ( ) Assign without evaluating the right side
> Its purpose is removing a repeated evaluation, not compressing two clear lines into one.

## `a or b` returns
- ( ) `True` or `False`
- (x) `a` if `a` is truthy, otherwise `b`
- ( ) `b` always
- ( ) A tuple of both
> Python's boolean operators return an operand, not a boolean, which is what makes `x or default` an idiom.

## `configured or 3` where `configured` is `0` gives
- ( ) `0`
- (x) `3`
- ( ) `None`
- ( ) `True`
> Zero is falsy, so a deliberate zero is replaced by the default. Test with `is None` whenever a legitimate value can be falsy.

## `rows[0] == "id" and rows` on an empty list
- ( ) Returns False
- (x) Raises IndexError
- ( ) Returns the empty list
- ( ) Returns None
> `and` short-circuits left to right, so the subscript runs before the existence check. Order the guard first.

## `answer == "y" or "Y"` is
- ( ) Equivalent to `answer in ("y", "Y")`
- (x) Always truthy, whatever answer is
- ( ) A SyntaxError
- ( ) True only when answer is "y"
> Precedence groups it as `(answer == "y") or ("Y")`, and a non-empty string is truthy. No linter fires by default.

## `0 < x < 10` is
- (x) A chained comparison: x is evaluated once and compared against both bounds
- ( ) `(0 < x) < 10`
- ( ) `0 < (x < 10)`
- ( ) A SyntaxError
> Parenthesising it does not clarify it, it changes it into something else.

## `(0 < x) < 10` where x is 50
- (x) Is True, because the parenthesised half is a boolean and `False < 10`
- ( ) Is False
- ( ) Raises TypeError
- ( ) Is the same as the chained form
> `bool` subclasses `int`, so comparing a boolean to a number is legal and answers a question nobody asked.

## `x = 1,` binds
- ( ) The integer 1
- (x) A one-element tuple
- ( ) A syntax error
- ( ) A list
> It is the comma that makes a tuple, never the parentheses, which is why `(1)` is an integer.

## `a, b = b, a` works because
- ( ) Python has a special swap instruction
- (x) The entire right side is evaluated before anything is bound
- ( ) Tuples are immutable
- ( ) It does not; it needs a temporary
> Multiple assignment builds the right-hand tuple first, which is also why the order of the targets does not matter.

## `first, *rest = [1, 2, 3]` gives `rest` as
- ( ) `(2, 3)`
- (x) `[2, 3]`
- ( ) `3`
- ( ) A generator
> The starred name always collects into a list, and there may be at most one starred name because two would be ambiguous.

## `{**defaults, **overrides}` produces
- ( ) A merged dict where `defaults` wins on conflicts
- (x) A new merged dict where `overrides` wins on conflicts
- ( ) A modified `defaults`
- ( ) A set
> Later keys win, and it builds a new dictionary rather than mutating either input.

## `a if c else b + 1` groups as
- ( ) `(a if c else b) + 1`
- (x) `a if c else (b + 1)`
- ( ) A SyntaxError
- ( ) It depends on the types
> The conditional expression binds looser than arithmetic, so it extends as far right as it can.

## `-2 ** 2` evaluates to
- ( ) `4`
- (x) `-4`
- ( ) `0`
- ( ) It raises
> `**` binds tighter than unary minus. Worth parenthesising rather than remembering.
