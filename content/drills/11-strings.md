---
slug: 11-strings
---

## A `str` is a sequence of
- (x) Characters, with no encoding attached
- ( ) Bytes
- ( ) UTF-8 bytes
- ( ) Whatever the platform default is
> A `bytes` is a sequence of numbers from 0 to 255, and it has no meaning until you say which encoding produced it.

## Which direction does `.encode()` go?
- (x) `str` to `bytes`, on the way out
- ( ) `bytes` to `str`, on the way in
- ( ) It changes the encoding of a string in place
- ( ) It escapes special characters
> Encode goes out, decode comes in. Python 3 refuses to guess either direction.

## `"a" == b"a"` evaluates to
- ( ) `True`
- (x) `False`
- ( ) `TypeError`
- ( ) It depends on the encoding
> Comparing across the two types is legal and always false, so a mismatch can travel a long way before anything complains.

## `len("café")` and `len("café".encode("utf-8"))` are
- ( ) Both 4
- (x) 4 and 5
- ( ) Both 5
- ( ) 4 and 8
> UTF-8 spends one byte on ASCII and two to four on everything else, and every external size limit is in bytes.

## `"example.com".strip(".com")` gives
- ( ) `"example"`
- (x) `"exampl"`
- ( ) `"example.com"`
- ( ) `""`
> `strip` takes a set of characters and keeps removing while the ends are in it. `removesuffix` is the one that does what you meant.

## To remove a known suffix, use
- ( ) `rstrip(suffix)`
- (x) `removesuffix(suffix)`
- ( ) `replace(suffix, "")`
- ( ) `split(suffix)[0]`
> `replace` would also remove it from the middle. `removesuffix` was added in 3.9 for exactly this.

## `"".split(",")` returns
- ( ) `[]`
- (x) `[""]`
- ( ) `None`
- ( ) `[","]`
> With a separator, `split` keeps empty pieces. `"".split()` with no argument gives `[]`, because that form discards them.

## `", ".join([1, 2])` does what?
- ( ) Returns `"1, 2"`
- (x) Raises TypeError
- ( ) Returns `"12"`
- ( ) Returns `[1, 2]`
> `join` will not stringify for you, deliberately: doing so silently is how `None` ends up in your output.

## Building a string with `+=` in a loop is
- ( ) The same as `join`
- (x) Quadratic, because strings are immutable and each step copies both sides
- ( ) Faster than `join`
- ( ) A SyntaxError
> `join` walks the sequence once, works out the total size, allocates once and fills it.

## `data[0]` where `data` is `b"abc"` gives
- ( ) `b"a"`
- (x) `97`
- ( ) `"a"`
- ( ) A TypeError
> Indexing bytes gives a number and slicing gives bytes, because there is no one-byte type to return. Strings have no such asymmetry.

## `open(path)` with no encoding argument
- ( ) Always reads UTF-8
- (x) Uses a platform-dependent default, which is why the same script can fail on another machine
- ( ) Reads bytes
- ( ) Raises unless the file is ASCII
> Name the encoding for text, and use `"rb"` for anything that is not text.

## `errors="ignore"` when decoding
- ( ) Raises on bad bytes
- ( ) Substitutes a visible replacement character
- (x) Drops the offending bytes silently
- ( ) Retries with another codec
> Which turns a loud failure into missing text nobody notices. `errors="replace"` at least leaves evidence.

## In an f-string, `{n:,}` produces
- ( ) A tuple
- (x) The number with thousands separators
- ( ) A comma-separated list
- ( ) A syntax error
> The part after the colon is the format spec: fill, align, sign, width, grouping, precision, type, all optional.

## `f"{value=}"` prints
- ( ) Just the value
- (x) The expression text and its value, like `value=42`
- ( ) An assignment
- ( ) The variable's type
> Added in 3.8, and it is the fastest way to put a useful line in a log.

## Why can `"café"` compare unequal to another `"café"`?
- ( ) It cannot
- (x) The same character can be one code point or a letter plus a combining accent
- ( ) One of them is bytes
- ( ) Because of the platform encoding
> Normalise both sides with `unicodedata.normalize("NFC", s)` before comparing text from different sources.
