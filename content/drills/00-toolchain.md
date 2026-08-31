---
slug: 00-toolchain
---

## A file has a syntax error on its last line. What runs?
- (x) Nothing at all
- ( ) Everything up to the broken line
- ( ) Everything except the broken line
- ( ) It depends on whether the error is in a function
> The whole file is compiled to bytecode before anything executes. A syntax error means there is no bytecode, so there is nothing to run.

## A file calls an undefined name on its last line. What runs?
- ( ) Nothing at all
- (x) Everything up to that line, then it fails there
- ( ) Everything, with the bad line skipped
- ( ) It refuses to compile
> Only syntax is checked at compile time. A missing name is discovered when that instruction is reached.

## What does `dis.dis(f)` show you?
- ( ) The C source of the interpreter
- (x) The bytecode instructions the compiler produced for f
- ( ) A profile of where f spends its time
- ( ) The machine code f was compiled to
> Python compiles to bytecode for a stack machine. `dis` prints it, which is the fastest way to settle what a line really does.

## `__pycache__` should be
- ( ) Committed, so builds are reproducible
- (x) Ignored by version control
- ( ) Deleted after every run
- ( ) Edited when you need a fix urgently
> It is a cache of compiled bytecode, tied to one interpreter version. Nothing is lost by deleting it and nothing is gained by committing it.

## Which files get a cached `.pyc`?
- ( ) Every file Python touches
- (x) Modules that are imported, but not the script you ran directly
- ( ) Only files in the standard library
- ( ) Only files larger than a threshold
> The script is compiled once and the process then ends, so caching it would buy nothing. Imported modules are compiled on every run without a cache.

## What is the first entry on `sys.path`?
- (x) The directory containing the script you ran
- ( ) The standard library
- ( ) The active virtual environment
- ( ) The current working directory, always
> Which is why a file of your own named `random.py` beside your script shadows the standard library module of that name.

## When you run a file directly, its `__name__` is
- ( ) The filename without its extension
- (x) `"__main__"`
- ( ) `None`
- ( ) `"__module__"`
> And it is the module's own name when imported instead, which is the entire point of the `if __name__ == "__main__":` guard.

## `"3.9" < "3.10"` evaluates to
- ( ) True
- (x) False
- ( ) It raises
- ( ) It depends on the Python version
> Strings compare character by character, and `9` sorts after `1`. Compare version parts as numbers, or use `sys.version_info`.

## `2 ** 10` in compiled bytecode appears as
- ( ) A call to the pow function
- ( ) A binary power instruction
- (x) The constant 1024
- ( ) A loop of ten multiplications
> The compiler folds constants whose operands are known. Evidence that Python has a real compiler, in a language people describe as not having one.

## What does `4 / 2` return?
- ( ) `2`, an int
- (x) `2.0`, a float
- ( ) `2`, as an int only when the division is exact
- ( ) It depends on `from __future__ import division`
> `/` is always true division in Python 3. `//` is the one that keeps integers integral.

## What happens to `assert` statements under `python -O`?
- ( ) They still run but do not print a message
- (x) They are removed entirely
- ( ) They become warnings
- ( ) Nothing; `-O` only affects imports
> Which is why validating someone else's input with `assert` produces a check that disappears in exactly the deployment you were relying on it in.

## In an f-string, `{value!r}` means
- ( ) Format value as a raw string
- (x) Render value with `repr` rather than `str`
- ( ) Reverse the value
- ( ) Round the value
> `repr` is the unambiguous rendering meant for programmers, which is why `'3'` and `3` stop looking identical in your log lines.

## `round(0.5)` returns
- ( ) `1`
- (x) `0`
- ( ) `0.5`
- ( ) It raises
> Python rounds halves to the nearest even number. Rounding halves consistently upward biases long sums upward; going to even cancels out.

## `0.1 + 0.2 == 0.3` is
- ( ) True
- (x) False
- ( ) True on 64-bit systems only
- ( ) Undefined
> Floats are binary fractions and `0.1` has no exact binary form. Compare with `math.isclose`, or use `decimal.Decimal` for money.

## Why does every project get its own virtual environment?
- ( ) It makes imports faster
- ( ) It is required by `pyproject.toml`
- (x) Because two projects can need different versions of the same library
- ( ) It reduces disk usage
> Without one, installs land in a directory shared by everything on the machine, and the second project to need a different version breaks the first.
