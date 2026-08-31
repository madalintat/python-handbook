#!/usr/bin/env python3
"""content/ -> data/.  No dependencies, no network (except --validate).

    python3 build.py                 build everything into data/
    python3 build.py --check FILE    validate one content file, print "N clean"
    python3 build.py --validate      run every starter and solution past all three judges
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).parent
CONTENT = ROOT / "content"
DATA = ROOT / "data"

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

TIERS = {"mini": "Mini", "core": "Core", "deep": "Deep"}

# The four verdict kinds. `silent` is the one Rust cannot have: every judge is
# happy and the code is still wrong.
VERDICTS = {"ruff", "mypy", "raises", "silent"}

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


def parse_unit(path: Path) -> dict:
    meta, body = front_matter(path.read_text(), path)
    words = word_count(body)
    if not (NOTE_MIN <= words <= NOTE_MAX):
        die(path, f"note is {words} words, must be {NOTE_MIN}-{NOTE_MAX}")

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

    if len(out) != 8:
        die(path, f"{len(out)} exercises, must be exactly 8")
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
    if len(out) != 15:
        die(path, f"{len(out)} drills, must be exactly 15")
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

    written = 0
    for path in sorted(CONTENT.glob("units/*.md")):
        unit = parse_unit(path)
        if unit["slug"] not in by_slug:
            die(path, f"slug {unit['slug']!r} is not in TRACK")
        by_slug[unit["slug"]]["hasNote"] = True
        (DATA / f"unit-{unit['slug']}.json").write_text(json.dumps(unit))
        written += 1

    for path in sorted(CONTENT.glob("ex/*.md")):
        slug = path.stem
        if slug not in by_slug:
            die(path, f"slug {slug!r} is not in TRACK")
        ex = parse_exercises(path)
        by_slug[slug]["hasEx"] = len(ex)
        (DATA / f"ex-{slug}.json").write_text(json.dumps(ex))
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
    proj_slugs = {p[0] for p in PROJECTS}
    for slug, tier, domain, stages, minutes, title, blurb in PROJECTS:
        projects.append({
            "slug": slug, "tier": tier, "tierLabel": TIERS[tier], "domain": domain,
            "stages": stages, "minutes": minutes, "title": title, "blurb": blurb,
            "hasBody": False,
        })
    for path in sorted(CONTENT.glob("projects/*.md")):
        proj = parse_project(path)
        if proj["slug"] not in proj_slugs:
            die(path, f"project slug {proj['slug']!r} is not in PROJECTS")
        for p in projects:
            if p["slug"] == proj["slug"]:
                p["hasBody"] = True
        (DATA / f"project-{proj['slug']}.json").write_text(json.dumps(proj))
        written += 1

    # The errors index is derived from every @diagnose in the book, so it cannot
    # drift from the prose the workbench actually shows.
    errors: dict[str, dict] = {}
    for path in sorted(CONTENT.glob("ex/*.md")):
        slug = path.stem
        for ex in parse_exercises(path):
            for code, prose in ex["diagnose"].items():
                # order matters: B006 starts with a capital too, so the ruff
                # shape has to be tested before "looks like an exception name"
                judge = ("reading" if code == "silent" else
                         "ruff" if re.fullmatch(r"[A-Z]{1,4}\d{3,4}", code) else
                         "runtime" if code[0].isupper() else "mypy")
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
    for path in sorted(CONTENT.glob("units/*.md")):
        unit = parse_unit(path)
        meta = by_slug[unit["slug"]]
        for sec in unit["sections"]:
            index.append({"kind": "section", "unit": unit["slug"], "n": meta["n"],
                          "title": sec["title"], "id": sec["id"],
                          "unitTitle": unit["title"]})
        index.append({"kind": "note", "unit": unit["slug"], "n": meta["n"],
                      "title": unit["title"], "id": "",
                      "body": re.sub(r"\s+", " ", unit["body"])[:20000]})
    for path in sorted(CONTENT.glob("ex/*.md")):
        for ex in parse_exercises(path):
            # the diagnose prose is where an exercise's substance is; indexing
            # only the prompt makes half the book unsearchable
            body = " ".join([ex["prompt"], *ex["hints"], *ex["diagnose"].values()])
            index.append({"kind": "exercise", "unit": path.stem, "n": ex["n"],
                          "title": ex["title"], "body": re.sub(r"\s+", " ", body)[:3000]})
    for g in gloss:
        index.append({"kind": "term", "title": g["term"], "body": g["text"][:800]})
    (DATA / "search.json").write_text(json.dumps(index))
    written += 1

    (DATA / "manifest.json").write_text(json.dumps({
        "track": track,
        "phases": [{"n": i, "title": t, "blurb": b} for i, (t, b) in enumerate(PHASES)],
        "projects": projects,
        "accents": ACCENTS,
        "totalMinutes": sum(p[4] for p in PROJECTS),
    }))
    written += 1

    done = sum(1 for e in track if e["hasNote"] and e["hasEx"] and e["hasDrills"])
    print(f"built {written} files -> data/")
    print(f"units complete: {done}/{len(track)}   projects written: "
          f"{sum(1 for p in projects if p['hasBody'])}/{len(projects)}")
    print(f"errors indexed: {len(errors)}   glossary terms: {len(gloss)}   "
          f"search entries: {len(index)}")
    return 0


# ---------------------------------------------------------------- check / validate

def check(target: Path) -> int:
    kind = target.parent.name
    parser = {"units": parse_unit, "ex": parse_exercises, "drills": parse_drills,
              "projects": parse_project, "gloss": parse_gloss}.get(kind)
    if not parser:
        die(target, f"do not know how to check a file in {kind}/")
    result = parser(target)
    n = len(result) if isinstance(result, list) else 1
    print(f"{n} clean")
    return 0


def _judges_available() -> bool:
    return all(_run(["uv", "run", "--quiet", "--with", tool, tool, "--version"]).returncode == 0
               for tool in ("ruff", "mypy"))


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def _judge(source: str) -> dict:
    """Run all three judges over one snippet. Mirrors the browser workbench."""
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "snippet.py"
        f.write_text(source)

        ruff = _run(["uv", "run", "--quiet", "--with", "ruff", "ruff", "check",
                     "--output-format", "json", "--isolated", "--no-cache",
                     "--select", "E,F,B,SIM,UP", "--ignore", "E501", str(f)])
        try:
            ruff_codes = sorted({d["code"] for d in json.loads(ruff.stdout or "[]") if d.get("code")})
        except json.JSONDecodeError:
            ruff_codes = []

        mypy = _run(["uv", "run", "--quiet", "--with", "mypy", "mypy",
                     "--no-color-output", "--no-error-summary", "--hide-error-context",
                     "--no-incremental", "--cache-dir", str(Path(td) / "c"), str(f)])
        mypy_codes = sorted(set(re.findall(
            r"^.*?:\d+:(?:\d+:)?\s*error:\s*.*?\s*\[([a-z-]+)\]\s*$", mypy.stdout, re.M)))

        run = _run([sys.executable, str(f)])
        raised = ""
        if run.returncode != 0:
            tail = [ln for ln in run.stderr.strip().splitlines() if ln and not ln[0].isspace()]
            if tail:
                raised = tail[-1].split(":")[0].strip()

    return {"ruff": ruff_codes, "mypy": mypy_codes, "raises": raised}


def _satisfies(expects: list[dict], verdict: dict) -> list[str]:
    """Return a list of failure messages; empty means the starter behaves as documented."""
    problems = []
    for e in expects:
        judge, code = e["judge"], e["code"]
        if judge == "silent":
            if verdict["raises"]:
                problems.append(f"@expect silent but it raised {verdict['raises']}")
        elif judge == "raises":
            if verdict["raises"] != code:
                problems.append(f"@expect raises:{code} but got {verdict['raises'] or 'no exception'}")
        elif code not in verdict[judge]:
            problems.append(f"@expect {judge}:{code} but {judge} said {verdict[judge] or 'nothing'}")
    return problems


def validate() -> int:
    if not _judges_available():
        print("validate needs uv with ruff and mypy available", file=sys.stderr)
        return 2

    failures = 0
    checked = 0
    for path in sorted(CONTENT.glob("ex/*.md")):
        for ex in parse_exercises(path):
            checked += 1
            label = f"{path.stem} #{ex['n']} {ex['title']}"

            # 1. the starter, alone, must produce the verdict its prose describes
            starter_verdict = _judge(ex["starter"])
            for problem in _satisfies(ex["expects"], starter_verdict):
                print(f"FAIL starter  {label}: {problem}")
                failures += 1

            # 2. the starter must actually FAIL its own hidden tests. without this
            #    an exercise can quietly become already-solved and nobody notices.
            # every code a judge actually produced must have prose explaining it,
            # or the learner meets a yellow row with no reading beside it
            for judge in ("ruff", "mypy"):
                for code in starter_verdict[judge]:
                    if code not in ex["diagnose"]:
                        print(f"FAIL starter  {label}: {judge} reported {code} "
                              f"but there is no @diagnose {code}")
                        failures += 1

            broken = _judge(ex["starter"] + "\n\n" + ex["tests"])
            if not broken["raises"]:
                print(f"FAIL starter  {label}: starter already passes its own tests")
                failures += 1
            elif any(e["judge"] == "silent" for e in ex["expects"]) \
                    and broken["raises"] != "AssertionError":
                print(f"FAIL starter  {label}: @expect silent, so starter+tests should "
                      f"fail an assert, but it raised {broken['raises']}")
                failures += 1

            # 3. the solution must pass the tests and be clean
            sol = _judge(ex["solution"] + "\n\n" + ex["tests"])
            if sol["raises"]:
                print(f"FAIL solution {label}: solution+tests raised {sol['raises']}")
                failures += 1
            if sol["ruff"]:
                print(f"FAIL solution {label}: solution is not ruff clean: {sol['ruff']}")
                failures += 1
            if sol["mypy"]:
                print(f"FAIL solution {label}: solution is not mypy clean: {sol['mypy']}")
                failures += 1

    print(f"\nvalidated {checked} exercises against ruff + mypy + CPython: "
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
