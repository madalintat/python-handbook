---
slug: json-parser
---

## Characters into tokens

Parsing anything is two jobs, and doing them separately is what keeps both
readable. The tokeniser turns characters into a flat list of meaningful units:
a brace, a comma, a string, a number. The parser turns that list into a tree.
Trying to do both at once is how you end up with a function that tracks three
indices and a mode flag.

Emit a token per unit, each carrying **where it was**. That position is the
difference between "invalid JSON" and "invalid JSON at line 3 column 17", and
the second one is the entire reason to write a parser rather than call one.

Numbers come out as `int` when they have no fraction or exponent, and `float`
otherwise, which is what `json` does and what a caller expects.

@goal `tokenize` produces positioned tokens, and refuses what JSON does not allow.

~~~starter
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}")
        self.at = at
        self.line = line
        self.column = column


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    raise NotImplementedError


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    raise NotImplementedError


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    raise NotImplementedError
~~~

~~~tests
kinds = lambda text: [t.kind for t in tokenize(text)]
values = lambda text: [t.value for t in tokenize(text)]

# punctuation
assert kinds("{}") == ["lbrace", "rbrace"]
assert kinds("[,:]") == ["lbracket", "comma", "colon", "rbracket"]
assert kinds("") == []

# whitespace is skipped, in all four forms JSON allows
assert kinds(' \t\n\r{ }') == ["lbrace", "rbrace"]

# numbers, and the int/float distinction
assert values("1") == [1] and isinstance(values("1")[0], int)
assert values("1.5") == [1.5] and isinstance(values("1.5")[0], float)
assert values("-2") == [-2]
assert values("1e3") == [1000.0] and isinstance(values("1e3")[0], float)
assert values("-1.5e-3") == [-0.0015]
assert values("0") == [0]

# strings, and their escapes
assert values('"hi"') == ["hi"]
assert values('""') == [""]
assert values(r'"a\"b"') == ['a"b']
assert values(r'"a\\b"') == ["a\\b"]
assert values(r'"line\nbreak"') == ["line\nbreak"]
assert values(r'"\u0041"') == ["A"]
assert values(r'"\u00e9"') == ["é"]

# literals
assert values("true false null") == [True, False, None]
assert kinds("true") == ["literal"]

# every token knows where it was
tokens = tokenize('{ "a" : 1 }')
assert [t.at for t in tokens][0] == 0
assert tokens[1].kind == "string" and tokens[1].value == "a"

# and the errors say where
for bad, needs in [("@", "line 1"), ('"unclosed', "line 1"), (r'"\q"', "line 1")]:
    try:
        tokenize(bad)
    except JSONError as exc:
        assert needs in str(exc), f"{bad!r} raised {exc}"
        assert exc.line == 1
    else:
        raise AssertionError(f"tokenize({bad!r}) should refuse it")

# the position is a real line and column, not an offset
try:
    tokenize('{\n  "a": @\n}')
except JSONError as exc:
    assert exc.line == 2, f"line {exc.line}"
    assert exc.column == 8, f"column {exc.column}"

# a raw control character inside a string is not allowed by JSON
try:
    tokenize('"a\nb"')
except JSONError:
    pass
else:
    raise AssertionError("a raw newline inside a string should be refused")
~~~

~~~solution
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}")
        self.at = at
        self.line = line
        self.column = column


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1
~~~

## Tokens into a tree

Now the parser, and the grammar is small enough to write in five lines:

```
value  := object | array | string | number | literal
object := "{" (string ":" value ("," string ":" value)*)? "}"
array  := "[" (value ("," value)*)? "]"
```

Recursive descent follows that exactly, one method per rule, each calling the
rule below it. An object is a brace, then pairs, then a brace, and the fact that
a value can be an object again is what gives you nesting without any code that
knows about nesting.

Two things a parser has to refuse that people forget. A document with anything
after the value, because `{} garbage` is not a document. And a document that
ends early, because `{"a":` is not one either.

@goal `loads` parses any valid document into Python values, and refuses invalid ones.

~~~starter
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}")
        self.at = at
        self.line = line
        self.column = column


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


class Parser:
    """Recursive descent over the token list. One method per rule."""

    def __init__(self, tokens, text=""):
        self.tokens = tokens
        self.text = text
        self.at = 0

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        raise NotImplementedError

    def value(self):
        raise NotImplementedError

    def object(self):
        raise NotImplementedError

    def array(self):
        raise NotImplementedError


def loads(text):
    """Parse a JSON document."""
    return Parser(tokenize(text), text).parse()
~~~

~~~tests
# stage one still holds
assert [t.kind for t in tokenize("{}")] == ["lbrace", "rbrace"]
assert [t.value for t in tokenize("1.5")] == [1.5]

# scalars
assert loads("1") == 1
assert loads("-1.5e2") == -150.0
assert loads('"hi"') == "hi"
assert loads("true") is True
assert loads("false") is False
assert loads("null") is None

# arrays
assert loads("[]") == []
assert loads("[1]") == [1]
assert loads("[1, 2, 3]") == [1, 2, 3]
assert loads('[1, "two", null, true]') == [1, "two", None, True]

# objects
assert loads("{}") == {}
assert loads('{"a": 1}') == {"a": 1}
assert loads('{"a": 1, "b": 2}') == {"a": 1, "b": 2}

# and they nest, without any code that knows about nesting
assert loads('{"a": [1, {"b": [2]}]}') == {"a": [1, {"b": [2]}]}
assert loads("[[[[1]]]]") == [[[[1]]]]

# whitespace anywhere it is allowed
assert loads('  {\n  "a" :\t[ 1 , 2 ]\n}  ') == {"a": [1, 2]}

# it agrees with the standard library on a real document
import json

document = ('{"name": "ada", "age": 36, "tags": ["maths", "engines"], '
            '"active": true, "score": -1.5e2, "note": null, '
            '"nested": {"deep": {"deeper": [1, 2, {"x": "y"}]}}}')
assert loads(document) == json.loads(document)

# what it has to refuse
for bad in ["", "{", "[", '{"a"}', '{"a":}', "[1,]", '{"a":1,}', "{} garbage",
            "[1 2]", '{1: 2}', "tru", "[,]", '{"a": 1']:
    try:
        loads(bad)
    except JSONError:
        pass
    else:
        raise AssertionError(f"loads({bad!r}) should refuse it")

# and the refusal says where
try:
    loads('{"a": 1, "b": }')
except JSONError as exc:
    assert exc.line == 1 and exc.column > 10, str(exc)
~~~

~~~solution
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}")
        self.at = at
        self.line = line
        self.column = column


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


class Parser:
    """Recursive descent over the token list. One method per rule."""

    def __init__(self, tokens, text=""):
        self.tokens = tokens
        self.text = text
        self.at = 0

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            return self.object()
        if token.kind == "lbracket":
            return self.array()
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        self.take("lbrace")
        out = {}
        if self.peek() is not None and self.peek().kind == "rbrace":
            self.take()
            return out
        while True:
            key = self.take("string")
            self.take("colon")
            out[key.value] = self.value()
            token = self.take()
            if token.kind == "rbrace":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or } in an object", self.text, token.at)

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text):
    """Parse a JSON document."""
    return Parser(tokenize(text), text).parse()
~~~

## An error worth reading

`Expecting value: line 1 column 8 (char 7)` is what the standard library gives
you, and on a one-line document of four thousand characters it is not enough.
Every compiler worth using prints the offending line with a caret under the
offending character, because a position you can see beats a number you have to
count to.

Add that. Find the line the failure is on, print it, and put a caret under the
column. Then handle the case that makes it useful rather than annoying: a very
long line has to be windowed around the error, with ellipses, or the output is
worse than the number was.

This is unit 38's argument applied to a parser you wrote: the message is where
the diagnosis happens.

@goal Every `JSONError` shows the offending line with a caret under the character.

~~~starter
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        # once show_error works, add it here:
        #     + "\n" + show_error(text, at)
        super().__init__(f"{message} at line {line} column {column}")
        self.at = at
        self.line = line
        self.column = column


def show_error(text, at, width=60):
    """The offending line, with a caret under the offending character."""
    raise NotImplementedError


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


class Parser:
    """Recursive descent over the token list. One method per rule."""

    def __init__(self, tokens, text=""):
        self.tokens = tokens
        self.text = text
        self.at = 0

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            return self.object()
        if token.kind == "lbracket":
            return self.array()
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        self.take("lbrace")
        out = {}
        if self.peek() is not None and self.peek().kind == "rbrace":
            self.take()
            return out
        while True:
            key = self.take("string")
            self.take("colon")
            out[key.value] = self.value()
            token = self.take()
            if token.kind == "rbrace":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or } in an object", self.text, token.at)

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text):
    """Parse a JSON document."""
    return Parser(tokenize(text), text).parse()
~~~

~~~tests
# stage two still holds
import json
assert loads('{"a": [1, {"b": [2]}]}') == {"a": [1, {"b": [2]}]}
assert loads("[]") == [] and loads("null") is None

# the caret sits under the character
out = show_error("abc@def", 3)
assert out.split("\n")[0] == "abc@def"
assert out.split("\n")[1] == "   ^", repr(out.split("\n")[1])

# on the right line of a multi-line document
text = 'line one\nline @two\nline three'
out = show_error(text, text.index("@"))
assert out.split("\n")[0] == "line @two"
assert out.split("\n")[1].index("^") == 5

# the first and last characters are not special cases
assert show_error("@bc", 0).split("\n")[1] == "^"
assert show_error("ab@", 2).split("\n")[1] == "  ^"

# a very long line is windowed, and says it was
long_line = "x" * 500 + "@" + "y" * 500
out = show_error(long_line, 500)
shown, caret = out.split("\n")
assert len(shown) < 120, f"the window is {len(shown)} characters wide"
assert "..." in shown
assert shown[caret.index("^")] == "@", "the caret should point at the offending character"

# a long line whose error is near the start needs no leading ellipsis
out = show_error("@" + "y" * 500, 0)
assert not out.startswith("...")

# and the parser's errors carry it
try:
    loads('{\n  "a": 1,\n  "b": @\n}')
except JSONError as exc:
    lines = str(exc).split("\n")
    assert "line 3" in lines[0]
    assert '"b": @' in lines[1], lines
    assert lines[2].strip() == "^"
    assert lines[1][lines[2].index("^")] == "@"
else:
    raise AssertionError("that document should be refused")

# the structured fields are still there for a caller that wants them
try:
    loads("[1 2]")
except JSONError as exc:
    assert exc.line == 1 and exc.at > 0
~~~

~~~solution
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}\n"
                         + show_error(text, at))
        self.at = at
        self.line = line
        self.column = column


def show_error(text, at, width=60):
    """The offending line, with a caret under the offending character."""
    line_start = text.rfind("\n", 0, at) + 1
    line_end = text.find("\n", at)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]
    column = at - line_start
    if len(line) > width:
        left = max(0, column - width // 2)
        right = min(len(line), left + width)
        prefix = "..." if left > 0 else ""
        suffix = "..." if right < len(line) else ""
        line = prefix + line[left:right] + suffix
        column = column - left + len(prefix)
    return f"{line}\n{' ' * column}^"


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


class Parser:
    """Recursive descent over the token list. One method per rule."""

    def __init__(self, tokens, text=""):
        self.tokens = tokens
        self.text = text
        self.at = 0

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            return self.object()
        if token.kind == "lbracket":
            return self.array()
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        self.take("lbrace")
        out = {}
        if self.peek() is not None and self.peek().kind == "rbrace":
            self.take()
            return out
        while True:
            key = self.take("string")
            self.take("colon")
            out[key.value] = self.value()
            token = self.take()
            if token.kind == "rbrace":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or } in an object", self.text, token.at)

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text):
    """Parse a JSON document."""
    return Parser(tokenize(text), text).parse()
~~~

## Input that is trying to break you

A recursive descent parser recurses once per level of nesting, so a document
that is ten thousand open brackets is ten thousand stack frames. In CPython that
is a `RecursionError` if you are lucky and an interpreter crash if you are not,
and it is four kilobytes to send. The standard library has a limit for exactly
this reason.

A parser that reads input from anywhere you do not control needs a depth limit,
and it needs to report hitting it as an ordinary parse error rather than as a
crash. That is the difference between rejecting a bad document and being the
bad document's target.

Take the limit as an argument, because a config file and a public endpoint want
different answers.

@goal A document nested past `max_depth` is refused as a `JSONError`, not a crash.

~~~starter
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}\n"
                         + show_error(text, at))
        self.at = at
        self.line = line
        self.column = column


def show_error(text, at, width=60):
    """The offending line, with a caret under the offending character."""
    line_start = text.rfind("\n", 0, at) + 1
    line_end = text.find("\n", at)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]
    column = at - line_start
    if len(line) > width:
        left = max(0, column - width // 2)
        right = min(len(line), left + width)
        prefix = "..." if left > 0 else ""
        suffix = "..." if right < len(line) else ""
        line = prefix + line[left:right] + suffix
        column = column - left + len(prefix)
    return f"{line}\n{' ' * column}^"


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


class Parser:
    """Recursive descent over the token list. One method per rule."""

    def __init__(self, tokens, text=""):
        self.tokens = tokens
        self.text = text
        self.at = 0

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def deeper(self, token):
        """Count one level in, and refuse a document built to exhaust the stack."""
        raise NotImplementedError

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            return self.object()
        if token.kind == "lbracket":
            return self.array()
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        self.take("lbrace")
        out = {}
        if self.peek() is not None and self.peek().kind == "rbrace":
            self.take()
            return out
        while True:
            key = self.take("string")
            self.take("colon")
            out[key.value] = self.value()
            token = self.take()
            if token.kind == "rbrace":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or } in an object", self.text, token.at)

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text):
    """Parse a JSON document."""
    return Parser(tokenize(text), text).parse()
~~~

~~~tests
# stage three still holds
assert show_error("abc@def", 3).split("\n")[1] == "   ^"
assert loads('{"a": [1, {"b": [2]}]}') == {"a": [1, {"b": [2]}]}

# ordinary nesting is untouched
assert loads("[[[[[1]]]]]") == [[[[[1]]]]]
assert loads('{"a": {"b": {"c": 1}}}') == {"a": {"b": {"c": 1}}}

# a document past the limit is refused, as a parse error
deep = "[" * 200 + "]" * 200
try:
    loads(deep, max_depth=100)
except JSONError as exc:
    assert "100" in str(exc), str(exc).split("\n")[0]
except RecursionError:
    raise AssertionError("a deep document should be refused, not crash the parser")
else:
    raise AssertionError("a document 200 deep should not pass a limit of 100")

# right at the limit is allowed, and one past it is not
assert loads("[" * 20 + "]" * 20, max_depth=20) == eval("[" * 20 + "]" * 20)
try:
    loads("[" * 21 + "]" * 21, max_depth=20)
except JSONError:
    pass
else:
    raise AssertionError("21 levels should not pass a limit of 20")

# objects count too, and so do the two mixed
try:
    loads("{" + '"a":{' * 30 + '"b":1' + "}" * 30 + "}", max_depth=10)
except JSONError:
    pass
else:
    raise AssertionError("nested objects should count toward the depth")

# depth is nesting, not length: a flat array of any size is fine
assert len(loads("[" + ",".join("1" for _ in range(500)) + "]", max_depth=5)) == 500

# and the depth counter unwinds, so siblings do not accumulate
assert loads('[[1],[2],[3],[4],[5]]', max_depth=3) == [[1], [2], [3], [4], [5]]

# the limit is an argument, because different callers want different answers
assert loads("[" * 30 + "]" * 30, max_depth=1000) is not None
~~~

~~~solution
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}\n"
                         + show_error(text, at))
        self.at = at
        self.line = line
        self.column = column


def show_error(text, at, width=60):
    """The offending line, with a caret under the offending character."""
    line_start = text.rfind("\n", 0, at) + 1
    line_end = text.find("\n", at)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]
    column = at - line_start
    if len(line) > width:
        left = max(0, column - width // 2)
        right = min(len(line), left + width)
        prefix = "..." if left > 0 else ""
        suffix = "..." if right < len(line) else ""
        line = prefix + line[left:right] + suffix
        column = column - left + len(prefix)
    return f"{line}\n{' ' * column}^"


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


MAX_DEPTH = 100


class Parser:
    """Recursive descent over the token list, with a depth limit."""

    def __init__(self, tokens, text="", max_depth=MAX_DEPTH):
        self.tokens = tokens
        self.text = text
        self.at = 0
        self.depth = 0
        self.max_depth = max_depth

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def deeper(self, token):
        """Count one level in, and refuse a document built to exhaust the stack."""
        self.depth += 1
        if self.depth > self.max_depth:
            raise JSONError(f"nested deeper than {self.max_depth}", self.text, token.at)

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            self.deeper(token)
            out = self.object()
            self.depth -= 1
            return out
        if token.kind == "lbracket":
            self.deeper(token)
            out = self.array()
            self.depth -= 1
            return out
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        self.take("lbrace")
        out = {}
        if self.peek() is not None and self.peek().kind == "rbrace":
            self.take()
            return out
        while True:
            key = self.take("string")
            self.take("colon")
            out[key.value] = self.value()
            token = self.take()
            if token.kind == "rbrace":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or } in an object", self.text, token.at)

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text, max_depth=MAX_DEPTH):
    """Parse a JSON document."""
    return Parser(tokenize(text), text, max_depth).parse()
~~~

## The inverse

A parser you cannot invert is half a library. Writing `dumps` is mostly
mechanical, and the two places it is not are the two places people get it wrong.

**Strings need escaping**, and the set is exact: the quote, the backslash, and
the control characters below `0x20`. Anything above that goes through as itself,
because JSON is defined over Unicode and escaping the rest is an option rather
than a requirement.

**`True` is an `int`.** `isinstance(True, int)` is true in Python, so a
serialiser that checks for `int` before `bool` writes `1` where it meant `true`.
Order the checks accordingly, and unit 04 explained why the language is like
that.

Optional indentation makes the output readable, which is what you want when a
person is going to look at it.

@goal `dumps` produces valid JSON, escaping correctly, with optional indentation.

~~~starter
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}\n"
                         + show_error(text, at))
        self.at = at
        self.line = line
        self.column = column


def show_error(text, at, width=60):
    """The offending line, with a caret under the offending character."""
    line_start = text.rfind("\n", 0, at) + 1
    line_end = text.find("\n", at)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]
    column = at - line_start
    if len(line) > width:
        left = max(0, column - width // 2)
        right = min(len(line), left + width)
        prefix = "..." if left > 0 else ""
        suffix = "..." if right < len(line) else ""
        line = prefix + line[left:right] + suffix
        column = column - left + len(prefix)
    return f"{line}\n{' ' * column}^"


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


MAX_DEPTH = 100


class Parser:
    """Recursive descent over the token list, with a depth limit."""

    def __init__(self, tokens, text="", max_depth=MAX_DEPTH):
        self.tokens = tokens
        self.text = text
        self.at = 0
        self.depth = 0
        self.max_depth = max_depth

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def deeper(self, token):
        """Count one level in, and refuse a document built to exhaust the stack."""
        self.depth += 1
        if self.depth > self.max_depth:
            raise JSONError(f"nested deeper than {self.max_depth}", self.text, token.at)

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            self.deeper(token)
            out = self.object()
            self.depth -= 1
            return out
        if token.kind == "lbracket":
            self.deeper(token)
            out = self.array()
            self.depth -= 1
            return out
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        self.take("lbrace")
        out = {}
        if self.peek() is not None and self.peek().kind == "rbrace":
            self.take()
            return out
        while True:
            key = self.take("string")
            self.take("colon")
            out[key.value] = self.value()
            token = self.take()
            if token.kind == "rbrace":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or } in an object", self.text, token.at)

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text, max_depth=MAX_DEPTH):
    """Parse a JSON document."""
    return Parser(tokenize(text), text, max_depth).parse()


def dump_string(value):
    """A JSON string literal, with everything JSON requires escaped."""
    raise NotImplementedError


def dumps(value, indent=None, _depth=0):
    """Serialise a Python value as JSON."""
    raise NotImplementedError
~~~

~~~tests
import json

# stage four still holds
assert loads("[[[[[1]]]]]") == [[[[[1]]]]]
try:
    loads("[" * 200 + "]" * 200, max_depth=100)
except JSONError:
    pass
else:
    raise AssertionError("the depth limit should still hold")

# scalars
assert dumps(1) == "1"
assert dumps(-1.5) == "-1.5"
assert dumps("hi") == '"hi"'
assert dumps(None) == "null"

# the trap: True is an int, and must not come out as 1
assert dumps(True) == "true", "bool has to be checked before int"
assert dumps(False) == "false"
assert dumps([True, 1, False, 0]) == "[true,1,false,0]"

# strings, and exactly what JSON requires escaping
assert dumps('a"b') == r'"a\"b"'
assert dumps("a\\b") == r'"a\\b"'
assert dumps("a\nb") == r'"a\nb"'
assert dumps("a\tb") == r'"a\tb"'
assert dumps("\x00") == r'"\u0000"'
assert dumps("é") == '"é"', "a character above 0x20 goes through as itself"
assert dumps("🐍") == '"🐍"'

# containers
assert dumps([]) == "[]"
assert dumps({}) == "{}"
assert dumps([1, 2]) == "[1,2]"
assert dumps({"a": 1}) == '{"a":1}'
assert dumps({"a": [1, {"b": None}]}) == '{"a":[1,{"b":null}]}'
assert dumps((1, 2)) == "[1,2]", "a tuple serialises as an array"

# indentation, when a person is going to read it
assert dumps({"a": 1}, indent=2) == '{\n  "a": 1\n}'
assert dumps([1, 2], indent=2) == "[\n  1,\n  2\n]"
assert dumps({"a": [1]}, indent=2) == '{\n  "a": [\n    1\n  ]\n}'
assert dumps([], indent=2) == "[]", "an empty container stays on one line"

# what cannot be represented is refused rather than guessed at
for bad in [float("nan"), float("inf"), float("-inf")]:
    try:
        dumps(bad)
    except ValueError:
        pass
    else:
        raise AssertionError(f"{bad} is not JSON and should be refused")

try:
    dumps({1: "a"})
except TypeError:
    pass
else:
    raise AssertionError("a non-string key should be refused")

try:
    dumps({1, 2})
except TypeError:
    pass
else:
    raise AssertionError("a set is not serialisable")

# and the output really is JSON, by the standard library's reckoning
for value in [1, "hi", None, True, [1, [2, [3]]], {"a": {"b": [1, 2]}},
              {"escaped": 'quote " and \\ and \n'}, [], {}]:
    assert json.loads(dumps(value)) == value, f"failed for {value!r}"
    assert json.loads(dumps(value, indent=2)) == value
~~~

~~~solution
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}\n"
                         + show_error(text, at))
        self.at = at
        self.line = line
        self.column = column


def show_error(text, at, width=60):
    """The offending line, with a caret under the offending character."""
    line_start = text.rfind("\n", 0, at) + 1
    line_end = text.find("\n", at)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]
    column = at - line_start
    if len(line) > width:
        left = max(0, column - width // 2)
        right = min(len(line), left + width)
        prefix = "..." if left > 0 else ""
        suffix = "..." if right < len(line) else ""
        line = prefix + line[left:right] + suffix
        column = column - left + len(prefix)
    return f"{line}\n{' ' * column}^"


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


MAX_DEPTH = 100


class Parser:
    """Recursive descent over the token list, with a depth limit."""

    def __init__(self, tokens, text="", max_depth=MAX_DEPTH):
        self.tokens = tokens
        self.text = text
        self.at = 0
        self.depth = 0
        self.max_depth = max_depth

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def deeper(self, token):
        """Count one level in, and refuse a document built to exhaust the stack."""
        self.depth += 1
        if self.depth > self.max_depth:
            raise JSONError(f"nested deeper than {self.max_depth}", self.text, token.at)

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            self.deeper(token)
            out = self.object()
            self.depth -= 1
            return out
        if token.kind == "lbracket":
            self.deeper(token)
            out = self.array()
            self.depth -= 1
            return out
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        self.take("lbrace")
        out = {}
        if self.peek() is not None and self.peek().kind == "rbrace":
            self.take()
            return out
        while True:
            key = self.take("string")
            self.take("colon")
            out[key.value] = self.value()
            token = self.take()
            if token.kind == "rbrace":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or } in an object", self.text, token.at)

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text, max_depth=MAX_DEPTH):
    """Parse a JSON document."""
    return Parser(tokenize(text), text, max_depth).parse()


ESCAPE_OUT = {'"': r'\"', "\\": r"\\", "\n": r"\n", "\r": r"\r",
              "\t": r"\t", "\b": r"\b", "\f": r"\f"}


def dump_string(value):
    """A JSON string literal, with everything JSON requires escaped."""
    out = ['"']
    for char in value:
        if char in ESCAPE_OUT:
            out.append(ESCAPE_OUT[char])
        elif ord(char) < 0x20:
            out.append(f"\\u{ord(char):04x}")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def dumps(value, indent=None, _depth=0):
    """Serialise a Python value as JSON."""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, str):
        return dump_string(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError(f"{value} is not representable in JSON")
        return repr(value)
    if isinstance(value, (list, tuple)):
        return _dump_items([dumps(v, indent, _depth + 1) for v in value],
                           "[", "]", indent, _depth)
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"a JSON key must be a string, not {type(key).__name__}")
            sep = ": " if indent is not None else ":"
            parts.append(dump_string(key) + sep + dumps(item, indent, _depth + 1))
        return _dump_items(parts, "{", "}", indent, _depth)
    raise TypeError(f"{type(value).__name__} is not serialisable")


def _dump_items(parts, open_char, close_char, indent, depth):
    if not parts:
        return open_char + close_char
    if indent is None:
        return open_char + ",".join(parts) + close_char
    pad = " " * (indent * (depth + 1))
    closing = " " * (indent * depth)
    joined = (",\n" + pad).join(parts)
    return f"{open_char}\n{pad}{joined}\n{closing}{close_char}"
~~~

## Where JSON is underspecified

JSON has one specification and several behaviours, and the gaps are where two
systems that both "speak JSON" disagree. Three of them matter enough to make a
decision about rather than inherit one.

**Duplicate keys.** `{"a": 1, "a": 2}` is valid by the grammar and the standard
says nothing about which wins. Every implementation takes the last, which means a
document can carry a value that a security check never saw. Take a hook, default
to the usual behaviour, and let a caller ask for a refusal.

**Big integers.** JSON numbers have no size limit and JavaScript's do, so a
64-bit id round-trips through a browser as a different number. Python has no such
problem, which is worth knowing precisely because the system on the other end
might.

**Key order.** Objects are unordered by the standard and every real parser keeps
insertion order, which unit 12 explained is guaranteed for a Python dict.

@goal An `object_pairs` hook decides what a repeated key means, defaulting to last-wins.

~~~starter
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}\n"
                         + show_error(text, at))
        self.at = at
        self.line = line
        self.column = column


def show_error(text, at, width=60):
    """The offending line, with a caret under the offending character."""
    line_start = text.rfind("\n", 0, at) + 1
    line_end = text.find("\n", at)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]
    column = at - line_start
    if len(line) > width:
        left = max(0, column - width // 2)
        right = min(len(line), left + width)
        prefix = "..." if left > 0 else ""
        suffix = "..." if right < len(line) else ""
        line = prefix + line[left:right] + suffix
        column = column - left + len(prefix)
    return f"{line}\n{' ' * column}^"


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


MAX_DEPTH = 100


class Parser:
    """Recursive descent over the token list, with a depth limit."""

    def __init__(self, tokens, text="", max_depth=MAX_DEPTH, object_pairs=None):
        self.tokens = tokens
        self.text = text
        self.at = 0
        self.depth = 0
        self.max_depth = max_depth
        self.object_pairs = object_pairs or dict

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def deeper(self, token):
        """Count one level in, and refuse a document built to exhaust the stack."""
        self.depth += 1
        if self.depth > self.max_depth:
            raise JSONError(f"nested deeper than {self.max_depth}", self.text, token.at)

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            self.deeper(token)
            out = self.object()
            self.depth -= 1
            return out
        if token.kind == "lbracket":
            self.deeper(token)
            out = self.array()
            self.depth -= 1
            return out
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        """Collect the pairs, then hand them to object_pairs to become a value."""
        raise NotImplementedError

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text, max_depth=MAX_DEPTH, object_pairs=None):
    """Parse a JSON document."""
    return Parser(tokenize(text), text, max_depth, object_pairs).parse()


def duplicate_keys_last(pairs):
    """The default: a later key wins, which is what every parser does."""
    raise NotImplementedError


def duplicate_keys_refuse(pairs):
    """Refuse a document with a repeated key rather than silently dropping one."""
    raise NotImplementedError


ESCAPE_OUT = {'"': r'\"', "\\": r"\\", "\n": r"\n", "\r": r"\r",
              "\t": r"\t", "\b": r"\b", "\f": r"\f"}


def dump_string(value):
    """A JSON string literal, with everything JSON requires escaped."""
    out = ['"']
    for char in value:
        if char in ESCAPE_OUT:
            out.append(ESCAPE_OUT[char])
        elif ord(char) < 0x20:
            out.append(f"\\u{ord(char):04x}")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def dumps(value, indent=None, _depth=0):
    """Serialise a Python value as JSON."""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, str):
        return dump_string(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError(f"{value} is not representable in JSON")
        return repr(value)
    if isinstance(value, (list, tuple)):
        return _dump_items([dumps(v, indent, _depth + 1) for v in value],
                           "[", "]", indent, _depth)
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"a JSON key must be a string, not {type(key).__name__}")
            sep = ": " if indent is not None else ":"
            parts.append(dump_string(key) + sep + dumps(item, indent, _depth + 1))
        return _dump_items(parts, "{", "}", indent, _depth)
    raise TypeError(f"{type(value).__name__} is not serialisable")


def _dump_items(parts, open_char, close_char, indent, depth):
    if not parts:
        return open_char + close_char
    if indent is None:
        return open_char + ",".join(parts) + close_char
    pad = " " * (indent * (depth + 1))
    closing = " " * (indent * depth)
    joined = (",\n" + pad).join(parts)
    return f"{open_char}\n{pad}{joined}\n{closing}{close_char}"
~~~

~~~tests
import json

# stage five still holds
assert dumps(True) == "true" and dumps("a\nb") == r'"a\nb"'
assert json.loads(dumps({"a": [1, {"b": None}]})) == {"a": [1, {"b": None}]}

# the default: the last one wins, as every implementation does
assert loads('{"a": 1, "a": 2}') == {"a": 2}
assert loads('{"a": 1, "a": 2}') == json.loads('{"a": 1, "a": 2}')
assert duplicate_keys_last([("a", 1), ("a", 2)]) == {"a": 2}

# and the hook can refuse instead, which a security check would want
assert duplicate_keys_refuse([("a", 1), ("b", 2)]) == {"a": 1, "b": 2}
try:
    duplicate_keys_refuse([("a", 1), ("a", 2)])
except ValueError as exc:
    assert "a" in str(exc)
else:
    raise AssertionError("a repeated key should be refused by that hook")

try:
    loads('{"a": 1, "a": 2}', object_pairs=duplicate_keys_refuse)
except ValueError:
    pass
else:
    raise AssertionError("the hook should reach the parser")

# a document with no duplicates is unaffected either way
document = '{"a": 1, "b": {"c": 2, "d": 3}}'
assert loads(document, object_pairs=duplicate_keys_refuse) == json.loads(document)

# the hook sees pairs in document order, so it can do anything with them
seen = []
loads('{"b": 1, "a": 2}', object_pairs=lambda pairs: seen.extend(pairs) or dict(pairs))
assert seen == [("b", 1), ("a", 2)], seen

# and it applies at every level, not only the top
assert loads('{"outer": {"a": 1, "a": 2}}') == {"outer": {"a": 2}}
try:
    loads('{"outer": {"a": 1, "a": 2}}', object_pairs=duplicate_keys_refuse)
except ValueError:
    pass
else:
    raise AssertionError("the hook should apply to nested objects too")

# key order is insertion order, which is what a dict guarantees
assert list(loads('{"z": 1, "a": 2, "m": 3}')) == ["z", "a", "m"]

# big integers survive, because Python's ints do not overflow
big = "9" * 30
assert loads(big) == int(big)
assert loads(f"[{big}]")[0] == int(big)
assert json.loads(dumps(loads(big))) == int(big)

# an empty object still goes through the hook
assert loads("{}", object_pairs=duplicate_keys_refuse) == {}
~~~

~~~solution
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}\n"
                         + show_error(text, at))
        self.at = at
        self.line = line
        self.column = column


def show_error(text, at, width=60):
    """The offending line, with a caret under the offending character."""
    line_start = text.rfind("\n", 0, at) + 1
    line_end = text.find("\n", at)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]
    column = at - line_start
    if len(line) > width:
        left = max(0, column - width // 2)
        right = min(len(line), left + width)
        prefix = "..." if left > 0 else ""
        suffix = "..." if right < len(line) else ""
        line = prefix + line[left:right] + suffix
        column = column - left + len(prefix)
    return f"{line}\n{' ' * column}^"


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


MAX_DEPTH = 100


class Parser:
    """Recursive descent over the token list, with a depth limit."""

    def __init__(self, tokens, text="", max_depth=MAX_DEPTH, object_pairs=None):
        self.tokens = tokens
        self.text = text
        self.at = 0
        self.depth = 0
        self.max_depth = max_depth
        self.object_pairs = object_pairs or dict

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def deeper(self, token):
        """Count one level in, and refuse a document built to exhaust the stack."""
        self.depth += 1
        if self.depth > self.max_depth:
            raise JSONError(f"nested deeper than {self.max_depth}", self.text, token.at)

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            self.deeper(token)
            out = self.object()
            self.depth -= 1
            return out
        if token.kind == "lbracket":
            self.deeper(token)
            out = self.array()
            self.depth -= 1
            return out
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        self.take("lbrace")
        pairs = []
        if self.peek() is not None and self.peek().kind == "rbrace":
            self.take()
            return self.object_pairs(pairs)
        while True:
            key = self.take("string")
            self.take("colon")
            pairs.append((key.value, self.value()))
            token = self.take()
            if token.kind == "rbrace":
                return self.object_pairs(pairs)
            if token.kind != "comma":
                raise JSONError("expected , or } in an object", self.text, token.at)

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text, max_depth=MAX_DEPTH, object_pairs=None):
    """Parse a JSON document."""
    return Parser(tokenize(text), text, max_depth, object_pairs).parse()


ESCAPE_OUT = {'"': r'\"', "\\": r"\\", "\n": r"\n", "\r": r"\r",
              "\t": r"\t", "\b": r"\b", "\f": r"\f"}


def dump_string(value):
    """A JSON string literal, with everything JSON requires escaped."""
    out = ['"']
    for char in value:
        if char in ESCAPE_OUT:
            out.append(ESCAPE_OUT[char])
        elif ord(char) < 0x20:
            out.append(f"\\u{ord(char):04x}")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def dumps(value, indent=None, _depth=0):
    """Serialise a Python value as JSON."""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, str):
        return dump_string(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError(f"{value} is not representable in JSON")
        return repr(value)
    if isinstance(value, (list, tuple)):
        return _dump_items([dumps(v, indent, _depth + 1) for v in value],
                           "[", "]", indent, _depth)
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"a JSON key must be a string, not {type(key).__name__}")
            sep = ": " if indent is not None else ":"
            parts.append(dump_string(key) + sep + dumps(item, indent, _depth + 1))
        return _dump_items(parts, "{", "}", indent, _depth)
    raise TypeError(f"{type(value).__name__} is not serialisable")


def _dump_items(parts, open_char, close_char, indent, depth):
    if not parts:
        return open_char + close_char
    if indent is None:
        return open_char + ",".join(parts) + close_char
    pad = " " * (indent * (depth + 1))
    closing = " " * (indent * depth)
    joined = (",\n" + pad).join(parts)
    return f"{open_char}\n{pad}{joined}\n{closing}{close_char}"


def duplicate_keys_last(pairs):
    """The default: a later key wins, which is what every parser does."""
    return dict(pairs)


def duplicate_keys_refuse(pairs):
    """Refuse a document with a repeated key rather than silently dropping one."""
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise ValueError(f"duplicate key {key!r}")
        seen[key] = value
    return seen
~~~

## One document per line

A single JSON array holding a million records has to be parsed in full before
anything can be done with the first one, and held in memory in full while it is.
JSON Lines is the answer everybody converged on: one document per line, no
enclosing array, so a reader can process record one without having seen record
two.

Write it as a **generator**, which is unit 16's argument with memory as the
motive: a file larger than memory is still a file you can process, and the
consumer decides how much to hold.

An error has to name the line of the stream, not the column of a fragment,
because "line 1 column 12" is unhelpful when there are a million of them. Wrap
the failure with the record number and keep the original as the cause, which is
unit 38's rule.

@goal `load_lines` yields one value per line and names the record that failed.

~~~starter
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}\n"
                         + show_error(text, at))
        self.at = at
        self.line = line
        self.column = column


def show_error(text, at, width=60):
    """The offending line, with a caret under the offending character."""
    line_start = text.rfind("\n", 0, at) + 1
    line_end = text.find("\n", at)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]
    column = at - line_start
    if len(line) > width:
        left = max(0, column - width // 2)
        right = min(len(line), left + width)
        prefix = "..." if left > 0 else ""
        suffix = "..." if right < len(line) else ""
        line = prefix + line[left:right] + suffix
        column = column - left + len(prefix)
    return f"{line}\n{' ' * column}^"


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


MAX_DEPTH = 100


class Parser:
    """Recursive descent over the token list, with a depth limit."""

    def __init__(self, tokens, text="", max_depth=MAX_DEPTH, object_pairs=None):
        self.tokens = tokens
        self.text = text
        self.at = 0
        self.depth = 0
        self.max_depth = max_depth
        self.object_pairs = object_pairs or dict

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def deeper(self, token):
        """Count one level in, and refuse a document built to exhaust the stack."""
        self.depth += 1
        if self.depth > self.max_depth:
            raise JSONError(f"nested deeper than {self.max_depth}", self.text, token.at)

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            self.deeper(token)
            out = self.object()
            self.depth -= 1
            return out
        if token.kind == "lbracket":
            self.deeper(token)
            out = self.array()
            self.depth -= 1
            return out
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        self.take("lbrace")
        pairs = []
        if self.peek() is not None and self.peek().kind == "rbrace":
            self.take()
            return self.object_pairs(pairs)
        while True:
            key = self.take("string")
            self.take("colon")
            pairs.append((key.value, self.value()))
            token = self.take()
            if token.kind == "rbrace":
                return self.object_pairs(pairs)
            if token.kind != "comma":
                raise JSONError("expected , or } in an object", self.text, token.at)

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text, max_depth=MAX_DEPTH, object_pairs=None):
    """Parse a JSON document."""
    return Parser(tokenize(text), text, max_depth, object_pairs).parse()


ESCAPE_OUT = {'"': r'\"', "\\": r"\\", "\n": r"\n", "\r": r"\r",
              "\t": r"\t", "\b": r"\b", "\f": r"\f"}


def dump_string(value):
    """A JSON string literal, with everything JSON requires escaped."""
    out = ['"']
    for char in value:
        if char in ESCAPE_OUT:
            out.append(ESCAPE_OUT[char])
        elif ord(char) < 0x20:
            out.append(f"\\u{ord(char):04x}")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def dumps(value, indent=None, _depth=0):
    """Serialise a Python value as JSON."""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, str):
        return dump_string(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError(f"{value} is not representable in JSON")
        return repr(value)
    if isinstance(value, (list, tuple)):
        return _dump_items([dumps(v, indent, _depth + 1) for v in value],
                           "[", "]", indent, _depth)
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"a JSON key must be a string, not {type(key).__name__}")
            sep = ": " if indent is not None else ":"
            parts.append(dump_string(key) + sep + dumps(item, indent, _depth + 1))
        return _dump_items(parts, "{", "}", indent, _depth)
    raise TypeError(f"{type(value).__name__} is not serialisable")


def _dump_items(parts, open_char, close_char, indent, depth):
    if not parts:
        return open_char + close_char
    if indent is None:
        return open_char + ",".join(parts) + close_char
    pad = " " * (indent * (depth + 1))
    closing = " " * (indent * depth)
    joined = (",\n" + pad).join(parts)
    return f"{open_char}\n{pad}{joined}\n{closing}{close_char}"


def duplicate_keys_last(pairs):
    """The default: a later key wins, which is what every parser does."""
    return dict(pairs)


def duplicate_keys_refuse(pairs):
    """Refuse a document with a repeated key rather than silently dropping one."""
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise ValueError(f"duplicate key {key!r}")
        seen[key] = value
    return seen

def load_lines(source, **kwargs):
    """Parse JSON Lines: one document per line, yielded as they are read."""
    raise NotImplementedError


def dump_lines(values, sink, **kwargs):
    """Write one document per line. Returns how many were written."""
    raise NotImplementedError
~~~

~~~tests
import io

# stage six still holds
assert loads('{"a": 1, "a": 2}') == {"a": 2}
try:
    loads('{"a": 1, "a": 2}', object_pairs=duplicate_keys_refuse)
except ValueError:
    pass
else:
    raise AssertionError("the duplicate-key hook should still work")

# reading
stream = io.StringIO('{"a": 1}\n{"a": 2}\n[1, 2]\n')
assert list(load_lines(stream)) == [{"a": 1}, {"a": 2}, [1, 2]]

# blank lines are skipped rather than being an error
assert list(load_lines(io.StringIO('{"a": 1}\n\n  \n{"a": 2}\n'))) == [{"a": 1}, {"a": 2}]
assert list(load_lines(io.StringIO(""))) == []
assert list(load_lines(io.StringIO("\n\n"))) == []

# a file with no trailing newline is still a file
assert list(load_lines(io.StringIO('{"a": 1}'))) == [{"a": 1}]

# it is lazy: nothing is parsed until it is asked for
opened = []


def counted_lines():
    for line in ['{"a": 1}', '{"a": 2}', '{"a": 3}']:
        opened.append(line)
        yield line


gen = load_lines(counted_lines())
assert opened == [], "a generator should not read before it is iterated"
first = next(gen)
assert first == {"a": 1}
assert len(opened) == 1, f"reading one record read {len(opened)} lines"

# a bad record names its line number and keeps the original as the cause
try:
    list(load_lines(io.StringIO('{"a": 1}\n{bad}\n{"a": 3}\n')))
except JSONError as exc:
    assert "line 2" in str(exc), str(exc).split("\n")[0]
    assert exc.__cause__ is not None, "the original failure should be the cause"
else:
    raise AssertionError("a bad record should be reported")

# the records before the bad one were already yielded, which is the point
partial = []
try:
    for value in load_lines(io.StringIO('{"a": 1}\n{bad}\n')):
        partial.append(value)
except JSONError:
    pass
assert partial == [{"a": 1}], partial

# writing, and the round trip through a file
sink = io.StringIO()
count = dump_lines([{"a": 1}, [1, 2], "text", None], sink)
assert count == 4
assert sink.getvalue().count("\n") == 4, "one newline per record"
assert list(load_lines(io.StringIO(sink.getvalue()))) == [{"a": 1}, [1, 2], "text", None]

# writing nothing writes nothing
empty = io.StringIO()
assert dump_lines([], empty) == 0 and empty.getvalue() == ""

# and the parser options reach through
try:
    list(load_lines(io.StringIO('{"a": 1, "a": 2}'), object_pairs=duplicate_keys_refuse))
except ValueError:
    pass
else:
    raise AssertionError("keyword arguments should reach loads")
~~~

~~~solution
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}\n"
                         + show_error(text, at))
        self.at = at
        self.line = line
        self.column = column


def show_error(text, at, width=60):
    """The offending line, with a caret under the offending character."""
    line_start = text.rfind("\n", 0, at) + 1
    line_end = text.find("\n", at)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]
    column = at - line_start
    if len(line) > width:
        left = max(0, column - width // 2)
        right = min(len(line), left + width)
        prefix = "..." if left > 0 else ""
        suffix = "..." if right < len(line) else ""
        line = prefix + line[left:right] + suffix
        column = column - left + len(prefix)
    return f"{line}\n{' ' * column}^"


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


MAX_DEPTH = 100


class Parser:
    """Recursive descent over the token list, with a depth limit."""

    def __init__(self, tokens, text="", max_depth=MAX_DEPTH, object_pairs=None):
        self.tokens = tokens
        self.text = text
        self.at = 0
        self.depth = 0
        self.max_depth = max_depth
        self.object_pairs = object_pairs or dict

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def deeper(self, token):
        """Count one level in, and refuse a document built to exhaust the stack."""
        self.depth += 1
        if self.depth > self.max_depth:
            raise JSONError(f"nested deeper than {self.max_depth}", self.text, token.at)

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            self.deeper(token)
            out = self.object()
            self.depth -= 1
            return out
        if token.kind == "lbracket":
            self.deeper(token)
            out = self.array()
            self.depth -= 1
            return out
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        self.take("lbrace")
        pairs = []
        if self.peek() is not None and self.peek().kind == "rbrace":
            self.take()
            return self.object_pairs(pairs)
        while True:
            key = self.take("string")
            self.take("colon")
            pairs.append((key.value, self.value()))
            token = self.take()
            if token.kind == "rbrace":
                return self.object_pairs(pairs)
            if token.kind != "comma":
                raise JSONError("expected , or } in an object", self.text, token.at)

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text, max_depth=MAX_DEPTH, object_pairs=None):
    """Parse a JSON document."""
    return Parser(tokenize(text), text, max_depth, object_pairs).parse()


ESCAPE_OUT = {'"': r'\"', "\\": r"\\", "\n": r"\n", "\r": r"\r",
              "\t": r"\t", "\b": r"\b", "\f": r"\f"}


def dump_string(value):
    """A JSON string literal, with everything JSON requires escaped."""
    out = ['"']
    for char in value:
        if char in ESCAPE_OUT:
            out.append(ESCAPE_OUT[char])
        elif ord(char) < 0x20:
            out.append(f"\\u{ord(char):04x}")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def dumps(value, indent=None, _depth=0):
    """Serialise a Python value as JSON."""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, str):
        return dump_string(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError(f"{value} is not representable in JSON")
        return repr(value)
    if isinstance(value, (list, tuple)):
        return _dump_items([dumps(v, indent, _depth + 1) for v in value],
                           "[", "]", indent, _depth)
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"a JSON key must be a string, not {type(key).__name__}")
            sep = ": " if indent is not None else ":"
            parts.append(dump_string(key) + sep + dumps(item, indent, _depth + 1))
        return _dump_items(parts, "{", "}", indent, _depth)
    raise TypeError(f"{type(value).__name__} is not serialisable")


def _dump_items(parts, open_char, close_char, indent, depth):
    if not parts:
        return open_char + close_char
    if indent is None:
        return open_char + ",".join(parts) + close_char
    pad = " " * (indent * (depth + 1))
    closing = " " * (indent * depth)
    joined = (",\n" + pad).join(parts)
    return f"{open_char}\n{pad}{joined}\n{closing}{close_char}"


def duplicate_keys_last(pairs):
    """The default: a later key wins, which is what every parser does."""
    return dict(pairs)


def duplicate_keys_refuse(pairs):
    """Refuse a document with a repeated key rather than silently dropping one."""
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise ValueError(f"duplicate key {key!r}")
        seen[key] = value
    return seen

def load_lines(source, **kwargs):
    """Parse JSON Lines: one document per line, yielded as they are read.

    A generator rather than a list, so a file larger than memory is a file you
    can still process. Unit 16's argument, with memory as the motive.
    """
    for number, line in enumerate(source, 1):
        line = line.strip()
        if not line:
            continue
        try:
            yield loads(line, **kwargs)
        except JSONError as exc:
            raise JSONError(f"line {number} of the stream: {exc.args[0].splitlines()[0]}",
                            line, exc.at) from exc


def dump_lines(values, sink, **kwargs):
    """Write one document per line. Returns how many were written."""
    written = 0
    for value in values:
        sink.write(dumps(value, **kwargs) + "\n")
        written += 1
    return written
~~~

## Measured against the one in the box

The last stage is the one that tells you what you have built. Compare it against
`json`: first that it agrees, on every document you can think of, because a
parser that is fast and wrong is worthless; then how much slower it is.

It will be much slower, and the reason is unit 35's: the standard library's
parser is C, and this one is a Python loop over characters. Expect a factor
between twenty and a hundred. That is not a failure of your code, it is the
ceiling on the approach, and knowing where that ceiling is is the point.

Report the ratio rather than the durations. A ratio is comparable between
machines where a duration is not, and take best-of-three rather than a mean,
because noise only ever makes things slower.

@goal `compare_against_stdlib` proves agreement and reports the honest ratio.

~~~starter
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}\n"
                         + show_error(text, at))
        self.at = at
        self.line = line
        self.column = column


def show_error(text, at, width=60):
    """The offending line, with a caret under the offending character."""
    line_start = text.rfind("\n", 0, at) + 1
    line_end = text.find("\n", at)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]
    column = at - line_start
    if len(line) > width:
        left = max(0, column - width // 2)
        right = min(len(line), left + width)
        prefix = "..." if left > 0 else ""
        suffix = "..." if right < len(line) else ""
        line = prefix + line[left:right] + suffix
        column = column - left + len(prefix)
    return f"{line}\n{' ' * column}^"


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


MAX_DEPTH = 100


class Parser:
    """Recursive descent over the token list, with a depth limit."""

    def __init__(self, tokens, text="", max_depth=MAX_DEPTH, object_pairs=None):
        self.tokens = tokens
        self.text = text
        self.at = 0
        self.depth = 0
        self.max_depth = max_depth
        self.object_pairs = object_pairs or dict

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def deeper(self, token):
        """Count one level in, and refuse a document built to exhaust the stack."""
        self.depth += 1
        if self.depth > self.max_depth:
            raise JSONError(f"nested deeper than {self.max_depth}", self.text, token.at)

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            self.deeper(token)
            out = self.object()
            self.depth -= 1
            return out
        if token.kind == "lbracket":
            self.deeper(token)
            out = self.array()
            self.depth -= 1
            return out
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        self.take("lbrace")
        pairs = []
        if self.peek() is not None and self.peek().kind == "rbrace":
            self.take()
            return self.object_pairs(pairs)
        while True:
            key = self.take("string")
            self.take("colon")
            pairs.append((key.value, self.value()))
            token = self.take()
            if token.kind == "rbrace":
                return self.object_pairs(pairs)
            if token.kind != "comma":
                raise JSONError("expected , or } in an object", self.text, token.at)

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text, max_depth=MAX_DEPTH, object_pairs=None):
    """Parse a JSON document."""
    return Parser(tokenize(text), text, max_depth, object_pairs).parse()


ESCAPE_OUT = {'"': r'\"', "\\": r"\\", "\n": r"\n", "\r": r"\r",
              "\t": r"\t", "\b": r"\b", "\f": r"\f"}


def dump_string(value):
    """A JSON string literal, with everything JSON requires escaped."""
    out = ['"']
    for char in value:
        if char in ESCAPE_OUT:
            out.append(ESCAPE_OUT[char])
        elif ord(char) < 0x20:
            out.append(f"\\u{ord(char):04x}")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def dumps(value, indent=None, _depth=0):
    """Serialise a Python value as JSON."""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, str):
        return dump_string(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError(f"{value} is not representable in JSON")
        return repr(value)
    if isinstance(value, (list, tuple)):
        return _dump_items([dumps(v, indent, _depth + 1) for v in value],
                           "[", "]", indent, _depth)
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"a JSON key must be a string, not {type(key).__name__}")
            sep = ": " if indent is not None else ":"
            parts.append(dump_string(key) + sep + dumps(item, indent, _depth + 1))
        return _dump_items(parts, "{", "}", indent, _depth)
    raise TypeError(f"{type(value).__name__} is not serialisable")


def _dump_items(parts, open_char, close_char, indent, depth):
    if not parts:
        return open_char + close_char
    if indent is None:
        return open_char + ",".join(parts) + close_char
    pad = " " * (indent * (depth + 1))
    closing = " " * (indent * depth)
    joined = (",\n" + pad).join(parts)
    return f"{open_char}\n{pad}{joined}\n{closing}{close_char}"


def duplicate_keys_last(pairs):
    """The default: a later key wins, which is what every parser does."""
    return dict(pairs)


def duplicate_keys_refuse(pairs):
    """Refuse a document with a repeated key rather than silently dropping one."""
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise ValueError(f"duplicate key {key!r}")
        seen[key] = value
    return seen

def load_lines(source, **kwargs):
    """Parse JSON Lines: one document per line, yielded as they are read.

    A generator rather than a list, so a file larger than memory is a file you
    can still process. Unit 16's argument, with memory as the motive.
    """
    for number, line in enumerate(source, 1):
        line = line.strip()
        if not line:
            continue
        try:
            yield loads(line, **kwargs)
        except JSONError as exc:
            raise JSONError(f"line {number} of the stream: {exc.args[0].splitlines()[0]}",
                            line, exc.at) from exc


def dump_lines(values, sink, **kwargs):
    """Write one document per line. Returns how many were written."""
    written = 0
    for value in values:
        sink.write(dumps(value, **kwargs) + "\n")
        written += 1
    return written


def count_nodes(value):
    """Every scalar, array and object in a document. The unit of work."""
    raise NotImplementedError


def compare_against_stdlib(documents):
    """Agreement and relative speed against the standard library."""
    raise NotImplementedError
~~~

~~~tests
import io
import json

# stage seven still holds
assert list(load_lines(io.StringIO('{"a": 1}\n[2]\n'))) == [{"a": 1}, [2]]
sink = io.StringIO()
assert dump_lines([{"a": 1}], sink) == 1

# counting the work in a document
assert count_nodes(1) == 1
assert count_nodes("hi") == 1
assert count_nodes(None) == 1
assert count_nodes([]) == 1
assert count_nodes([1, 2]) == 3, "the array itself plus two scalars"
assert count_nodes({"a": 1}) == 2
assert count_nodes({"a": [1, 2]}) == 4
assert count_nodes({"a": {"b": [1, {"c": 2}]}}) == 6

# agreement on a spread of real documents
documents = [
    '{"name": "ada", "age": 36, "tags": ["maths", "engines"]}',
    "[1, 2.5, -3e2, true, false, null]",
    '{"nested": {"deep": {"deeper": [1, 2, {"x": "y"}]}}}',
    '{"escaped": "quote \\" backslash \\\\ newline \\n tab \\t"}',
    '{"unicode": "naïve 🐍 日本語", "escaped_unicode": "\\u0041"}',
    "[]", "{}", '""', "0", '{"a": [[[[1]]]]}',
    '{"big": 123456789012345678901234567890}',
]
for document in documents:
    assert loads(document) == json.loads(document), f"disagrees on {document}"

report = compare_against_stdlib(documents)
assert report["agrees"] is True
assert report["nodes"] > 20, report["nodes"]

# it is slower, and the report is honest about how much
assert report["slower_by"] > 1.0, (
    f"a Python character loop should not beat the C parser: {report['slower_by']}"
)
assert report["slower_by"] < 500, f"slower by {report['slower_by']:.0f}x is suspicious"

# disagreement is an error rather than a number
try:
    compare_against_stdlib(["{bad}"])
except (AssertionError, JSONError):
    pass
else:
    raise AssertionError("an unparseable document should not be reported as agreeing")

# the round trip through both directions still holds for everything above
for document in documents:
    value = loads(document)
    assert loads(dumps(value)) == value, f"round trip failed for {document}"
    assert json.loads(dumps(value)) == value

# and the whole library agrees with the standard one on a generated document
generated = dumps({"rows": [{"id": i, "name": f"row {i}", "ok": i % 2 == 0}
                            for i in range(50)]})
assert loads(generated) == json.loads(generated)
~~~

~~~solution
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """One lexical unit, and where it was."""

    kind: str
    value: object
    at: int


class JSONError(ValueError):
    """The document is not valid JSON."""

    def __init__(self, message, text, at):
        line = text.count("\n", 0, at) + 1
        column = at - (text.rfind("\n", 0, at) + 1) + 1
        super().__init__(f"{message} at line {line} column {column}\n"
                         + show_error(text, at))
        self.at = at
        self.line = line
        self.column = column


def show_error(text, at, width=60):
    """The offending line, with a caret under the offending character."""
    line_start = text.rfind("\n", 0, at) + 1
    line_end = text.find("\n", at)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]
    column = at - line_start
    if len(line) > width:
        left = max(0, column - width // 2)
        right = min(len(line), left + width)
        prefix = "..." if left > 0 else ""
        suffix = "..." if right < len(line) else ""
        line = prefix + line[left:right] + suffix
        column = column - left + len(prefix)
    return f"{line}\n{' ' * column}^"


PUNCTUATION = {"{": "lbrace", "}": "rbrace", "[": "lbracket", "]": "rbracket",
               ",": "comma", ":": "colon"}
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
LITERALS = {"true": True, "false": False, "null": None}


def tokenize(text):
    """Every token in the document, in order."""
    tokens = []
    at = 0
    while at < len(text):
        char = text[at]
        if char in " \t\n\r":
            at += 1
        elif char in PUNCTUATION:
            tokens.append(Token(PUNCTUATION[char], char, at))
            at += 1
        elif char == '"':
            value, at = read_string(text, at)
            tokens.append(Token("string", value, at))
        elif (match := NUMBER.match(text, at)) is not None:
            tokens.append(Token("number", parse_number(match.group()), at))
            at = match.end()
        else:
            for word, value in LITERALS.items():
                if text.startswith(word, at):
                    tokens.append(Token("literal", value, at))
                    at += len(word)
                    break
            else:
                raise JSONError(f"unexpected {char!r}", text, at)
    return tokens


def parse_number(raw):
    """An int when it has no fraction or exponent, a float otherwise."""
    return float(raw) if any(c in raw for c in ".eE") else int(raw)


ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b",
           "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def read_string(text, at):
    """The string starting at `at`, and the index just past its closing quote."""
    at += 1
    out = []
    while True:
        if at >= len(text):
            raise JSONError("string is never closed", text, len(text) - 1)
        char = text[at]
        if char == '"':
            return "".join(out), at + 1
        if char == "\\":
            at += 1
            if at >= len(text):
                raise JSONError("string ends with a backslash", text, at - 1)
            code = text[at]
            if code == "u":
                if at + 4 >= len(text):
                    raise JSONError("truncated \\u escape", text, at)
                out.append(chr(int(text[at + 1:at + 5], 16)))
                at += 5
                continue
            if code not in ESCAPES:
                raise JSONError(f"unknown escape \\{code}", text, at)
            out.append(ESCAPES[code])
            at += 1
            continue
        if ord(char) < 0x20:
            raise JSONError("a control character must be escaped", text, at)
        out.append(char)
        at += 1


MAX_DEPTH = 100


class Parser:
    """Recursive descent over the token list, with a depth limit."""

    def __init__(self, tokens, text="", max_depth=MAX_DEPTH, object_pairs=None):
        self.tokens = tokens
        self.text = text
        self.at = 0
        self.depth = 0
        self.max_depth = max_depth
        self.object_pairs = object_pairs or dict

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, kind=None):
        token = self.peek()
        if token is None:
            raise JSONError("the document ends too early", self.text, len(self.text))
        if kind is not None and token.kind != kind:
            raise JSONError(f"expected {kind}, found {token.kind}", self.text, token.at)
        self.at += 1
        return token

    def parse(self):
        value = self.value()
        if self.peek() is not None:
            raise JSONError("trailing content after the value", self.text, self.peek().at)
        return value

    def deeper(self, token):
        """Count one level in, and refuse a document built to exhaust the stack."""
        self.depth += 1
        if self.depth > self.max_depth:
            raise JSONError(f"nested deeper than {self.max_depth}", self.text, token.at)

    def value(self):
        token = self.peek()
        if token is None:
            raise JSONError("a value was expected", self.text, len(self.text))
        if token.kind == "lbrace":
            self.deeper(token)
            out = self.object()
            self.depth -= 1
            return out
        if token.kind == "lbracket":
            self.deeper(token)
            out = self.array()
            self.depth -= 1
            return out
        if token.kind in ("string", "number", "literal"):
            return self.take().value
        raise JSONError(f"a value cannot start with {token.kind}", self.text, token.at)

    def object(self):
        self.take("lbrace")
        pairs = []
        if self.peek() is not None and self.peek().kind == "rbrace":
            self.take()
            return self.object_pairs(pairs)
        while True:
            key = self.take("string")
            self.take("colon")
            pairs.append((key.value, self.value()))
            token = self.take()
            if token.kind == "rbrace":
                return self.object_pairs(pairs)
            if token.kind != "comma":
                raise JSONError("expected , or } in an object", self.text, token.at)

    def array(self):
        self.take("lbracket")
        out = []
        if self.peek() is not None and self.peek().kind == "rbracket":
            self.take()
            return out
        while True:
            out.append(self.value())
            token = self.take()
            if token.kind == "rbracket":
                return out
            if token.kind != "comma":
                raise JSONError("expected , or ] in an array", self.text, token.at)


def loads(text, max_depth=MAX_DEPTH, object_pairs=None):
    """Parse a JSON document."""
    return Parser(tokenize(text), text, max_depth, object_pairs).parse()


ESCAPE_OUT = {'"': r'\"', "\\": r"\\", "\n": r"\n", "\r": r"\r",
              "\t": r"\t", "\b": r"\b", "\f": r"\f"}


def dump_string(value):
    """A JSON string literal, with everything JSON requires escaped."""
    out = ['"']
    for char in value:
        if char in ESCAPE_OUT:
            out.append(ESCAPE_OUT[char])
        elif ord(char) < 0x20:
            out.append(f"\\u{ord(char):04x}")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def dumps(value, indent=None, _depth=0):
    """Serialise a Python value as JSON."""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, str):
        return dump_string(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError(f"{value} is not representable in JSON")
        return repr(value)
    if isinstance(value, (list, tuple)):
        return _dump_items([dumps(v, indent, _depth + 1) for v in value],
                           "[", "]", indent, _depth)
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"a JSON key must be a string, not {type(key).__name__}")
            sep = ": " if indent is not None else ":"
            parts.append(dump_string(key) + sep + dumps(item, indent, _depth + 1))
        return _dump_items(parts, "{", "}", indent, _depth)
    raise TypeError(f"{type(value).__name__} is not serialisable")


def _dump_items(parts, open_char, close_char, indent, depth):
    if not parts:
        return open_char + close_char
    if indent is None:
        return open_char + ",".join(parts) + close_char
    pad = " " * (indent * (depth + 1))
    closing = " " * (indent * depth)
    joined = (",\n" + pad).join(parts)
    return f"{open_char}\n{pad}{joined}\n{closing}{close_char}"


def duplicate_keys_last(pairs):
    """The default: a later key wins, which is what every parser does."""
    return dict(pairs)


def duplicate_keys_refuse(pairs):
    """Refuse a document with a repeated key rather than silently dropping one."""
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise ValueError(f"duplicate key {key!r}")
        seen[key] = value
    return seen

def load_lines(source, **kwargs):
    """Parse JSON Lines: one document per line, yielded as they are read.

    A generator rather than a list, so a file larger than memory is a file you
    can still process. Unit 16's argument, with memory as the motive.
    """
    for number, line in enumerate(source, 1):
        line = line.strip()
        if not line:
            continue
        try:
            yield loads(line, **kwargs)
        except JSONError as exc:
            raise JSONError(f"line {number} of the stream: {exc.args[0].splitlines()[0]}",
                            line, exc.at) from exc


def dump_lines(values, sink, **kwargs):
    """Write one document per line. Returns how many were written."""
    written = 0
    for value in values:
        sink.write(dumps(value, **kwargs) + "\n")
        written += 1
    return written

def count_nodes(value):
    """Every scalar, array and object in a document. The unit of work."""
    if isinstance(value, dict):
        return 1 + sum(count_nodes(v) for v in value.values())
    if isinstance(value, list):
        return 1 + sum(count_nodes(v) for v in value)
    return 1


def compare_against_stdlib(documents):
    """Agreement and relative speed against the standard library.

    Speed is measured as a ratio of best-of-three runs, because a ratio is
    comparable between machines where a duration is not, and best-of rather
    than mean because noise only ever makes things slower.
    """
    import json
    import time

    for document in documents:
        if loads(document) != json.loads(document):
            raise AssertionError(f"disagrees with json on {document[:40]!r}")

    def best_of(parse):
        times = []
        for _ in range(3):
            start = time.perf_counter()
            for document in documents:
                parse(document)
            times.append(time.perf_counter() - start)
        return min(times)

    mine = best_of(loads)
    theirs = best_of(json.loads)
    nodes = sum(count_nodes(loads(d)) for d in documents)
    return {
        "agrees": True,
        "nodes": nodes,
        "slower_by": mine / theirs if theirs else float("inf"),
    }
~~~
