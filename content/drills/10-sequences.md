---
slug: 10-sequences
---

## Which of these is not a sequence?
- ( ) `range`
- ( ) `str`
- (x) `set`
- ( ) `tuple`
> A sequence is ordered and indexable by position. A set is neither, which is why `s[0]` raises.

## `letters[-1]` on an empty list
- ( ) Returns `None`
- (x) Raises IndexError
- ( ) Returns an empty list
- ( ) Returns the list itself
> `x[-1]` is `x[len(x) - 1]` computed for you, so it fails on an empty sequence exactly as `x[0]` does.

## `letters[10:20]` on a four-element list
- ( ) Raises IndexError
- (x) Returns an empty list
- ( ) Returns the whole list
- ( ) Returns `None`
> Slices clamp their bounds to what exists. Indexing raises when you are wrong; slicing quietly gives you less.

## `x[1:4]` returns how many elements?
- ( ) Four
- (x) Three
- ( ) Two
- ( ) It depends on the length
> The stop is exclusive, which is why `x[:n] + x[n:]` reconstructs the original for any `n`.

## `x[::-1]` does what?
- ( ) Reverses in place and returns None
- (x) Returns a reversed copy
- ( ) Returns an iterator
- ( ) Removes the last element
> `x.reverse()` mutates and returns `None`; `reversed(x)` gives an iterator and copies nothing.

## `list.reverse()` returns
- ( ) The reversed list
- (x) `None`
- ( ) A copy
- ( ) The number of swaps
> Every in-place operation in the standard library returns `None`, so chaining off one fails immediately instead of quietly.

## `items[:] = other` differs from `items = other` in that
- (x) It replaces the contents of the existing list, so every name bound to it sees the change
- ( ) It is faster
- ( ) It copies `other` deeply
- ( ) They are the same
> Slice assignment targets the object; plain assignment rebinds a name. Unit 02's distinction in slicing form.

## `nums[1:3] = ["x"]` on a five-element list
- ( ) Raises, because the lengths differ
- (x) Works, and the list gets shorter
- ( ) Replaces only the first element
- ( ) Inserts without removing
> Slice assignment can change the length. An extended slice, one with a step, is stricter and demands an exact match.

## For a tuple `t`, `t[:] is t` is
- (x) True
- ( ) False
- ( ) True only for empty tuples
- ( ) A TypeError
> Copying an immutable value would achieve nothing, so the original comes back. For a list it is a new object.

## `999_999_999 in range(1_000_000_000)` is
- ( ) Slow, because it scans
- (x) Instant, because membership is computed
- ( ) A MemoryError
- ( ) False
> `range` implements the whole sequence interface with arithmetic and stores nothing, which is why wrapping it in `list` is usually a habit worth dropping.

## `item in some_list` costs
- ( ) Constant time
- (x) Linear time, because it scans
- ( ) Logarithmic time
- ( ) It depends on the item's hash
> Which is why a membership test inside a loop over the same list is quadratic, and why a set is the answer when you ask repeatedly.

## `out = out + [item]` inside a loop is
- ( ) The same as `append`
- (x) Quadratic, because it copies the whole list each time
- ( ) A syntax error
- ( ) Faster than `append`
> `append` is amortised constant. The same trap is worse for strings, which are immutable, so `join` is the fix there.

## `out += name` where `out` is a list and `name` is `"ada"` gives
- ( ) `["ada"]`
- (x) `["a", "d", "a"]`
- ( ) A TypeError
- ( ) `"ada"`
> `+=` on a list is `extend`, which walks whatever it is given, and walking a string yields characters. `append` adds one element.

## `values[1:len(values)]` selects
- ( ) Everything except the first and last
- (x) Everything except the first
- ( ) The whole list
- ( ) Nothing
> The stop is exclusive and `len(values)` is already one past the last index. `values[1:-1]` is the one that drops both ends.

## `first, *rest = row` differs from `row[0], row[1:]` in that
- (x) It raises ValueError when the shape is wrong, instead of returning something plausible
- ( ) It is faster
- ( ) It works on tuples only
- ( ) It copies the row
> Slicing is forgiving, which is right when a short result is a reasonable answer. Unpacking is strict, which is right when the shape is part of the contract.
