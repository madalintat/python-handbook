---
slug: 30-packaging
---

## The two questions behind almost every packaging problem are
- (x) Which Python is running, and what can it import
- ( ) Which version, and which platform
- ( ) pip or uv
- ( ) Wheel or sdist
> `sys.executable` and `module.__file__` answer them in one line each.

## A virtual environment is
- (x) A directory with its own `site-packages` and its own `python`
- ( ) A container
- ( ) A copy of the standard library
- ( ) A `PATH` setting
> Activating just puts its `bin` first on `PATH`, which is why `which python` tells you whether it worked.

## `python -m pip install x` is preferable to `pip install x` because
- (x) It installs into the interpreter you named rather than whichever `pip` the shell found
- ( ) It is faster
- ( ) It resolves better
- ( ) It works without activation
> That one habit prevents most "but I installed it" conversations.

## `[project.scripts]` in `pyproject.toml`
- (x) Creates an executable that imports a module and calls a function, written `module:function`
- ( ) Lists scripts to run at install time
- ( ) Declares test commands
- ( ) Is a build hook
> The entire mechanism behind every command-line tool you have installed with pip.

## A **library** should specify its dependencies
- (x) Loosely: a lower bound where a feature arrived, an upper bound only where something breaks
- ( ) Exactly, for reproducibility
- ( ) With `~=` on everything
- ( ) Without versions at all
> Every pin is a constraint on everybody who depends on you, and two libraries pinning a third differently cannot coexist.

## An **application** should pin exactly
- (x) In a lock file, not in `pyproject.toml`
- ( ) In `pyproject.toml`
- ( ) In both
- ( ) In neither; use the latest
> `pyproject.toml` says what you can work with; the lock file says what you did.

## A lock file records
- (x) Every direct and transitive dependency at one version, and is committed and generated
- ( ) The direct dependencies
- ( ) The Python version
- ( ) What you edit when you upgrade
> Recording only what you named leaves the resolver free to pick differently underneath.

## `"1.10" < "1.9"` is
- (x) `True`, because strings compare character by character
- ( ) `False`
- ( ) A `TypeError`
- ( ) Undefined
> Completely silent until a version reaches ten. Compare tuples of integers, or use `packaging.version`.

## `1.0.0rc1` sorts
- (x) Before `1.0.0`
- ( ) After `1.0.0`
- ( ) Equal to `1.0.0`
- ( ) After `1.0.1`
> A release candidate is a candidate for a release, so it comes first.

## `~=1.4.2` means
- (x) At least 1.4.2, and not past 1.5
- ( ) Exactly 1.4.2
- ( ) Approximately 1.4
- ( ) At least 1.4.2, any version above
> The same as `>=1.4.2,<1.5.0`, which is the constraint people keep writing at length.

## Under semantic versioning, `0.x`
- (x) May break in any release, which is why an upper bound on one is more defensible
- ( ) Follows the same rules as `1.x`
- ( ) Cannot be published
- ( ) Means pre-release
> The exception everybody forgets.

## `tomllib.load` requires
- (x) A binary file object, because TOML is defined as UTF-8 and it decodes the bytes itself
- ( ) A text file object
- ( ) A path
- ( ) A string
> `tomllib.loads` takes a string. There is no `dump`: the standard library reads TOML and does not write it.

## A wheel against an sdist
- (x) A wheel is built and installing it is copying; an sdist runs the build backend on the user's machine
- ( ) A wheel is compressed and an sdist is not
- ( ) A wheel is for binaries only
- ( ) They are the same format
> `python -m build` produces both. Publish wheels.

## The src layout catches
- (x) A release missing a subpackage, because the package is not importable until installed
- ( ) Circular imports
- ( ) Version drift
- ( ) Missing type stubs
> With a flat layout your tests import the source tree rather than the thing you built.

## `importlib.metadata.version("myapp")` is preferable to a hand-written `__version__` because
- (x) There is then one version number, in `pyproject.toml`, rather than two that drift
- ( ) It is faster
- ( ) `__version__` is deprecated
- ( ) It works without installing
> A project that must keep `__version__` should have a three-line test asserting the two agree.
