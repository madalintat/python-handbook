---
slug: 30-packaging
---

## Versions compared as text

`latest` picks the newest version by sorting the strings. `"1.10"` sorts before `"1.9"`, because `"1"` comes before `"9"`.

@expect silent
@hint Compare `"1.10"` and `"1.9"` as strings, character by character.
@hint A version compares component by component, and each component is a number.
@diagnose silent Nothing raised, and it picked the older version. Strings compare character by character, so `"1.10"` loses to `"1.9"` at the second character, which is the single most common versioning bug and is completely silent: the code works for every version below ten and then quietly stops. Versions compare **component by component, numerically**, which a tuple of integers does correctly and for free, since tuples compare element by element and stop at the first difference. This is why `packaging.version.Version` exists, and why comparing version strings with `<` should always feel like a mistake.

~~~starter
def latest(versions):
    """The newest of these version strings."""
    return max(versions)
~~~

~~~tests
assert latest(["1.9", "1.10", "1.2"]) == "1.10", f"picked {latest(['1.9', '1.10', '1.2'])}"
assert latest(["2.0.0", "10.0.0"]) == "10.0.0"
assert latest(["0.1.0"]) == "0.1.0"
assert latest(["1.0.2", "1.0.10"]) == "1.0.10"
~~~

~~~solution
def latest(versions):
    """The newest of these version strings."""
    return max(versions, key=lambda v: tuple(int(part) for part in v.split(".")))
~~~

## A config file opened as text

`read_dependencies` parses `pyproject.toml`. `tomllib.load` requires a binary file, and this one is opened as text.

@expect raises:TypeError
@hint Read the error: it names the mode the file needed.
@hint TOML is defined as UTF-8, so the parser decodes it rather than trusting the platform.
@diagnose TypeError `tomllib.load` requires a **binary** file object and says so: `File must be opened in binary mode`. It is not being awkward. TOML is defined to be UTF-8, so the parser decodes the bytes itself rather than trusting whatever encoding the platform would have chosen, which is exactly the sort of assumption that works on one machine and fails on another. `"rb"` is the fix. `tomllib.loads` takes a string, so reading the text yourself and parsing that is the other way round and is equally correct. Note the direction, too: the standard library reads TOML and does not write it, because round-tripping a config file without destroying its comments is a much harder problem than parsing one.

~~~starter
import tomllib

with open("pyproject.toml", "w") as f:
    f.write('[project]\nname = "myapp"\nversion = "0.1.0"\n')
    f.write('dependencies = ["httpx>=0.27", "rich"]\n')


def read_dependencies(path):
    """The declared dependencies of a project."""
    with open(path) as f:
        config = tomllib.load(f)
    return config["project"]["dependencies"]


print(read_dependencies("pyproject.toml"))
~~~

~~~tests
assert read_dependencies("pyproject.toml") == ["httpx>=0.27", "rich"]
~~~

~~~solution
import tomllib

with open("pyproject.toml", "w") as f:
    f.write('[project]\nname = "myapp"\nversion = "0.1.0"\n')
    f.write('dependencies = ["httpx>=0.27", "rich"]\n')


def read_dependencies(path):
    """The declared dependencies of a project."""
    with open(path, "rb") as f:
        config = tomllib.load(f)
    return config["project"]["dependencies"]


print(read_dependencies("pyproject.toml"))
~~~

## A pre-release sorted the wrong way

`sort_releases` orders versions, treating a release candidate as though it came after the release. Pre-releases sort **before** the version they lead to.

@expect silent
@hint `1.0.0rc1` is a candidate for `1.0.0`. Which of the two exists first?
@hint A tuple that ends sooner sorts first, if the earlier components are equal.
@diagnose silent It runs and puts `1.0.0` before `1.0.0rc1`, which is backwards: a release candidate is a candidate *for* a release, so it comes first. The trick that makes this fall out for free is to sort on a tuple where the pre-release marker is an extra component, and to give the final release a marker that sorts **after** any pre-release. Sorting `(1, 0, 0, 0, 1)` for `rc1` against `(1, 0, 0, 1)` for the release does it, because tuples compare element by element and the fourth element decides. Getting this backwards means an installer offering a release candidate as the newest version, which is exactly the sort of thing nobody notices until a user reports it.

~~~starter
def sort_releases(versions):
    """Version strings, oldest first. `1.0.0rc1` precedes `1.0.0`."""

    def key(version):
        if "rc" in version:
            base, candidate = version.split("rc")
            return (*(int(p) for p in base.split(".")), 1, int(candidate))
        return (*(int(p) for p in version.split(".")), 0, 0)

    return sorted(versions, key=key)
~~~

~~~tests
assert sort_releases(["1.0.0", "1.0.0rc1"]) == ["1.0.0rc1", "1.0.0"]
assert sort_releases(["1.0.0rc2", "1.0.0rc1"]) == ["1.0.0rc1", "1.0.0rc2"]
assert sort_releases(["1.0.1", "1.0.0", "1.0.1rc1"]) == ["1.0.0", "1.0.1rc1", "1.0.1"]
~~~

~~~solution
def sort_releases(versions):
    """Version strings, oldest first. `1.0.0rc1` precedes `1.0.0`."""

    def key(version):
        if "rc" in version:
            base, candidate = version.split("rc")
            return (*(int(p) for p in base.split(".")), 0, int(candidate))
        return (*(int(p) for p in version.split(".")), 1, 0)

    return sorted(versions, key=key)
~~~

## A compatible-release specifier read as an equality

`satisfies` implements `~=`, the compatible-release operator. It treats it as exact equality, so no newer patch release ever matches.

@expect silent
@hint `~=1.4.2` means "at least 1.4.2, and still 1.4.something".
@hint Two conditions, both on the same tuple.
@diagnose silent Nothing raised, and `1.4.3` was rejected by a specifier written precisely to accept it. `~=1.4.2` means **at least 1.4.2, and not past 1.5**: the last component is allowed to move and everything to its left is pinned. It is the same thing as `>=1.4.2,<1.5.0` and exists because that is the constraint people actually want and keep writing at length. The distinction matters for the advice in this unit: a library should mostly say `>=`, and reach for `~=` where it knows a minor release breaks something; an application should not be using either, because its exact versions belong in a lock file.

~~~starter
def satisfies(version, specifier):
    """Whether `version` satisfies a `~=` compatible-release specifier."""
    wanted = tuple(int(p) for p in specifier.removeprefix("~=").split("."))
    got = tuple(int(p) for p in version.split("."))
    return got == wanted
~~~

~~~tests
assert satisfies("1.4.2", "~=1.4.2")
assert satisfies("1.4.3", "~=1.4.2"), "a newer patch release should satisfy ~="
assert satisfies("1.4.99", "~=1.4.2")
assert not satisfies("1.4.1", "~=1.4.2")
assert not satisfies("1.5.0", "~=1.4.2")
assert not satisfies("2.0.0", "~=1.4.2")
~~~

~~~solution
def satisfies(version, specifier):
    """Whether `version` satisfies a `~=` compatible-release specifier."""
    wanted = tuple(int(p) for p in specifier.removeprefix("~=").split("."))
    got = tuple(int(p) for p in version.split("."))
    return got >= wanted and got[:-1] == wanted[:-1]
~~~

## An entry point that names the module and not the function

`[project.scripts]` maps a command to `module:function`. This one gives only the module, so there is nothing to call.

@expect raises:ValueError
@hint The value has two halves. What separates them, and what is each for?
@hint Installing the package builds a script that imports one and calls the other.
@diagnose ValueError Splitting on `:` gave one piece where two were needed. An entry point is written `package.module:function`, and installing the package generates a small executable that imports the module and calls the function. That is the entire mechanism behind every command-line tool you have installed with pip, and it is worth knowing because the failure mode is so specific: get the left half wrong and the command fails with an `ImportError` mentioning a module the user has never heard of; get the right half wrong and it fails with an `AttributeError` at the moment they run it, not at the moment they install it.

~~~starter
def resolve_script(spec, modules):
    """Turn a `module:function` entry point into the callable it names."""
    module_name, function_name = spec.split(":")
    return modules[module_name][function_name]


SCRIPTS = {"myapp": "myapp.cli"}
MODULES = {"myapp.cli": {"main": lambda: "ran"}}

print(resolve_script(SCRIPTS["myapp"], MODULES))
~~~

~~~tests
assert resolve_script("myapp.cli:main", MODULES)() == "ran"
assert SCRIPTS["myapp"] == "myapp.cli:main", f"the entry point is {SCRIPTS['myapp']!r}"
assert resolve_script(SCRIPTS["myapp"], MODULES)() == "ran"
~~~

~~~solution
def resolve_script(spec, modules):
    """Turn a `module:function` entry point into the callable it names."""
    module_name, function_name = spec.split(":")
    return modules[module_name][function_name]


SCRIPTS = {"myapp": "myapp.cli:main"}
MODULES = {"myapp.cli": {"main": lambda: "ran"}}

print(resolve_script(SCRIPTS["myapp"], MODULES))
~~~

## A library that pinned its dependencies

`LIBRARY` declares exact versions. A library's pins become constraints on everybody who depends on it, and two libraries pinning the same third package differently cannot be installed together.

@expect silent
@hint Who has to live with a library's pins?
@hint The lower bound is where the feature you need arrived. The upper bound needs a reason.
@diagnose silent Nothing raised, and the two libraries could not be installed together, because each pinned a different exact version of `httpx` and no single version satisfies both. This is the packaging decision that is genuinely consequential. A library should specify **loosely**: a lower bound where a feature you use arrived, and an upper bound only where you know something breaks. An application should pin **exactly**, and in a lock file rather than in `pyproject.toml`. Stated once more, because getting it backwards is what causes the pain: `pyproject.toml` says what you can work with, and the lock file says what you did.

~~~starter
LIBRARY = {"name": "mylib", "dependencies": ["httpx==0.27.1", "rich==13.7.0"]}
OTHER = {"name": "theirlib", "dependencies": ["httpx==0.28.0"]}


def resolvable(*packages):
    """Whether these packages can be installed together."""
    wanted: dict[str, set[str]] = {}
    for package in packages:
        for spec in package["dependencies"]:
            if "==" in spec:
                name, version = spec.split("==")
                wanted.setdefault(name, set()).add(version)
    return all(len(versions) == 1 for versions in wanted.values())
~~~

~~~tests
assert resolvable(LIBRARY, OTHER), (
    "a library pinning exact versions cannot coexist with another that pins differently"
)
assert LIBRARY["dependencies"] == ["httpx>=0.27", "rich>=13"]
~~~

~~~solution
LIBRARY = {"name": "mylib", "dependencies": ["httpx>=0.27", "rich>=13"]}
OTHER = {"name": "theirlib", "dependencies": ["httpx==0.28.0"]}


def resolvable(*packages):
    """Whether these packages can be installed together."""
    wanted: dict[str, set[str]] = {}
    for package in packages:
        for spec in package["dependencies"]:
            if "==" in spec:
                name, version = spec.split("==")
                wanted.setdefault(name, set()).add(version)
    return all(len(versions) == 1 for versions in wanted.values())
~~~

## A version number kept in two places

`__version__` is written into the module by hand and `pyproject.toml` has its own. They have drifted, and nothing was going to notice.

@expect silent
@hint One of the two is the real one. Which does an installer read?
@hint `importlib.metadata.version` asks the installed metadata rather than the source.
@diagnose silent Nothing raised, and the module reported a version the project had moved past. A version number written in two places is a version number that will disagree with itself, and the disagreement is silent because nothing compares them: the installer reads `pyproject.toml`, and your logs, your user agent and your bug reports read `__version__`. `importlib.metadata.version("myapp")` asks the installed package's metadata, which means one number, in one file, read wherever it is needed. The equivalent habit for a project that must keep `__version__` is a test asserting the two agree, which is three lines and closes the gap permanently.

~~~starter
with open("pyproject.toml", "w") as f:
    f.write('[project]\nname = "myapp"\nversion = "0.2.0"\n')

__version__ = "0.1.0"


def declared_version():
    """The version this package reports."""
    return __version__
~~~

~~~tests
import tomllib

with open("pyproject.toml", "rb") as f:
    packaged = tomllib.load(f)["project"]["version"]

assert declared_version() == packaged, (
    f"the module says {declared_version()} and pyproject.toml says {packaged}"
)
~~~

~~~solution
import tomllib

with open("pyproject.toml", "w") as f:
    f.write('[project]\nname = "myapp"\nversion = "0.2.0"\n')


def declared_version():
    """The version this package reports, read from the one place it is written."""
    with open("pyproject.toml", "rb") as f:
        return tomllib.load(f)["project"]["version"]
~~~

## A lock file that recorded only the direct dependencies

`lock` records what the project asked for and not what that pulled in. A lock file that omits transitive dependencies does not lock anything.

@expect silent
@hint Which packages actually get installed: the ones you named, or those and everything they need?
@hint The recorded set has to be closed: every dependency of everything in it is also in it.
@diagnose silent Nothing raised, and the lock file recorded two packages where five would be installed. A lock file exists to make two installations identical, which means it has to record the **entire resolved set**: every direct dependency, every transitive one, each at one version. Recording only what you named leaves the resolver free to pick different versions of everything underneath, which is precisely the variation the file was meant to remove. Three things follow that are worth having straight: a lock file is committed, because one nobody shares locks nothing; it is generated and never hand-edited; and a change to it is a reviewable event, because a transitive dependency jumping two major versions is exactly what somebody should see before it ships.

~~~starter
REGISTRY = {
    "httpx": ["httpcore", "certifi"],
    "httpcore": ["h11"],
    "certifi": [],
    "h11": [],
    "rich": [],
}


def lock(direct):
    """Every package that will be installed, given these direct dependencies."""
    return sorted(direct)
~~~

~~~tests
assert lock(["httpx"]) == ["certifi", "h11", "httpcore", "httpx"], f"got {lock(['httpx'])}"
assert lock(["rich"]) == ["rich"]
assert lock(["httpx", "rich"]) == ["certifi", "h11", "httpcore", "httpx", "rich"]
assert lock([]) == []
~~~

~~~solution
REGISTRY = {
    "httpx": ["httpcore", "certifi"],
    "httpcore": ["h11"],
    "certifi": [],
    "h11": [],
    "rich": [],
}


def lock(direct):
    """Every package that will be installed, given these direct dependencies."""
    resolved: set[str] = set()
    pending = list(direct)
    while pending:
        name = pending.pop()
        if name in resolved:
            continue
        resolved.add(name)
        pending.extend(REGISTRY[name])
    return sorted(resolved)
~~~
