#!/usr/bin/env python3
"""content/ -> data/.  No dependencies, no network (except --validate).

    python3 build.py                 build everything into data/
    python3 build.py --check FILE    validate one content file, print "N clean"
    python3 build.py --validate      run every starter and solution past all three judges
"""
from __future__ import annotations

import argparse
import ast
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).parent
CONTENT = ROOT / "content"
DATA = ROOT / "data"
CACHE = ROOT / ".cache"

# ---------------------------------------------------------------- the manifest

ACCENTS = ["gold", "denim", "ember", "moss", "teal", "plum", "clay"]

PHASES = [
    ("The machine", "Get to the object model before you write a loop."),
    ("Control and structure", "The shapes a program is built out of."),
    ("Data", "The four containers you will use for the rest of your life."),
    ("Iteration", "Python's crown jewel, three units deep."),
    ("Objects", "What a class actually is, all the way down to the descriptor."),
    ("Types", "Optional, gradual, and not enforced at runtime. All three matter."),
    ("Code as data", "Programs that read and rewrite programs."),
    ("Programs, not scripts", "The layer where a folder of files becomes software."),
    ("Concurrency and performance", "Doing more at once, and doing it faster."),
    ("The wider world", "The ecosystem, and the one skill that outlives this book."),
]

# (slug, phase, title, blurb)
TRACK = [
    ("00-toolchain", 0, "The toolchain",
     "What `python app.py` actually does between you pressing enter and the program starting: bytecode, `__pycache__`, and why Python has no compile step but definitely has a compiler."),
    ("01-names", 0, "Names and objects",
     "Python has no variables. `a = b` binds a second name to one object, and almost every surprising bug in this book begins by forgetting that."),
    ("02-mutability", 0, "Mutability and aliasing",
     "The list that changed when you were not looking. Aliasing, shallow copies, and the default argument that is created once and kept for the life of the process."),
    ("03-data-model", 0, "The data model",
     "Everything is an object and every operator is a method call. Duck typing stated precisely enough that you can predict what will break."),
    ("04-equality", 0, "Equality, hashing, truthiness",
     "The `__eq__` and `__hash__` contract, why a mutable dict key is a bug lying in wait, and what `if x:` actually calls."),
    ("05-expressions", 1, "Expressions and statements",
     "What counts as an expression, what the walrus is for, and the evaluation order you have been assuming without ever checking."),
    ("06-control-flow", 1, "Control flow",
     "`for`/`else`, the loop that finished versus the loop that broke, and `match` — the newest control structure in the language and the least used."),
    ("07-functions", 1, "Functions",
     "Positional-only, keyword-only, `*args`, `**kwargs`, and the single most important fact about defaults: when they are evaluated."),
    ("08-scope", 1, "Scope and closures",
     "LEGB, the closure that captured a variable rather than a value, and why every function you made in that loop returned the same answer."),
    ("09-exceptions", 1, "Exceptions",
     "A recoverable error is something you catch; a bug is a traceback. `raise ... from`, EAFP over LBYL, and the exception groups 3.11 added."),
    ("10-sequences", 2, "Sequences and slicing",
     "A slice is an object. Negative steps, slice assignment, and why `a[:]` copies but `a[:] = b` does not."),
    ("11-strings", 2, "Strings, bytes and encoding",
     "`str` is not `bytes`, and the difference will find you at a file boundary. Encodings, the format spec mini-language, and `!r`."),
    ("12-dicts", 2, "Dicts and sets",
     "Hashing, the insertion order that became a language guarantee in 3.7, views, and the shape `setdefault` and `defaultdict` exist to fill."),
    ("13-comprehensions", 2, "Comprehensions and collections",
     "A comprehension is a compiled construct with its own scope, not sugar for a loop. Plus the five `collections` types actually worth knowing."),
    ("14-sorting", 2, "Sorting and ordering",
     "Key functions, why stability matters more than you expect, and the two stdlib modules that replace half the sorting code you would write."),
    ("15-iterators", 3, "The iterator protocol",
     "`__iter__` and `__next__`, exhaustion, and the reason `for` works on things that are not sequences at all."),
    ("16-generators", 3, "Generators",
     "`yield` turns a function into a resumable object. Lazy pipelines, `send`, `throw`, and `yield from`."),
    ("17-itertools", 3, "itertools and functools",
     "Seventy building blocks that compose, `cache` and `singledispatch`, and an honest verdict on `map`, `filter` and `reduce`."),
    ("18-classes", 4, "Classes",
     "`__new__` versus `__init__`, what a method actually is, and the class attribute that everyone mutates by accident exactly once."),
    ("19-attributes", 4, "Attribute access",
     "`__dict__`, `__getattr__` versus `__getattribute__`, `__slots__`, and `property` as the first descriptor you ever meet."),
    ("20-descriptors", 4, "Descriptors",
     "The mechanism underneath `property`, methods, `classmethod` and `staticmethod`. One protocol explains all four, and this is the unit where the language clicks."),
    ("21-mro", 4, "Inheritance and the MRO",
     "C3 linearisation, what `super()` is really doing (not what you think), and the narrow case where multiple inheritance is the right call."),
    ("22-protocols", 4, "Dunder protocols",
     "Operator overloading, `__repr__` versus `__str__`, what `with` compiles to, and a container you can implement in four methods."),
    ("23-dataclasses", 4, "Modern data modelling",
     "`dataclass`, `NamedTuple` and `Enum`, and the precise point at which `attrs` and `pydantic` start earning their dependency."),
    ("24-typing", 5, "Type hints",
     "Annotations are runtime metadata, not enforcement. Generics, `TypeVar`, `Literal`, `TypedDict`, and `Protocol` — structural typing, finally."),
    ("25-typecheck", 5, "Type checking in practice",
     "mypy's strictness dials, the five errors you will actually hit, how to type a codebase that has none, and the point where types stop paying."),
    ("26-decorators", 6, "Decorators",
     "A decorator is a function that takes a function. `functools.wraps`, parameters, and why the ones in real libraries look nothing like the tutorial ones."),
    ("27-metaclasses", 6, "Metaclasses and __init_subclass__",
     "`type` is a callable that makes classes. When a metaclass is genuinely right (rarely) and why `__init_subclass__` usually beats reaching for one."),
    ("28-ast", 6, "Introspection and the AST",
     "`inspect`, `dis` and `ast`. Read your own bytecode, then write a transformer that rewrites source before it ever runs."),
    ("29-modules", 7, "Modules, packages, imports",
     "The import system in full: `sys.path`, packages, relative imports, and the circular import you can finally diagnose instead of shuffling."),
    ("30-packaging", 7, "Packaging and environments",
     "`pyproject.toml`, `uv`, and shipping a wheel. From a folder of scripts to something a stranger can install by name."),
    ("31-testing", 7, "Testing",
     "pytest for real: fixtures, `parametrize`, honest mocking, and property-based tests that find the input you would never have thought of."),
    ("32-tooling", 7, "Tooling and practice",
     "ruff, mypy and pre-commit as one pipeline, `logging` instead of `print`, and the handful of practices that survive contact with a team."),
    ("33-concurrency", 8, "Concurrency models",
     "The GIL, described accurately for once, including the free-threaded build. Threads, processes and async, and which one your problem actually needs."),
    ("34-async", 8, "async and await",
     "A coroutine does nothing until something awaits it. The event loop, `TaskGroup`, and why one blocking call stalls the entire program."),
    ("35-performance", 8, "Performance",
     "Profile first, always. `cProfile`, `timeit`, the algorithmic win versus the micro one, and where the C boundary changes every rule."),
    ("36-memory", 8, "Memory and the runtime",
     "Reference counting plus a cycle collector. Weak references, why `__del__` is a trap, and the reason `getsizeof` lies to you."),
    ("37-ecosystem", 9, "The ecosystem, mapped",
     "A map, not a tutorial: the stdlib modules you will really use and the dozen packages worth knowing, each with the case where it is the wrong answer."),
    ("38-tracebacks", 9, "Reading the traceback",
     "Every other unit teaches a topic. This one teaches reading the traceback, which is what makes the next error survivable — including errors this book never covers."),
]

# (slug, tier, domain, stages, minutes, title, blurb)
PROJECTS = [
    ("bloom-filter", "mini", "data", 4, 45, "A Bloom filter",
     "A set that answers \"definitely not\" or \"probably yes\" in constant space, built on a bit array and k hashes, with the false positive rate measured against the formula."),
    ("lru-cache", "mini", "systems", 4, 50, "An LRU cache",
     "A dict and a doubly linked list, O(1) on both ends, then raced against `functools.lru_cache` to find out what the standard library is doing differently."),
    ("retry-decorator", "mini", "tools", 4, 40, "A retry library",
     "Decorators with parameters, exponential backoff with jitter, and the exception-filtering predicate that turns a toy into something you would actually deploy."),
    ("regex-engine", "mini", "languages", 4, 60, "A regex engine",
     "Parse a pattern into a tree and walk it with a backtracking matcher, then find the pattern that makes your own engine take exponential time."),
    ("ngram", "core", "ai", 8, 90, "An n-gram language model",
     "Count the contexts, smooth the counts so unseen words do not get probability zero, sample from the distribution, and read the text it writes back at you."),
    ("micrograd", "core", "ai", 8, 120, "micrograd",
     "A `Value` that remembers how it was computed, a backward pass over the graph, an MLP built from it, and a loss curve that actually falls."),
    ("bpe-tokenizer", "core", "ai", 8, 90, "A BPE tokenizer",
     "The algorithm GPT and Llama really use: merge the commonest byte pair, over and over, until text is integers and the round trip is exact."),
    ("json-parser", "core", "languages", 8, 90, "A JSON parser",
     "A tokenizer and a recursive descent parser that reads a real document and, when it fails, names the exact character it failed on."),
    ("test-framework", "core", "tools", 8, 110, "A test framework",
     "Rebuild the useful third of pytest: collection, fixtures with teardown, and assertion rewriting through the `ast` module so a bare `assert` explains itself."),
    ("orm", "core", "web", 8, 110, "An ORM",
     "Descriptors for the fields, a metaclass for the table, and generated SQL. After this, Django and SQLAlchemy stop being magic and start being code."),
    ("async-crawler", "core", "web", 8, 100, "An async crawler",
     "`asyncio` under load: a worker pool, a rate limiter, `TaskGroup` for structured concurrency, and backpressure so the queue cannot eat your memory."),
    ("kv-store", "core", "systems", 8, 100, "A key-value store",
     "An append-only write-ahead log, an in-memory index, compaction, and a crash in the middle of a write that the store recovers from."),
    ("cli-to-pypi", "core", "tools", 8, 80, "A CLI, shipped",
     "From `__main__.py` to a wheel on an index: argument parsing, entry points, `pyproject.toml`, a test matrix, and a version someone else can install."),
    ("web-framework", "core", "web", 8, 110, "A web framework",
     "ASGI from the specification up: routing, middleware as a callable chain, request and response objects, and dependency injection in about forty lines."),
    ("build-a-gpt", "deep", "ai", 12, 240, "Build a GPT",
     "Tokenizer to embeddings to attention to a training loop to sampling. Consumes the BPE tokenizer and micrograd you already built, and ends with a model writing text."),
]

# The four verdict kinds. `silent` is the one Rust cannot have: every judge is
# happy and the code is still wrong.
VERDICTS = {"ruff", "mypy", "raises", "silent"}

# The one description of the three judges. build.py runs them from here and the
# browser fetches this as data/judges.json, so what --validate calls clean and
# what a reader is told is clean cannot drift apart.
JUDGES = {
    "ruff": {
        "version": "0.16.5",
        "cdn": "https://cdn.jsdelivr.net/npm/@astral-sh/ruff-wasm-web@0.16.5/",
        "select": ["E", "F", "B", "SIM", "UP"],
        # line length is a formatting opinion, not a teaching signal
        "ignore": ["E501"],
        "lineLength": 88,
        # without this, ruff assumes an older Python and reports 3.11+ builtins
        # such as ExceptionGroup as undefined names
        "targetVersion": "py314",
    },
    "mypy": {
        "flags": ["--no-color-output", "--no-error-summary", "--hide-error-context"],
        # micropip does not resolve mypy's transitive dependencies in Pyodide
        "install": ["mypy_extensions", "pathspec", "tomli", "mypy"],
        # typing-extensions ships inside the Pyodide distribution
        "preload": ["micropip", "typing-extensions"],
    },
    "cpython": {
        "version": "3.14",
        "cdn": "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/",
    },
}

# The four verdict kinds under the names the errors page groups them by, with the
# heading and blurb it renders. Kept here so the page cannot drift from the
# vocabulary the content is written in.
JUDGE_GROUP = {"ruff": "ruff", "mypy": "mypy", "raises": "runtime", "silent": "reading"}

# ---------------------------------------------------------------- parsing

FM = re.compile(r"\A---\n(.*?)\n---\n", re.S)
FENCE = re.compile(r"^~~~(\w+)\n(.*?)^~~~$", re.M | re.S)


def front_matter(text: str, path: Path) -> tuple[dict, str]:
    m = FM.match(text)
    if not m:
        die(path, "missing YAML front matter")
    meta: dict[str, object] = {}
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            die(path, f"front matter line is not key: value -> {line!r}")
        k, _, v = line.partition(":")
        v = v.strip()
        if v.startswith("[") and v.endswith("]"):
            meta[k.strip()] = [s.strip() for s in v[1:-1].split(",") if s.strip()]
        else:
            meta[k.strip()] = v
    return meta, text[m.end():]


def die(path: Path, msg: str) -> None:
    print(f"{path}: {msg}", file=sys.stderr)
    sys.exit(1)


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def word_count(s: str) -> int:
    # prose only: fenced code and inline code do not count toward the budget
    s = re.sub(r"^```.*?^```", "", s, flags=re.M | re.S)
    s = re.sub(r"^~~~.*?^~~~", "", s, flags=re.M | re.S)
    s = re.sub(r"`[^`]*`", "", s)
    return len(s.split())


# ---------------------------------------------------------------- units

NOTE_MIN, NOTE_MAX = 1400, 2600
EXERCISES_PER_UNIT = 8
DRILLS_PER_UNIT = 15


def parse_unit(path: Path) -> dict:
    meta, body = front_matter(path.read_text(), path)
    words = word_count(body)
    if not (NOTE_MIN <= words <= NOTE_MAX):
        die(path, f"note is {words} words, must be {NOTE_MIN}-{NOTE_MAX}")

    # The browser renders these notes with a small hand-written markdown
    # subset. Anything it cannot draw would be shown to the reader as raw
    # source, so the build refuses it rather than letting it through.
    prose = re.sub(r"^```.*?^```", "", body, flags=re.M | re.S)
    unsupported = {
        "ordered list": r"^\d+\. ",
        "blockquote": r"^> ",
        "image": r"!\[",
        "heading deeper than ####": r"^#{5,} ",
        "setext heading": r"^=+$",
        "html block": r"^<\w+",
        "footnote": r"^\[\^",
    }
    for label, pat in unsupported.items():
        if re.search(pat, prose, re.M):
            die(path, f"note uses {label}, which the renderer does not support")

    sections = []
    for m in re.finditer(r"^## (.+)$", body, re.M):
        sections.append({"title": m.group(1).strip(), "id": slugify(m.group(1))})
    if len(sections) < 3:
        die(path, f"note has {len(sections)} `## ` sections, needs at least 3")

    return {
        "slug": meta["slug"],
        "title": meta["title"],
        "body": body.strip(),
        "sections": sections,
        "words": words,
    }


# ---------------------------------------------------------------- exercises

DIRECTIVE = re.compile(r"^@(expect|hint|diagnose)[ \t]+(.+)$", re.M)


def parse_exercises(path: Path) -> list[dict]:
    meta, body = front_matter(path.read_text(), path)
    chunks = re.split(r"^## ", body, flags=re.M)[1:]
    if not chunks:
        die(path, "no exercises found (need `## ` headings)")

    out = []
    for i, chunk in enumerate(chunks, 1):
        title, _, rest = chunk.partition("\n")
        blocks = {m.group(1): m.group(2).rstrip() for m in FENCE.finditer(rest)}
        for need in ("starter", "tests", "solution"):
            if need not in blocks:
                die(path, f"exercise {i} ({title.strip()}) has no ~~~{need} block")

        expects, hints, diagnose = [], [], {}
        for kind, value in DIRECTIVE.findall(rest):
            if kind == "expect":
                if ":" in value:
                    judge, _, code = value.partition(":")
                else:
                    judge, code = value.strip(), ""
                judge = judge.strip()
                if judge not in VERDICTS:
                    die(path, f"exercise {i}: @expect {judge!r} not one of {sorted(VERDICTS)}")
                expects.append({"judge": judge, "code": code.strip()})
            elif kind == "hint":
                hints.append(value.strip())
            else:
                code, _, prose = value.partition(" ")
                if not prose.strip():
                    die(path, f"exercise {i}: @diagnose {code} has no prose")
                diagnose[code.strip()] = prose.strip()

        if not expects:
            die(path, f"exercise {i} ({title.strip()}) has no @expect")
        if not hints:
            die(path, f"exercise {i} ({title.strip()}) has no @hint")
        for e in expects:
            key = e["code"] or e["judge"]
            if key not in diagnose:
                die(path, f"exercise {i}: @expect {key} has no matching @diagnose")

        prompt = FENCE.sub("", DIRECTIVE.sub("", rest)).strip()
        if len(prompt.split()) < 15:
            die(path, f"exercise {i} ({title.strip()}) prompt is too short to be a prompt")

        out.append({
            "n": i,
            "title": title.strip(),
            "prompt": prompt,
            "expects": expects,
            "hints": hints,
            "diagnose": diagnose,
            "starter": blocks["starter"],
            "tests": blocks["tests"],
            "solution": blocks["solution"],
        })

    if len(out) != EXERCISES_PER_UNIT:
        die(path, f"{len(out)} exercises, must be exactly {EXERCISES_PER_UNIT}")
    return out


# ---------------------------------------------------------------- drills

OPTION = re.compile(r"^- \(([ x])\) (.+)$", re.M)


def parse_drills(path: Path) -> list[dict]:
    meta, body = front_matter(path.read_text(), path)
    chunks = re.split(r"^## ", body, flags=re.M)[1:]
    out = []
    for i, chunk in enumerate(chunks, 1):
        question, _, rest = chunk.partition("\n")
        options = OPTION.findall(rest)
        if len(options) < 3:
            die(path, f"drill {i} has {len(options)} options, needs at least 3")
        correct = [n for n, (mark, _) in enumerate(options) if mark == "x"]
        if len(correct) != 1:
            die(path, f"drill {i} has {len(correct)} correct answers, needs exactly 1")
        why = re.search(r"^> (.+)$", rest, re.M)
        if not why:
            die(path, f"drill {i} has no `> ` explanation")
        out.append({
            "n": i,
            "q": question.strip(),
            "options": [text for _, text in options],
            "answer": correct[0],
            "why": why.group(1).strip(),
        })
    if len(out) != DRILLS_PER_UNIT:
        die(path, f"{len(out)} drills, must be exactly {DRILLS_PER_UNIT}")
    return out


# ---------------------------------------------------------------- projects

def parse_gloss(path: Path) -> list[dict]:
    meta, body = front_matter(path.read_text(), path)
    out = []
    for chunk in re.split(r"^## ", body, flags=re.M)[1:]:
        term, _, rest = chunk.partition("\n")
        see = re.findall(r"\[\[([\w-]+)\]\]", rest)
        text = re.sub(r"\[\[([\w-]+)\]\]", r"\1", rest).strip()
        if len(text.split()) < 8:
            die(path, f"glossary entry {term.strip()!r} is too short to be a definition")
        out.append({"term": term.strip(), "text": text, "see": see})
    return out


def parse_project(path: Path) -> dict:
    meta, body = front_matter(path.read_text(), path)
    stages = []
    for i, chunk in enumerate(re.split(r"^## ", body, flags=re.M)[1:], 1):
        title, _, rest = chunk.partition("\n")
        stages.append({"n": i, "title": title.strip(), "body": rest.strip()})
    return {"slug": meta["slug"], "stages": stages}



# ---------------------------------------------------------------- the vocabulary gate
#
# An exercise must be solvable with what the reader has already met. Relying on
# the author to remember the ordering does not survive contact with 39 units, so
# each unit declares what it introduces and the build refuses any exercise whose
# code uses something from further down the track.

# Assumed from the first page and therefore never gated: statements, calls,
# attribute access, f-strings, annotations and the four container literals. They
# are not listed, because a list of names no detector emits would imply a gate
# that does not exist. Only what appears below is enforced.

# slug -> what that unit's note teaches, and therefore what its exercises and
# every later unit's exercises may use. This lists only features the detector
# below can actually see: a name here that nothing detects gates nothing, which
# is worse than not listing it, so the build refuses one.
INTRODUCES = {
    "00-toolchain": {"assert", "compile", "eval", "math", "raise", "round"},
    "01-names": {"class", "del", "id"},
    "02-mutability": {"comprehension", "copy_module", "deepcopy", "slice", "sorted"},
    "03-data-model": {"callable", "getattr", "hash", "iter", "repr", "setattr", "sum"},
    "04-equality": {"all", "any", "frozenset", "set"},
    "05-expressions": {"conditional_expr", "next", "starargs", "walrus"},
    "06-control-flow": {"enumerate", "match", "zip"},
    "07-functions": {"lambda"},
    "08-scope": {"global", "nonlocal"},
    "09-exceptions": {"try"},
    "10-sequences": set(),
    "11-strings": set(),
    "12-dicts": {"counter", "defaultdict", "dict_comprehension", "setdefault"},
    "13-comprehensions": {"deque"},
    "14-sorting": {"bisect", "heapq"},
    "15-iterators": set(),
    "16-generators": {"yield"},
    "17-itertools": {"cache", "filter", "functools", "itertools", "map", "partial", "reduce"},
    "18-classes": {"classmethod", "staticmethod"},
    "19-attributes": {"property"},
    "20-descriptors": set(),
    "21-mro": {"super"},
    "22-protocols": {"with"},
    "23-dataclasses": {"dataclass", "enum", "namedtuple"},
    "24-typing": {"optional"},
    "25-typecheck": set(),
    "26-decorators": {"decorator", "wraps"},
    "27-metaclasses": set(),
    "28-ast": {"ast", "dis", "inspect"},
    "29-modules": set(),
    "30-packaging": set(),
    "31-testing": set(),
    "32-tooling": {"logging"},
    "33-concurrency": {"thread"},
    "34-async": {"async_def", "await"},
    "35-performance": {"timeit"},
    "36-memory": {"gc", "weakref"},
    "37-ecosystem": {"pathlib", "re", "subprocess"},
    "38-tracebacks": {"breakpoint", "pdb"},
}

_NODE_FEATURES = [
    ((ast.ListComp, ast.SetComp, ast.GeneratorExp), "comprehension"),
    ((ast.DictComp,), "dict_comprehension"),
    ((ast.Lambda,), "lambda"),
    ((ast.NamedExpr,), "walrus"),
    ((ast.Match,), "match"),
    ((ast.ClassDef,), "class"),
    ((ast.Yield, ast.YieldFrom), "yield"),
    ((ast.With, ast.AsyncWith), "with"),
    ((ast.Try,), "try"),
    ((ast.Slice,), "slice"),
    ((ast.Global,), "global"),
    ((ast.Nonlocal,), "nonlocal"),
    ((ast.AsyncFunctionDef,), "async_def"),
    ((ast.Await,), "await"),
    ((ast.IfExp,), "conditional_expr"),
    ((ast.Delete,), "del"),
    ((ast.Starred,), "starargs"),
    ((ast.Assert,), "assert"),
    ((ast.Raise,), "raise"),
]

# builtins and modules whose first legitimate appearance is a specific unit
# Emitted from syntax rather than from a name or a node type, so it needs saying
# here or the consistency check below cannot see it.
_SYNTHETIC_FEATURES = {"decorator"}

_NAME_FEATURES = {
    "map": "map", "filter": "filter", "reduce": "reduce", "zip": "zip",
    "enumerate": "enumerate", "sorted": "sorted", "sum": "sum", "any": "any",
    "all": "all", "next": "next", "iter": "iter", "id": "id", "hash": "hash",
    "set": "set", "frozenset": "frozenset", "setattr": "setattr",
    "getattr": "getattr", "repr": "repr", "callable": "callable",
    "property": "property", "classmethod": "classmethod",
    "staticmethod": "staticmethod", "super": "super", "compile": "compile",
    "eval": "eval", "round": "round", "breakpoint": "breakpoint",
    "dataclass": "dataclass", "defaultdict": "defaultdict",
    "namedtuple": "namedtuple", "Counter": "counter", "deque": "deque",
    "setdefault": "setdefault", "wraps": "wraps", "partial": "partial",
    "deepcopy": "deepcopy",
}
# Reached only as an attribute (functools.cache) or a from-import, never as a
# bare name, so matching them as bare names only produced false positives on
# ordinary variables called `cache`.
_ATTR_FEATURES = {"cache": "cache", "lru_cache": "cache"}

_MODULE_FEATURES = {
    "math": "math", "copy": "copy_module", "itertools": "itertools",
    "functools": "functools", "heapq": "heapq",
    "bisect": "bisect", "dataclasses": "dataclass", "enum": "enum",
    "ast": "ast", "dis": "dis", "inspect": "inspect", "logging": "logging",
    "weakref": "weakref", "gc": "gc", "pathlib": "pathlib", "re": "re",
    "subprocess": "subprocess", "threading": "thread", "asyncio": "async_def",
    "typing": "optional", "pdb": "pdb", "timeit": "timeit",
}


# INTRODUCES says what each unit unlocks; the tables above say what the detector
# can actually find. Nothing connected the two, so a feature named in INTRODUCES
# but never detected gated nothing, and a detected feature named in no unit gated
# everything forever. Both are now build failures.
DETECTABLE = ({name for _, name in _NODE_FEATURES} | _SYNTHETIC_FEATURES
              | set(_ATTR_FEATURES.values())
              | set(_NAME_FEATURES.values()) | set(_MODULE_FEATURES.values()))


def _check_feature_tables() -> None:
    introduced = {f for feats in INTRODUCES.values() for f in feats}
    undetectable = introduced - DETECTABLE
    ungated = DETECTABLE - introduced
    if undetectable:
        raise SystemExit(f"INTRODUCES names features no detector finds: {sorted(undetectable)}")
    if ungated:
        raise SystemExit(f"the detector finds features no unit introduces: {sorted(ungated)}")
    twice = [f for f in DETECTABLE
             if sum(1 for feats in INTRODUCES.values() if f in feats) > 1]
    if twice:
        raise SystemExit(f"features introduced by more than one unit: {sorted(twice)}")


def features_used(source: str) -> set[str]:
    """Every gated construct appearing in a snippet."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return set()          # a deliberately unparseable starter gates nothing

    found: set[str] = set()
    for node in ast.walk(tree):
        for types, name in _NODE_FEATURES:
            if isinstance(node, types):
                found.add(name)
        if isinstance(node, ast.Name) and node.id in _NAME_FEATURES:
            found.add(_NAME_FEATURES[node.id])
        if isinstance(node, ast.Attribute):
            if node.attr in _NAME_FEATURES:
                found.add(_NAME_FEATURES[node.attr])
            if node.attr in _ATTR_FEATURES:
                found.add(_ATTR_FEATURES[node.attr])
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name in _ATTR_FEATURES:
                    found.add(_ATTR_FEATURES[alias.name])
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name in _MODULE_FEATURES:
                    found.add(_MODULE_FEATURES[alias.name])
        if isinstance(node, ast.ImportFrom) and node.module in _MODULE_FEATURES:
            found.add(_MODULE_FEATURES[node.module])
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.decorator_list:
            found.add("decorator")
    return found


def available_by(slug: str) -> set[str]:
    """Everything a reader has met by the time they reach this unit's exercises."""
    order = [s for s, *_ in TRACK]
    if slug not in order:
        return set(BASELINE)
    upto = order[: order.index(slug) + 1]
    out: set[str] = set()
    for s in upto:
        out |= INTRODUCES.get(s, set())
    return out


def gate(path: Path) -> list[str]:
    """Complaints about an exercise file using constructs from further down the track."""
    _check_feature_tables()
    slug = path.stem
    allowed = available_by(slug)
    problems = []
    for ex in parse_exercises(path):
        for kind in ("starter", "solution"):   # the reader never writes the tests
            used = features_used(ex[kind])
            early = sorted(used - allowed)
            if early:
                problems.append(
                    f"{slug} #{ex['n']} {ex['title']}: {kind} uses {', '.join(early)} "
                    f"before the reader has met it")
    return problems


# ---------------------------------------------------------------- build

def build() -> int:
    DATA.mkdir(exist_ok=True)
    by_slug = {}
    track = []
    for i, (slug, phase, title, blurb) in enumerate(TRACK):
        entry = {
            "slug": slug, "n": i, "phase": phase, "title": title,
            "blurb": blurb, "accent": ACCENTS[i % len(ACCENTS)],
            "needs": TRACK[i - 1][0] if i else None,
            "hasNote": False, "hasEx": 0, "hasDrills": 0,
        }
        by_slug[slug] = entry
        track.append(entry)

    # Parse each file once. The JSON dump, the errors index and the search index
    # all want the same parsed result, and re-globbing meant every validation and
    # every regex ran two or three times per build.
    units = {p: parse_unit(p) for p in sorted(CONTENT.glob("units/*.md"))}
    exercises = {p: parse_exercises(p) for p in sorted(CONTENT.glob("ex/*.md"))}

    written = 0
    for path, unit in units.items():
        if unit["slug"] not in by_slug:
            die(path, f"slug {unit['slug']!r} is not in TRACK")
        by_slug[unit["slug"]]["hasNote"] = True
        (DATA / f"unit-{unit['slug']}.json").write_text(json.dumps(unit))
        written += 1

    # The gate belongs to the build, not to a shell script a contributor may
    # never run. The exercises are already parsed, so this costs nothing.
    _check_feature_tables()
    vocabulary = [p for path in exercises for p in gate(path)]
    for problem in vocabulary:
        print(f"VOCABULARY  {problem}", file=sys.stderr)

    for path, ex in exercises.items():
        slug = path.stem
        if slug not in by_slug:
            die(path, f"slug {slug!r} is not in TRACK")
        by_slug[slug]["hasEx"] = len(ex)
        # The book gives hints and never answers. Shipping the solutions to the
        # browser would put every one of them a single fetch away, so they stay
        # in content/ where --validate can still compile and run them.
        shipped = [{k: v for k, v in e.items() if k != "solution"} for e in ex]
        (DATA / f"ex-{slug}.json").write_text(json.dumps(shipped))
        written += 1

    for path in sorted(CONTENT.glob("drills/*.md")):
        slug = path.stem
        if slug not in by_slug:
            die(path, f"slug {slug!r} is not in TRACK")
        drills = parse_drills(path)
        by_slug[slug]["hasDrills"] = len(drills)
        (DATA / f"drills-{slug}.json").write_text(json.dumps(drills))
        written += 1

    projects = []
    for slug, tier, domain, stages, minutes, title, blurb in PROJECTS:
        projects.append({
            "slug": slug, "tier": tier, "tierLabel": tier.capitalize(), "domain": domain,
            "stages": stages, "minutes": minutes, "title": title, "blurb": blurb,
            "hasBody": False,
        })
    by_proj = {p["slug"]: p for p in projects}
    for path in sorted(CONTENT.glob("projects/*.md")):
        proj = parse_project(path)
        if proj["slug"] not in by_proj:
            die(path, f"project slug {proj['slug']!r} is not in PROJECTS")
        by_proj[proj["slug"]]["hasBody"] = True
        (DATA / f"project-{proj['slug']}.json").write_text(json.dumps(proj))
        written += 1

    # The errors index is derived from every @diagnose in the book, so it cannot
    # drift from the prose the workbench actually shows.
    errors: dict[str, dict] = {}
    for path, parsed in exercises.items():
        slug = path.stem
        for ex in parsed:
            # The judge travels with the @expect declaration. Guessing it back
            # from the shape of the code was wrong for B006, which looks like an
            # exception name, and would be wrong again for the next such code.
            declared = {e["code"] or e["judge"]: e["judge"] for e in ex["expects"]}
            for code, prose in ex["diagnose"].items():
                judge = JUDGE_GROUP[declared[code]] if code in declared else "runtime"
                entry = errors.setdefault(code, {"code": code, "judge": judge, "seen": []})
                entry["seen"].append({"unit": slug, "n": ex["n"], "title": ex["title"],
                                      "prose": prose})
    (DATA / "errors.json").write_text(json.dumps(
        sorted(errors.values(), key=lambda e: (e["judge"], e["code"]))))
    written += 1

    gloss = []
    for path in sorted(CONTENT.glob("gloss/*.md")):
        gloss.extend(parse_gloss(path))
    gloss.sort(key=lambda g: g["term"].lower())
    (DATA / "gloss.json").write_text(json.dumps(gloss))
    written += 1

    # A search index built once here rather than fetching 39 notes in the browser.
    index = []
    for unit in units.values():
        meta = by_slug[unit["slug"]]
        for sec in unit["sections"]:
            index.append({"kind": "section", "unit": unit["slug"], "n": meta["n"],
                          "title": sec["title"], "id": sec["id"],
                          "unitTitle": unit["title"]})
        index.append({"kind": "note", "unit": unit["slug"], "n": meta["n"],
                      "title": unit["title"], "id": "",
                      "body": re.sub(r"\s+", " ", unit["body"])[:20000]})
    for path, parsed in exercises.items():
        for ex in parsed:
            # the diagnose prose is where an exercise's substance is; indexing
            # only the prompt makes half the book unsearchable
            body = " ".join([ex["prompt"], *ex["hints"], *ex["diagnose"].values()])
            index.append({"kind": "exercise", "unit": path.stem, "n": ex["n"],
                          "title": ex["title"], "body": re.sub(r"\s+", " ", body)[:3000]})
    for g in gloss:
        index.append({"kind": "term", "title": g["term"], "body": g["text"][:800]})
    (DATA / "search.json").write_text(json.dumps(index))
    written += 1

    (DATA / "judges.json").write_text(json.dumps(JUDGES))
    written += 1

    (DATA / "manifest.json").write_text(json.dumps({
        "track": track,
        "phases": [{"n": i, "title": t, "blurb": b} for i, (t, b) in enumerate(PHASES)],
        "projects": projects,
        "totalMinutes": sum(p[4] for p in PROJECTS),
    }))
    written += 1

    # A unit with some of its three parts but not all of them is a defect, not
    # work in progress: it renders links to pages that are not there.
    partial = [e["slug"] for e in track
               if any((e["hasNote"], e["hasEx"], e["hasDrills"]))
               and not all((e["hasNote"], e["hasEx"], e["hasDrills"]))]
    for slug in partial:
        e = by_slug[slug]
        missing = [name for name, present in
                   (("note", e["hasNote"]), ("exercises", e["hasEx"]), ("drills", e["hasDrills"]))
                   if not present]
        print(f"INCOMPLETE {slug}: no {', no '.join(missing)}", file=sys.stderr)

    done = sum(1 for e in track if e["hasNote"] and e["hasEx"] and e["hasDrills"])
    print(f"built {written} files -> data/")
    print(f"units complete: {done}/{len(track)}   projects written: "
          f"{sum(1 for p in projects if p['hasBody'])}/{len(projects)}")
    print(f"errors indexed: {len(errors)}   glossary terms: {len(gloss)}   "
          f"search entries: {len(index)}")
    return 1 if (partial or vocabulary) else 0


# ---------------------------------------------------------------- check / validate

def check(target: Path) -> int:
    kind = target.parent.name
    parser = {"units": parse_unit, "ex": parse_exercises, "drills": parse_drills,
              "projects": parse_project, "gloss": parse_gloss}.get(kind)
    if not parser:
        die(target, f"do not know how to check a file in {kind}/")
    result = parser(target)
    if kind == "ex":
        problems = gate(target)
        for problem in problems:
            print(f"VOCABULARY  {problem}", file=sys.stderr)
        if problems:
            return 1
    n = len(result) if isinstance(result, list) else 1
    print(f"{n} clean")
    return 0


def _judges_available() -> bool:
    return all(_run(["uv", "run", "--quiet", "--with", tool, tool, "--version"]).returncode == 0
               for tool in ("ruff", "mypy"))


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


RUNNER = ROOT / "assets" / "runner.py"


def _run_all(cases: dict[str, tuple[str, str]]) -> dict[str, dict]:
    """Run each (source, tests) pair through assets/runner.py.

    The same file the browser executes inside Pyodide, so the filenames, the line
    numbers and the exception names are one definition rather than two that have
    to be kept in step by hand. One subprocess per case, because each runs
    arbitrary code, but they are independent and go through a thread pool.
    """
    def once(src, tests, seed):
        out = _run([sys.executable, str(RUNNER), "--stdin"],
                   input=json.dumps({"src": src, "tests": tests}),
                   env={**os.environ, "PYTHONHASHSEED": seed})
        try:
            return json.loads(out.stdout)
        except json.JSONDecodeError:
            return {"ok": False, "out": "", "exc": "RunnerFailed",
                    "msg": out.stderr.strip()[-400:], "tb": ""}

    def one(item):
        name, (src, tests) = item
        # Twice, under different hash seeds. String hashing is randomised per
        # process, so anything that depends on the order of a set of strings
        # passes or fails by luck, and an exercise that does is worse than one
        # that is simply wrong: it goes green often enough to be committed.
        first = once(src, tests, "0")
        second = once(src, tests, "12345")
        if (first["ok"], first["exc"]) != (second["ok"], second["exc"]):
            return name, {**first, "flaky": (first["exc"] or "passed",
                                             second["exc"] or "passed")}
        return name, first

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        return dict(pool.map(one, cases.items()))


def _judge_all(sources: dict[str, str]) -> dict[str, dict]:
    """Run ruff and mypy over many snippets at once.

    Both cost almost nothing per file and a great deal per invocation, so each
    runs once over the whole set. Each snippet is judged ALONE, which is what the
    browser lints: the reader's editor contents, without the hidden tests
    appended. Running the code is `_run_all`.
    """
    verdicts = {name: {"ruff": [], "mypy": []} for name in sources}

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        paths = {}
        for name, src in sources.items():
            f = root / f"{name}.py"
            f.write_text(src)
            paths[f.name] = name

        ruff = _run(["uv", "run", "--quiet", "--with", "ruff", "ruff", "check",
                     "--output-format", "json", "--isolated", "--no-cache",
                     "--select", ",".join(JUDGES["ruff"]["select"]),
                     "--ignore", ",".join(JUDGES["ruff"]["ignore"]),
                     "--line-length", str(JUDGES["ruff"]["lineLength"]),
                     "--target-version", JUDGES["ruff"]["targetVersion"], str(root)])
        try:
            for d in json.loads(ruff.stdout or "[]"):
                name = paths.get(Path(d.get("filename", "")).name)
                if name and d.get("code"):
                    verdicts[name]["ruff"].append(d["code"])
        except json.JSONDecodeError:
            pass

        CACHE.mkdir(parents=True, exist_ok=True)
        mypy = _run(["uv", "run", "--quiet", "--with", "mypy", "mypy",
                     *JUDGES["mypy"]["flags"],
                     "--cache-dir", str(CACHE / "mypy"), *[str(root / f) for f in paths]])
        for line in mypy.stdout.splitlines():
            m = re.match(r"^(.*?):\d+:(?:\d+:)?\s*error:\s*.*?\s*\[([a-z-]+)\]\s*$", line)
            if m:
                name = paths.get(Path(m.group(1)).name)
                if name:
                    verdicts[name]["mypy"].append(m.group(2))


    for v in verdicts.values():
        v["ruff"] = sorted(set(v["ruff"]))
        v["mypy"] = sorted(set(v["mypy"]))
    return verdicts


def _satisfies(expects: list[dict], static: dict, run: dict) -> list[str]:
    """Failures to meet an exercise's declared verdict, in the browser's terms.

    One run of the reader's code with its hidden tests, exactly as the workbench
    does it: if the starter raises, the tests never execute and the exception is
    what both sides see; if it does not, an AssertionError means the tests
    caught it, which is what `silent` describes.
    """
    problems = []
    for e in expects:
        judge, code = e["judge"], e["code"]
        if judge == "silent":
            if run["exc"] != "AssertionError":
                problems.append("@expect silent, so the hidden tests should catch it, "
                                f"but it raised {run['exc'] or 'nothing at all'}")
        elif judge == "raises":
            if run["exc"] != code:
                problems.append(f"@expect raises:{code} but got {run['exc'] or 'no exception'}")
        elif code not in static[judge]:
            problems.append(f"@expect {judge}:{code} but {judge} said {static[judge] or 'nothing'}")
    return problems


# Cases where the two runners could disagree about what an exception is called.
# The browser reports type(e).__name__; a traceback prints the qualified name.
_NAME_CASES = {
    "_agree_builtin": ('raise TypeError("x")', "TypeError"),
    "_agree_qualified": ('import json\njson.loads("{bad")', "JSONDecodeError"),
    "_agree_custom": ('class ConfigError(Exception): pass\nraise ConfigError("x")', "ConfigError"),
    "_agree_nested": ('import decimal\ndecimal.Decimal("x")', "InvalidOperation"),
}


def validate() -> int:
    if not _judges_available():
        print("validate needs uv with ruff and mypy available", file=sys.stderr)
        return 2

    labels, sources, cases = {}, {}, {}
    for path in sorted(CONTENT.glob("ex/*.md")):
        slug = path.stem.replace("-", "_")
        for ex in parse_exercises(path):
            base = f"ex_{slug}__{ex['n']}"
            labels[base] = (f"{path.stem} #{ex['n']} {ex['title']}", ex)
            # ruff and mypy see the code alone, which is what the browser lints.
            sources[f"{base}__starter"] = ex["starter"]
            sources[f"{base}__solution"] = ex["solution"]
            # CPython sees the code with its hidden tests, which is what the
            # browser runs.
            cases[f"{base}__starter"] = (ex["starter"], ex["tests"])
            cases[f"{base}__solution"] = (ex["solution"], ex["tests"])

    # Judged alongside the exercises, so the two runners cannot drift apart on
    # what an exception is called without a check failing.
    cases.update({k: (src, "") for k, (src, _) in _NAME_CASES.items()})

    static = _judge_all(sources)
    runs = _run_all(cases)

    failures = 0
    for key, (_, expected) in _NAME_CASES.items():
        got = runs[key]["exc"]
        if got != expected:
            print(f"FAIL judges: an exception the browser calls {expected!r} "
                  f"is reported here as {got!r}")
            failures += 1

    for base, (label, ex) in sorted(labels.items()):
        s_static, s_run = static[f"{base}__starter"], runs[f"{base}__starter"]
        v_static, v_run = static[f"{base}__solution"], runs[f"{base}__solution"]

        for which, verdict in (("starter", s_run), ("solution", v_run)):
            if "flaky" in verdict:
                a, b = verdict["flaky"]
                print(f"FAIL {which:8} {label}: FLAKY. Under one hash seed it "
                      f"{a}, under another it {b}. Something here depends on the "
                      f"order of a set, which is randomised per process.")
                failures += 1

        # 1. the starter produces the verdict its prose describes
        for problem in _satisfies(ex["expects"], s_static, s_run):
            print(f"FAIL starter  {label}: {problem}")
            failures += 1

        # 2. every code a judge reports has prose explaining it, or the reader
        #    meets a coloured row with no reading beside it
        for judge in ("ruff", "mypy"):
            for code in s_static[judge]:
                if code not in ex["diagnose"]:
                    print(f"FAIL starter  {label}: {judge} reported {code} "
                          f"but there is no @diagnose {code}")
                    failures += 1

        # 3. the starter must actually FAIL its own hidden tests, or the exercise
        #    is already solved and nobody would notice
        if s_run["ok"]:
            print(f"FAIL starter  {label}: starter already passes its own tests")
            failures += 1

        # 4. the solution passes, and is clean under both static judges
        if not v_run["ok"]:
            print(f"FAIL solution {label}: solution+tests raised "
                  f"{v_run['exc']}: {v_run['msg'][:120]}")
            failures += 1
        for judge in ("ruff", "mypy"):
            if v_static[judge]:
                print(f"FAIL solution {label}: solution is not {judge} clean: {v_static[judge]}")
                failures += 1

    print(f"\nvalidated {len(labels)} exercises against ruff + mypy + CPython: "
          f"{'ALL CLEAN' if not failures else f'{failures} FAILURES'}")
    return 1 if failures else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", metavar="FILE")
    ap.add_argument("--validate", action="store_true")
    args = ap.parse_args()
    if args.check:
        return check(Path(args.check))
    if args.validate:
        return validate()
    return build()


if __name__ == "__main__":
    sys.exit(main())
