---
slug: regex-engine
---

## A pattern is a tree

A regular expression looks like a string and behaves like a program, and the
first move is to stop treating it as a string. Parse it into a tree, once, and
the matcher becomes a walk over that tree rather than a scan with an index into
the pattern and a pile of special cases.

Start with the smallest useful grammar: literal characters, `.` for any
character, and the three postfix quantifiers `*`, `+` and `?` applied to the
atom on their left. A sequence of those is a concatenation. Represent each node
as a tuple whose first element names its kind, which is enough structure to
match on and small enough to print when something goes wrong.

@goal `parse(pattern)` returns a tree of literals, `.` and the three quantifiers.

~~~starter
def parse(pattern):
    """Turn a pattern into a tree.

    ("lit", c)    one character        ("star", node)  zero or more
    ("any",)      any character        ("plus", node)  one or more
    ("cat", ...)  a sequence           ("opt", node)   zero or one
    """
    raise NotImplementedError
~~~

~~~tests
assert parse("a") == ("cat", (("lit", "a"),))
assert parse("ab") == ("cat", (("lit", "a"), ("lit", "b")))
assert parse(".") == ("cat", (("any",),))
assert parse("") == ("cat", ())

assert parse("a*") == ("cat", (("star", ("lit", "a")),))
assert parse("a+") == ("cat", (("plus", ("lit", "a")),))
assert parse("a?") == ("cat", (("opt", ("lit", "a")),))

# a quantifier binds to the atom on its left, not to everything before it
assert parse("ab*") == ("cat", (("lit", "a"), ("star", ("lit", "b"))))
assert parse(".*") == ("cat", (("star", ("any",)),))

# and quantifiers stack
assert parse("a*?") == ("cat", (("opt", ("star", ("lit", "a"))),))

# a quantifier with nothing to apply to is a broken pattern, and should say so
for bad in ("*", "+", "?", "*a"):
    try:
        parse(bad)
    except ValueError as exc:
        assert "nothing" in str(exc).lower() or "repeat" in str(exc).lower(), (
            f"parse({bad!r}) raised {exc!r}, which does not say what is wrong"
        )
    else:
        raise AssertionError(f"parse({bad!r}) should refuse a quantifier with no atom")

longer = parse("a.b+c?")
assert longer == ("cat", (
    ("lit", "a"), ("any",), ("plus", ("lit", "b")), ("opt", ("lit", "c")),
))
~~~

~~~solution
QUANTIFIERS = {"*": "star", "+": "plus", "?": "opt"}


def parse(pattern):
    """Turn a pattern into a tree.

    ("lit", c)    one character        ("star", node)  zero or more
    ("any",)      any character        ("plus", node)  one or more
    ("cat", ...)  a sequence           ("opt", node)   zero or one
    """
    items = []
    for char in pattern:
        if char in QUANTIFIERS:
            if not items:
                raise ValueError(f"{char!r} has nothing to repeat")
            items[-1] = (QUANTIFIERS[char], items[-1])
        elif char == ".":
            items.append(("any",))
        else:
            items.append(("lit", char))
    return ("cat", tuple(items))
~~~

## Walking it, and going back

Now match. The clean way to write a backtracking matcher is to have each node
report **every** position the text could be at after it matches, as a generator.
A literal yields one position or none. A concatenation threads the positions
through its children. A star yields the position it started at, and every
position reachable by matching its body again.

That shape gets backtracking for free. When a later part of the pattern fails,
the generator for an earlier part is asked for its next position, which is
exactly what "going back and trying a shorter match" means, with no explicit
stack anywhere in your code.

Greedy means trying the longer match first, so a star recurses before it yields
the position it started at.

@goal `fullmatch(pattern, text)` is True when the whole text matches the whole pattern.

~~~starter
QUANTIFIERS = {"*": "star", "+": "plus", "?": "opt"}


def parse(pattern):
    """Turn a pattern into a tree."""
    items = []
    for char in pattern:
        if char in QUANTIFIERS:
            if not items:
                raise ValueError(f"{char!r} has nothing to repeat")
            items[-1] = (QUANTIFIERS[char], items[-1])
        elif char == ".":
            items.append(("any",))
        else:
            items.append(("lit", char))
    return ("cat", tuple(items))


def walk(node, text, at):
    """Every position the text could be at after this node matches at `at`."""
    raise NotImplementedError


def fullmatch(pattern, text):
    """Whether the whole text matches the whole pattern."""
    return any(end == len(text) for end in walk(parse(pattern), text, 0))
~~~

~~~tests
assert parse("a") == ("cat", (("lit", "a"),))

assert fullmatch("a", "a")
assert not fullmatch("a", "b")
assert not fullmatch("a", "aa"), "fullmatch means the whole text"
assert not fullmatch("ab", "a")
assert fullmatch("", "")
assert not fullmatch("", "a")

assert fullmatch(".", "x")
assert not fullmatch(".", "")
assert fullmatch("...", "abc")

assert fullmatch("a*", "")
assert fullmatch("a*", "aaaa")
assert not fullmatch("a*", "aab")
assert fullmatch("a+", "a")
assert not fullmatch("a+", "")
assert fullmatch("a?", "")
assert fullmatch("a?", "a")
assert not fullmatch("a?", "aa")

# the case that needs backtracking: the star has to give a character back
assert fullmatch(".*a", "bbba")
assert fullmatch("a*a", "aaa")
assert not fullmatch("a*b", "aaa")

# and one where it gives back several
assert fullmatch(".*ab", "xxxabab")
assert fullmatch("a*a*a*b", "aaab")

# greedy: the longer match is tried first
ends = list(walk(parse("a*"), "aaa", 0))
assert ends[0] == 3, f"the first end offered was {ends[0]}, expected the greedy one"
assert sorted(ends) == [0, 1, 2, 3]
~~~

~~~solution
QUANTIFIERS = {"*": "star", "+": "plus", "?": "opt"}


def parse(pattern):
    """Turn a pattern into a tree."""
    items = []
    for char in pattern:
        if char in QUANTIFIERS:
            if not items:
                raise ValueError(f"{char!r} has nothing to repeat")
            items[-1] = (QUANTIFIERS[char], items[-1])
        elif char == ".":
            items.append(("any",))
        else:
            items.append(("lit", char))
    return ("cat", tuple(items))


def walk(node, text, at):
    """Every position the text could be at after this node matches at `at`.

    A generator per node is what makes backtracking fall out: when something
    later fails, the caller asks this for its next position, which is the
    shorter match it had not tried yet.
    """
    kind = node[0]
    if kind == "lit":
        if at < len(text) and text[at] == node[1]:
            yield at + 1
    elif kind == "any":
        if at < len(text):
            yield at + 1
    elif kind == "cat":
        yield from _sequence(node[1], text, at)
    elif kind == "star":
        # greedy: the longer match first, then give characters back
        for after in walk(node[1], text, at):
            if after > at:
                yield from walk(node, text, after)
        yield at
    elif kind == "plus":
        for after in walk(node[1], text, at):
            if after > at:
                yield from walk(("star", node[1]), text, after)
            else:
                yield after
    elif kind == "opt":
        yield from walk(node[1], text, at)
        yield at


def _sequence(items, text, at):
    """Thread the positions through a sequence of nodes."""
    if not items:
        yield at
        return
    for after in walk(items[0], text, at):
        yield from _sequence(items[1:], text, after)


def fullmatch(pattern, text):
    """Whether the whole text matches the whole pattern."""
    return any(end == len(text) for end in walk(parse(pattern), text, 0))
~~~

## Groups, alternation and classes

Now the parser earns its keep. Adding `(...)` for grouping, `|` for
alternation and `[abc]` for a character class to a string-scanning matcher means
three new special cases in the matching loop; adding them to a tree means three
new node kinds and a real grammar.

The grammar is the standard one, and writing it down is most of the work:

```
alt   := cat ("|" cat)*
cat   := repeat*
repeat := atom ("*" | "+" | "?")*
atom  := literal | "." | "[" class "]" | "(" alt ")"
```

Recursive descent follows the grammar exactly: one function per rule, each
calling the rule below it. A group is just `alt` inside brackets, which is why
`(a|b)*` works without any code that knows about that combination.

Escapes matter too: `\.` is a literal dot, and inside a class `[a-c]` is a
range while `[^a]` is a negation.

@goal `fullmatch` handles groups, alternation, classes, ranges, negation and escapes.

~~~starter
QUANTIFIERS = {"*": "star", "+": "plus", "?": "opt"}


class _Parser:
    """Recursive descent, one method per rule. Three rules are missing."""

    def __init__(self, pattern):
        self.pattern = pattern
        self.at = 0

    def peek(self):
        return self.pattern[self.at] if self.at < len(self.pattern) else ""

    def take(self):
        char = self.pattern[self.at]
        self.at += 1
        return char

    def parse(self):
        node = self.alt()
        if self.at != len(self.pattern):
            raise ValueError(f"unexpected {self.peek()!r} at {self.at}")
        return node

    def alt(self):
        """alt := cat ("|" cat)*"""
        return self.cat()

    def cat(self):
        """cat := repeat*"""
        items = []
        while self.peek() and self.peek() not in "|)":
            items.append(self.repeat())
        return ("cat", tuple(items))

    def repeat(self):
        """repeat := atom ("*" | "+" | "?")*"""
        node = self.atom()
        while self.peek() in QUANTIFIERS and self.peek():
            node = (QUANTIFIERS[self.take()], node)
        return node

    def atom(self):
        """atom := literal | "." | "[" class "]" | "(" alt ")" """
        char = self.peek()
        if not char:
            raise ValueError("pattern ended where an atom was expected")
        if char in QUANTIFIERS:
            raise ValueError(f"{char!r} has nothing to repeat")
        if char == ".":
            self.take()
            return ("any",)
        if char == "\\":
            self.take()
            if not self.peek():
                raise ValueError("pattern ends with a backslash")
            return ("lit", self.take())
        return ("lit", self.take())

    def char_class(self):
        """A ("cls", members, negated) node, with ranges and negation."""
        raise NotImplementedError


def parse(pattern):
    """Turn a pattern into a tree, following the grammar in the brief."""
    return _Parser(pattern).parse()


def walk(node, text, at):
    """Every position the text could be at after this node matches at `at`."""
    kind = node[0]
    if kind == "lit":
        if at < len(text) and text[at] == node[1]:
            yield at + 1
    elif kind == "any":
        if at < len(text):
            yield at + 1
    elif kind == "cat":
        yield from _sequence(node[1], text, at)
    elif kind == "star":
        for after in walk(node[1], text, at):
            if after > at:
                yield from walk(node, text, after)
        yield at
    elif kind == "plus":
        for after in walk(node[1], text, at):
            if after > at:
                yield from walk(("star", node[1]), text, after)
            else:
                yield after
    elif kind == "opt":
        yield from walk(node[1], text, at)
        yield at


def _sequence(items, text, at):
    if not items:
        yield at
        return
    for after in walk(items[0], text, at):
        yield from _sequence(items[1:], text, after)


def fullmatch(pattern, text):
    """Whether the whole text matches the whole pattern."""
    return any(end == len(text) for end in walk(parse(pattern), text, 0))
~~~

~~~tests
# everything from before still holds
assert fullmatch("a", "a") and not fullmatch("a", "b")
assert fullmatch(".*a", "bbba")
assert fullmatch("a*a*a*b", "aaab")
assert not fullmatch("a*", "aab")

# alternation
assert fullmatch("a|b", "a")
assert fullmatch("a|b", "b")
assert not fullmatch("a|b", "c")
assert fullmatch("cat|dog", "dog")
assert not fullmatch("cat|dog", "cog")

# groups
assert fullmatch("(ab)+", "ababab")
assert not fullmatch("(ab)+", "aba")
assert fullmatch("(a|b)*", "abba")
assert fullmatch("(a|b)*c", "abbac")
assert not fullmatch("(a|b)*c", "abbad")
assert fullmatch("a(b|c)d", "acd")

# classes, ranges and negation
assert fullmatch("[abc]", "b")
assert not fullmatch("[abc]", "d")
assert fullmatch("[a-c]+", "abcba")
assert not fullmatch("[a-c]+", "abd")
assert fullmatch("[^a]", "z")
assert not fullmatch("[^a]", "a")
assert fullmatch("[a-c0-9]*", "a1b2c3")

# escapes, in a pattern and in a class
assert fullmatch(r"a\.b", "a.b")
assert not fullmatch(r"a\.b", "axb")
assert fullmatch(r"\*", "*")
assert fullmatch(r"[\]]", "]")
assert fullmatch(r"\(a\)", "(a)")

# a bracket or paren that never closes is a broken pattern
for bad in ("(a", "[a", "a)"):
    try:
        parse(bad)
    except ValueError:
        pass
    else:
        raise AssertionError(f"parse({bad!r}) should refuse an unbalanced pattern")

# something that looks like a real pattern
assert fullmatch(r"[a-z]+@[a-z]+\.(com|org)", "ada@example.com")
assert not fullmatch(r"[a-z]+@[a-z]+\.(com|org)", "ada@example.net")
~~~

~~~solution
QUANTIFIERS = {"*": "star", "+": "plus", "?": "opt"}


class _Parser:
    """Recursive descent, one method per rule of the grammar."""

    def __init__(self, pattern):
        self.pattern = pattern
        self.at = 0

    def peek(self):
        return self.pattern[self.at] if self.at < len(self.pattern) else ""

    def take(self):
        char = self.pattern[self.at]
        self.at += 1
        return char

    def parse(self):
        node = self.alt()
        if self.at != len(self.pattern):
            raise ValueError(f"unexpected {self.peek()!r} at {self.at}")
        return node

    def alt(self):
        branches = [self.cat()]
        while self.peek() == "|":
            self.take()
            branches.append(self.cat())
        return branches[0] if len(branches) == 1 else ("alt", tuple(branches))

    def cat(self):
        items = []
        while self.peek() and self.peek() not in "|)":
            items.append(self.repeat())
        return ("cat", tuple(items))

    def repeat(self):
        node = self.atom()
        while self.peek() in QUANTIFIERS and self.peek():
            node = (QUANTIFIERS[self.take()], node)
        return node

    def atom(self):
        char = self.peek()
        if not char:
            raise ValueError("pattern ended where an atom was expected")
        if char in QUANTIFIERS:
            raise ValueError(f"{char!r} has nothing to repeat")
        if char == "(":
            self.take()
            node = self.alt()
            if self.peek() != ")":
                raise ValueError("unbalanced (")
            self.take()
            return node
        if char == ")":
            raise ValueError("unbalanced )")
        if char == "[":
            return self.char_class()
        if char == ".":
            self.take()
            return ("any",)
        if char == "\\":
            self.take()
            if not self.peek():
                raise ValueError("pattern ends with a backslash")
            return ("lit", self.take())
        return ("lit", self.take())

    def char_class(self):
        self.take()                                  # the [
        negated = self.peek() == "^"
        if negated:
            self.take()
        members = set()
        while self.peek() and self.peek() != "]":
            char = self.take()
            if char == "\\":
                if not self.peek():
                    raise ValueError("pattern ends with a backslash")
                char = self.take()
            if self.peek() == "-" and self.at + 1 < len(self.pattern) \
                    and self.pattern[self.at + 1] != "]":
                self.take()
                members.update(chr(c) for c in range(ord(char), ord(self.take()) + 1))
            else:
                members.add(char)
        if self.peek() != "]":
            raise ValueError("unbalanced [")
        self.take()
        return ("cls", frozenset(members), negated)


def parse(pattern):
    """Turn a pattern into a tree, following the grammar in the brief."""
    return _Parser(pattern).parse()


def walk(node, text, at):
    """Every position the text could be at after this node matches at `at`."""
    kind = node[0]
    if kind == "lit":
        if at < len(text) and text[at] == node[1]:
            yield at + 1
    elif kind == "any":
        if at < len(text):
            yield at + 1
    elif kind == "cls":
        if at < len(text) and ((text[at] in node[1]) is not node[2]):
            yield at + 1
    elif kind == "cat":
        yield from _sequence(node[1], text, at)
    elif kind == "alt":
        for branch in node[1]:
            yield from walk(branch, text, at)
    elif kind == "star":
        for after in walk(node[1], text, at):
            if after > at:
                yield from walk(node, text, after)
        yield at
    elif kind == "plus":
        for after in walk(node[1], text, at):
            if after > at:
                yield from walk(("star", node[1]), text, after)
            else:
                yield after
    elif kind == "opt":
        yield from walk(node[1], text, at)
        yield at


def _sequence(items, text, at):
    if not items:
        yield at
        return
    for after in walk(items[0], text, at):
        yield from _sequence(items[1:], text, after)


def fullmatch(pattern, text):
    """Whether the whole text matches the whole pattern."""
    return any(end == len(text) for end in walk(parse(pattern), text, 0))
~~~

## The pattern that eats your afternoon

The last stage is the one that makes this worth having built. A backtracking
matcher can take exponential time, and the pattern that does it looks harmless:
`(a+)+b` against a string of `a`s with no `b`. The outer plus can split the
`a`s among its repetitions in exponentially many ways, and the engine tries all
of them before concluding there is no `b`.

This is not a flaw in your code. It is a property of backtracking, it is why
`re` has the same behaviour, and it is the mechanism behind every regular
expression denial of service. The alternative is a different algorithm, a
Thompson construction that walks all branches at once in linear time, which is
what `re2` and Go's regexp do and which is the price they pay for having no
backreferences.

Count the steps rather than timing them, for unit 35's reason: a step count is
the same on every machine. Then add a budget, so a matcher that would run
forever raises instead.

@goal `match_steps` counts the work, and a budget turns a runaway match into an error.

~~~starter
QUANTIFIERS = {"*": "star", "+": "plus", "?": "opt"}


class Budget:
    """A step allowance for one match."""

    def __init__(self, limit=None):
        self.limit = limit
        self.steps = 0

    def step(self):
        """Count one unit of matching work."""
        raise NotImplementedError


class TooMuchBacktracking(Exception):
    """The match used more steps than it was allowed."""


class _Parser:
    """Recursive descent, one method per rule of the grammar."""

    def __init__(self, pattern):
        self.pattern = pattern
        self.at = 0

    def peek(self):
        return self.pattern[self.at] if self.at < len(self.pattern) else ""

    def take(self):
        char = self.pattern[self.at]
        self.at += 1
        return char

    def parse(self):
        node = self.alt()
        if self.at != len(self.pattern):
            raise ValueError(f"unexpected {self.peek()!r} at {self.at}")
        return node

    def alt(self):
        branches = [self.cat()]
        while self.peek() == "|":
            self.take()
            branches.append(self.cat())
        return branches[0] if len(branches) == 1 else ("alt", tuple(branches))

    def cat(self):
        items = []
        while self.peek() and self.peek() not in "|)":
            items.append(self.repeat())
        return ("cat", tuple(items))

    def repeat(self):
        node = self.atom()
        while self.peek() in QUANTIFIERS and self.peek():
            node = (QUANTIFIERS[self.take()], node)
        return node

    def atom(self):
        char = self.peek()
        if not char:
            raise ValueError("pattern ended where an atom was expected")
        if char in QUANTIFIERS:
            raise ValueError(f"{char!r} has nothing to repeat")
        if char == "(":
            self.take()
            node = self.alt()
            if self.peek() != ")":
                raise ValueError("unbalanced (")
            self.take()
            return node
        if char == ")":
            raise ValueError("unbalanced )")
        if char == "[":
            return self.char_class()
        if char == ".":
            self.take()
            return ("any",)
        if char == "\\":
            self.take()
            if not self.peek():
                raise ValueError("pattern ends with a backslash")
            return ("lit", self.take())
        return ("lit", self.take())

    def char_class(self):
        self.take()
        negated = self.peek() == "^"
        if negated:
            self.take()
        members = set()
        while self.peek() and self.peek() != "]":
            char = self.take()
            if char == "\\":
                if not self.peek():
                    raise ValueError("pattern ends with a backslash")
                char = self.take()
            if self.peek() == "-" and self.at + 1 < len(self.pattern) \
                    and self.pattern[self.at + 1] != "]":
                self.take()
                members.update(chr(c) for c in range(ord(char), ord(self.take()) + 1))
            else:
                members.add(char)
        if self.peek() != "]":
            raise ValueError("unbalanced [")
        self.take()
        return ("cls", frozenset(members), negated)


def parse(pattern):
    """Turn a pattern into a tree."""
    return _Parser(pattern).parse()


def walk(node, text, at, budget=None):
    """Every position the text could be at after this node matches at `at`."""
    if budget is not None:
        budget.step()
    kind = node[0]
    if kind == "lit":
        if at < len(text) and text[at] == node[1]:
            yield at + 1
    elif kind == "any":
        if at < len(text):
            yield at + 1
    elif kind == "cls":
        if at < len(text) and ((text[at] in node[1]) is not node[2]):
            yield at + 1
    elif kind == "cat":
        yield from _sequence(node[1], text, at, budget)
    elif kind == "alt":
        for branch in node[1]:
            yield from walk(branch, text, at, budget)
    elif kind == "star":
        for after in walk(node[1], text, at, budget):
            if after > at:
                yield from walk(node, text, after, budget)
        yield at
    elif kind == "plus":
        for after in walk(node[1], text, at, budget):
            if after > at:
                yield from walk(("star", node[1]), text, after, budget)
            else:
                yield after
    elif kind == "opt":
        yield from walk(node[1], text, at, budget)
        yield at


def _sequence(items, text, at, budget=None):
    if not items:
        yield at
        return
    for after in walk(items[0], text, at, budget):
        yield from _sequence(items[1:], text, after, budget)


def match_steps(pattern, text, limit=None):
    """Whether it matches, and how many steps that took."""
    raise NotImplementedError


def fullmatch(pattern, text, limit=None):
    """Whether the whole text matches the whole pattern."""
    if limit is None:
        return any(end == len(text) for end in walk(parse(pattern), text, 0))
    return match_steps(pattern, text, limit)[0]
~~~

~~~tests
# everything from before still holds
assert fullmatch("a", "a") and not fullmatch("a", "b")
assert fullmatch("(a|b)*c", "abbac")
assert fullmatch(r"[a-z]+@[a-z]+\.(com|org)", "ada@example.com")
assert not fullmatch(r"[a-z]+@[a-z]+\.(com|org)", "ada@example.net")
assert fullmatch("[^a]", "z") and not fullmatch("[^a]", "a")

# a match that works costs work proportional to the text
matched, steps = match_steps("a*b", "aaaaab")
assert matched and steps > 0

linear = [match_steps("a*b", "a" * n + "b")[1] for n in (5, 10, 20)]
assert linear[2] < linear[0] * 20, f"a plain match should not explode: {linear}"

# and now the one that does explode
counts = [match_steps("(a+)+b", "a" * n)[1] for n in (8, 12, 16)]
assert counts[0] < counts[1] < counts[2]
assert counts[2] > counts[0] * 20, (
    f"the classic blowup should grow far faster than the input: {counts}"
)

# the budget turns a runaway match into an error rather than a hung tab
try:
    match_steps("(a+)+b", "a" * 24, limit=5000)
except TooMuchBacktracking as exc:
    assert "5000" in str(exc) or "budget" in str(exc).lower()
else:
    raise AssertionError("a match past its budget should raise")

# a budget large enough is not in the way
matched, steps = match_steps("(a+)+b", "aaaab", limit=100_000)
assert matched
assert steps < 100_000

# no budget means no limit, which is the default
assert fullmatch("(a|b)*", "abab")
~~~

~~~solution
QUANTIFIERS = {"*": "star", "+": "plus", "?": "opt"}


class TooMuchBacktracking(Exception):
    """The match used more steps than it was allowed."""


class Budget:
    """A step allowance for one match."""

    def __init__(self, limit=None):
        self.limit = limit
        self.steps = 0

    def step(self):
        """Count one unit of matching work."""
        self.steps += 1
        if self.limit is not None and self.steps > self.limit:
            raise TooMuchBacktracking(
                f"gave up after {self.limit} steps: this pattern backtracks "
                f"exponentially on this input"
            )


class _Parser:
    """Recursive descent, one method per rule of the grammar."""

    def __init__(self, pattern):
        self.pattern = pattern
        self.at = 0

    def peek(self):
        return self.pattern[self.at] if self.at < len(self.pattern) else ""

    def take(self):
        char = self.pattern[self.at]
        self.at += 1
        return char

    def parse(self):
        node = self.alt()
        if self.at != len(self.pattern):
            raise ValueError(f"unexpected {self.peek()!r} at {self.at}")
        return node

    def alt(self):
        branches = [self.cat()]
        while self.peek() == "|":
            self.take()
            branches.append(self.cat())
        return branches[0] if len(branches) == 1 else ("alt", tuple(branches))

    def cat(self):
        items = []
        while self.peek() and self.peek() not in "|)":
            items.append(self.repeat())
        return ("cat", tuple(items))

    def repeat(self):
        node = self.atom()
        while self.peek() in QUANTIFIERS and self.peek():
            node = (QUANTIFIERS[self.take()], node)
        return node

    def atom(self):
        char = self.peek()
        if not char:
            raise ValueError("pattern ended where an atom was expected")
        if char in QUANTIFIERS:
            raise ValueError(f"{char!r} has nothing to repeat")
        if char == "(":
            self.take()
            node = self.alt()
            if self.peek() != ")":
                raise ValueError("unbalanced (")
            self.take()
            return node
        if char == ")":
            raise ValueError("unbalanced )")
        if char == "[":
            return self.char_class()
        if char == ".":
            self.take()
            return ("any",)
        if char == "\\":
            self.take()
            if not self.peek():
                raise ValueError("pattern ends with a backslash")
            return ("lit", self.take())
        return ("lit", self.take())

    def char_class(self):
        self.take()
        negated = self.peek() == "^"
        if negated:
            self.take()
        members = set()
        while self.peek() and self.peek() != "]":
            char = self.take()
            if char == "\\":
                if not self.peek():
                    raise ValueError("pattern ends with a backslash")
                char = self.take()
            if self.peek() == "-" and self.at + 1 < len(self.pattern) \
                    and self.pattern[self.at + 1] != "]":
                self.take()
                members.update(chr(c) for c in range(ord(char), ord(self.take()) + 1))
            else:
                members.add(char)
        if self.peek() != "]":
            raise ValueError("unbalanced [")
        self.take()
        return ("cls", frozenset(members), negated)


def parse(pattern):
    """Turn a pattern into a tree."""
    return _Parser(pattern).parse()


def walk(node, text, at, budget):
    """Every position the text could be at after this node matches at `at`.

    One step per node visited. That count is the whole point of this stage: it
    is the same number on every machine, where a duration is not.
    """
    budget.step()
    kind = node[0]
    if kind == "lit":
        if at < len(text) and text[at] == node[1]:
            yield at + 1
    elif kind == "any":
        if at < len(text):
            yield at + 1
    elif kind == "cls":
        if at < len(text) and ((text[at] in node[1]) is not node[2]):
            yield at + 1
    elif kind == "cat":
        yield from _sequence(node[1], text, at, budget)
    elif kind == "alt":
        for branch in node[1]:
            yield from walk(branch, text, at, budget)
    elif kind == "star":
        for after in walk(node[1], text, at, budget):
            if after > at:
                yield from walk(node, text, after, budget)
        yield at
    elif kind == "plus":
        for after in walk(node[1], text, at, budget):
            if after > at:
                yield from walk(("star", node[1]), text, after, budget)
            else:
                yield after
    elif kind == "opt":
        yield from walk(node[1], text, at, budget)
        yield at


def _sequence(items, text, at, budget):
    if not items:
        yield at
        return
    for after in walk(items[0], text, at, budget):
        yield from _sequence(items[1:], text, after, budget)


def match_steps(pattern, text, limit=None):
    """Whether it matches, and how many steps that took."""
    budget = Budget(limit)
    matched = any(end == len(text) for end in walk(parse(pattern), text, 0, budget))
    return matched, budget.steps


def fullmatch(pattern, text, limit=None):
    """Whether the whole text matches the whole pattern."""
    return match_steps(pattern, text, limit)[0]
~~~
