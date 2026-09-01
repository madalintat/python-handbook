---
slug: 37-ecosystem
---

## Paths joined with a slash

`report_path` builds a path by concatenating strings. Joining with a literal separator gets the separator wrong, doubles it, or loses it.

@expect silent
@hint The standard library has a type for paths, and it overloads an operator for joining.
@hint `Path(a) / b` handles the separator, whatever the platform.
@diagnose silent It runs and produces a path with a doubled separator, because one of the pieces already ended with one. Concatenating path components is a small function with a surprising number of cases: a trailing separator, an absolute component that should discard everything before it, and a platform whose separator is different. `pathlib.Path` handles all of them, and `Path("data") / "rows.csv"` reads better than the alternatives besides. The methods come with it, `.exists()`, `.read_text()`, `.glob("*.py")`, `.parent`, `.suffix`, which is the real argument: the operations you want are on the object rather than scattered across `os.path`.

~~~starter
def report_path(directory, name):
    """The path to a report inside a directory."""
    return directory + "/" + name + ".csv"
~~~

~~~tests
from pathlib import Path

assert report_path("data", "june") == str(Path("data") / "june.csv")
assert report_path("data/", "june") == str(Path("data") / "june.csv"), (
    f"a trailing separator gave {report_path('data/', 'june')!r}"
)
assert report_path("data/2026", "june") == str(Path("data/2026") / "june.csv")
~~~

~~~solution
from pathlib import Path


def report_path(directory, name):
    """The path to a report inside a directory."""
    return str(Path(directory) / f"{name}.csv")
~~~

## A command assembled as a string

`run` passes its command to a shell as one string, so anything in the argument that the shell finds interesting is interpreted.

@expect silent
@hint What does the shell do with a semicolon, or a space, in a filename?
@hint Pass a list, and no shell is involved at all.
@diagnose silent It runs, and a filename containing a space was split into two arguments by the shell, so the command received something the caller never wrote. That is the harmless version. The same mechanism with `; rm -rf ~` in place of the space is command injection, and it is the single most common serious vulnerability in code that shells out. Passing a **list** avoids the shell entirely: the arguments go to the process exactly as given, and no quoting is possible because no parsing happens. The incantation worth memorising is `subprocess.run([...], capture_output=True, text=True, check=True)`, where `check=True` makes a non-zero exit raise rather than being ignored, which is the other half of this mistake.

~~~starter
def build_command(script, filename):
    """The command to run a script against a file."""
    return f"python {script} {filename}"


def arguments_received(command):
    """What the process actually gets, once the shell has had it."""
    if isinstance(command, str):
        return command.split()
    return list(command)
~~~

~~~tests
assert arguments_received(build_command("report.py", "june.csv")) == [
    "python",
    "report.py",
    "june.csv",
]

got = arguments_received(build_command("report.py", "my report.csv"))
assert got == ["python", "report.py", "my report.csv"], (
    f"the process received {got}"
)
~~~

~~~solution
def build_command(script, filename):
    """The command to run a script against a file."""
    return ["python", script, filename]


def arguments_received(command):
    """What the process actually gets, once the shell has had it."""
    if isinstance(command, str):
        return command.split()
    return list(command)
~~~

## A timestamp that means different things in different places

`stamp` records the current time with `datetime.now()`, which produces a naive object carrying no timezone at all.

@expect silent
@hint A naive datetime has no timezone. What can you not then do with it?
@hint Store and compute in UTC; convert at the edges.
@diagnose silent Nothing raised, and the timestamp came back with no timezone on it. A naive datetime does not say what instant it means, so two recorded on two machines are two different moments that look identical, and Python will refuse outright to compare one with an aware datetime, because no answer would be correct. `datetime.now()` gives you a naive one, and it is the source of most date bugs in most codebases, because two of them recorded on two machines are two different instants that look identical. `datetime.now(UTC)` gives an aware one. The rule that prevents nearly all of this: store and compute in UTC with aware objects, and convert to a local timezone only when displaying, using `zoneinfo` for the conversion.

~~~starter
from datetime import datetime


def stamp():
    """The moment this was called."""
    return datetime.now()
~~~

~~~tests
from datetime import UTC, datetime, timedelta

now = stamp()
assert now.tzinfo is not None, "the timestamp carries no timezone"
assert abs(now - datetime.now(UTC)) < timedelta(seconds=5)
~~~

~~~solution
from datetime import UTC, datetime


def stamp():
    """The moment this was called."""
    return datetime.now(UTC)
~~~

## Money in binary floating point

`total` adds prices held as floats. Binary floating point cannot represent most decimal fractions, so the sum is close to right and not right.

@expect silent
@hint Unit 05 said why `0.1 + 0.2` is not `0.3`. Where does that matter most?
@hint There is a type in the standard library for decimal arithmetic.
@diagnose silent It runs and the total is out by a fraction of a penny, because `0.1` has no exact binary representation and neither do most prices. Unit 05 covered the mechanism; money is the case where it is unacceptable, because nobody accepts an invoice being wrong by a hundredth. `decimal.Decimal` does base-ten arithmetic exactly, and takes a **string** rather than a float, since `Decimal(0.1)` faithfully preserves the error that was already there. The other approach, used widely, is to hold money as an integer number of the smallest unit and never divide, which is why unit 22's exercises kept talking about pence.

~~~starter
def total(prices):
    """Add up prices given as decimal strings, returning a string."""
    return str(sum(float(price) for price in prices))
~~~

~~~tests
assert total(["0.10", "0.20"]) == "0.30", f"got {total(['0.10', '0.20'])}"
assert total(["19.99", "0.01"]) == "20.00"
assert total([]) == "0"
~~~

~~~solution
from decimal import Decimal


def total(prices):
    """Add up prices given as decimal strings, returning a string."""
    return str(sum((Decimal(price) for price in prices), Decimal(0)))
~~~

## A token from the wrong generator

`make_token` builds a session token with `random`. That module is fast, reproducible and predictable, which are the three properties a token must not have.

@expect silent
@hint `random` can be seeded, and a seeded sequence repeats exactly.
@hint There is a module whose entire purpose is this.
@diagnose silent It runs and produces a token that can be predicted, because `random` is a Mersenne Twister: seed it the same way and you get the same sequence, and an observer with a few outputs can recover the state and produce the rest. That is exactly what makes it good for simulations and unusable for anything security-related. `secrets` draws from the operating system's cryptographic source: `secrets.token_urlsafe(n)` for a token, `secrets.choice` for a selection, `secrets.compare_digest` for comparing a secret without leaking its length through timing. The rule is simple enough to apply without thinking: `random` for anything you would be happy to see published, `secrets` for everything else.

~~~starter
import random
import string

ALPHABET = string.ascii_letters + string.digits


def make_token(length=16):
    """A session token."""
    return "".join(random.choice(ALPHABET) for _ in range(length))
~~~

~~~tests
import random

random.seed(1)
first = make_token()
random.seed(1)
second = make_token()

assert first != second, "seeding the generator reproduced the token exactly"
assert len(first) >= 16
assert make_token() != make_token()
~~~

~~~solution
import secrets
import string

ALPHABET = string.ascii_letters + string.digits


def make_token(length=16):
    """A session token."""
    return "".join(secrets.choice(ALPHABET) for _ in range(length))
~~~

## Structure parsed with a pattern

`extract_links` pulls hyperlinks out of markup with a regular expression. Anything with nesting or quoting defeats a pattern, and markup has both.

@expect silent
@hint The pattern stops at the first closing quote it sees. What if the attribute is not the first one?
@hint The rule is about what you are parsing, not about the pattern.
@diagnose silent It runs and returns the wrong thing, because the pattern matched something that looked like the shape it wanted in the wrong place. This is the general rule, and it is worth taking literally: a regular expression cannot parse a nested structure, because it has no memory of how deep it is, and markup, source code and JSON are all nested. Every attempt produces a pattern that works on the examples in front of you and fails on the input somebody else supplies. Use a parser: `html.parser` in the standard library, or `beautifulsoup4`, or `lxml`. Regular expressions are excellent at what they are for, which is flat, line-oriented text with a shape you can write down.

~~~starter
import re

LINK = re.compile(r'href="([^"]*)"')


def extract_links(markup):
    """Every href in this markup."""
    return LINK.findall(markup)
~~~

~~~tests
simple = '<a href="/one">one</a> <a href="/two">two</a>'
assert extract_links(simple) == ["/one", "/two"]

tricky = """<a title='href="/fake"' href="/real">link</a>"""
assert extract_links(tricky) == ["/real"], f"got {extract_links(tricky)}"
~~~

~~~solution
from html.parser import HTMLParser


class LinkFinder(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            for name, value in attrs:
                if name == "href" and value is not None:
                    self.links.append(value)


def extract_links(markup):
    """Every href in this markup."""
    finder = LinkFinder()
    finder.feed(markup)
    return finder.links
~~~

## A URL built by adding strings

`search_url` glues a query onto a URL. A value containing an ampersand or a space becomes part of the URL's structure rather than part of the value.

@expect silent
@hint What does an `&` mean inside a query string?
@hint `urllib.parse` has a function that builds the query for you.
@diagnose silent It runs, and a search for a term containing an ampersand produced a URL with two parameters in it, because the value was pasted in without escaping and `&` is the separator. The same applies to `=`, `#`, `+`, `?` and spaces. `urllib.parse.urlencode({...})` escapes each key and value correctly and joins them, and `quote` does one value at a time. This is a small instance of a general principle worth carrying: whenever you build a structured string by concatenation, whether a URL, a shell command, a SQL query or HTML, you are hoping the values contain nothing meaningful, and the library that builds it properly exists because that hope keeps being wrong.

~~~starter
def search_url(base, term, page):
    """A search URL for this term."""
    return f"{base}?q={term}&page={page}"
~~~

~~~tests
from urllib.parse import parse_qs, urlsplit

url = search_url("https://example.com/s", "salt & pepper", 2)
query = parse_qs(urlsplit(url).query)
assert query["q"] == ["salt & pepper"], f"the term arrived as {query.get('q')}"
assert query["page"] == ["2"]
assert len(query) == 2
~~~

~~~solution
from urllib.parse import urlencode


def search_url(base, term, page):
    """A search URL for this term."""
    return f"{base}?{urlencode({'q': term, 'page': page})}"
~~~

## Written by hand where the library already had it

`most_common` counts occurrences and sorts them. `collections.Counter` does both, and its version handles the tie-breaking and the ordering.

@expect silent
@hint Unit 12 introduced the type that counts things.
@hint It also has a method with exactly this name.
@diagnose silent It runs and gets the ties in the wrong order, because sorting on the count alone leaves equal counts in whatever order the dictionary produced them, which is insertion order and not what was wanted. `collections.Counter` counts in one line, and `.most_common(n)` returns the pairs ordered by count, using a heap so it does not sort everything to give you three. The point of the exercise is not this function: it is that a hand-written version of something in the standard library is usually correct on the examples the author thought of and subtly wrong on the ones they did not, which is the expensive mistake this unit exists to prevent.

~~~starter
def most_common(words, n):
    """The n commonest words, commonest first, ties broken alphabetically."""
    counts = {}
    for word in words:
        counts[word] = counts.get(word, 0) + 1
    ordered = sorted(counts.items(), key=lambda pair: -pair[1])
    return ordered[:n]
~~~

~~~tests
words = ["b", "a", "c", "a", "b", "d"]
assert most_common(words, 2) == [("a", 2), ("b", 2)]
assert most_common(words, 4) == [("a", 2), ("b", 2), ("c", 1), ("d", 1)], (
    f"got {most_common(words, 4)}"
)
assert most_common([], 3) == []
~~~

~~~solution
from collections import Counter


def most_common(words, n):
    """The n commonest words, commonest first, ties broken alphabetically."""
    counts = Counter(words)
    ordered = sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
    return ordered[:n]
~~~
