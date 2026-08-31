---
slug: 01-names
---

## What does `b = a` do when `a` is a list of a million items?
- ( ) Copies all one million items into a new list
- (x) Binds a second name to the existing list, copying nothing
- ( ) Copies the list only if it is later modified
- ( ) Raises if `b` already refers to something else
> Binding never copies, at any size. It writes down a reference, which is why `b = a` costs the same for one item as for a million.

## `a = [1]; b = a; a = [2]`. What is `b`?
- (x) `[1]`
- ( ) `[2]`
- ( ) `[1, 2]`
- ( ) `[]`
> `a = [2]` is rebinding. It points `a` at a different object and leaves `b` looking at the original list.

## `a = [1]; b = a; a.append(2)`. What is `b`?
- ( ) `[1]`
- ( ) `[2]`
- (x) `[1, 2]`
- ( ) `[]`
> `append` is mutation. There is one list, `b` is a name for it, and the change is visible through every name bound to it.

## Which question does `is` ask?
- ( ) Do these have the same value?
- (x) Are these the same object?
- ( ) Do these have the same type?
- ( ) Are these both truthy?
> `is` compares identity. `==` compares value, and the object's type decides what value equality means.

## Why does `257 is 257` sometimes come out False?
- ( ) `is` is unreliable on all integers
- ( ) Integers above 256 are stored as floats
- (x) CPython caches only the integers from -5 to 256, so larger ones can be separate objects
- ( ) The comparison depends on available memory
> The small integer cache is a CPython implementation detail. It is the clearest demonstration that identity and equality are different questions.

## When is a function's default argument value evaluated?
- ( ) On every call
- ( ) On the first call only
- (x) Once, when the `def` statement executes
- ( ) Lazily, the first time the parameter is read
> The default is computed once at definition time and stored on the function object, which is why a mutable default is shared by every call.

## A function does `items = []` to its list parameter. What does the caller see?
- (x) No change at all
- ( ) An empty list
- ( ) A copy of the original list
- ( ) An error
> Assigning to a parameter rebinds a local name. The caller's object was never touched.

## A function does `items.clear()` to its list parameter. What does the caller see?
- ( ) No change at all
- (x) An empty list
- ( ) A copy of the original list
- ( ) An error
> `clear` mutates the object both names refer to, so the change is visible to the caller.

## What does `del x` remove?
- ( ) The object `x` refers to
- (x) The name `x` from its namespace
- ( ) Both the name and the object, always
- ( ) The last reference in the list
> `del` unbinds a name. The object is destroyed only if that was the last reference to it.

## Which of these types can be mutated in place?
- ( ) `str`
- ( ) `tuple`
- (x) `dict`
- ( ) `frozenset`
> Lists, dicts, sets and most user-defined objects are mutable. Strings, tuples, frozensets and numbers are not.

## `s = "hi"; s.upper()` on its own line. What is `s` afterwards?
- (x) `"hi"`
- ( ) `"HI"`
- ( ) `None`
- ( ) It raises
> Strings are immutable, so `upper` returns a new string. Discarding the return value discards the entire result.

## `grid[:]` on a list of lists gives you...
- ( ) A fully independent copy
- (x) A new outer list holding the same inner list objects
- ( ) The same list object
- ( ) A copy only of the first row
> Slicing is a shallow copy. The outer list is new; everything inside it is shared.

## A class body contains `items = []`. Where does that list live?
- ( ) On each instance, created fresh in `__init__`
- (x) On the class, shared by every instance
- ( ) On the first instance created
- ( ) In the module namespace
> The class body runs once. Per-instance state has to be created per instance, which means inside `__init__`.

## Why can a function change your list but not your integer?
- ( ) Integers are passed by value and lists by reference
- (x) Both are bound the same way; lists have mutating methods and integers do not
- ( ) Integers are copied at the function boundary
- ( ) The interpreter protects numeric types
> Nothing about the call differs. The only difference is that a list can be modified in place and an `int` cannot.

## When is a Python object destroyed?
- ( ) At the end of the enclosing function
- ( ) When the garbage collector next runs on a timer
- (x) As soon as the last reference to it goes away
- ( ) When `del` is called on it
> CPython counts references and destroys an object the moment its count reaches zero. A separate collector exists only for reference cycles.
