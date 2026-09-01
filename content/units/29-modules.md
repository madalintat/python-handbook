---
slug: 29-modules
title: Modules, packages, imports
---

Import errors are the ones that make people delete their virtual environment and start again. They do not need to be. The import system is small, entirely inspectable, and every error it produces names exactly what went wrong once you know what the words mean.

## What `import` does

`import json` does four things, in order.

It checks `sys.modules`, a dict of everything already imported, and if the name is there it binds it and stops. **A module is executed once per process, no matter how many files import it.**

If it is not there, it searches `sys.path`, a list of directories, in order, taking the first match.

It executes the module's code, top to bottom, in a fresh namespace, and puts the resulting module object in `sys.modules` **before** the code finishes.

It binds the name in your namespace.

Almost every confusing import problem is one of those four steps doing exactly what it says. The module you did not expect was already in `sys.modules`, or `sys.path` found a different file first, or the code at the top ran and did something, or the module object was in `sys.modules` while still half-built.

## `sys.path`, and the file you did not mean

`sys.path` is built from the directory of the script being run (or the current directory for `-c` and the REPL), then `PYTHONPATH`, then the installation's directories including `site-packages`.

The first entry is the one that causes trouble. A file called `random.py` in your project directory shadows the standard library's `random` for every module in that program, and the error arrives somewhere else entirely, as an `AttributeError` for a function your file does not have. The same goes for `types.py`, `string.py`, `email.py`, `test.py`.

Two habits avoid this permanently. Do not name a file after anything importable. And when an import behaves impossibly, print `module.__file__` and find out what you actually got.

## Packages

A directory with an `__init__.py` is a package, and importing it runs that file. A directory without one is a **namespace package**, which also works and is a thing to know about mostly because it explains why a typo in a directory name imports successfully and provides nothing.

`__init__.py` should be small. Its job is to define the package's public surface, usually by importing a few names from the modules inside it, and every import in it runs on any import from anywhere in the package. A heavy `__init__.py` is why some libraries take a noticeable moment to import.

Relative imports use dots, and only work inside a package:

```python
from . import sibling
from .models import User
from ..shared import helper
```

The dot means "relative to this package", not "relative to this file", which is why running a file inside a package directly, `python myapp/thing.py`, fails with `ImportError: attempted relative import with no known parent package`. The file was run as a script, so it has no package, so `.` means nothing. `python -m myapp.thing` runs it as a module inside its package and works.

That distinction is worth internalising, because it is the single most common import error in a project laid out correctly. The rule: **`-m` for anything inside a package.**

## `__name__` and `__main__`

Unit 00 introduced `if __name__ == "__main__":` and this is where it stops being a formula.

`__name__` is the module's name, set when it is imported: `"myapp.thing"` for an imported module, and `"__main__"` for whichever file was run. So the guard means "only when this file is the one being run, not when it is imported".

Without it, importing a module for one function also runs whatever else was at the top: a server starts, a file is written, an argument parser reads `sys.argv` and exits. With it, the file is both a script and an importable module, which is the point.

`python -m myapp` runs `myapp/__main__.py`, which is how a package becomes a command.

## Import forms, and what they bind

`import x`, `from x import y` and `import x as z` differ in what ends up in your namespace, and in one case that difference matters.

`import myapp.models` binds the name `myapp`, and you reach the module through it. `from myapp import models` binds `models` directly. `from myapp.models import User` binds `User`, the object, and this is the form with the sharp edge: it takes a **reference to the value at import time**, so if `myapp.models.User` is later reassigned, your name still points at the old one. That is why patching in tests so often fails to take effect, and why the advice is to patch where a name is used rather than where it is defined.

`from x import *` binds everything the module does not consider private, or exactly what `__all__` lists if it defines one. Do not use it outside a REPL: it makes the origin of every name in the file unknowable, and it silently overwrites names from earlier star imports.

`__all__` is a list of strings naming a module's public surface. It controls `import *`, it tells a reader what is meant to be used, and linters check it, which are three good reasons to write one in a package's `__init__.py` and skip it elsewhere.

## Circular imports

Two modules importing each other is the error people shuffle code around to escape. It has a mechanical explanation.

Recall step three: the module object goes into `sys.modules` before its code finishes. So if `a.py` imports `b.py`, and `b.py` imports `a.py`, the second import finds a partially built `a` and gets whatever had been defined so far. If `b` needs a name defined below the import line in `a`, you get `ImportError: cannot import name 'Thing' from partially initialized module`, and the message even says "most likely due to a circular import".

Three fixes, in order of preference.

**Restructure.** A cycle usually means the two modules are one concern split in the wrong place, or that a third module should hold what they share. This is the fix that makes the code better rather than the error go away.

**Import inside the function.** Moving the import to where it is used defers it until call time, by which point both modules are fully built. It is legitimate and it is what the standard library does in places, though it hides a dependency from anything reading the imports at the top.

**`if TYPE_CHECKING:`.** When the import exists only for an annotation, guard it: the name is available to the checker and never imported at run time. Since 3.14 annotations are evaluated lazily, so this needs no quoting and no `__future__` import to work.

That last fix has one sharp edge, and it is worth knowing before you reach for it. Lazy does not mean never: anything that **reads** the annotations forces them to be evaluated, and at that moment a name imported only under `TYPE_CHECKING` does not exist. `dataclasses`, pydantic, a dependency injector and `typing.get_type_hints` all do this. So the guard is right when the annotation is only ever read by a checker, and wrong the moment something at run time turns annotations into behaviour.

## Reading an import error

Three messages cover almost everything.

`ModuleNotFoundError: No module named 'x'` means `sys.path` had no `x`. Either it is not installed, or it is installed in a different environment from the one running, which unit 30 is about. `python -c "import sys; print(sys.executable)"` answers the second question faster than anything else.

`ImportError: cannot import name 'y' from 'x'` means `x` was found and has no `y`. A circular import, a typo, or a version of `x` older than the one you are reading about.

`ImportError: attempted relative import with no known parent package` means a file inside a package was run as a script. Use `-m`.

## Where code lives on disk

Two layouts, and the difference is not cosmetic.

The **flat layout** puts the package directly in the project root, so `myapp/` sits next to `pyproject.toml`. The **src layout** puts it in `src/myapp/`.

The src layout is the better default, for one reason that has nothing to do with taste. With a flat layout the package is in the current directory, so it is importable whether or not it is installed, which means your tests are importing the source tree rather than the thing you built. With a src layout it is not importable until installed, so a test run that passes is a statement about the installed package, including whether the packaging configuration remembered to include every file. Unit 30 is where that matters most, and the failure it prevents, a release missing a subpackage that worked perfectly in development, is a genuinely common one.

## The tools

`sys.modules` is an ordinary dict, so `"json" in sys.modules` answers whether something has been imported. `module.__file__` answers which file you got, which settles shadowing questions immediately. `python -v` prints every import as it happens, which is heavy-handed and occasionally exactly what you need. And `importlib.reload(module)` re-executes a module, which is useful at a REPL and is not a general-purpose fix, because existing references to the old objects keep pointing at them.

Between `__file__` and `sys.executable`, the two questions that cause most import confusion, which file and which Python, are one line each.

One last habit is worth adopting because it prevents a whole category rather than diagnosing it: **keep import-time work to a minimum**. A module that only defines things is fast, safe to import from anywhere, and impossible to break with an ordering problem. A module that opens a connection, reads a file or starts a thread at import has made every importer pay for it, made the order of imports significant, and made a circular import fatal rather than merely awkward. Put the work in a function, and let whoever needs it call it.
