---
slug: 11-strings
---

## strip takes a set of characters

`domain_of` removes a trailing suffix from a host name. It uses `strip`, which does not do what its name suggests to anyone who has not been caught by it once.

@expect silent
@hint `strip` takes a set of characters to remove, not a string to match.
@hint It keeps removing while the end is in that set. Work out which letters of the host are in `".com"`.
@diagnose silent Nothing raised, and a letter went missing. `strip`, `lstrip` and `rstrip` take a **set of characters** and keep removing from the ends while what they find is in that set. `".com"` is the four characters `.`, `c`, `o`, `m`, so `"example.com"` loses the suffix and then keeps going: the `e` before it is not in the set, but `"welcome.com"` would lose its `e` and `"moo.com"` would be stripped to nothing. This is the most misread method in the standard library. `removesuffix`, added in 3.9, does what you meant and does it exactly once.

~~~starter
def domain_of(host):
    """Return the host with a trailing '.com' removed."""
    return host.strip(".com")
~~~

~~~tests
assert domain_of("example.com") == "example"
assert domain_of("welcome.com") == "welcome", "a letter of the name was stripped too"
assert domain_of("plain") == "plain"
assert domain_of("moo.com") == "moo"
~~~

~~~solution
def domain_of(host):
    """Return the host with a trailing '.com' removed."""
    return host.removesuffix(".com")
~~~

## Text and bytes do not mix

`banner` builds a line to write to a binary stream. It joins a string onto bytes, and Python refuses. Read which two types it names.

@expect raises:TypeError
@expect mypy:operator
@hint `str` is characters and `bytes` is numbers. There is no implicit conversion in either direction.
@hint Encode on the way out. The method is named for the direction.
@diagnose TypeError `str` and `bytes` are two different types and Python 3 will not guess a conversion between them, which is the change from Python 2 that removed a whole family of bugs. A string is encoded on the way out with `.encode("utf-8")` and bytes are decoded on the way in with `.decode("utf-8")`. Watch for the quieter version of this mistake too: `"a" == b"a"` is not an error, it is `False`, so a mismatch can travel a long way before anything complains.
@diagnose operator mypy reports the unsupported operand types without running anything, naming `bytes` and `str` exactly. Any boundary where text meets binary is worth annotating for this reason: it is the one place the two types are easiest to mix up and the easiest for a checker to catch.

~~~starter
def banner(title: str) -> bytes:
    """Return the title as bytes, wrapped in a binary marker."""
    return b"--- " + title + b" ---"


print(banner("hello"))
~~~

~~~tests
assert banner("hello") == b"--- hello ---"
assert banner("café") == "--- café ---".encode()
~~~

~~~solution
def banner(title: str) -> bytes:
    """Return the title as bytes, wrapped in a binary marker."""
    return b"--- " + title.encode("utf-8") + b" ---"


print(banner("hello"))
~~~

## A method that changed nothing

`clean` tidies a field by stripping it and replacing a character. Both methods return a new string, and this function keeps neither.

@expect silent
@hint A string cannot be changed. Every method that looks like it edits one returns a new one.
@hint Two of these three lines throw their result away.
@diagnose silent It runs and returns the original text, whitespace and all. Strings are immutable: `strip` and `replace` build new strings and hand them back, and calling them for their effect accomplishes precisely nothing. Unit 01 met this as a first bug and it is worth meeting again, because it is easy to write when two of the three lines happen to be correct. The tell is a method call on its own line whose result is not assigned or returned: for an immutable type, that line can never be doing anything.

~~~starter
def clean(field):
    """Return the field trimmed, with underscores turned into spaces."""
    field.strip()
    field.replace("_", " ")
    return field
~~~

~~~tests
assert clean("  a_b  ") == "a b"
assert clean("plain") == "plain"
assert clean("") == ""
~~~

~~~solution
def clean(field):
    """Return the field trimmed, with underscores turned into spaces."""
    return field.strip().replace("_", " ")
~~~

## The empty line that was not empty

`fields_of` splits a comma-separated line into its fields. On a blank line it returns one field rather than none, because `split` with a separator keeps empty results.

@expect silent
@hint Compare `"".split(",")` with `"".split()`. They disagree.
@hint With a separator, `split` reports every gap between separators, including the one in an empty string.
@diagnose silent Nothing raised, and a blank line produced one empty field instead of no fields at all. `split(sep)` splits on every occurrence of the separator and keeps the empty pieces, so `""` is a single gap and comes back as `[""]`. `split()` with no argument behaves differently: it splits on runs of whitespace, discards the empties, and gives `[]` for a blank string. Parsing code that assumed "no fields" therefore gets one bad field, and the failure surfaces wherever that empty string is used rather than here.

~~~starter
def fields_of(line):
    """Return the comma-separated fields, or an empty list for a blank line."""
    return line.split(",")
~~~

~~~tests
assert fields_of("a,b,c") == ["a", "b", "c"]
assert fields_of("a") == ["a"]
assert fields_of("") == [], "a blank line has no fields"
assert fields_of("a,,b") == ["a", "", "b"], "an empty field in the middle is still a field"
~~~

~~~solution
def fields_of(line):
    """Return the comma-separated fields, or an empty list for a blank line."""
    if not line:
        return []
    return line.split(",")
~~~

## join takes strings

`summarise` builds a one-line summary from a row's values. `join` walks its argument and refuses anything that is not a string, naming the position it gave up at.

@expect raises:TypeError
@hint `join` concatenates strings and will not convert for you.
@hint Convert each value first. A comprehension does it in one expression.
@diagnose TypeError `str.join` requires every element to be a string and says so, naming the index of the first one that was not. It will not call `str()` for you, deliberately: silently stringifying whatever it is handed is how you end up with `None` and `<object at 0x...>` in your output. Convert first. Note that `join` is also the right answer for the performance reason: it walks the sequence once, works out the total size, allocates once and fills it, where building the same string with `+=` in a loop copies everything so far on every iteration.

~~~starter
def summarise(values):
    """Return the values as one comma-separated line."""
    return ", ".join(values)


print(summarise(["ada", 42]))
~~~

~~~tests
assert summarise(["ada", 42]) == "ada, 42"
assert summarise([]) == ""
assert summarise([1, 2, 3]) == "1, 2, 3"
~~~

~~~solution
def summarise(values):
    """Return the values as one comma-separated line."""
    return ", ".join(str(value) for value in values)


print(summarise(["ada", 42]))
~~~

## The wrong codec

`read_text` decodes bytes that arrived from somewhere else. It names a codec that cannot represent the bytes it was given, and the error says exactly which byte it stopped at.

@expect raises:UnicodeDecodeError
@hint The bytes are UTF-8. The codec named is not.
@hint Almost always the codec is wrong rather than the data.
@diagnose UnicodeDecodeError The bytes cannot be interpreted by the codec you named, and the message gives the byte, its position and why it is invalid. When this happens the codec is nearly always the mistake, not the data: something wrote UTF-8 and something else read ASCII or latin-1. Two things worth knowing. `errors="replace"` substitutes a visible replacement character, so the damage is obvious; `errors="ignore"` drops the offending bytes silently, which turns a loud failure into missing text nobody notices, and is almost never what you want. And name the encoding explicitly at every boundary, because the default is platform-dependent and is why the same script works on one machine and not another.

~~~starter
def read_text(data):
    """Decode UTF-8 bytes into text."""
    return data.decode("ascii")


print(read_text("café".encode()))
~~~

~~~tests
assert read_text(b"plain") == "plain"
assert read_text("café".encode("utf-8")) == "café"
~~~

~~~solution
def read_text(data):
    """Decode UTF-8 bytes into text."""
    return data.decode("utf-8")


print(read_text("café".encode()))
~~~

## Characters are not bytes

`fits` checks whether a name will fit a field that holds twenty bytes. It measures the string, which counts characters, and the two numbers are only the same while the text is ASCII.

@expect silent
@hint `len` counts characters. The limit is in bytes. Compare the two for a string with an accent in it.
@hint UTF-8 uses one byte for ASCII and two to four for everything else.
@diagnose silent Nothing raised, and a name that is too long for the field is reported as fitting. `len(s)` counts code points and every size limit in the outside world, database columns, network frames, filesystem names, is in bytes. UTF-8 spends one byte on ASCII and two to four on everything else, so the two numbers agree exactly until the first accented character and then never again. Measure what the limit measures: `len(s.encode("utf-8"))`. And note that truncating to fit is its own problem, because slicing the bytes can cut a character in half and produce something that will not decode.

~~~starter
def fits(name, limit=20):
    """True if the name fits a field holding `limit` bytes of UTF-8."""
    return len(name) <= limit
~~~

~~~tests
assert fits("ada") is True
assert fits("x" * 20) is True
assert fits("x" * 21) is False
assert fits("é" * 11) is False, "eleven accented characters are twenty-two bytes"
~~~

~~~solution
def fits(name, limit=20):
    """True if the name fits a field holding `limit` bytes of UTF-8."""
    return len(name.encode("utf-8")) <= limit
~~~

## Formatting from an older Python

`label` builds a display string with percent formatting. ruff suggests the modern spelling, and the tests show that the old one has a trap the new one does not.

@expect ruff:UP031
@expect raises:TypeError
@hint `%` formatting treats a tuple specially. Ask what happens when the value is one.
@hint An f-string interpolates exactly the expression you wrote.
@diagnose UP031 ruff's `UP031` is "use format specifiers instead of percent format". The `UP` rules rewrite constructs that a newer Python does better, and here the newer spelling is both faster and free of the trap below.
@diagnose TypeError "not all arguments converted during string formatting", because `%` treats a tuple as the argument **list** rather than as one value. A two-element tuple is read as two arguments for a format string that wants one, so a function that works for every other type breaks the moment somebody passes a pair. The old workaround is to wrap the value in a one-element tuple, `% (value,)`, which people forget precisely because it looks redundant. An f-string has no such rule: `f"{value}"` formats exactly the expression you wrote, whatever its type. That is the substance behind ruff's suggestion, rather than a preference about spelling.

~~~starter
def label(value):
    """Return a display label for a value of any type."""
    return "value: %s" % value
~~~

~~~tests
assert label(42) == "value: 42"
assert label("ada") == "value: ada"
assert label((1, 2)) == "value: (1, 2)", "a tuple was read as an argument list"
~~~

~~~solution
def label(value):
    """Return a display label for a value of any type."""
    return f"value: {value}"
~~~
