---
slug: 29-modules
---

## Cached one line too late

`load` is a small import system. It executes a module and then records it, so two modules that import each other never stop.

@expect raises:RecursionError
@hint Follow `a` importing `b` importing `a`. When is `a` recorded?
@hint Real `import` puts the module in `sys.modules` before running its code, not after.
@diagnose RecursionError Loading `a` starts executing it, `a` loads `b`, `b` loads `a`, and `a` is still not recorded, so it starts again. This is exactly why the real import system puts the module object in `sys.modules` **before** executing the code rather than after: with the entry in place, the second load finds it and returns a half-built module rather than recursing. That half-built module is the whole explanation for circular imports, and it is why the error you get from one is `cannot import name X from partially initialized module` rather than a hang. Moving one line up turns an infinite loop into a defined behaviour you can reason about.

~~~starter
SOURCES = {
    "a": "b = load('b')\nNAME = 'a'\n",
    "b": "a = load('a')\nNAME = 'b'\n",
}
MODULES: dict[str, dict] = {}


def load(name):
    """Execute a module once and return its namespace."""
    if name in MODULES:
        return MODULES[name]
    module = {"__name__": name, "load": load}
    exec(SOURCES[name], module)
    MODULES[name] = module
    return module
~~~

~~~tests
a = load("a")
assert a["NAME"] == "a"
assert a["b"]["NAME"] == "b"
# b saw a while a was still being built, so a had no NAME yet
assert "NAME" not in a["b"]["a"] or a["b"]["a"] is a
~~~

~~~solution
SOURCES = {
    "a": "b = load('b')\nNAME = 'a'\n",
    "b": "a = load('a')\nNAME = 'b'\n",
}
MODULES: dict[str, dict] = {}


def load(name):
    """Execute a module once and return its namespace."""
    if name in MODULES:
        return MODULES[name]
    module = {"__name__": name, "load": load}
    MODULES[name] = module
    exec(SOURCES[name], module)
    return module
~~~

## A module executed once per import

`load` builds a module and records it, and never looks at the record. Every import runs the module's code again.

@expect silent
@hint Step one of a real import is a dict lookup. Which dict, and where in this function?
@hint The module is put in `sys.modules`. Nothing reads it back.
@diagnose silent Nothing raised, and the module's top-level code ran three times. A module is executed **once per process**, no matter how many files import it, and that is not an optimisation: module-level state, a connection, a registry, a counter, would otherwise exist several times over with different contents. Checking `sys.modules` first is the whole of the mechanism, and it is also why `importlib.reload` has to exist as a separate function, and why editing a file has no effect on a running program.

~~~starter
import sys
import types

LOADED: list[str] = []
SOURCE = "import sys\nsys.modules['tally'].__dict__['LOADED'].append('ran')\n"


def load(name):
    """Import a module by name, executing it at most once."""
    module = types.ModuleType(name)
    module.LOADED = LOADED
    sys.modules[name] = module
    exec(SOURCE, module.__dict__)
    return module
~~~

~~~tests
load("tally")
load("tally")
load("tally")
assert LOADED == ["ran"], f"the module ran {len(LOADED)} times"
~~~

~~~solution
import sys
import types

LOADED: list[str] = []
SOURCE = "import sys\nsys.modules['tally'].__dict__['LOADED'].append('ran')\n"


def load(name):
    """Import a module by name, executing it at most once."""
    if name in sys.modules:
        return sys.modules[name]
    module = types.ModuleType(name)
    module.LOADED = LOADED
    sys.modules[name] = module
    exec(SOURCE, module.__dict__)
    return module
~~~

## A value copied at import time

`from config import TIMEOUT` binds the number, not the module. Changing the setting later changes the module and not the name that was copied out of it.

@expect silent
@hint What does `from x import y` bind: a reference to the module, or the value `y` had at that moment?
@hint The fix changes the import, not the function.
@diagnose silent Nothing raised, and raising the timeout had no effect. `from config import TIMEOUT` takes the value the name held **at import time** and binds it in this module's namespace; the two names then have nothing to do with each other. `import config` followed by `config.TIMEOUT` looks the attribute up on each read, so it sees the current value. The same fact explains why patching in tests so often appears to do nothing, and it is the reason the advice is to patch where a name is *used* rather than where it is defined: the used name is the copy, and the copy is what the code reads.

~~~starter
import sys
import types

config = types.ModuleType("config")
exec("TIMEOUT = 30\n", config.__dict__)
sys.modules["config"] = config

# exactly what `from config import TIMEOUT` binds: the value, right now
TIMEOUT = config.TIMEOUT


def connect():
    """Connect, waiting up to the configured timeout."""
    return f"waiting {TIMEOUT}s"
~~~

~~~tests
assert connect() == "waiting 30s"

exec("TIMEOUT = 60\n", sys.modules["config"].__dict__)
assert connect() == "waiting 60s", f"after raising the setting, {connect()!r}"
~~~

~~~solution
import sys
import types

config = types.ModuleType("config")
exec("TIMEOUT = 30\n", config.__dict__)
sys.modules["config"] = config


def connect():
    """Connect, waiting up to the configured timeout."""
    return f"waiting {config.TIMEOUT}s"
~~~

## An import the run time never made

The import sits under `if TYPE_CHECKING:`, so it never happens when the program runs. That is fine until something reads the annotations, which forces them to be evaluated.

@expect raises:NameError
@hint Annotations are lazy on this version. What makes one get evaluated anyway?
@hint `TYPE_CHECKING` is `False` at run time. So what is `Decimal` bound to?
@diagnose NameError `TYPE_CHECKING` is `False` when the program runs, so the import inside it never happened and `Decimal` is not a name in this module. Since 3.14 annotations are evaluated lazily, which is why the `def` itself was fine and why the failure waits until something reads them. `typing.get_type_hints` is that something, and so are `dataclasses`, pydantic, a dependency injector and anything else that turns annotations into behaviour. The rule that follows is worth stating plainly: guard an import with `TYPE_CHECKING` only when nothing will read the annotation at run time. The moment something does, the import has to be real, and the payoff of the guard, breaking a cycle or skipping an expensive module, is gone.

~~~starter
from typing import TYPE_CHECKING, get_type_hints

if TYPE_CHECKING:
    from decimal import Decimal


def charge(amount: Decimal, note: str) -> str:
    """Record a charge."""
    return f"{note}: {amount}"


def parameter_types(func):
    """Report a function's parameter types, the way a container would."""
    hints = get_type_hints(func)
    return {name: cls.__name__ for name, cls in hints.items() if name != "return"}


print(parameter_types(charge))
~~~

~~~tests
from decimal import Decimal

assert charge(Decimal("1.50"), "coffee") == "coffee: 1.50"
assert parameter_types(charge) == {"amount": "Decimal", "note": "str"}
~~~

~~~solution
from decimal import Decimal
from typing import get_type_hints


def charge(amount: Decimal, note: str) -> str:
    """Record a charge."""
    return f"{note}: {amount}"


def parameter_types(func):
    """Report a function's parameter types, the way a container would."""
    hints = get_type_hints(func)
    return {name: cls.__name__ for name, cls in hints.items() if name != "return"}


print(parameter_types(charge))
~~~

## A public surface that names the wrong things

`__all__` declares what `from helpers import *` provides. It lists a name the module does not define and omits one it does.

@expect silent
@hint `__all__` is checked against what the module actually has, but only when `import *` runs.
@hint Compare the list against the `def` statements one at a time.
@diagnose silent Nothing raised, and the star import brought in the wrong set: the private helper came along and the public one did not. `__all__` is a list of strings naming a module's public surface, and it controls exactly what `import *` binds; without it, `import *` takes everything not starting with an underscore. Nothing checks `__all__` against reality until an `import *` actually runs, and a name in it that the module does not define raises `AttributeError` at that moment, which is a long way from the typo. Linters do check it, which is one of three good reasons to write one in a package's `__init__.py`: it controls the star import, it tells a reader what is meant to be used, and it can be verified.

~~~starter
import sys
import types

helpers = types.ModuleType("helpers")
exec(
    "__all__ = ['tidy', '_scrub']\n"
    "def tidy(s):\n    return s.strip()\n"
    "def shout(s):\n    return s.upper()\n"
    "def _scrub(s):\n    return s.replace('!', '')\n",
    helpers.__dict__,
)
sys.modules["helpers"] = helpers


def star_import_names():
    """The names `from helpers import *` would bind."""
    namespace: dict = {}
    exec("from helpers import *", namespace)
    return sorted(n for n in namespace if not n.startswith("__"))
~~~

~~~tests
assert star_import_names() == ["shout", "tidy"], f"got {star_import_names()}"
~~~

~~~solution
import sys
import types

helpers = types.ModuleType("helpers")
exec(
    "__all__ = ['tidy', 'shout']\n"
    "def tidy(s):\n    return s.strip()\n"
    "def shout(s):\n    return s.upper()\n"
    "def _scrub(s):\n    return s.replace('!', '')\n",
    helpers.__dict__,
)
sys.modules["helpers"] = helpers


def star_import_names():
    """The names `from helpers import *` would bind."""
    namespace: dict = {}
    exec("from helpers import *", namespace)
    return sorted(n for n in namespace if not n.startswith("__"))
~~~

## Reloaded, and still holding the old one

`refresh` reloads the settings module and the caller keeps reading the function it grabbed before. Reload replaces the module's contents; it cannot reach names that were already copied out.

@expect silent
@hint What does the caller hold: the module, or something taken out of it?
@hint This is the same fact as the timeout exercise, in a different disguise.
@diagnose silent Nothing raised, and the reloaded value never appeared, because `handler` was bound to the function object before the reload and still refers to it. `importlib.reload` re-executes a module's code into the **same module object**, so anything reaching the module by attribute sees the new contents and anything holding a direct reference to an old object keeps it. That is the same distinction as `from x import y` against `import x`, which is why both appear in this unit. Reload is genuinely useful at a REPL and is not a general-purpose fix, precisely because you can never be sure what else in the process is still holding an old object.

~~~starter
import sys
import types

settings = types.ModuleType("settings")
exec("def greeting():\n    return 'hello'\n", settings.__dict__)
sys.modules["settings"] = settings

handler = settings.greeting


def greet():
    """Greet, using the current setting."""
    return handler()
~~~

~~~tests
assert greet() == "hello"

exec("def greeting():\n    return 'goodbye'\n", sys.modules["settings"].__dict__)
assert greet() == "goodbye", f"after the module changed, {greet()!r}"
~~~

~~~solution
import sys
import types

settings = types.ModuleType("settings")
exec("def greeting():\n    return 'hello'\n", settings.__dict__)
sys.modules["settings"] = settings


def greet():
    """Greet, using the current setting."""
    return settings.greeting()
~~~

## Work done for everyone who imports it

The module opens its report file at the top level, so importing it for one function opens a file. The hidden tests import it and look.

@expect silent
@hint Everything at module level runs on import, not only a call at the bottom.
@hint Put the work in a function and let whoever needs it call it.
@diagnose silent Nothing raised, and importing the module for one pure function had already opened a handle. Unit 00's `__main__` guard covers a bare call at the bottom; this is the wider version of the same rule, because **everything** at module level runs on import, including an assignment whose right-hand side does work. A module that only defines things is fast, safe to import from anywhere, and impossible to break with an ordering problem. One that opens a connection, reads a file or starts a thread has made every importer pay for it, made import order significant, and turned a circular import from awkward into fatal.

~~~starter
OPENED: list[str] = []


def open_report():
    OPENED.append("report.txt")
    return "handle"


REPORT = open_report()


def summarise(rows):
    """A pure function that has nothing to do with the report file."""
    return f"{len(rows)} rows"
~~~

~~~tests
imported = _ph_import()
assert imported["OPENED"] == [], f"importing the module already opened {imported['OPENED']}"
assert imported["summarise"]([1, 2]) == "2 rows"
assert imported["report"]() == "handle"
assert imported["OPENED"] == ["report.txt"], "asking for the report should open it"
~~~

~~~solution
OPENED: list[str] = []


def open_report():
    OPENED.append("report.txt")
    return "handle"


def report():
    """Open the report file, when somebody actually wants it."""
    return open_report()


def summarise(rows):
    """A pure function that has nothing to do with the report file."""
    return f"{len(rows)} rows"
~~~

## A file named after something importable

A module called `json` sits earlier on the path than the standard library's, so `import json` finds it and nothing it provides is there.

@expect raises:AttributeError
@hint The error says the module has no such function. Ask which file you actually got.
@hint `module.__file__` and `module.__name__` settle it in one line.
@diagnose AttributeError `import json` found a different `json` first and bound it, so the standard library's `loads` was never in reach. In a real project this is a file called `json.py` in the directory you ran from, because the first entry on `sys.path` is the script's own directory and it comes before everything installed. The same trap is waiting behind `random.py`, `types.py`, `string.py`, `email.py` and `test.py`, and the error always arrives somewhere else entirely as a missing attribute. Two habits close it permanently: never name a file after anything importable, and when an import behaves impossibly, print `module.__file__` and find out what you actually got.

~~~starter
import importlib
import sys
import types

# a file called json.py sits in the project directory, earlier on sys.path
shadow = types.ModuleType("json")
shadow.__file__ = "/app/json.py"
exec("def dumps(obj):\n    return 'not really json'\n", shadow.__dict__)
sys.modules["json"] = shadow

json = importlib.import_module("json")


def encode(rows):
    """Turn rows into a JSON string."""
    return json.dumps(rows)


def decode(text):
    """Read rows back from a JSON string."""
    return json.loads(text)


print(decode("[1, 2]"))
~~~

~~~tests
assert decode("[1, 2]") == [1, 2]
assert encode([1, 2]) == "[1, 2]"
~~~

~~~solution
import importlib
import sys
import types

# a file called json.py sits in the project directory, earlier on sys.path
shadow = types.ModuleType("json")
shadow.__file__ = "/app/json.py"
exec("def dumps(obj):\n    return 'not really json'\n", shadow.__dict__)
sys.modules["json"] = shadow

# the shadowing file has to go; nothing else fixes this
del sys.modules["json"]

json = importlib.import_module("json")


def encode(rows):
    """Turn rows into a JSON string."""
    return json.dumps(rows)


def decode(text):
    """Read rows back from a JSON string."""
    return json.loads(text)


print(decode("[1, 2]"))
~~~
