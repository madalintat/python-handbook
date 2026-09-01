---
slug: 00-toolchain
title: The toolchain
---

You type `python app.py` and something happens. This unit is about what.

Not because you need it on day one. You can write working Python knowing none of it, but because almost every confusing thing later in this book becomes obvious the moment you know that Python compiles your source before running it, and that you can read what it produced.

## Python is compiled. It just does not tell you.

The folklore is that Python is an interpreted language and C is a compiled one. That is not quite wrong but it is unhelpful, because it suggests Python reads your source a line at a time and does what each line says. It does not.

When you run a file, CPython reads the whole thing, parses it into a syntax tree, and compiles that tree into **bytecode**: a flat sequence of instructions for a stack machine that does not exist in hardware. Only then does it start executing, and what it executes is the bytecode, never your text.

The compile step is real, and it is strict about exactly one thing: syntax. This is why a syntax error on the last line of a two-thousand-line file stops the first line from running. Nothing ran. The file never became bytecode, so there was nothing to run.

```python
print("this never appears")
def broken(:
    pass
```

Every other kind of mistake (a misspelled name, a wrong type, dividing by zero) compiles perfectly well and fails later, when that instruction is reached. That single distinction explains why Python catches so little before running, and it is the gap the other two judges in this book exist to close.

## You can read the bytecode

`dis` prints it, and it settles arguments that prose cannot.

```python
import dis

def add(a, b):
    return a + b

dis.dis(add)
```

You get something close to:

```
  LOAD_FAST   a
  LOAD_FAST   b
  BINARY_OP   + 
  RETURN_VALUE
```

Four instructions. Push `a`, push `b`, add the top two, return. Everything in Python is built out of a few dozen operations like these, and when you cannot work out what a line does, disassembling it is faster than arguing about it.

It is also how you catch the compiler doing work on your behalf. Compile `2 ** 10` and there is no exponentiation instruction at all, just `LOAD_CONST 1024`. The compiler folded the constant while building the bytecode, because both operands were known and would never change. That is a real optimisation pass, in a language people describe as not having a compiler.

## The `.pyc` and the directory you did not ask for

Compiling takes time, and for an imported module that time would be paid on every single run. So CPython caches the result: the first time you import `helpers.py`, it writes the compiled bytecode to `__pycache__/helpers.cpython-314.pyc` and on later runs it loads that instead, provided the source has not changed.

Three things follow, and each surprises somebody:

The directory appears without being asked for, contains no source, and belongs in `.gitignore`. The filename carries the interpreter version because bytecode is not portable between Python versions: a `.pyc` from 3.12 means nothing to 3.14. And the file you run directly is never cached, only the ones you import; a script has nothing to gain, because it is compiled once and then the process ends.

If a stale `.pyc` ever seems to be haunting you, delete the directory. It is a cache and nothing is lost.

## The REPL is an instrument

Typing `python` with no arguments gives you a prompt that evaluates one thing at a time and prints the result. Treat that as a measuring instrument rather than a toy, because most questions in this book are one line away from an answer:

```python
>>> type(3 / 1)
<class 'float'>
>>> [] == []
True
>>> [] is []
False
>>> import sys; sys.getsizeof([])
56
```

Four questions that would take a paragraph to argue about, settled in four lines. `dir(x)` lists what an object can do, `help(x)` prints its documentation, and `_` holds the last result. The habit of checking rather than assuming is worth more than any single fact in this unit.

## One environment per project

Python installs libraries into a directory shared by everything on the machine. That is fine until two projects want different versions of the same library, at which point one of them breaks and the other one is about to.

A **virtual environment** is the fix: a directory holding its own copy of the interpreter's library path, so installs land there instead of system-wide. Every project gets one, without exception, and it is never committed.

The modern tool is `uv`, which is a package manager and environment manager that is fast enough that you stop thinking about it:

```sh
uv init myproject        # a project with a pyproject.toml
uv add httpx             # install into this project's environment
uv run app.py            # run inside it, creating it if needed
```

`pip` and `venv` do the same job and are what you will meet in older codebases. Unit 30 takes packaging apart properly. For now the rule is simply that a project owns its dependencies, and if you are installing libraries with no environment active you are building something that only works on your laptop.

## Two numbers, and what they promise

`python --version` gives something like `3.14.2`. The first two numbers are what matter. A minor version bump, 3.13 to 3.14, may add syntax, change performance characteristics, and remove things deprecated several versions earlier. The third number is bug fixes only and never changes behaviour you were relying on.

This book is written against 3.14, and where a feature is newer than 3.9 the unit says so. Two changes worth knowing about now: dictionaries have preserved insertion order as a language guarantee since 3.7, and since 3.13 there is an official build of CPython with no global interpreter lock, which unit 33 will get into properly.

One trap, since it costs people an afternoon roughly once: version numbers are not strings.

```python
>>> "3.9" < "3.10"
False
```

Compared as text, `"3.9"` sorts after `"3.10"` because `9` comes after `1`. Compare the parts as numbers, or use the tuple the interpreter already provides:

```python
>>> import sys
>>> sys.version_info >= (3, 10)
True
```

## What happens before your first line

`python app.py` does a surprising amount of work before it reaches anything you wrote.

It locates the interpreter, initialises it, and builds `sys.path`, the list of directories that imports are searched in, in order. The first entry is the directory containing the script you ran, which is the single most useful fact about the import system and the cause of its most common bug: a file of your own named `random.py` or `json.py` sitting next to your script will be found *before* the standard library, and everything that imports it gets yours instead.

Then it creates a module object for your file, sets its `__name__` to the string `"__main__"`, compiles the source, and executes the resulting bytecode from top to bottom in that module's namespace. A `def` statement is not a declaration processed ahead of time; it is an instruction that runs when reached, building a function object and binding a name to it. This is why you cannot call a function defined further down the file from code at the top: at that moment the name does not exist yet.

That `__name__` detail is the whole reason for the line everybody copies without reading:

```python
if __name__ == "__main__":
    main()
```

Run the file directly and `__name__` is `"__main__"`, so `main()` runs. Import the same file from somewhere else and `__name__` is the module's own name instead, so it does not. One file, two behaviours, and the guard is what separates a library you can import from a script that does something the moment you touch it.

## Two arithmetic surprises, up front

Both of these catch people in their first week, and both are the runtime doing exactly what it was specified to do.

`round(0.5)` is `0`, and `round(1.5)` is `2`. Python rounds a value exactly between two integers to the **even** one, which is called banker's rounding. Rounding halves consistently upward biases the total of a long column of numbers upward; going to even cancels out. It is the right default and the wrong behaviour for a function documented to round halves up, which therefore has to implement that itself.

`0.1 + 0.2 == 0.3` is `False`. A `float` is a binary fraction, and one tenth has no exact binary form any more than one third has an exact decimal one, so the sum is `0.30000000000000004`. This is IEEE 754 and every language with floats has it. Compare with `math.isclose`, and for money do not use floats at all. Use `decimal.Decimal`, or count in whole pennies and divide only when you print.

## Reading what went wrong

When something does fail, Python prints a traceback: the chain of calls that were in progress when the exception was raised, oldest first, with the exception itself on the last line.

Read the last line first. It tells you what went wrong and is almost always the sentence you need. Then read upward through the frames to find the last one that is code you wrote, in a stack that goes ten frames deep into a library, that line is where your part of the mistake lives.

The temptation, faced with forty lines of traceback, is to skim it and start guessing. Guessing costs more than reading. Unit 38 makes this a proper skill and covers the cases where the useful information is genuinely buried, but the two-step version (bottom line for what, your own frame for where) resolves most of them.

## What to carry forward

Your source is compiled to bytecode before anything runs, so syntax errors stop the whole file while every other error waits until its line is reached. `dis` shows you what the compiler produced, and it is the fastest way to end a disagreement. `__pycache__` is a cache, tied to the interpreter version, safe to delete. Every project gets its own environment. And the REPL is there to be asked.

The rest of this book leans on the first of those more than anything else. Python will happily compile and run something that makes no sense, so knowing what it is really doing is not a nicety. It is the skill the rest of the language rests on.
