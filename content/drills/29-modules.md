---
slug: 29-modules
---

## `import json` first
- (x) Checks `sys.modules`, and stops there if the name is present
- ( ) Searches `sys.path`
- ( ) Reads the file
- ( ) Compiles the module
> Which is why a module is executed once per process, however many files import it.

## The module object goes into `sys.modules`
- (x) Before its code finishes running
- ( ) After its code finishes running
- ( ) Only if the import succeeds
- ( ) When it is first used
> That is the whole explanation for circular imports, and why they give a partially initialized module rather than a hang.

## The first entry on `sys.path` is
- (x) The directory of the script being run
- ( ) `site-packages`
- ( ) The standard library
- ( ) `PYTHONPATH`
> Which is why a file called `random.py` in your project shadows the standard library for the whole program.

## When an import behaves impossibly, the fastest question is
- (x) `print(module.__file__)`
- ( ) `pip list`
- ( ) Delete the virtual environment
- ( ) `python -v`
> And `sys.executable` for the other half: which Python is running.

## A directory with no `__init__.py`
- (x) Is a namespace package, which imports successfully and provides nothing
- ( ) Cannot be imported
- ( ) Raises `ImportError`
- ( ) Is treated as a plain directory
> Which is why a typo in a directory name imports fine and then has nothing in it.

## `from .models import User` in a file run as `python myapp/thing.py`
- (x) Fails: the file was run as a script, so it has no package for `.` to mean
- ( ) Works
- ( ) Imports from the current directory
- ( ) Raises `ModuleNotFoundError`
> `python -m myapp.thing` runs it as a module inside its package. Use `-m` for anything inside a package.

## `__name__` is
- (x) `"__main__"` for the file that was run, and the module's own name when imported
- ( ) Always the file name
- ( ) The package name
- ( ) Set by the import system only
> Which is exactly what the guard tests, and why the file can be both a script and a library.

## `from x import y`
- (x) Binds the value `y` had at import time; later reassignment in `x` does not reach it
- ( ) Binds a reference to `x.y`, followed on each read
- ( ) Is identical to `import x`
- ( ) Imports only `y`, not the rest of `x`
> Which is why patching where a name is used works and patching where it is defined often does not.

## `__all__`
- (x) Names a module's public surface and controls exactly what `import *` binds
- ( ) Hides everything else
- ( ) Is checked at import
- ( ) Is required in a package
> A name in it the module does not define raises only when a star import actually runs.

## `ImportError: cannot import name 'Thing' from partially initialized module` means
- (x) A circular import reached a module whose code had not got as far as `Thing`
- ( ) The module is corrupt
- ( ) `Thing` is private
- ( ) Two versions are installed
> Restructure first; import inside the function second; `TYPE_CHECKING` when it is only an annotation.

## An import guarded by `if TYPE_CHECKING:` breaks when
- (x) Something reads the annotations at run time, which forces them to be evaluated
- ( ) The checker runs
- ( ) The module is reloaded
- ( ) Never; it is always safe
> `dataclasses`, pydantic and `typing.get_type_hints` all do this. Lazy does not mean never.

## `importlib.reload(module)`
- (x) Re-executes into the same module object, so anything holding an old object keeps it
- ( ) Replaces every reference to the module's contents
- ( ) Removes the module from `sys.modules`
- ( ) Is how to pick up an edited file in production
> Useful at a REPL, and not a general-purpose fix.

## The src layout is the better default because
- (x) The package is not importable until installed, so tests exercise what you built
- ( ) It is tidier
- ( ) It is required by `pyproject.toml`
- ( ) It speeds up imports
> It catches the release that is missing a subpackage but worked perfectly in development.

## Work at module level, such as opening a connection
- (x) Runs on import, so every importer pays for it and import order becomes significant
- ( ) Runs on first use
- ( ) Runs only when the module is the program
- ( ) Is deferred by the compiler
> A module that only defines things is fast, safe to import anywhere, and impossible to break with ordering.

## `ModuleNotFoundError` most often means
- (x) It is installed in a different environment from the one running
- ( ) The package does not exist
- ( ) A circular import
- ( ) A missing `__init__.py`
> `python -c "import sys; print(sys.executable)"` answers it faster than anything else.
