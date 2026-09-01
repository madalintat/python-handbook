---
slug: 11-strings
title: Strings, bytes and encoding
---

`str` and `bytes` are two different types that look similar enough to be confused for one, and the confusion always surfaces at a boundary: a file, a socket, a subprocess, a database driver. Getting the distinction straight once removes a whole family of bugs that are otherwise very hard to reason about.

## Two types, one idea kept apart

A `str` is a sequence of **characters**, or more precisely of Unicode code points. It has no encoding. It is not bytes in disguise. When you write `"café"` you have four characters, and that is all Python knows about it.

A `bytes` is a sequence of **numbers from 0 to 255**. It has no meaning until you say what encoding produced it.

Converting between them is explicit in both directions, and the two names are the ones to memorise:

```python
"café".encode("utf-8")        # b'caf\xc3\xa9'  str -> bytes
b"caf\xc3\xa9".decode("utf-8")  # 'café'        bytes -> str
```

**Encode goes out, decode comes in.** A string you have is encoded when it leaves the program; bytes you receive are decoded on the way in. Python 3 refuses to guess either direction, which is the change from Python 2 that caused all the noise and removed all the bugs.

The consequence you meet first is that they do not mix:

```python
"a" + b"b"          # TypeError
"a" == b"a"         # False, and not an error
```

The equality one is worth noting: comparing across the two types is legal and always false, so a mismatch can flow a long way before anything complains.

## UTF-8, and why one character is not one byte

An encoding is a rule for turning code points into bytes. UTF-8 is the one to use unless something external forces otherwise: it is ASCII-compatible for the first 128 code points, it encodes everything else in two to four bytes, and it is the default nearly everywhere.

Which means **the length of a string and the length of its bytes are different numbers**:

```python
s = "café"
len(s)                    # 4 characters
len(s.encode("utf-8"))    # 5 bytes
```

Every size limit you meet in the outside world is in bytes: database columns, network frames, filesystem names. Every `len` in your program is in characters. Truncating a string to fit a byte limit by slicing characters is a bug waiting for a non-ASCII input, and slicing the *bytes* is worse, because it can cut a character in half and produce something that will not decode.

## The two errors

`UnicodeDecodeError` means bytes arrived that the codec you named cannot make sense of. Almost always the codec is wrong rather than the data: something wrote latin-1 or cp1252 and you read utf-8.

`UnicodeEncodeError` means a character cannot be represented in the encoding you asked for, which mostly happens when something is still defaulting to ASCII.

Both take an `errors=` argument, and it is worth knowing what each choice throws away. `errors="strict"` is the default and raises. `errors="replace"` substitutes a replacement character, so the data is corrupted but visible. `errors="ignore"` drops the offending bytes silently, which is the one to be suspicious of: it turns a loud failure into missing text nobody notices.

## Files, and the default that bites

`open(path)` opens in **text** mode and decodes for you, using a platform-dependent default encoding. That default is why the same script reads a file correctly on one machine and fails on another. Say what you mean:

```python
open(path, encoding="utf-8")           # text, decoded explicitly
open(path, "rb")                       # bytes, no decoding at all
```

Anything that is not text should be opened in binary mode. Anything that is text should name its encoding.

## Strings are immutable, and what that costs

No method changes a string. `upper`, `replace`, `strip` and the rest all return a new one, which is why calling them for their effect does nothing at all, and unit 01 met that as a first bug.

The cost shows up in loops. Because every `+=` builds a whole new string and copies both sides, accumulating a string one piece at a time is quadratic:

```python
out = ""
for part in parts:
    out += part          # copies everything so far, every time
```

`"".join(parts)` walks the sequence once, adds up the total size, allocates once and fills it. It is the idiomatic answer and it is the fast one. `join` takes an iterable of strings and raises `TypeError` on anything else, so numbers need converting first.

## `strip` takes a set of characters

The most misread method in the standard library:

```python
"example.com".strip(".com")     # 'exampl'
```

`strip`, `lstrip` and `rstrip` take a **set of characters to remove**, not a prefix or a suffix, and they keep removing while the ends are in that set. Here the trailing `e` goes because `e` is in `".com"`.

For prefixes and suffixes there are two methods that do exactly what you meant, added in 3.9: `removeprefix` and `removesuffix`. With no argument, `strip()` removes whitespace, which is the use that made everyone think it was a prefix operation.

## `split`, and the two behaviours

`split()` with no argument splits on runs of whitespace and discards empty results, so a blank string gives `[]` and leading spaces do not produce empty entries. `split(sep)` with a separator splits on every single occurrence, keeps empties, and on a blank string gives `[""]` rather than `[]`.

That last one is the one to remember, because parsing a possibly-empty line with `line.split(",")` yields a one-element list containing an empty string, and code that assumed "no items" gets one bad item instead.

`maxsplit` limits how many splits happen, and `rsplit` counts from the right, which is how you take the extension off a filename or the last field off a line.

## The methods that earn their place

There are about forty string methods and you will use a dozen. Grouped by what they answer:

**Is it?** `startswith`, `endswith`, `isdigit`, `isalpha`, `isspace`. `startswith` and `endswith` both take a tuple, so `name.endswith((".jpg", ".png"))` is one call rather than a chain of `or`.

**Where is it?** `find` returns `-1` when absent; `index` raises. Prefer `in` when you only want to know whether it is there, because it says so more plainly and does not tempt you into comparing against `-1`.

**Change it.** `replace`, `lower`, `upper`, `strip`, `removeprefix`, `removesuffix`, `zfill`. Every one returns a new string.

**Cut it up and put it together.** `split`, `rsplit`, `splitlines`, `partition`, `join`. `partition(sep)` is the one people miss: it returns the part before, the separator itself, and the part after, always three values, so it never needs a length check.

`casefold` deserves a mention over `lower` for case-insensitive comparison: it handles cases `lower` does not, such as the German sharp s comparing equal to "ss".

## Bytes are not a lesser string

`bytes` has most of the same methods, and they take bytes rather than strings: `b"a,b".split(b",")`, not `b"a,b".split(",")`, which is a `TypeError`. Indexing behaves differently in a way that catches people:

```python
data = b"abc"
data[0]        # 97, an int
data[0:1]      # b'a', a bytes of length one
```

Indexing gives you a number and slicing gives you bytes, because a single byte is a number and there is no one-byte type to return. Strings do not have this asymmetry: `s[0]` is a one-character string, since a character is itself a string.

`bytearray` is the mutable version, which is what you want when building up binary data incrementally, for exactly the reason `join` beats `+=` for text.

## Normalisation, briefly

Two strings can look identical, print identically, and not be equal, because Unicode allows more than one sequence of code points for the same visible character. An accented e can be one code point or an ordinary e followed by a combining accent.

```python
import unicodedata
a = "café"                       # composed
b = "cafe\u0301"                 # e + combining acute
a == b                           # False
len(a), len(b)                   # 4, 5
unicodedata.normalize("NFC", b) == a     # True
```

You will meet this if you compare text that came from different sources, particularly anything that has been near a Mac filesystem or a form field. The fix is to normalise both sides to the same form, usually NFC, before comparing or before using text as a key.

This is also why "the length of a string" is a slippery idea. `len` counts code points, which is not the same as characters a reader would count, and neither is the same as bytes. For anything user-facing, the honest answer is that you need a library.

## f-strings, properly

An f-string evaluates its expressions and formats the results:

```python
f"{value}"        # str(value)
f"{value!r}"      # repr(value), for logs and debugging
f"{value=}"       # 'value=42' — prints the expression and its value
f"{n:.2f}"        # two decimal places
f"{n:,}"          # thousands separators
f"{s:>10}"        # right-aligned in ten columns
f"{n:08.3f}"      # zero-padded, width eight, three decimals
```

The part after the colon is the **format spec**, and it is the same mini-language `format()` and `str.format` use. Its shape is fill, align, sign, width, grouping, precision, type, and every part is optional. Learning `,` for grouping, `.Nf` for decimals and `<^>` for alignment covers nearly everything you will write.

`!r` deserves a habit: use it in every log line and every error message. `repr` is unambiguous, so `'3'` and `3` stay distinguishable at the moment you most need them to be.

Older code uses `%` formatting or `.format()`. Both still work, and ruff's `UP` rules will suggest the f-string version, which is faster and reads better.

## What to carry forward

`str` is characters and `bytes` is numbers, and the two never mix implicitly. Encode on the way out, decode on the way in, and name the encoding rather than accepting a default. A character is not a byte, so lengths differ and every external size limit is in bytes. Strings are immutable, so every method returns a new one and `+=` in a loop is quadratic where `join` is not. `strip` takes a set of characters, not a prefix. `split()` and `split(sep)` disagree about empty results. And `!r` in a log line is worth the two characters.
