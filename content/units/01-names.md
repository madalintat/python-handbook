---
slug: 01-names
title: Names and objects
---

You have written `x = 5` a thousand times. In most languages that line means: there is a box called `x`, and the number five has been put inside it. Assign again and the box holds something else. The box persists; the contents change.

Python does not work like this. Not "works like this with a subtle difference" — it is a different model, and roughly a third of the bugs in the rest of this book are what happens when you apply the box model to a language that does not have boxes.

## There are no variables

In Python there are **objects** and there are **names**, and they are separate kinds of thing.

An object is a real region of memory with a type, a value, and an identity. It exists whether or not anything is pointing at it. The number five is an object. A list is an object. A function is an object. So is a class, a module, and the exception you are about to raise.

A name is a label in a namespace that refers to an object. That is all it is. A name has no type, because a name is not a thing that can hold a type — the object it points at has one. A name has no size, no memory of what it used to refer to, and no ownership over what it refers to now.

So `x = 5` does not put anything anywhere. It creates an integer object with the value five (or finds one that already exists, which we will come back to), and then binds the name `x` in the current namespace to that object. The technical term for `=` in Python is not assignment but **binding**, and using the right word turns out to matter.

This is why the two arrows in a diagram of Python memory both point the same way — from name to object, never the reverse. An object does not know its own names. It cannot; there might be none, or seven.

## Two names, one object

Here is the whole consequence in four lines:

```python
a = [1, 2, 3]
b = a
b.append(4)
print(a)          # [1, 2, 3, 4]
```

If you read `b = a` as "copy the list into b", the output is impossible. If you read it as "bind the name `b` to whatever object `a` is currently bound to", the output is the only thing that could have happened. There is one list. There are two names for it. `b.append(4)` reaches through the name to the object and modifies the object, and `a` sees it because `a` was never looking at a copy — it was looking at the same list.

Nothing about `b = a` is a copy. Binding never copies. It is one of the cheapest operations in the language precisely because it does nothing but write down a reference.

You can watch this directly. Every object has an identity — a number, unique among live objects, that never changes for the life of the object:

```python
a = [1, 2, 3]
b = a
print(id(a) == id(b))   # True: one object
print(a is b)           # True: `is` compares identity
```

`is` asks "are these two expressions referring to the same object?" It does not ask whether they are equal. `==` asks whether they are equal, and equality is a question the object's type gets to answer for itself. Two different lists with the same contents are `==` and are not `is`. Keeping those two questions apart is most of unit 04.

## Rebinding is not mutation

There are exactly two things you can do through a name, and confusing them is the second half of this unit.

**Rebinding** points the name at a different object. It affects the name only.

**Mutation** changes the object the name points at. It affects every name bound to that object.

```python
a = [1, 2, 3]
b = a

a = [9, 9, 9]     # rebinding: `a` now points somewhere else
print(b)          # [1, 2, 3] — b never moved
```

Compare that with:

```python
a = [1, 2, 3]
b = a

a.append(9)       # mutation: the object itself changed
print(b)          # [1, 2, 3, 9] — b is looking at the same object
```

The two snippets differ by one character of intent and produce entirely different worlds. `a = ...` is always rebinding. `a.append(...)`, `a[0] = ...`, `a.sort()` are mutation. And `a += [9]` is — for a list — mutation, which is a genuinely surprising fact that unit 02 will make you earn.

Only some types can be mutated at all. Lists, dicts, sets and most objects you define yourself are mutable. Integers, floats, strings, tuples, frozensets and `None` are immutable: there is no operation anywhere in the language that changes the value of an existing string object. When you write `s = s.upper()` you are not upper-casing a string, you are building a new string and rebinding the name. This is why `s.upper()` on its own line does nothing useful, and why that is such a common first bug.

## Arguments are bound, not copied

Calling a function binds names too. The parameter names in the function's local namespace get bound to the same objects the caller passed. Nothing is copied on the way in.

```python
def wipe(items):
    items.clear()

data = [1, 2, 3]
wipe(data)
print(data)       # []
```

`items` and `data` are two names for one list. `clear()` mutates it, and the caller sees the result. This is not "pass by reference" in the C++ sense, and it is not "pass by value" either — the value being passed is a reference, which people usually shorten to *pass by object reference* or *call by sharing*.

The test for whether the caller will see a change is the same test as before: did the function **rebind** its parameter, or **mutate** the object?

```python
def wipe(items):
    items = []        # rebinding a local name; the caller's list is untouched

data = [1, 2, 3]
wipe(data)
print(data)           # [1, 2, 3]
```

The function body looks like it empties the list. It empties nothing. It points the local name `items` at a fresh empty list and then, one line later, that local name goes out of existence.

## The small integer cache

Now the fact that makes people distrust `is` forever, which is a good instinct arrived at for the wrong reason:

```python
a = 256
b = 256
print(a is b)      # True

a = 257
b = 257
print(a is b)      # very likely False
```

CPython pre-creates the integer objects from -5 to 256 when it starts, because small integers appear constantly and making a new object for every `0` would be wasteful. Both names find the same cached object. Above 256 you get a fresh object each time, so the identities differ. Short strings get similar treatment, called *interning*.

None of this is in the language specification. It is an implementation detail of CPython, it varies between versions, and it changes depending on whether the two literals appear in the same compiled block. Which is exactly why the rule is: **never use `is` to compare values.** Use `is` for `None`, for `True` and `False`, and for genuine identity questions like "is this the same object I stored earlier?" — those are guaranteed singletons and the comparison means what it says. For everything else, use `==`.

The cache is not a wart to memorise. It is the clearest possible demonstration that identity and equality are separate questions, because here are two objects that are equal and not identical, sitting one line below two names for one object that are both.

## A namespace is a dictionary

None of this is hidden machinery. A namespace really is a dict, and in most cases you can look at it:

```python
def f():
    local = 1
    print(locals())      # {'local': 1}

f()
print(globals().keys())  # every name at module level, including 'f'
```

Module-level names live in a dict you can inspect with `globals()`. An object's own attributes live in a dict on the object, `obj.__dict__`. Function locals are optimised into a fixed array at compile time rather than a real dict, which is why `locals()` hands you a snapshot rather than a live view — but the model is the same one.

So `x = 5` at module level is close to `globals()["x"] = 5`, and `obj.attr = 5` is close to `obj.__dict__["attr"] = 5`. Binding is a dictionary write. Looking a name up is a dictionary read that fails with `NameError` instead of `KeyError`. Unit 08 is entirely about the order in which those dictionaries are searched, and unit 19 is about what happens when you intercept the read.

## When the last name goes

If an object does not know its own names, how does Python know when it is finished with one?

It counts. Every object carries a count of how many references point at it, incremented on each new binding and decremented when a name is rebound or goes out of scope. When the count reaches zero the object is destroyed immediately.

```python
import sys

a = [1, 2, 3]
print(sys.getrefcount(a))   # 2: `a`, plus the temporary argument to getrefcount
b = a
print(sys.getrefcount(a))   # 3
del b
print(sys.getrefcount(a))   # 2 again
```

`del b` does not delete a list. It unbinds one name, and the list is deleted only if that was the last one. This is the other half of the model and it explains a great deal later: why a lingering reference in a cache is a memory leak, why circular references need a separate collector, and why `__del__` fires at a time you cannot easily predict. Unit 36 takes it apart properly. For now the useful version is that objects live exactly as long as something is pointing at them, and names are the pointing.

## What to carry forward

Four sentences, and the rest of the book leans on all four.

A name refers to an object; it does not contain one. `=` binds a name and never copies. Mutation is visible through every name bound to the object; rebinding is visible through one. Arguments are bound the same way as any other name, which is why a function can change your list and cannot change your integer.

When something in Python surprises you, the first question is almost always: *how many objects are there, and how many names?* Draw the arrows. The answer is usually immediate once you stop assuming a copy that was never made.
