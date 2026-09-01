---
slug: cli-to-pypi
---

## What the file says you are building

A wheel is built from a description, and the description lives in
`pyproject.toml`. Before anything can be packaged, that file has to be read and
believed or rejected, so this is where the tool starts.

`tomllib` has been in the standard library since 3.11, which means reading TOML
needs no dependency at all. What it does not do is tell you whether the table
you got is a project: that part is yours.

The rule for the errors is the one unit 09 made. A build tool that raises
`KeyError: 'name'` at somebody is telling them about its own source code. Every
failure here says which file, what was wrong with it, and enough for the person
to fix it without reading this function.

One subtlety worth catching early. A `dynamic` list means a build backend
computes that field rather than reading it, so a project that declares its
version dynamic and expects this tool to find it should be told plainly that it
will not, rather than shown a missing key.

@goal `load_project` returns a `Project`, or a `ProjectError` that explains itself.

~~~starter
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs."""

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`."""
    raise NotImplementedError
~~~

~~~tests
import os
from pathlib import Path


def write(name, text):
    Path(name).parent.mkdir(parents=True, exist_ok=True)
    Path(name).write_text(text, encoding="utf-8")


write("good/pyproject.toml", """
[project]
name = "pkgit"
version = "0.1.0"
description = "a packaging tool that can package itself"
requires-python = ">=3.11"
dependencies = ["tomli-w>=1.0", "rich"]

[project.scripts]
pkgit = "pkgit.cli:main"
""")

project = load_project("good")
assert project.name == "pkgit"
assert project.version == "0.1.0"
assert project.description == "a packaging tool that can package itself"
assert project.requires_python == ">=3.11"
assert project.dependencies == ["tomli-w>=1.0", "rich"]
assert project.scripts == {"pkgit": "pkgit.cli:main"}
assert project.root == Path("good")

# the smallest file that is still buildable
write("small/pyproject.toml", '[project]\nname = "tiny"\nversion = "1.0"\n')
small = load_project("small")
assert small.name == "tiny" and small.version == "1.0"
assert small.description == "" and small.dependencies == [] and small.scripts == {}

# two Projects made from the same file are equal, because a dataclass says so
assert load_project("small") == load_project("small")
assert load_project("small") != load_project("good")


def refused(root, phrase):
    """The error a bad project gives, checked for saying something useful."""
    try:
        load_project(root)
    except ProjectError as exc:
        assert phrase in str(exc), f"{phrase!r} not in {str(exc)!r}"
        return str(exc)
    raise AssertionError(f"{root} should not have loaded")


os.makedirs("nothing", exist_ok=True)
refused("nothing", "no pyproject.toml")

write("broken/pyproject.toml", "[project\nname = 'x'\n")
refused("broken", "not valid TOML")

write("empty/pyproject.toml", "[build-system]\nrequires = []\n")
refused("empty", "no [project] table")

write("noname/pyproject.toml", '[project]\nversion = "1.0"\n')
refused("noname", "no name")

write("nover/pyproject.toml", '[project]\nname = "x"\n')
refused("nover", "no version")

write("numver/pyproject.toml", '[project]\nname = "x"\nversion = 1\n')
refused("numver", "must be a string")

# dynamic means a backend computes it, and saying so beats a missing key error
write("dyn/pyproject.toml", '[project]\nname = "x"\ndynamic = ["version"]\n')
message = refused("dyn", "dynamic")
assert "version" in message

# the shapes that would break a build later, caught now
write("baddeps/pyproject.toml", '[project]\nname = "x"\nversion = "1"\ndependencies = "rich"\n')
refused("baddeps", "must be a list")

write("baddep/pyproject.toml", '[project]\nname = "x"\nversion = "1"\ndependencies = [1, 2]\n')
refused("baddep", "must be a string")

write("badscript/pyproject.toml", """
[project]
name = "x"
version = "1"
[project.scripts]
run = "pkgit.cli"
""")
refused("badscript", "module:function")

# a table where a string belongs is caught too
write("tablescript/pyproject.toml", """
[project]
name = "x"
version = "1"
[project.scripts.run]
target = "a:b"
""")
refused("tablescript", "module:function")
~~~

~~~solution
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )
~~~

## The command line as something you can test

Now a face for it. `argparse` is in the standard library, it does subcommands,
and it produces the help text without being asked twice, so there is nothing
here that needs a dependency.

Two decisions make the difference between a tool that can be tested and one
that cannot. `main` takes `argv` as a parameter, defaulting to None so that
argparse reads `sys.argv` when a person runs it and a test can hand it a list
instead. And `main` returns an exit code rather than calling `sys.exit`,
because a function that exits the interpreter cannot be called twice in one
test file. Exiting is the caller's job and it is one line, which the next stage
writes.

Printing goes to a file object for the same reason. A test that has to capture
`sys.stdout` is a test that fights the code, and a parameter with a default is
cheaper than a fixture.

The exit codes are a convention worth keeping. Zero worked, one means the
command failed at what it was asked to do, and two means the command line
itself made no sense, which is what argparse already does on its own.

@goal `main` runs a command, prints for a person, and returns an exit code.

~~~starter
import argparse
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running."""
    raise NotImplementedError


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    raise NotImplementedError


COMMANDS = {"info": cmd_info}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants."""
    raise NotImplementedError
~~~

~~~tests
import io
from pathlib import Path


def write(name, text):
    Path(name).parent.mkdir(parents=True, exist_ok=True)
    Path(name).write_text(text, encoding="utf-8")


write("good/pyproject.toml", """
[project]
name = "pkgit"
version = "0.1.0"
description = "a packaging tool"
requires-python = ">=3.11"
dependencies = ["rich"]

[project.scripts]
pkgit = "pkgit.cli:main"
""")

# stage one still holds
assert load_project("good").name == "pkgit"
try:
    load_project("nowhere")
except ProjectError:
    pass
else:
    raise AssertionError("a missing project should still raise")


def run(argv):
    """The exit code and everything printed, which is what a CLI is."""
    out = io.StringIO()
    return main(argv, out), out.getvalue()


code, text = run(["info", "good"])
assert code == 0, text
assert "pkgit" in text
assert "0.1.0" in text
assert "a packaging tool" in text
assert ">=3.11" in text
assert "rich" in text
assert "pkgit.cli:main" in text

# a project with nothing optional prints nothing optional
write("small/pyproject.toml", '[project]\nname = "tiny"\nversion = "1.0"\n')
code, text = run(["info", "small"])
assert code == 0
assert "tiny" in text and "1.0" in text
assert "description" not in text
assert "dependency" not in text

# a bad project is an error the person can read, and a non-zero code
code, text = run(["info", "nowhere"])
assert code == 1, "a failed command should not report success"
assert "pkgit:" in text
assert "no pyproject.toml" in text

# the path argument is optional and defaults to here
Path("pyproject.toml").write_text('[project]\nname = "here"\nversion = "2.0"\n')
code, text = run(["info"])
assert code == 0 and "here" in text

# the parser can be asked what it accepts without anything being run
parser = build_parser()
args = parser.parse_args(["info", "somewhere"])
assert args.command == "info"
assert args.path == "somewhere"
assert parser.parse_args(["info"]).path == "."
assert parser.prog == "pkgit"

# argparse exits with 2 for a command line it cannot make sense of, which is
# the convention every other tool follows
for bad in ([], ["nonsense"], ["info", "a", "b"]):
    try:
        main(bad, io.StringIO())
    except SystemExit as exc:
        assert exc.code == 2, f"{bad} exited {exc.code}"
    else:
        raise AssertionError(f"{bad} should not have run")

# and 0 for the things it handles itself
try:
    main(["--version"], io.StringIO())
except SystemExit as exc:
    assert exc.code == 0
else:
    raise AssertionError("--version should have exited")

assert __version__ in build_parser().format_help() or True
assert "info" in build_parser().format_help()
~~~

~~~solution
import argparse
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


COMMANDS = {"info": cmd_info}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)
~~~

## Two ways to run it, and the line that makes both work

There are two ways somebody runs your tool. `python -m mytool`, which needs a
`__main__.py` inside the package, and `mytool`, which is a small file an
installer puts on the PATH. Both come down to the same three lines, and both
depend on the decision the last stage made.

`__main__.py` carries the guard. Unit 29 was about what it means: a module run
as a program has `__name__` set to "__main__", and a module imported by
something else does not, so the guard is what stops importing your package from
running your program. `sys.exit` around the call is what turns the number
`main` returns into the number the shell sees, which is why `main` returns one.

The console script has no guard, because a script is run and never imported, so
there is nothing for a guard to protect against. Everything else is identical.

Names matter here too. A distribution is named with hyphens and a package is
named with underscores, because a hyphen cannot appear in an identifier. `pip
install my-tool` followed by `import my_tool` is that rule, not a coincidence.

@goal `python -m` on the generated package runs `main` and exits with its code.

~~~starter
import argparse
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


COMMANDS = {"info": cmd_info}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)


def split_entry_point(target):
    """`"module:attribute"` as a pair, or a ProjectError saying what is wrong."""
    raise NotImplementedError


def main_module_source(target):
    """The `__main__.py` that makes `python -m <package>` work."""
    raise NotImplementedError


def console_script_source(target):
    """What an installer writes for a console script, near enough."""
    raise NotImplementedError


def entry_points_metadata(project):
    """The `entry_points.txt` a wheel carries, in the format the spec asks for."""
    raise NotImplementedError


def package_name(project):
    """The importable name for a distribution name."""
    raise NotImplementedError


def scaffold(project, root=None):
    """Write the package layout the project describes. Returns the paths written."""
    raise NotImplementedError
~~~

~~~tests
import importlib
import io
import runpy
import sys
from pathlib import Path


def write(name, text):
    Path(name).parent.mkdir(parents=True, exist_ok=True)
    Path(name).write_text(text, encoding="utf-8")


write("good/pyproject.toml", """
[project]
name = "my-tool"
version = "0.1.0"
[project.scripts]
mytool = "my_tool.cli:main"
zzz = "my_tool.other:run"
""")

# stage two still holds
out = io.StringIO()
assert main(["info", "good"], out) == 0
assert "my-tool" in out.getvalue()

# an entry point splits, and says so when it cannot
assert split_entry_point("my_tool.cli:main") == ("my_tool.cli", "main")
assert split_entry_point("pkg:obj.method") == ("pkg", "obj.method")
for bad in ("my_tool.cli", ":main", "my_tool:", "", "my tool:main", "pkg:1bad"):
    try:
        split_entry_point(bad)
    except ProjectError:
        pass
    else:
        raise AssertionError(f"{bad!r} should not have split")

# a distribution name is hyphens and a package name is underscores, because a
# hyphen cannot appear in an identifier
project = load_project("good")
assert package_name(project) == "my_tool"
assert package_name(Project(name="A.B-C", version="1")) == "a_b_c"

# the generated __main__.py is real Python that says what it means
source = main_module_source("my_tool.cli:main")
compile(source, "__main__.py", "exec")
assert 'if __name__ == "__main__":' in source
assert "sys.exit(main())" in source
assert "from my_tool.cli import main" in source

# a console script is the same without the guard, because it is never imported
script = console_script_source("my_tool.cli:main")
compile(script, "script", "exec")
assert "__name__" not in script, "a script has nothing to guard against"
assert "sys.exit(main())" in script

# entry point metadata is the format the specification asks for, sorted
assert entry_points_metadata(project) == (
    "[console_scripts]\nmytool = my_tool.cli:main\nzzz = my_tool.other:run\n"
)
assert entry_points_metadata(Project(name="x", version="1")) == ""

# scaffolding writes a package that python can actually run
write("demo/pyproject.toml", """
[project]
name = "toy"
version = "3.0"
[project.scripts]
toy = "toy.cli:main"
""")
Path("demo/toy").mkdir(parents=True, exist_ok=True)
write("demo/toy/cli.py", "def main():\n    print('the toy ran')\n    return 7\n")

written = scaffold(load_project("demo"))
assert [p.name for p in written] == ["__init__.py", "__main__.py"], written
assert Path("demo/toy/__init__.py").read_text() == '__version__ = "3.0"\n'

# python -m toy, which is what runpy.run_module is
sys.path.insert(0, "demo")
importlib.invalidate_caches()
try:
    runpy.run_module("toy", run_name="__main__")
except SystemExit as exc:
    assert exc.code == 7, f"the exit code main returned was lost: {exc.code}"
else:
    raise AssertionError("python -m should have exited with what main returned")

# and importing the package does not run it, which is what the guard is for
importlib.invalidate_caches()
toy = importlib.import_module("toy")
assert toy.__version__ == "3.0"

# running it twice does not replace what is there. a generator that silently
# writes a one line stub over somebody's module is a generator nobody can
# safely run a second time
write("demo/toy/__init__.py", "REAL CODE\n")
assert scaffold(load_project("demo")) == [], "there was nothing new to write"
assert Path("demo/toy/__init__.py").read_text() == "REAL CODE\n"

# and force is how a caller says they meant it
forced = scaffold(load_project("demo"), force=True)
assert [x.name for x in forced] == ["__init__.py", "__main__.py"]
assert Path("demo/toy/__init__.py").read_text() == '__version__ = "3.0"\n'

# a project with no scripts still gets a package, with nothing to run
write("bare/pyproject.toml", '[project]\nname = "bare"\nversion = "1"\n')
written = scaffold(load_project("bare"))
assert [p.name for p in written] == ["__init__.py"]
assert not Path("bare/bare/__main__.py").exists()

# scaffolding somewhere else leaves the project alone
write("elsewhere/pyproject.toml", '[project]\nname = "moved"\nversion = "1"\n')
scaffold(load_project("elsewhere"), "built")
assert Path("built/moved/__init__.py").exists()
assert not Path("elsewhere/moved").exists()

# a script that names nothing runnable is refused rather than written
try:
    entry_points_metadata(Project(name="x", version="1", scripts={"a": "no_colon"}))
except ProjectError:
    pass
else:
    raise AssertionError("an unreadable entry point should not be written out")
~~~

~~~solution
import argparse
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


COMMANDS = {"info": cmd_info}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)


MAIN_TEMPLATE = """\
import sys

from {module} import {attribute}

if __name__ == "__main__":
    sys.exit({attribute}())
"""

SCRIPT_TEMPLATE = """\
import sys

from {module} import {attribute}

sys.exit({attribute}())
"""


def split_entry_point(target):
    """`"module:attribute"` as a pair, or a ProjectError saying what is wrong."""
    module, separator, attribute = target.partition(":")
    if not separator or not module or not attribute:
        raise ProjectError(f"{target!r} does not name a function as module:function")
    if not all(part.isidentifier() for part in module.split(".")):
        raise ProjectError(f"{target!r}: {module!r} is not a module path")
    if not all(part.isidentifier() for part in attribute.split(".")):
        raise ProjectError(f"{target!r}: {attribute!r} is not an attribute name")
    return module, attribute


def main_module_source(target):
    """The `__main__.py` that makes `python -m <package>` work.

    Every line earns its place. The guard is unit 29's: a module run as a
    program has `__name__` set to "__main__" and a module imported by something
    else does not, so the import above it costs nothing to whoever imports the
    package. `sys.exit` is what turns the number `main` returns into the number
    the shell sees, which is the reason `main` returns one.
    """
    module, attribute = split_entry_point(target)
    return MAIN_TEMPLATE.format(module=module, attribute=attribute)


def console_script_source(target):
    """What an installer writes for a console script, near enough.

    The `pkgit` command on somebody's PATH is a small Python file that imports
    the function the entry point names and exits with what it returns. The same
    lines as `__main__.py` without the guard, because a script is run and never
    imported, so there is nothing for a guard to protect against.
    """
    module, attribute = split_entry_point(target)
    return SCRIPT_TEMPLATE.format(module=module, attribute=attribute)


def entry_points_metadata(project):
    """The `entry_points.txt` a wheel carries, in the format the spec asks for."""
    if not project.scripts:
        return ""
    lines = ["[console_scripts]"]
    for command, target in sorted(project.scripts.items()):
        split_entry_point(target)
        lines.append(f"{command} = {target}")
    return "\n".join(lines) + "\n"


def package_name(project):
    """The importable name for a distribution name.

    A distribution is named with hyphens and a package is named with
    underscores, because a hyphen is not valid in an identifier. `pip install
    my-tool` then `import my_tool` is this rule and not a coincidence.
    """
    return project.name.replace("-", "_").replace(".", "_").lower()


def scaffold(project, root=None, force=False):
    """Write the package layout the project describes. Returns what it wrote.

    A file that is already there is left alone. The alternative is a generator
    that silently replaces somebody's module with a one line stub the first
    time they run it twice, and `force=True` is how a caller says they meant
    that.
    """
    root = Path(root) if root is not None else project.root
    directory = root / package_name(project)
    directory.mkdir(parents=True, exist_ok=True)

    wanted = [(directory / "__init__.py", f'__version__ = "{project.version}"\n')]
    if project.scripts:
        target = project.scripts[sorted(project.scripts)[0]]
        wanted.append((directory / "__main__.py", main_module_source(target)))

    written = []
    for path, text in wanted:
        if path.exists() and not force:
            continue
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written
~~~

## Versions that sort the way the specification says

`"1.10" < "1.9"` is true for strings and wrong for versions, and a build tool
that gets this wrong resolves the wrong dependency. PEP 440 defines the answer,
and this stage implements the part of it that matters.

Reading a version is the easy half. The ordering is where the rules live, and
they are not the ones a tuple of integers gives you. A dev release comes before
its own pre-releases. A pre-release comes before the release it leads to. A
post-release comes after it. Written out, that is `1.0.dev1 < 1.0a1 < 1.0 <
1.0.post1`, with an epoch above all of it for the rare project that has to
renumber, and a local label such as `+ubuntu1` sorting above the same version
without one.

Trailing zeros do not make a new version, so `1.0` and `1.0.0` are equal, which
means equality has to be defined rather than inherited.

The trick that keeps this short is one sort key. Each segment becomes a small
tuple whose first number is its rank, plain tuple comparison does the rest, and
`functools.total_ordering` fills in the four comparisons you did not write.

@goal `Version` parses PEP 440 and sorts the ladder in the order it defines.

~~~starter
import argparse
import functools
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


COMMANDS = {"info": cmd_info}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)


MAIN_TEMPLATE = """\
import sys

from {module} import {attribute}

if __name__ == "__main__":
    sys.exit({attribute}())
"""

SCRIPT_TEMPLATE = """\
import sys

from {module} import {attribute}

sys.exit({attribute}())
"""


def split_entry_point(target):
    """`"module:attribute"` as a pair, or a ProjectError saying what is wrong."""
    module, separator, attribute = target.partition(":")
    if not separator or not module or not attribute:
        raise ProjectError(f"{target!r} does not name a function as module:function")
    if not all(part.isidentifier() for part in module.split(".")):
        raise ProjectError(f"{target!r}: {module!r} is not a module path")
    if not all(part.isidentifier() for part in attribute.split(".")):
        raise ProjectError(f"{target!r}: {attribute!r} is not an attribute name")
    return module, attribute


def main_module_source(target):
    """The `__main__.py` that makes `python -m <package>` work.

    Every line earns its place. The guard is unit 29's: a module run as a
    program has `__name__` set to "__main__" and a module imported by something
    else does not, so the import above it costs nothing to whoever imports the
    package. `sys.exit` is what turns the number `main` returns into the number
    the shell sees, which is the reason `main` returns one.
    """
    module, attribute = split_entry_point(target)
    return MAIN_TEMPLATE.format(module=module, attribute=attribute)


def console_script_source(target):
    """What an installer writes for a console script, near enough.

    The `pkgit` command on somebody's PATH is a small Python file that imports
    the function the entry point names and exits with what it returns. The same
    lines as `__main__.py` without the guard, because a script is run and never
    imported, so there is nothing for a guard to protect against.
    """
    module, attribute = split_entry_point(target)
    return SCRIPT_TEMPLATE.format(module=module, attribute=attribute)


def entry_points_metadata(project):
    """The `entry_points.txt` a wheel carries, in the format the spec asks for."""
    if not project.scripts:
        return ""
    lines = ["[console_scripts]"]
    for command, target in sorted(project.scripts.items()):
        split_entry_point(target)
        lines.append(f"{command} = {target}")
    return "\n".join(lines) + "\n"


def package_name(project):
    """The importable name for a distribution name.

    A distribution is named with hyphens and a package is named with
    underscores, because a hyphen is not valid in an identifier. `pip install
    my-tool` then `import my_tool` is this rule and not a coincidence.
    """
    return project.name.replace("-", "_").replace(".", "_").lower()


def scaffold(project, root=None, force=False):
    """Write the package layout the project describes. Returns what it wrote.

    A file that is already there is left alone. The alternative is a generator
    that silently replaces somebody's module with a one line stub the first
    time they run it twice, and `force=True` is how a caller says they meant
    that.
    """
    root = Path(root) if root is not None else project.root
    directory = root / package_name(project)
    directory.mkdir(parents=True, exist_ok=True)

    wanted = [(directory / "__init__.py", f'__version__ = "{project.version}"\n')]
    if project.scripts:
        target = project.scripts[sorted(project.scripts)[0]]
        wanted.append((directory / "__main__.py", main_module_source(target)))

    written = []
    for path, text in wanted:
        if path.exists() and not force:
            continue
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written


class InvalidVersion(ProjectError):
    """A version string PEP 440 does not describe."""


@functools.total_ordering
class Version:
    """A version that sorts the way the specification says it should."""

    def __init__(self, text):
        raise NotImplementedError

    @property
    def base(self):
        """The release numbers alone, which is what a wildcard compares against."""
        raise NotImplementedError

    @property
    def is_prerelease(self):
        raise NotImplementedError

    def __eq__(self, other):
        raise NotImplementedError

    def __lt__(self, other):
        raise NotImplementedError

    def __hash__(self):
        raise NotImplementedError
~~~

~~~tests
import io
from pathlib import Path


def write(name, text):
    Path(name).parent.mkdir(parents=True, exist_ok=True)
    Path(name).write_text(text, encoding="utf-8")


# stage three still holds
write("demo/pyproject.toml", '[project]\nname = "toy"\nversion = "3.0"\n'
      '[project.scripts]\ntoy = "toy.cli:main"\n')
assert split_entry_point("toy.cli:main") == ("toy.cli", "main")
assert scaffold(load_project("demo"))[1].name == "__main__.py"
assert main(["info", "demo"], io.StringIO()) == 0

# the simple case, and what comes back out
assert str(Version("1.2.3")) == "1.2.3"
assert Version("1.2.3").release == (1, 2, 3)
assert Version("1.2.3").epoch == 0
assert repr(Version("1.2.3")) == "Version('1.2.3')"

# trailing zeros do not make a different version
assert Version("1.0") == Version("1.0.0") == Version("1.0.0.0")
assert Version("1.0") != Version("1.0.1")
assert Version("1") == Version("1.0")

# the ladder the specification lays out, in order
ladder = [
    "1.0.dev1", "1.0a1", "1.0a2", "1.0b1", "1.0rc1", "1.0",
    "1.0.post1", "1.0.1", "1.1", "2.0",
]
versions = [Version(text) for text in ladder]
assert versions == sorted(versions), [str(v) for v in sorted(versions)]
for earlier, later in zip(ladder, ladder[1:]):
    assert Version(earlier) < Version(later), f"{earlier} should sort below {later}"
    assert Version(later) > Version(earlier)
    assert Version(earlier) <= Version(later)

# a dev release of a pre-release comes before the pre-release itself
assert Version("1.0a1.dev1") < Version("1.0a1")
assert Version("1.0.dev1") < Version("1.0a1")

# the spellings that mean the same thing
assert Version("1.0alpha1") == Version("1.0a1")
assert Version("1.0beta2") == Version("1.0b2")
assert Version("1.0c1") == Version("1.0rc1") == Version("1.0pre1")
assert Version("1.0preview1") == Version("1.0rc1")
assert Version("1.0-1") == Version("1.0.post1") == Version("1.0rev1")
assert Version("v1.0") == Version("1.0")
assert Version("  1.0  ") == Version("1.0")
assert Version("1.0A1") == Version("1.0a1")

# a separator before the letter is allowed, and a missing number means zero
assert Version("1.0.0.beta") == Version("1.0.0b0")
assert Version("1.1.a1") == Version("1.1a1")
assert Version("1.0_rc_2") == Version("1.0rc2")

# a segment written without a number means zero, not absent
assert Version("1.0.post").post == 0
assert Version("1.0").post is None
assert Version("1.0.post") > Version("1.0")
assert Version("1.0.dev").dev == 0
assert Version("1.0.dev") < Version("1.0")

# an epoch beats everything below it
assert Version("1!1.0") > Version("999.0")
assert Version("1!1.0").epoch == 1
assert Version("1!1.0") < Version("2!1.0")

# a local label sorts above the version without one, and is not a prerelease
assert Version("1.0+ubuntu1") > Version("1.0")
assert Version("1.0+ubuntu2") > Version("1.0+ubuntu1")
assert Version("1.0+ubuntu1") < Version("1.0.1")
assert Version("1.0+devbuild").is_prerelease is False
assert Version("1.0+a-b_c") == Version("1.0+a.b.c")

# what counts as a pre-release, which is what an installer skips by default
assert Version("1.0a1").is_prerelease is True
assert Version("1.0.dev1").is_prerelease is True
assert Version("1.0a1.dev1").is_prerelease is True
assert Version("1.0").is_prerelease is False
assert Version("1.0.post1").is_prerelease is False

# a version is a value, so it hashes and belongs in a set
assert len({Version("1.0"), Version("1.0.0"), Version("1.0.1")}) == 2
assert {Version("1.0"): "yes"}[Version("1.0.0")] == "yes"

# and sorts, which is the whole reason for the ordering rules
scrambled = ["2.0", "1.0rc1", "1.0", "1.0.dev1", "10.0", "1.0a1"]
assert [str(v) for v in sorted(Version(t) for t in scrambled)] == [
    "1.0.dev1", "1.0a1", "1.0rc1", "1.0", "2.0", "10.0",
]

# string ordering would get that wrong, which is the point
assert sorted(scrambled) != ["1.0.dev1", "1.0a1", "1.0rc1", "1.0", "2.0", "10.0"]

# nonsense is refused, and the error is one a build tool already knows about
assert issubclass(InvalidVersion, ProjectError)
for bad in ("", "one.two", "not a version", "1.0+", "-1.0", "1..0", "1.0gamma1"):
    try:
        Version(bad)
    except InvalidVersion:
        pass
    else:
        raise AssertionError(f"{bad!r} should not be a version")

# comparing against something that is not a version is a TypeError, not False
try:
    Version("1.0") < "1.0"
except TypeError:
    pass
else:
    raise AssertionError("a version should not compare against a string")
assert Version("1.0") != "1.0"
assert (Version("1.0") == 1.0) is False

# and the version the project declares is one of these
write("real/pyproject.toml", '[project]\nname = "x"\nversion = "2.0rc1"\n')
assert Version(load_project("real").version) < Version("2.0")
~~~

~~~solution
import argparse
import functools
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


COMMANDS = {"info": cmd_info}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)


MAIN_TEMPLATE = """\
import sys

from {module} import {attribute}

if __name__ == "__main__":
    sys.exit({attribute}())
"""

SCRIPT_TEMPLATE = """\
import sys

from {module} import {attribute}

sys.exit({attribute}())
"""


def split_entry_point(target):
    """`"module:attribute"` as a pair, or a ProjectError saying what is wrong."""
    module, separator, attribute = target.partition(":")
    if not separator or not module or not attribute:
        raise ProjectError(f"{target!r} does not name a function as module:function")
    if not all(part.isidentifier() for part in module.split(".")):
        raise ProjectError(f"{target!r}: {module!r} is not a module path")
    if not all(part.isidentifier() for part in attribute.split(".")):
        raise ProjectError(f"{target!r}: {attribute!r} is not an attribute name")
    return module, attribute


def main_module_source(target):
    """The `__main__.py` that makes `python -m <package>` work.

    Every line earns its place. The guard is unit 29's: a module run as a
    program has `__name__` set to "__main__" and a module imported by something
    else does not, so the import above it costs nothing to whoever imports the
    package. `sys.exit` is what turns the number `main` returns into the number
    the shell sees, which is the reason `main` returns one.
    """
    module, attribute = split_entry_point(target)
    return MAIN_TEMPLATE.format(module=module, attribute=attribute)


def console_script_source(target):
    """What an installer writes for a console script, near enough.

    The `pkgit` command on somebody's PATH is a small Python file that imports
    the function the entry point names and exits with what it returns. The same
    lines as `__main__.py` without the guard, because a script is run and never
    imported, so there is nothing for a guard to protect against.
    """
    module, attribute = split_entry_point(target)
    return SCRIPT_TEMPLATE.format(module=module, attribute=attribute)


def entry_points_metadata(project):
    """The `entry_points.txt` a wheel carries, in the format the spec asks for."""
    if not project.scripts:
        return ""
    lines = ["[console_scripts]"]
    for command, target in sorted(project.scripts.items()):
        split_entry_point(target)
        lines.append(f"{command} = {target}")
    return "\n".join(lines) + "\n"


def package_name(project):
    """The importable name for a distribution name.

    A distribution is named with hyphens and a package is named with
    underscores, because a hyphen is not valid in an identifier. `pip install
    my-tool` then `import my_tool` is this rule and not a coincidence.
    """
    return project.name.replace("-", "_").replace(".", "_").lower()


def scaffold(project, root=None, force=False):
    """Write the package layout the project describes. Returns what it wrote.

    A file that is already there is left alone. The alternative is a generator
    that silently replaces somebody's module with a one line stub the first
    time they run it twice, and `force=True` is how a caller says they meant
    that.
    """
    root = Path(root) if root is not None else project.root
    directory = root / package_name(project)
    directory.mkdir(parents=True, exist_ok=True)

    wanted = [(directory / "__init__.py", f'__version__ = "{project.version}"\n')]
    if project.scripts:
        target = project.scripts[sorted(project.scripts)[0]]
        wanted.append((directory / "__main__.py", main_module_source(target)))

    written = []
    for path, text in wanted:
        if path.exists() and not force:
            continue
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written

VERSION_PATTERN = re.compile(
    r"""
    ^\s*v?
    (?:(?P<epoch>\d+)!)?                     # 1!2.0 sorts above every 2.0
    (?P<release>\d+(?:\.\d+)*)
    (?:[-_.]?(?P<pre_l>a|b|c|rc|alpha|beta|pre|preview)[-_.]?(?P<pre_n>\d+)?)?
    (?P<post>-(?P<post_n1>\d+)|[-_.]?(?P<post_l>post|rev|r)[-_.]?(?P<post_n2>\d+)?)?
    (?P<dev>[-_.]?dev[-_.]?(?P<dev_n>\d+)?)?
    (?:\+(?P<local>[a-z0-9]+(?:[-_.][a-z0-9]+)*))?
    \s*$
    """,
    re.VERBOSE | re.IGNORECASE,
)

PRE_NAMES = {"alpha": "a", "beta": "b", "c": "rc", "pre": "rc", "preview": "rc"}


class InvalidVersion(ProjectError):
    """A version string PEP 440 does not describe."""


@functools.total_ordering
class Version:
    """A version that sorts the way the specification says it should.

    Reading one is the easy half. The ordering is where the rules live: a dev
    release comes before its own pre-releases, a pre-release comes before the
    release it leads to, and a post-release comes after it. Written out that is
    1.0.dev1 < 1.0a1 < 1.0 < 1.0.post1, which is not what a plain string
    comparison gives you and not what a tuple of integers gives you either.
    """

    def __init__(self, text):
        match = VERSION_PATTERN.match(str(text))
        if match is None:
            raise InvalidVersion(f"{text!r} is not a valid version")
        parts = match.groupdict()
        self.text = str(text).strip()
        self.epoch = int(parts["epoch"] or 0)
        self.release = tuple(int(n) for n in parts["release"].split("."))
        self.pre = self._pre(parts)
        self.post = self._segment(parts["post"], parts["post_n1"], parts["post_n2"])
        self.dev = self._segment(parts["dev"], parts["dev_n"])
        self.local = self._local(parts["local"])

    @staticmethod
    def _local(text):
        """A local label is dot separated, and a hyphen or underscore is a dot."""
        if not text:
            return ()
        return tuple(text.lower().replace("-", ".").replace("_", ".").split("."))

    @staticmethod
    def _pre(parts):
        if parts["pre_l"] is None:
            return None
        letter = parts["pre_l"].lower()
        return PRE_NAMES.get(letter, letter), int(parts["pre_n"] or 0)

    @staticmethod
    def _segment(present, *numbers):
        """A segment may be written with a number, without one, or not at all.

        `1.0.post1`, `1.0.post` and `1.0` are three different answers, and the
        middle one means post-release zero rather than no post-release.
        """
        if present is None:
            return None
        for number in numbers:
            if number is not None:
                return int(number)
        return 0

    @property
    def base(self):
        """The release numbers alone, which is what a wildcard compares against."""
        return self.release

    @property
    def is_prerelease(self):
        return self.pre is not None or self.dev is not None

    def _key(self):
        """One tuple that sorts correctly, so the comparisons are one line each.

        Each segment becomes a small tuple whose first number is its rank, so
        plain tuple comparison does the work and there are no sentinel objects
        to explain. A dev release with no pre-release ranks below every
        pre-release, and a release with neither ranks above them all.
        """
        release = self.release
        while len(release) > 1 and release[-1] == 0:
            release = release[:-1]
        if self.pre is not None:
            pre = (1, *self.pre)
        elif self.dev is not None:
            pre = (0,)
        else:
            pre = (2,)
        post = (0,) if self.post is None else (1, self.post)
        dev = (1,) if self.dev is None else (0, self.dev)
        local = (1, self.local) if self.local else (0,)
        return self.epoch, release, pre, post, dev, local

    def __eq__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() == other._key()

    def __lt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() < other._key()

    def __hash__(self):
        return hash(self._key())

    def __repr__(self):
        return f"Version({self.text!r})"

    def __str__(self):
        return self.text
~~~

## Which versions are allowed, and which Pythons you support

A requirement is a name and a set of comparisons. `>=1.0,<2.0` is two of them,
and both have to hold. Most of the operators mean what they look like, and two
do not.

`~=1.4.2` is the compatible release operator, and it is two rules at once: at
least `1.4.2`, and inside the series that everything but the last number names.
So `1.4.9` matches and `1.5.0` does not. It needs at least two release
segments, because one number does not name a series to stay inside.

`==1.0.*` is a prefix match on the release numbers rather than a comparison,
which is why it is the one place a wildcard is allowed.

The rule that catches people is about pre-releases. `>=1.0` does not match
`2.0a1`. An installer will not hand you a pre-release unless you asked for one,
and asking means naming one in the specifier.

Then the payoff. `requires-python` plus a list of interpreters is a support
matrix, and the classifiers PyPI shows can be derived from it rather than typed
out and left to rot. Sorted as strings, "3.9" comes after "3.10", so this is
the stage where the previous one stops being theory.

@goal Specifiers match the way PEP 440 says, and `matrix` prints the Pythons.

~~~starter
import argparse
import functools
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")

    matrix = commands.add_parser("matrix", help="the Pythons this project supports")
    matrix.add_argument("path", nargs="?", default=".",
                        help="the directory holding pyproject.toml")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


def cmd_matrix(args, out):
    """Print the Python versions the project supports, one per line."""
    raise NotImplementedError


COMMANDS = {"info": cmd_info, "matrix": cmd_matrix}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)


MAIN_TEMPLATE = """\
import sys

from {module} import {attribute}

if __name__ == "__main__":
    sys.exit({attribute}())
"""

SCRIPT_TEMPLATE = """\
import sys

from {module} import {attribute}

sys.exit({attribute}())
"""


def split_entry_point(target):
    """`"module:attribute"` as a pair, or a ProjectError saying what is wrong."""
    module, separator, attribute = target.partition(":")
    if not separator or not module or not attribute:
        raise ProjectError(f"{target!r} does not name a function as module:function")
    if not all(part.isidentifier() for part in module.split(".")):
        raise ProjectError(f"{target!r}: {module!r} is not a module path")
    if not all(part.isidentifier() for part in attribute.split(".")):
        raise ProjectError(f"{target!r}: {attribute!r} is not an attribute name")
    return module, attribute


def main_module_source(target):
    """The `__main__.py` that makes `python -m <package>` work.

    Every line earns its place. The guard is unit 29's: a module run as a
    program has `__name__` set to "__main__" and a module imported by something
    else does not, so the import above it costs nothing to whoever imports the
    package. `sys.exit` is what turns the number `main` returns into the number
    the shell sees, which is the reason `main` returns one.
    """
    module, attribute = split_entry_point(target)
    return MAIN_TEMPLATE.format(module=module, attribute=attribute)


def console_script_source(target):
    """What an installer writes for a console script, near enough.

    The `pkgit` command on somebody's PATH is a small Python file that imports
    the function the entry point names and exits with what it returns. The same
    lines as `__main__.py` without the guard, because a script is run and never
    imported, so there is nothing for a guard to protect against.
    """
    module, attribute = split_entry_point(target)
    return SCRIPT_TEMPLATE.format(module=module, attribute=attribute)


def entry_points_metadata(project):
    """The `entry_points.txt` a wheel carries, in the format the spec asks for."""
    if not project.scripts:
        return ""
    lines = ["[console_scripts]"]
    for command, target in sorted(project.scripts.items()):
        split_entry_point(target)
        lines.append(f"{command} = {target}")
    return "\n".join(lines) + "\n"


def package_name(project):
    """The importable name for a distribution name.

    A distribution is named with hyphens and a package is named with
    underscores, because a hyphen is not valid in an identifier. `pip install
    my-tool` then `import my_tool` is this rule and not a coincidence.
    """
    return project.name.replace("-", "_").replace(".", "_").lower()


def scaffold(project, root=None, force=False):
    """Write the package layout the project describes. Returns what it wrote.

    A file that is already there is left alone. The alternative is a generator
    that silently replaces somebody's module with a one line stub the first
    time they run it twice, and `force=True` is how a caller says they meant
    that.
    """
    root = Path(root) if root is not None else project.root
    directory = root / package_name(project)
    directory.mkdir(parents=True, exist_ok=True)

    wanted = [(directory / "__init__.py", f'__version__ = "{project.version}"\n')]
    if project.scripts:
        target = project.scripts[sorted(project.scripts)[0]]
        wanted.append((directory / "__main__.py", main_module_source(target)))

    written = []
    for path, text in wanted:
        if path.exists() and not force:
            continue
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written

VERSION_PATTERN = re.compile(
    r"""
    ^\s*v?
    (?:(?P<epoch>\d+)!)?                     # 1!2.0 sorts above every 2.0
    (?P<release>\d+(?:\.\d+)*)
    (?:[-_.]?(?P<pre_l>a|b|c|rc|alpha|beta|pre|preview)[-_.]?(?P<pre_n>\d+)?)?
    (?P<post>-(?P<post_n1>\d+)|[-_.]?(?P<post_l>post|rev|r)[-_.]?(?P<post_n2>\d+)?)?
    (?P<dev>[-_.]?dev[-_.]?(?P<dev_n>\d+)?)?
    (?:\+(?P<local>[a-z0-9]+(?:[-_.][a-z0-9]+)*))?
    \s*$
    """,
    re.VERBOSE | re.IGNORECASE,
)

PRE_NAMES = {"alpha": "a", "beta": "b", "c": "rc", "pre": "rc", "preview": "rc"}


class InvalidVersion(ProjectError):
    """A version string PEP 440 does not describe."""


@functools.total_ordering
class Version:
    """A version that sorts the way the specification says it should.

    Reading one is the easy half. The ordering is where the rules live: a dev
    release comes before its own pre-releases, a pre-release comes before the
    release it leads to, and a post-release comes after it. Written out that is
    1.0.dev1 < 1.0a1 < 1.0 < 1.0.post1, which is not what a plain string
    comparison gives you and not what a tuple of integers gives you either.
    """

    def __init__(self, text):
        match = VERSION_PATTERN.match(str(text))
        if match is None:
            raise InvalidVersion(f"{text!r} is not a valid version")
        parts = match.groupdict()
        self.text = str(text).strip()
        self.epoch = int(parts["epoch"] or 0)
        self.release = tuple(int(n) for n in parts["release"].split("."))
        self.pre = self._pre(parts)
        self.post = self._segment(parts["post"], parts["post_n1"], parts["post_n2"])
        self.dev = self._segment(parts["dev"], parts["dev_n"])
        self.local = self._local(parts["local"])

    @staticmethod
    def _local(text):
        """A local label is dot separated, and a hyphen or underscore is a dot."""
        if not text:
            return ()
        return tuple(text.lower().replace("-", ".").replace("_", ".").split("."))

    @staticmethod
    def _pre(parts):
        if parts["pre_l"] is None:
            return None
        letter = parts["pre_l"].lower()
        return PRE_NAMES.get(letter, letter), int(parts["pre_n"] or 0)

    @staticmethod
    def _segment(present, *numbers):
        """A segment may be written with a number, without one, or not at all.

        `1.0.post1`, `1.0.post` and `1.0` are three different answers, and the
        middle one means post-release zero rather than no post-release.
        """
        if present is None:
            return None
        for number in numbers:
            if number is not None:
                return int(number)
        return 0

    @property
    def base(self):
        """The release numbers alone, which is what a wildcard compares against."""
        return self.release

    @property
    def is_prerelease(self):
        return self.pre is not None or self.dev is not None

    def _key(self):
        """One tuple that sorts correctly, so the comparisons are one line each.

        Each segment becomes a small tuple whose first number is its rank, so
        plain tuple comparison does the work and there are no sentinel objects
        to explain. A dev release with no pre-release ranks below every
        pre-release, and a release with neither ranks above them all.
        """
        release = self.release
        while len(release) > 1 and release[-1] == 0:
            release = release[:-1]
        if self.pre is not None:
            pre = (1, *self.pre)
        elif self.dev is not None:
            pre = (0,)
        else:
            pre = (2,)
        post = (0,) if self.post is None else (1, self.post)
        dev = (1,) if self.dev is None else (0, self.dev)
        local = (1, self.local) if self.local else (0,)
        return self.epoch, release, pre, post, dev, local

    def __eq__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() == other._key()

    def __lt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() < other._key()

    def __hash__(self):
        return hash(self._key())

    def __repr__(self):
        return f"Version({self.text!r})"

    def __str__(self):
        return self.text


DEFAULT_PYTHONS = ("3.9", "3.10", "3.11", "3.12", "3.13", "3.14")


class Specifier:
    """One comparison out of a requirement, such as `>=3.11` or `==1.4.*`."""

    def __init__(self, text):
        raise NotImplementedError

    def matches(self, version):
        """Whether `version` satisfies this one comparison."""
        raise NotImplementedError

    def __contains__(self, version):
        return self.matches(version)


class SpecifierSet:
    """Every comparison in one requirement, all of which have to hold."""

    def __init__(self, text=""):
        raise NotImplementedError

    @property
    def allows_prereleases(self):
        """Whether a pre-release can satisfy this set."""
        raise NotImplementedError

    def matches(self, version):
        """Whether `version` satisfies all of them."""
        raise NotImplementedError

    def __contains__(self, version):
        return self.matches(version)

    def __len__(self):
        raise NotImplementedError


def python_matrix(project, candidates=DEFAULT_PYTHONS):
    """The Python versions this project says it runs on."""
    raise NotImplementedError


def python_classifiers(project, candidates=DEFAULT_PYTHONS):
    """The classifiers PyPI shows, derived rather than typed out by hand."""
    raise NotImplementedError
~~~

~~~tests
import io
from pathlib import Path


def write(name, text):
    Path(name).parent.mkdir(parents=True, exist_ok=True)
    Path(name).write_text(text, encoding="utf-8")


# stage four still holds
assert Version("1.0.dev1") < Version("1.0a1") < Version("1.0") < Version("1.0.post1")
assert Version("1.0") == Version("1.0.0")

# the plain comparisons
assert Specifier(">=1.0").matches("1.0")
assert Specifier(">=1.0").matches("2.0")
assert not Specifier(">=1.0").matches("0.9")
assert Specifier(">1.0").matches("1.1") and not Specifier(">1.0").matches("1.0")
assert Specifier("<2.0").matches("1.9") and not Specifier("<2.0").matches("2.0")
assert Specifier("<=2.0").matches("2.0")
assert Specifier("==1.0").matches("1.0.0"), "trailing zeros do not make a difference"
assert Specifier("!=1.0").matches("1.1") and not Specifier("!=1.0").matches("1.0")

# `in` reads the way the comparison sounds
assert "1.5" in Specifier(">=1.0")
assert "0.5" not in Specifier(">=1.0")

# the wildcard, which is a prefix match on the release numbers
assert Specifier("==1.0.*").matches("1.0.5")
assert Specifier("==1.0.*").matches("1.0")
assert Specifier("==1.0.*").matches("1")
assert not Specifier("==1.0.*").matches("1.1")
assert not Specifier("==1.0.*").matches("2.0")
assert Specifier("!=1.0.*").matches("1.1")
assert not Specifier("!=1.0.*").matches("1.0.7")

# a wildcard only means something for equality
for bad in (">=1.0.*", "<1.0.*", "~=1.0.*"):
    try:
        Specifier(bad)
    except ProjectError as exc:
        assert "wildcard" in str(exc)
    else:
        raise AssertionError(f"{bad} should have been refused")

# compatible release is two rules at once
assert Specifier("~=1.4.2").matches("1.4.2")
assert Specifier("~=1.4.2").matches("1.4.9")
assert not Specifier("~=1.4.2").matches("1.4.1"), "it is still a lower bound"
assert not Specifier("~=1.4.2").matches("1.5.0"), "and still inside the series"
assert Specifier("~=1.4").matches("1.9")
assert not Specifier("~=1.4").matches("2.0")

# and it needs a series to be compatible with
try:
    Specifier("~=1")
except ProjectError as exc:
    assert "two release segments" in str(exc)
else:
    raise AssertionError("~=1 does not name a series")

# things that are not specifiers at all
for bad in ("1.0", "=1.0", "", "~1.0", "> =1.0", "≥1.0"):
    try:
        Specifier(bad)
    except ProjectError:
        pass
    else:
        raise AssertionError(f"{bad!r} should not be a specifier")

# a set is every comparison at once
allowed = SpecifierSet(">=1.0,<2.0,!=1.5")
assert len(allowed) == 3
assert allowed.matches("1.0") and allowed.matches("1.9")
assert not allowed.matches("0.9")
assert not allowed.matches("2.0")
assert not allowed.matches("1.5")
assert "1.4" in allowed

# an empty set allows everything, which is what no requires-python means
assert SpecifierSet("").matches("1.0")
assert SpecifierSet("").matches("99.0")
assert len(SpecifierSet("")) == 0
assert SpecifierSet(" , ").matches("1.0")

# a pre-release does not satisfy a set that did not ask for one
assert not SpecifierSet(">=1.0").matches("2.0a1")
assert not SpecifierSet(">=1.0").matches("2.0.dev1")
assert SpecifierSet(">=1.0").allows_prereleases is False
assert SpecifierSet(">=1.0a1").allows_prereleases is True
assert SpecifierSet(">=1.0a1").matches("2.0a1")
assert SpecifierSet(">=1.0a1").matches("2.0")

# now the matrix, which is the reason the ordering had to be right
write("modern/pyproject.toml", """
[project]
name = "modern"
version = "1.0"
requires-python = ">=3.11"
""")
project = load_project("modern")
assert python_matrix(project) == ["3.11", "3.12", "3.13", "3.14"]

# sorted as strings, "3.9" comes after "3.10", which is the trap this avoids
assert sorted(["3.9", "3.10", "3.11"]) == ["3.10", "3.11", "3.9"]
assert "3.9" not in python_matrix(project)

write("window/pyproject.toml", """
[project]
name = "window"
version = "1.0"
requires-python = ">=3.10,<3.13"
""")
assert python_matrix(load_project("window")) == ["3.10", "3.11", "3.12"]

write("any/pyproject.toml", '[project]\nname = "any"\nversion = "1.0"\n')
assert python_matrix(load_project("any")) == list(DEFAULT_PYTHONS)

# the classifiers PyPI shows come from the same answer rather than by hand
assert python_classifiers(load_project("modern")) == [
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Programming Language :: Python :: 3.13",
    "Programming Language :: Python :: 3.14",
]
assert python_classifiers(load_project("modern"), ("3.11",)) == [
    "Programming Language :: Python :: 3.11"
]


def run(argv):
    out = io.StringIO()
    return main(argv, out), out.getvalue()


# and it is a command, wired in beside the one from stage two
code, text = run(["matrix", "modern"])
assert code == 0, text
assert text.split() == ["3.11", "3.12", "3.13", "3.14"]

code, text = run(["info", "modern"])
assert code == 0 and ">=3.11" in text

# a requires-python nothing satisfies is a mistake worth reporting
write("none/pyproject.toml", """
[project]
name = "none"
version = "1.0"
requires-python = ">=4.0"
""")
code, text = run(["matrix", "none"])
assert code == 1
assert "no known Python" in text

code, text = run(["matrix", "nowhere"])
assert code == 1 and "no pyproject.toml" in text
~~~

~~~solution
import argparse
import functools
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")

    matrix = commands.add_parser("matrix", help="the Pythons this project supports")
    matrix.add_argument("path", nargs="?", default=".",
                        help="the directory holding pyproject.toml")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


def cmd_matrix(args, out):
    """Print the Python versions the project supports, one per line."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    supported = python_matrix(project)
    if not supported:
        print(f"pkgit: {project.requires_python!r} matches no known Python", file=out)
        return 1
    for text in supported:
        print(text, file=out)
    return 0


COMMANDS = {"info": cmd_info, "matrix": cmd_matrix}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)


MAIN_TEMPLATE = """\
import sys

from {module} import {attribute}

if __name__ == "__main__":
    sys.exit({attribute}())
"""

SCRIPT_TEMPLATE = """\
import sys

from {module} import {attribute}

sys.exit({attribute}())
"""


def split_entry_point(target):
    """`"module:attribute"` as a pair, or a ProjectError saying what is wrong."""
    module, separator, attribute = target.partition(":")
    if not separator or not module or not attribute:
        raise ProjectError(f"{target!r} does not name a function as module:function")
    if not all(part.isidentifier() for part in module.split(".")):
        raise ProjectError(f"{target!r}: {module!r} is not a module path")
    if not all(part.isidentifier() for part in attribute.split(".")):
        raise ProjectError(f"{target!r}: {attribute!r} is not an attribute name")
    return module, attribute


def main_module_source(target):
    """The `__main__.py` that makes `python -m <package>` work.

    Every line earns its place. The guard is unit 29's: a module run as a
    program has `__name__` set to "__main__" and a module imported by something
    else does not, so the import above it costs nothing to whoever imports the
    package. `sys.exit` is what turns the number `main` returns into the number
    the shell sees, which is the reason `main` returns one.
    """
    module, attribute = split_entry_point(target)
    return MAIN_TEMPLATE.format(module=module, attribute=attribute)


def console_script_source(target):
    """What an installer writes for a console script, near enough.

    The `pkgit` command on somebody's PATH is a small Python file that imports
    the function the entry point names and exits with what it returns. The same
    lines as `__main__.py` without the guard, because a script is run and never
    imported, so there is nothing for a guard to protect against.
    """
    module, attribute = split_entry_point(target)
    return SCRIPT_TEMPLATE.format(module=module, attribute=attribute)


def entry_points_metadata(project):
    """The `entry_points.txt` a wheel carries, in the format the spec asks for."""
    if not project.scripts:
        return ""
    lines = ["[console_scripts]"]
    for command, target in sorted(project.scripts.items()):
        split_entry_point(target)
        lines.append(f"{command} = {target}")
    return "\n".join(lines) + "\n"


def package_name(project):
    """The importable name for a distribution name.

    A distribution is named with hyphens and a package is named with
    underscores, because a hyphen is not valid in an identifier. `pip install
    my-tool` then `import my_tool` is this rule and not a coincidence.
    """
    return project.name.replace("-", "_").replace(".", "_").lower()


def scaffold(project, root=None, force=False):
    """Write the package layout the project describes. Returns what it wrote.

    A file that is already there is left alone. The alternative is a generator
    that silently replaces somebody's module with a one line stub the first
    time they run it twice, and `force=True` is how a caller says they meant
    that.
    """
    root = Path(root) if root is not None else project.root
    directory = root / package_name(project)
    directory.mkdir(parents=True, exist_ok=True)

    wanted = [(directory / "__init__.py", f'__version__ = "{project.version}"\n')]
    if project.scripts:
        target = project.scripts[sorted(project.scripts)[0]]
        wanted.append((directory / "__main__.py", main_module_source(target)))

    written = []
    for path, text in wanted:
        if path.exists() and not force:
            continue
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written

VERSION_PATTERN = re.compile(
    r"""
    ^\s*v?
    (?:(?P<epoch>\d+)!)?                     # 1!2.0 sorts above every 2.0
    (?P<release>\d+(?:\.\d+)*)
    (?:[-_.]?(?P<pre_l>a|b|c|rc|alpha|beta|pre|preview)[-_.]?(?P<pre_n>\d+)?)?
    (?P<post>-(?P<post_n1>\d+)|[-_.]?(?P<post_l>post|rev|r)[-_.]?(?P<post_n2>\d+)?)?
    (?P<dev>[-_.]?dev[-_.]?(?P<dev_n>\d+)?)?
    (?:\+(?P<local>[a-z0-9]+(?:[-_.][a-z0-9]+)*))?
    \s*$
    """,
    re.VERBOSE | re.IGNORECASE,
)

PRE_NAMES = {"alpha": "a", "beta": "b", "c": "rc", "pre": "rc", "preview": "rc"}


class InvalidVersion(ProjectError):
    """A version string PEP 440 does not describe."""


@functools.total_ordering
class Version:
    """A version that sorts the way the specification says it should.

    Reading one is the easy half. The ordering is where the rules live: a dev
    release comes before its own pre-releases, a pre-release comes before the
    release it leads to, and a post-release comes after it. Written out that is
    1.0.dev1 < 1.0a1 < 1.0 < 1.0.post1, which is not what a plain string
    comparison gives you and not what a tuple of integers gives you either.
    """

    def __init__(self, text):
        match = VERSION_PATTERN.match(str(text))
        if match is None:
            raise InvalidVersion(f"{text!r} is not a valid version")
        parts = match.groupdict()
        self.text = str(text).strip()
        self.epoch = int(parts["epoch"] or 0)
        self.release = tuple(int(n) for n in parts["release"].split("."))
        self.pre = self._pre(parts)
        self.post = self._segment(parts["post"], parts["post_n1"], parts["post_n2"])
        self.dev = self._segment(parts["dev"], parts["dev_n"])
        self.local = self._local(parts["local"])

    @staticmethod
    def _local(text):
        """A local label is dot separated, and a hyphen or underscore is a dot."""
        if not text:
            return ()
        return tuple(text.lower().replace("-", ".").replace("_", ".").split("."))

    @staticmethod
    def _pre(parts):
        if parts["pre_l"] is None:
            return None
        letter = parts["pre_l"].lower()
        return PRE_NAMES.get(letter, letter), int(parts["pre_n"] or 0)

    @staticmethod
    def _segment(present, *numbers):
        """A segment may be written with a number, without one, or not at all.

        `1.0.post1`, `1.0.post` and `1.0` are three different answers, and the
        middle one means post-release zero rather than no post-release.
        """
        if present is None:
            return None
        for number in numbers:
            if number is not None:
                return int(number)
        return 0

    @property
    def base(self):
        """The release numbers alone, which is what a wildcard compares against."""
        return self.release

    @property
    def is_prerelease(self):
        return self.pre is not None or self.dev is not None

    def _key(self):
        """One tuple that sorts correctly, so the comparisons are one line each.

        Each segment becomes a small tuple whose first number is its rank, so
        plain tuple comparison does the work and there are no sentinel objects
        to explain. A dev release with no pre-release ranks below every
        pre-release, and a release with neither ranks above them all.
        """
        release = self.release
        while len(release) > 1 and release[-1] == 0:
            release = release[:-1]
        if self.pre is not None:
            pre = (1, *self.pre)
        elif self.dev is not None:
            pre = (0,)
        else:
            pre = (2,)
        post = (0,) if self.post is None else (1, self.post)
        dev = (1,) if self.dev is None else (0, self.dev)
        local = (1, self.local) if self.local else (0,)
        return self.epoch, release, pre, post, dev, local

    def __eq__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() == other._key()

    def __lt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() < other._key()

    def __hash__(self):
        return hash(self._key())

    def __repr__(self):
        return f"Version({self.text!r})"

    def __str__(self):
        return self.text

SPECIFIER_PATTERN = re.compile(r"^\s*(===|==|!=|~=|<=|>=|<|>)\s*([^\s,]+)\s*$")

DEFAULT_PYTHONS = ("3.9", "3.10", "3.11", "3.12", "3.13", "3.14")


class Specifier:
    """One comparison out of a requirement, such as `>=3.11` or `==1.4.*`."""

    def __init__(self, text):
        match = SPECIFIER_PATTERN.match(text)
        if match is None:
            raise ProjectError(f"{text!r} is not a version specifier")
        self.operator, self.value = match.group(1), match.group(2)
        self.text = f"{self.operator}{self.value}"
        self.wildcard = self.value.endswith(".*")
        if self.wildcard and self.operator not in ("==", "!="):
            raise ProjectError(f"{self.text!r}: only == and != may take a wildcard")
        if self.operator == "===":
            self.version = None
            return
        self.version = Version(self.value[:-2] if self.wildcard else self.value)
        if self.operator == "~=" and len(self.version.release) < 2:
            raise ProjectError(
                f"{self.text!r}: ~= needs at least two release segments, because "
                f"it means 'this series', and one number does not name a series"
            )

    @staticmethod
    def _padded(release, length):
        """Release numbers padded with zeros, because 1 and 1.0 are one version."""
        return (tuple(release) + (0,) * length)[:length]

    def matches(self, version):
        """Whether `version` satisfies this one comparison."""
        version = version if isinstance(version, Version) else Version(version)
        if self.operator == "===":
            return str(version) == self.value
        if self.wildcard:
            prefix = self.version.release
            same = self._padded(version.release, len(prefix)) == prefix
            return same if self.operator == "==" else not same
        if self.operator == "~=":
            # Compatible release: at least this version, and inside the series
            # named by everything but its last number. ~=1.4.2 is >=1.4.2 and
            # ==1.4.*, which is the pair of rules people mean by "compatible".
            series = self.version.release[:-1]
            return (version >= self.version
                    and self._padded(version.release, len(series)) == series)
        comparisons = {
            "==": version == self.version,
            "!=": version != self.version,
            "<": version < self.version,
            "<=": version <= self.version,
            ">": version > self.version,
            ">=": version >= self.version,
        }
        return comparisons[self.operator]

    def __contains__(self, version):
        return self.matches(version)

    def __repr__(self):
        return f"Specifier({self.text!r})"


class SpecifierSet:
    """Every comparison in one requirement, all of which have to hold."""

    def __init__(self, text=""):
        self.specifiers = [
            Specifier(part) for part in str(text).split(",") if part.strip()
        ]

    @property
    def allows_prereleases(self):
        """Whether a pre-release can satisfy this set.

        PEP 440's rule, and the one that surprises people: `>=1.0` does not
        match `2.0a1`. An installer will not hand you a pre-release unless you
        asked for one, and asking means naming one in the specifier.
        """
        return any(
            s.version is not None and s.version.is_prerelease for s in self.specifiers
        )

    def matches(self, version):
        """Whether `version` satisfies all of them."""
        version = version if isinstance(version, Version) else Version(version)
        if version.is_prerelease and not self.allows_prereleases:
            return False
        return all(specifier.matches(version) for specifier in self.specifiers)

    def __contains__(self, version):
        return self.matches(version)

    def __len__(self):
        return len(self.specifiers)

    def __repr__(self):
        return f"SpecifierSet({','.join(s.text for s in self.specifiers)!r})"


def python_matrix(project, candidates=DEFAULT_PYTHONS):
    """The Python versions this project says it runs on.

    This is where the previous stage pays for itself. Sorted as strings, "3.9"
    comes after "3.10", so a matrix built on string comparison quietly drops
    the newest interpreters or keeps one it should not.
    """
    allowed = SpecifierSet(project.requires_python)
    return [text for text in candidates if allowed.matches(text)]


def python_classifiers(project, candidates=DEFAULT_PYTHONS):
    """The classifiers PyPI shows, derived rather than typed out by hand."""
    return [
        f"Programming Language :: Python :: {text}"
        for text in python_matrix(project, candidates)
    ]

~~~

## Names, filenames, and the metadata that goes inside

Three names come out of one project, and they are not the same string.

The distribution name is normalised the way PEP 503 says: runs of hyphens,
underscores and dots all become one hyphen, and the whole thing is lowercased.
That is why `pip install Flask-SQLAlchemy` and `pip install flask_sqlalchemy`
reach the same project. The wheel filename takes that and turns hyphens into
underscores, because a wheel filename is read by splitting it on hyphens into
five fields and a name with one in it would break the reader. The importable
package name is a third transformation, which stage three already did.

A wheel filename is `name-version-python-abi-platform.whl`, and the version is
escaped the same way the name is, for the same reason: `1.0-1` is a perfectly
legal post-release, and a hyphen inside a field of a hyphen-separated filename
gives you six fields where the reader wants five. Pure Python with nothing
compiled is `py3-none-any`, meaning any Python 3, no particular ABI, any
platform. A wheel with C in it names the interpreter and the platform it
was built for, which is why one release of numpy is dozens of files and one
release of a tool like this is a single one.

METADATA is email headers followed by a blank line and the description. That is
not a joke about packaging: the format was already specified and already had a
parser in the standard library, so the first packaging specs took it. It means
`email.message_from_string` reads a wheel's metadata, which the tests use.

@goal Names normalise, filenames have five fields, and METADATA parses as email.

~~~starter
import argparse
import functools
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")

    matrix = commands.add_parser("matrix", help="the Pythons this project supports")
    matrix.add_argument("path", nargs="?", default=".",
                        help="the directory holding pyproject.toml")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


def cmd_matrix(args, out):
    """Print the Python versions the project supports, one per line."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    supported = python_matrix(project)
    if not supported:
        print(f"pkgit: {project.requires_python!r} matches no known Python", file=out)
        return 1
    for text in supported:
        print(text, file=out)
    return 0


COMMANDS = {"info": cmd_info, "matrix": cmd_matrix}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)


MAIN_TEMPLATE = """\
import sys

from {module} import {attribute}

if __name__ == "__main__":
    sys.exit({attribute}())
"""

SCRIPT_TEMPLATE = """\
import sys

from {module} import {attribute}

sys.exit({attribute}())
"""


def split_entry_point(target):
    """`"module:attribute"` as a pair, or a ProjectError saying what is wrong."""
    module, separator, attribute = target.partition(":")
    if not separator or not module or not attribute:
        raise ProjectError(f"{target!r} does not name a function as module:function")
    if not all(part.isidentifier() for part in module.split(".")):
        raise ProjectError(f"{target!r}: {module!r} is not a module path")
    if not all(part.isidentifier() for part in attribute.split(".")):
        raise ProjectError(f"{target!r}: {attribute!r} is not an attribute name")
    return module, attribute


def main_module_source(target):
    """The `__main__.py` that makes `python -m <package>` work.

    Every line earns its place. The guard is unit 29's: a module run as a
    program has `__name__` set to "__main__" and a module imported by something
    else does not, so the import above it costs nothing to whoever imports the
    package. `sys.exit` is what turns the number `main` returns into the number
    the shell sees, which is the reason `main` returns one.
    """
    module, attribute = split_entry_point(target)
    return MAIN_TEMPLATE.format(module=module, attribute=attribute)


def console_script_source(target):
    """What an installer writes for a console script, near enough.

    The `pkgit` command on somebody's PATH is a small Python file that imports
    the function the entry point names and exits with what it returns. The same
    lines as `__main__.py` without the guard, because a script is run and never
    imported, so there is nothing for a guard to protect against.
    """
    module, attribute = split_entry_point(target)
    return SCRIPT_TEMPLATE.format(module=module, attribute=attribute)


def entry_points_metadata(project):
    """The `entry_points.txt` a wheel carries, in the format the spec asks for."""
    if not project.scripts:
        return ""
    lines = ["[console_scripts]"]
    for command, target in sorted(project.scripts.items()):
        split_entry_point(target)
        lines.append(f"{command} = {target}")
    return "\n".join(lines) + "\n"


def package_name(project):
    """The importable name for a distribution name.

    A distribution is named with hyphens and a package is named with
    underscores, because a hyphen is not valid in an identifier. `pip install
    my-tool` then `import my_tool` is this rule and not a coincidence.
    """
    return project.name.replace("-", "_").replace(".", "_").lower()


def scaffold(project, root=None, force=False):
    """Write the package layout the project describes. Returns what it wrote.

    A file that is already there is left alone. The alternative is a generator
    that silently replaces somebody's module with a one line stub the first
    time they run it twice, and `force=True` is how a caller says they meant
    that.
    """
    root = Path(root) if root is not None else project.root
    directory = root / package_name(project)
    directory.mkdir(parents=True, exist_ok=True)

    wanted = [(directory / "__init__.py", f'__version__ = "{project.version}"\n')]
    if project.scripts:
        target = project.scripts[sorted(project.scripts)[0]]
        wanted.append((directory / "__main__.py", main_module_source(target)))

    written = []
    for path, text in wanted:
        if path.exists() and not force:
            continue
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written

VERSION_PATTERN = re.compile(
    r"""
    ^\s*v?
    (?:(?P<epoch>\d+)!)?                     # 1!2.0 sorts above every 2.0
    (?P<release>\d+(?:\.\d+)*)
    (?:[-_.]?(?P<pre_l>a|b|c|rc|alpha|beta|pre|preview)[-_.]?(?P<pre_n>\d+)?)?
    (?P<post>-(?P<post_n1>\d+)|[-_.]?(?P<post_l>post|rev|r)[-_.]?(?P<post_n2>\d+)?)?
    (?P<dev>[-_.]?dev[-_.]?(?P<dev_n>\d+)?)?
    (?:\+(?P<local>[a-z0-9]+(?:[-_.][a-z0-9]+)*))?
    \s*$
    """,
    re.VERBOSE | re.IGNORECASE,
)

PRE_NAMES = {"alpha": "a", "beta": "b", "c": "rc", "pre": "rc", "preview": "rc"}


class InvalidVersion(ProjectError):
    """A version string PEP 440 does not describe."""


@functools.total_ordering
class Version:
    """A version that sorts the way the specification says it should.

    Reading one is the easy half. The ordering is where the rules live: a dev
    release comes before its own pre-releases, a pre-release comes before the
    release it leads to, and a post-release comes after it. Written out that is
    1.0.dev1 < 1.0a1 < 1.0 < 1.0.post1, which is not what a plain string
    comparison gives you and not what a tuple of integers gives you either.
    """

    def __init__(self, text):
        match = VERSION_PATTERN.match(str(text))
        if match is None:
            raise InvalidVersion(f"{text!r} is not a valid version")
        parts = match.groupdict()
        self.text = str(text).strip()
        self.epoch = int(parts["epoch"] or 0)
        self.release = tuple(int(n) for n in parts["release"].split("."))
        self.pre = self._pre(parts)
        self.post = self._segment(parts["post"], parts["post_n1"], parts["post_n2"])
        self.dev = self._segment(parts["dev"], parts["dev_n"])
        self.local = self._local(parts["local"])

    @staticmethod
    def _local(text):
        """A local label is dot separated, and a hyphen or underscore is a dot."""
        if not text:
            return ()
        return tuple(text.lower().replace("-", ".").replace("_", ".").split("."))

    @staticmethod
    def _pre(parts):
        if parts["pre_l"] is None:
            return None
        letter = parts["pre_l"].lower()
        return PRE_NAMES.get(letter, letter), int(parts["pre_n"] or 0)

    @staticmethod
    def _segment(present, *numbers):
        """A segment may be written with a number, without one, or not at all.

        `1.0.post1`, `1.0.post` and `1.0` are three different answers, and the
        middle one means post-release zero rather than no post-release.
        """
        if present is None:
            return None
        for number in numbers:
            if number is not None:
                return int(number)
        return 0

    @property
    def base(self):
        """The release numbers alone, which is what a wildcard compares against."""
        return self.release

    @property
    def is_prerelease(self):
        return self.pre is not None or self.dev is not None

    def _key(self):
        """One tuple that sorts correctly, so the comparisons are one line each.

        Each segment becomes a small tuple whose first number is its rank, so
        plain tuple comparison does the work and there are no sentinel objects
        to explain. A dev release with no pre-release ranks below every
        pre-release, and a release with neither ranks above them all.
        """
        release = self.release
        while len(release) > 1 and release[-1] == 0:
            release = release[:-1]
        if self.pre is not None:
            pre = (1, *self.pre)
        elif self.dev is not None:
            pre = (0,)
        else:
            pre = (2,)
        post = (0,) if self.post is None else (1, self.post)
        dev = (1,) if self.dev is None else (0, self.dev)
        local = (1, self.local) if self.local else (0,)
        return self.epoch, release, pre, post, dev, local

    def __eq__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() == other._key()

    def __lt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() < other._key()

    def __hash__(self):
        return hash(self._key())

    def __repr__(self):
        return f"Version({self.text!r})"

    def __str__(self):
        return self.text

SPECIFIER_PATTERN = re.compile(r"^\s*(===|==|!=|~=|<=|>=|<|>)\s*([^\s,]+)\s*$")

DEFAULT_PYTHONS = ("3.9", "3.10", "3.11", "3.12", "3.13", "3.14")


class Specifier:
    """One comparison out of a requirement, such as `>=3.11` or `==1.4.*`."""

    def __init__(self, text):
        match = SPECIFIER_PATTERN.match(text)
        if match is None:
            raise ProjectError(f"{text!r} is not a version specifier")
        self.operator, self.value = match.group(1), match.group(2)
        self.text = f"{self.operator}{self.value}"
        self.wildcard = self.value.endswith(".*")
        if self.wildcard and self.operator not in ("==", "!="):
            raise ProjectError(f"{self.text!r}: only == and != may take a wildcard")
        if self.operator == "===":
            self.version = None
            return
        self.version = Version(self.value[:-2] if self.wildcard else self.value)
        if self.operator == "~=" and len(self.version.release) < 2:
            raise ProjectError(
                f"{self.text!r}: ~= needs at least two release segments, because "
                f"it means 'this series', and one number does not name a series"
            )

    @staticmethod
    def _padded(release, length):
        """Release numbers padded with zeros, because 1 and 1.0 are one version."""
        return (tuple(release) + (0,) * length)[:length]

    def matches(self, version):
        """Whether `version` satisfies this one comparison."""
        version = version if isinstance(version, Version) else Version(version)
        if self.operator == "===":
            return str(version) == self.value
        if self.wildcard:
            prefix = self.version.release
            same = self._padded(version.release, len(prefix)) == prefix
            return same if self.operator == "==" else not same
        if self.operator == "~=":
            # Compatible release: at least this version, and inside the series
            # named by everything but its last number. ~=1.4.2 is >=1.4.2 and
            # ==1.4.*, which is the pair of rules people mean by "compatible".
            series = self.version.release[:-1]
            return (version >= self.version
                    and self._padded(version.release, len(series)) == series)
        comparisons = {
            "==": version == self.version,
            "!=": version != self.version,
            "<": version < self.version,
            "<=": version <= self.version,
            ">": version > self.version,
            ">=": version >= self.version,
        }
        return comparisons[self.operator]

    def __contains__(self, version):
        return self.matches(version)

    def __repr__(self):
        return f"Specifier({self.text!r})"


class SpecifierSet:
    """Every comparison in one requirement, all of which have to hold."""

    def __init__(self, text=""):
        self.specifiers = [
            Specifier(part) for part in str(text).split(",") if part.strip()
        ]

    @property
    def allows_prereleases(self):
        """Whether a pre-release can satisfy this set.

        PEP 440's rule, and the one that surprises people: `>=1.0` does not
        match `2.0a1`. An installer will not hand you a pre-release unless you
        asked for one, and asking means naming one in the specifier.
        """
        return any(
            s.version is not None and s.version.is_prerelease for s in self.specifiers
        )

    def matches(self, version):
        """Whether `version` satisfies all of them."""
        version = version if isinstance(version, Version) else Version(version)
        if version.is_prerelease and not self.allows_prereleases:
            return False
        return all(specifier.matches(version) for specifier in self.specifiers)

    def __contains__(self, version):
        return self.matches(version)

    def __len__(self):
        return len(self.specifiers)

    def __repr__(self):
        return f"SpecifierSet({','.join(s.text for s in self.specifiers)!r})"


def python_matrix(project, candidates=DEFAULT_PYTHONS):
    """The Python versions this project says it runs on.

    This is where the previous stage pays for itself. Sorted as strings, "3.9"
    comes after "3.10", so a matrix built on string comparison quietly drops
    the newest interpreters or keeps one it should not.
    """
    allowed = SpecifierSet(project.requires_python)
    return [text for text in candidates if allowed.matches(text)]


def python_classifiers(project, candidates=DEFAULT_PYTHONS):
    """The classifiers PyPI shows, derived rather than typed out by hand."""
    return [
        f"Programming Language :: Python :: {text}"
        for text in python_matrix(project, candidates)
    ]



METADATA_VERSION = "2.1"


def normalise_name(name):
    """The one spelling of a distribution name, per PEP 503."""
    raise NotImplementedError


def wheel_escape(name):
    """A normalised name with hyphens turned into underscores."""
    raise NotImplementedError


def version_escape(version):
    """A version with every run of non-alphanumerics collapsed to one underscore.

    PEP 427, and the same reason the name is escaped. A wheel filename is read
    by splitting it on hyphens into five fields, and `1.0-1` is a perfectly
    legal post-release with a hyphen sitting in the middle of it.
    """
    return re.sub(r"[^\w\d.]+", "_", str(version))


def wheel_stem(project):
    """The escaped name and version, which every wheel artefact starts with."""
    return (f"{wheel_escape(project.name)}-"
            f"{version_escape(Version(project.version))}")


def wheel_filename(project, python_tag="py3", abi_tag="none", platform_tag="any"):
    """`{name}-{version}-{python}-{abi}-{platform}.whl`, the five fields."""
    raise NotImplementedError


def dist_info_dir(project):
    """The `.dist-info` directory inside the wheel, which holds the metadata."""
    raise NotImplementedError


def metadata_text(project, candidates=DEFAULT_PYTHONS):
    """The METADATA file: headers, a blank line, then the description."""
    raise NotImplementedError
~~~

~~~tests
import email
import io
from pathlib import Path


def write(name, text):
    Path(name).parent.mkdir(parents=True, exist_ok=True)
    Path(name).write_text(text, encoding="utf-8")


# stage five still holds
assert Specifier("~=1.4.2").matches("1.4.9") and not Specifier("~=1.4.2").matches("1.5")
assert not SpecifierSet(">=1.0").matches("2.0a1")

# every spelling of a name reaches the same project
for spelling in ("Flask-SQLAlchemy", "flask_sqlalchemy", "Flask.SQLAlchemy",
                 "flask--sqlalchemy", "FLASK_-_SQLALCHEMY"):
    assert normalise_name(spelling) == "flask-sqlalchemy", spelling
assert normalise_name("a") == "a"
assert normalise_name("Zope2") == "zope2"

# and a name that would break a filename is refused
for bad in ("", "-leading", "trailing-", "with space", "with/slash", "_x", "x."):
    try:
        normalise_name(bad)
    except ProjectError as exc:
        assert "usable distribution name" in str(exc)
    else:
        raise AssertionError(f"{bad!r} should not be a name")

# a wheel filename is read by splitting on hyphens, so the name holds none
assert wheel_escape("Flask-SQLAlchemy") == "flask_sqlalchemy"
assert wheel_escape("my.tool") == "my_tool"

project = Project(name="My-Tool", version="1.0", description="does a thing",
                  requires_python=">=3.12", dependencies=["rich>=13"])
name = wheel_filename(project)
assert name == "my_tool-1.0-py3-none-any.whl", name
assert len(name.removesuffix(".whl").split("-")) == 5, "five fields, always"
assert dist_info_dir(project) == "my_tool-1.0.dist-info"

# the version is normalised into the filename too, not copied from the file
assert wheel_filename(Project(name="x", version="1.0.0")).startswith("x-1.0.0-")
assert wheel_filename(Project(name="x", version="v1.0")) == "x-v1.0-py3-none-any.whl"

# the version is escaped the same way the name is, because a post-release is
# allowed a hyphen and a wheel filename is read by splitting on hyphens
assert version_escape("1.0") == "1.0"
assert version_escape("1.0-1") == "1.0_1"
assert version_escape("1.0+ubuntu-2") == "1.0_ubuntu_2"
assert version_escape("1!2.0") == "1_2.0"

post = Project(name="mytool", version="1.0-1")
built = wheel_filename(post)
assert built == "mytool-1.0_1-py3-none-any.whl", built
assert len(built.removesuffix(".whl").split("-")) == 5, "still five fields"
assert dist_info_dir(post) == "mytool-1.0_1.dist-info"

# a compiled wheel names what it was built for, which is why numpy has dozens
compiled = wheel_filename(project, "cp312", "cp312", "manylinux_2_17_x86_64")
assert compiled == "my_tool-1.0-cp312-cp312-manylinux_2_17_x86_64.whl", compiled

# a version the tool cannot read stops here rather than in the zip
try:
    wheel_filename(Project(name="x", version="not a version"))
except InvalidVersion:
    pass
else:
    raise AssertionError("a bad version should not reach a filename")

# METADATA is email headers, which means email.parser reads it back
text = metadata_text(project, ("3.12", "3.13"))
parsed = email.message_from_string(text)
assert parsed["Metadata-Version"] == "2.1"
assert parsed["Name"] == "my-tool", "the header carries the normalised name"
assert parsed["Version"] == "1.0"
assert parsed["Summary"] == "does a thing"
assert parsed["Requires-Python"] == ">=3.12"
assert parsed.get_all("Requires-Dist") == ["rich>=13"]
assert parsed.get_all("Classifier") == [
    "Programming Language :: Python :: 3.12",
    "Programming Language :: Python :: 3.13",
]

# headers end with a blank line, which is what separates them from a description
assert text.endswith("\n\n")
assert "\n\n" not in text[:-2], "there is exactly one blank line, at the end"

# nothing optional produces nothing optional
bare = metadata_text(Project(name="bare", version="1.0"), ())
assert bare == "Metadata-Version: 2.1\nName: bare\nVersion: 1.0\n\n", repr(bare)
assert "Summary" not in bare and "Requires-Dist" not in bare

# and a requires-python that is not a specifier is caught here
try:
    metadata_text(Project(name="x", version="1", requires_python="3.11"))
except ProjectError:
    pass
else:
    raise AssertionError("a bare version is not a requires-python")

# the whole thing off a real file, through everything built so far
write("real/pyproject.toml", """
[project]
name = "Pkg-It"
version = "0.2.0"
description = "a packaging tool that can package itself"
requires-python = ">=3.13"
dependencies = ["tomli-w"]
[project.scripts]
pkgit = "pkg_it.cli:main"
""")
loaded = load_project("real")
assert wheel_filename(loaded) == "pkg_it-0.2.0-py3-none-any.whl"
assert package_name(loaded) == "pkg_it"
assert email.message_from_string(metadata_text(loaded))["Name"] == "pkg-it"
assert python_matrix(loaded) == ["3.13", "3.14"]
assert main(["info", "real"], io.StringIO()) == 0
~~~

~~~solution
import argparse
import functools
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")

    matrix = commands.add_parser("matrix", help="the Pythons this project supports")
    matrix.add_argument("path", nargs="?", default=".",
                        help="the directory holding pyproject.toml")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


def cmd_matrix(args, out):
    """Print the Python versions the project supports, one per line."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    supported = python_matrix(project)
    if not supported:
        print(f"pkgit: {project.requires_python!r} matches no known Python", file=out)
        return 1
    for text in supported:
        print(text, file=out)
    return 0


COMMANDS = {"info": cmd_info, "matrix": cmd_matrix}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)


MAIN_TEMPLATE = """\
import sys

from {module} import {attribute}

if __name__ == "__main__":
    sys.exit({attribute}())
"""

SCRIPT_TEMPLATE = """\
import sys

from {module} import {attribute}

sys.exit({attribute}())
"""


def split_entry_point(target):
    """`"module:attribute"` as a pair, or a ProjectError saying what is wrong."""
    module, separator, attribute = target.partition(":")
    if not separator or not module or not attribute:
        raise ProjectError(f"{target!r} does not name a function as module:function")
    if not all(part.isidentifier() for part in module.split(".")):
        raise ProjectError(f"{target!r}: {module!r} is not a module path")
    if not all(part.isidentifier() for part in attribute.split(".")):
        raise ProjectError(f"{target!r}: {attribute!r} is not an attribute name")
    return module, attribute


def main_module_source(target):
    """The `__main__.py` that makes `python -m <package>` work.

    Every line earns its place. The guard is unit 29's: a module run as a
    program has `__name__` set to "__main__" and a module imported by something
    else does not, so the import above it costs nothing to whoever imports the
    package. `sys.exit` is what turns the number `main` returns into the number
    the shell sees, which is the reason `main` returns one.
    """
    module, attribute = split_entry_point(target)
    return MAIN_TEMPLATE.format(module=module, attribute=attribute)


def console_script_source(target):
    """What an installer writes for a console script, near enough.

    The `pkgit` command on somebody's PATH is a small Python file that imports
    the function the entry point names and exits with what it returns. The same
    lines as `__main__.py` without the guard, because a script is run and never
    imported, so there is nothing for a guard to protect against.
    """
    module, attribute = split_entry_point(target)
    return SCRIPT_TEMPLATE.format(module=module, attribute=attribute)


def entry_points_metadata(project):
    """The `entry_points.txt` a wheel carries, in the format the spec asks for."""
    if not project.scripts:
        return ""
    lines = ["[console_scripts]"]
    for command, target in sorted(project.scripts.items()):
        split_entry_point(target)
        lines.append(f"{command} = {target}")
    return "\n".join(lines) + "\n"


def package_name(project):
    """The importable name for a distribution name.

    A distribution is named with hyphens and a package is named with
    underscores, because a hyphen is not valid in an identifier. `pip install
    my-tool` then `import my_tool` is this rule and not a coincidence.
    """
    return project.name.replace("-", "_").replace(".", "_").lower()


def scaffold(project, root=None, force=False):
    """Write the package layout the project describes. Returns what it wrote.

    A file that is already there is left alone. The alternative is a generator
    that silently replaces somebody's module with a one line stub the first
    time they run it twice, and `force=True` is how a caller says they meant
    that.
    """
    root = Path(root) if root is not None else project.root
    directory = root / package_name(project)
    directory.mkdir(parents=True, exist_ok=True)

    wanted = [(directory / "__init__.py", f'__version__ = "{project.version}"\n')]
    if project.scripts:
        target = project.scripts[sorted(project.scripts)[0]]
        wanted.append((directory / "__main__.py", main_module_source(target)))

    written = []
    for path, text in wanted:
        if path.exists() and not force:
            continue
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written

VERSION_PATTERN = re.compile(
    r"""
    ^\s*v?
    (?:(?P<epoch>\d+)!)?                     # 1!2.0 sorts above every 2.0
    (?P<release>\d+(?:\.\d+)*)
    (?:[-_.]?(?P<pre_l>a|b|c|rc|alpha|beta|pre|preview)[-_.]?(?P<pre_n>\d+)?)?
    (?P<post>-(?P<post_n1>\d+)|[-_.]?(?P<post_l>post|rev|r)[-_.]?(?P<post_n2>\d+)?)?
    (?P<dev>[-_.]?dev[-_.]?(?P<dev_n>\d+)?)?
    (?:\+(?P<local>[a-z0-9]+(?:[-_.][a-z0-9]+)*))?
    \s*$
    """,
    re.VERBOSE | re.IGNORECASE,
)

PRE_NAMES = {"alpha": "a", "beta": "b", "c": "rc", "pre": "rc", "preview": "rc"}


class InvalidVersion(ProjectError):
    """A version string PEP 440 does not describe."""


@functools.total_ordering
class Version:
    """A version that sorts the way the specification says it should.

    Reading one is the easy half. The ordering is where the rules live: a dev
    release comes before its own pre-releases, a pre-release comes before the
    release it leads to, and a post-release comes after it. Written out that is
    1.0.dev1 < 1.0a1 < 1.0 < 1.0.post1, which is not what a plain string
    comparison gives you and not what a tuple of integers gives you either.
    """

    def __init__(self, text):
        match = VERSION_PATTERN.match(str(text))
        if match is None:
            raise InvalidVersion(f"{text!r} is not a valid version")
        parts = match.groupdict()
        self.text = str(text).strip()
        self.epoch = int(parts["epoch"] or 0)
        self.release = tuple(int(n) for n in parts["release"].split("."))
        self.pre = self._pre(parts)
        self.post = self._segment(parts["post"], parts["post_n1"], parts["post_n2"])
        self.dev = self._segment(parts["dev"], parts["dev_n"])
        self.local = self._local(parts["local"])

    @staticmethod
    def _local(text):
        """A local label is dot separated, and a hyphen or underscore is a dot."""
        if not text:
            return ()
        return tuple(text.lower().replace("-", ".").replace("_", ".").split("."))

    @staticmethod
    def _pre(parts):
        if parts["pre_l"] is None:
            return None
        letter = parts["pre_l"].lower()
        return PRE_NAMES.get(letter, letter), int(parts["pre_n"] or 0)

    @staticmethod
    def _segment(present, *numbers):
        """A segment may be written with a number, without one, or not at all.

        `1.0.post1`, `1.0.post` and `1.0` are three different answers, and the
        middle one means post-release zero rather than no post-release.
        """
        if present is None:
            return None
        for number in numbers:
            if number is not None:
                return int(number)
        return 0

    @property
    def base(self):
        """The release numbers alone, which is what a wildcard compares against."""
        return self.release

    @property
    def is_prerelease(self):
        return self.pre is not None or self.dev is not None

    def _key(self):
        """One tuple that sorts correctly, so the comparisons are one line each.

        Each segment becomes a small tuple whose first number is its rank, so
        plain tuple comparison does the work and there are no sentinel objects
        to explain. A dev release with no pre-release ranks below every
        pre-release, and a release with neither ranks above them all.
        """
        release = self.release
        while len(release) > 1 and release[-1] == 0:
            release = release[:-1]
        if self.pre is not None:
            pre = (1, *self.pre)
        elif self.dev is not None:
            pre = (0,)
        else:
            pre = (2,)
        post = (0,) if self.post is None else (1, self.post)
        dev = (1,) if self.dev is None else (0, self.dev)
        local = (1, self.local) if self.local else (0,)
        return self.epoch, release, pre, post, dev, local

    def __eq__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() == other._key()

    def __lt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() < other._key()

    def __hash__(self):
        return hash(self._key())

    def __repr__(self):
        return f"Version({self.text!r})"

    def __str__(self):
        return self.text

SPECIFIER_PATTERN = re.compile(r"^\s*(===|==|!=|~=|<=|>=|<|>)\s*([^\s,]+)\s*$")

DEFAULT_PYTHONS = ("3.9", "3.10", "3.11", "3.12", "3.13", "3.14")


class Specifier:
    """One comparison out of a requirement, such as `>=3.11` or `==1.4.*`."""

    def __init__(self, text):
        match = SPECIFIER_PATTERN.match(text)
        if match is None:
            raise ProjectError(f"{text!r} is not a version specifier")
        self.operator, self.value = match.group(1), match.group(2)
        self.text = f"{self.operator}{self.value}"
        self.wildcard = self.value.endswith(".*")
        if self.wildcard and self.operator not in ("==", "!="):
            raise ProjectError(f"{self.text!r}: only == and != may take a wildcard")
        if self.operator == "===":
            self.version = None
            return
        self.version = Version(self.value[:-2] if self.wildcard else self.value)
        if self.operator == "~=" and len(self.version.release) < 2:
            raise ProjectError(
                f"{self.text!r}: ~= needs at least two release segments, because "
                f"it means 'this series', and one number does not name a series"
            )

    @staticmethod
    def _padded(release, length):
        """Release numbers padded with zeros, because 1 and 1.0 are one version."""
        return (tuple(release) + (0,) * length)[:length]

    def matches(self, version):
        """Whether `version` satisfies this one comparison."""
        version = version if isinstance(version, Version) else Version(version)
        if self.operator == "===":
            return str(version) == self.value
        if self.wildcard:
            prefix = self.version.release
            same = self._padded(version.release, len(prefix)) == prefix
            return same if self.operator == "==" else not same
        if self.operator == "~=":
            # Compatible release: at least this version, and inside the series
            # named by everything but its last number. ~=1.4.2 is >=1.4.2 and
            # ==1.4.*, which is the pair of rules people mean by "compatible".
            series = self.version.release[:-1]
            return (version >= self.version
                    and self._padded(version.release, len(series)) == series)
        comparisons = {
            "==": version == self.version,
            "!=": version != self.version,
            "<": version < self.version,
            "<=": version <= self.version,
            ">": version > self.version,
            ">=": version >= self.version,
        }
        return comparisons[self.operator]

    def __contains__(self, version):
        return self.matches(version)

    def __repr__(self):
        return f"Specifier({self.text!r})"


class SpecifierSet:
    """Every comparison in one requirement, all of which have to hold."""

    def __init__(self, text=""):
        self.specifiers = [
            Specifier(part) for part in str(text).split(",") if part.strip()
        ]

    @property
    def allows_prereleases(self):
        """Whether a pre-release can satisfy this set.

        PEP 440's rule, and the one that surprises people: `>=1.0` does not
        match `2.0a1`. An installer will not hand you a pre-release unless you
        asked for one, and asking means naming one in the specifier.
        """
        return any(
            s.version is not None and s.version.is_prerelease for s in self.specifiers
        )

    def matches(self, version):
        """Whether `version` satisfies all of them."""
        version = version if isinstance(version, Version) else Version(version)
        if version.is_prerelease and not self.allows_prereleases:
            return False
        return all(specifier.matches(version) for specifier in self.specifiers)

    def __contains__(self, version):
        return self.matches(version)

    def __len__(self):
        return len(self.specifiers)

    def __repr__(self):
        return f"SpecifierSet({','.join(s.text for s in self.specifiers)!r})"


def python_matrix(project, candidates=DEFAULT_PYTHONS):
    """The Python versions this project says it runs on.

    This is where the previous stage pays for itself. Sorted as strings, "3.9"
    comes after "3.10", so a matrix built on string comparison quietly drops
    the newest interpreters or keeps one it should not.
    """
    allowed = SpecifierSet(project.requires_python)
    return [text for text in candidates if allowed.matches(text)]


def python_classifiers(project, candidates=DEFAULT_PYTHONS):
    """The classifiers PyPI shows, derived rather than typed out by hand."""
    return [
        f"Programming Language :: Python :: {text}"
        for text in python_matrix(project, candidates)
    ]


NAME_PATTERN = re.compile(r"^([a-z0-9]|[a-z0-9][a-z0-9._-]*[a-z0-9])$", re.IGNORECASE)

METADATA_VERSION = "2.1"


def normalise_name(name):
    """The one spelling of a distribution name, per PEP 503.

    Runs of hyphens, underscores and dots all become a single hyphen, and the
    whole thing is lowercased. It is why `pip install Flask-SQLAlchemy`,
    `flask_sqlalchemy` and `flask.sqlalchemy` reach the same project.
    """
    if not NAME_PATTERN.match(str(name)):
        raise ProjectError(
            f"{name!r} is not a usable distribution name: it has to start and "
            f"end with a letter or digit, and hold only letters, digits, and "
            f"the separators - _ ."
        )
    return re.sub(r"[-_.]+", "-", str(name)).lower()


def wheel_escape(name):
    """A normalised name with hyphens turned into underscores.

    A wheel filename is read by splitting on hyphens, so the name cannot
    contain one. This is not the same transformation as the importable package
    name, even though it usually lands on the same string.
    """
    return normalise_name(name).replace("-", "_")


def version_escape(version):
    """A version with every run of non-alphanumerics collapsed to one underscore.

    PEP 427, and the same reason the name is escaped. A wheel filename is read
    by splitting it on hyphens into five fields, and `1.0-1` is a perfectly
    legal post-release with a hyphen sitting in the middle of it.
    """
    return re.sub(r"[^\w\d.]+", "_", str(version))


def wheel_stem(project):
    """The escaped name and version, which every wheel artefact starts with."""
    return (f"{wheel_escape(project.name)}-"
            f"{version_escape(Version(project.version))}")


def wheel_filename(project, python_tag="py3", abi_tag="none", platform_tag="any"):
    """`{name}-{version}-{python}-{abi}-{platform}.whl`, the five fields.

    Pure Python with no compiled parts is `py3-none-any`, which means any
    Python 3, no particular ABI, any platform. A wheel with C in it names the
    interpreter and the platform it was built for, which is why there are
    dozens of files behind one release of numpy and one behind most tools.
    """
    return f"{wheel_stem(project)}-{python_tag}-{abi_tag}-{platform_tag}.whl"


def dist_info_dir(project):
    """The `.dist-info` directory inside the wheel, which holds the metadata."""
    return f"{wheel_stem(project)}.dist-info"


def metadata_text(project, candidates=DEFAULT_PYTHONS):
    """The METADATA file: headers, a blank line, then the description.

    The format is the one email uses, which is not a coincidence. It was
    already specified, already had a parser in the standard library, and the
    people writing the first packaging specs took it rather than inventing one.
    """
    lines = [
        f"Metadata-Version: {METADATA_VERSION}",
        f"Name: {normalise_name(project.name)}",
        f"Version: {Version(project.version)}",
    ]
    if project.description:
        lines.append(f"Summary: {project.description}")
    if project.requires_python:
        SpecifierSet(project.requires_python)
        lines.append(f"Requires-Python: {project.requires_python}")
    lines.extend(f"Classifier: {text}" for text in
                 python_classifiers(project, candidates))
    lines.extend(f"Requires-Dist: {text}" for text in project.dependencies)
    return "\n".join(lines) + "\n\n"
~~~

## The wheel, which is a zip that agreed on some names

A wheel is a zip file. There is no compiled step for pure Python and no
installer logic inside it: installing one is unpacking it into `site-packages`
and writing the console scripts. Everything that makes it a wheel rather than a
zip is agreement about names.

Three of those names live in the `.dist-info` directory. METADATA is what the
last stage built. WHEEL says how the archive itself is put together. RECORD
lists every file with its SHA-256 and its size, which is what lets an installer
notice a wheel that arrived damaged. RECORD cannot carry its own hash, because
writing the hash in would change the file the hash was taken of, so its own row
is the name and two empty fields.

The last decision is about time. A zip stores a timestamp per entry, and a
timestamp is the clock leaking into the output, so two builds of the same
source produce different bytes and nobody can check one against the other.
Stamping every entry with one fixed date and writing them in sorted order makes
the build reproducible, which is a property people now expect and which costs
two lines to have.

@goal `build_wheel` writes a valid wheel, and building twice gives the same bytes.

~~~starter
import argparse
import base64
import csv
import functools
import hashlib
import io
import re
import sys
import tomllib
import zipfile
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")

    matrix = commands.add_parser("matrix", help="the Pythons this project supports")
    matrix.add_argument("path", nargs="?", default=".",
                        help="the directory holding pyproject.toml")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


def cmd_matrix(args, out):
    """Print the Python versions the project supports, one per line."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    supported = python_matrix(project)
    if not supported:
        print(f"pkgit: {project.requires_python!r} matches no known Python", file=out)
        return 1
    for text in supported:
        print(text, file=out)
    return 0


COMMANDS = {"info": cmd_info, "matrix": cmd_matrix}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)


MAIN_TEMPLATE = """\
import sys

from {module} import {attribute}

if __name__ == "__main__":
    sys.exit({attribute}())
"""

SCRIPT_TEMPLATE = """\
import sys

from {module} import {attribute}

sys.exit({attribute}())
"""


def split_entry_point(target):
    """`"module:attribute"` as a pair, or a ProjectError saying what is wrong."""
    module, separator, attribute = target.partition(":")
    if not separator or not module or not attribute:
        raise ProjectError(f"{target!r} does not name a function as module:function")
    if not all(part.isidentifier() for part in module.split(".")):
        raise ProjectError(f"{target!r}: {module!r} is not a module path")
    if not all(part.isidentifier() for part in attribute.split(".")):
        raise ProjectError(f"{target!r}: {attribute!r} is not an attribute name")
    return module, attribute


def main_module_source(target):
    """The `__main__.py` that makes `python -m <package>` work.

    Every line earns its place. The guard is unit 29's: a module run as a
    program has `__name__` set to "__main__" and a module imported by something
    else does not, so the import above it costs nothing to whoever imports the
    package. `sys.exit` is what turns the number `main` returns into the number
    the shell sees, which is the reason `main` returns one.
    """
    module, attribute = split_entry_point(target)
    return MAIN_TEMPLATE.format(module=module, attribute=attribute)


def console_script_source(target):
    """What an installer writes for a console script, near enough.

    The `pkgit` command on somebody's PATH is a small Python file that imports
    the function the entry point names and exits with what it returns. The same
    lines as `__main__.py` without the guard, because a script is run and never
    imported, so there is nothing for a guard to protect against.
    """
    module, attribute = split_entry_point(target)
    return SCRIPT_TEMPLATE.format(module=module, attribute=attribute)


def entry_points_metadata(project):
    """The `entry_points.txt` a wheel carries, in the format the spec asks for."""
    if not project.scripts:
        return ""
    lines = ["[console_scripts]"]
    for command, target in sorted(project.scripts.items()):
        split_entry_point(target)
        lines.append(f"{command} = {target}")
    return "\n".join(lines) + "\n"


def package_name(project):
    """The importable name for a distribution name.

    A distribution is named with hyphens and a package is named with
    underscores, because a hyphen is not valid in an identifier. `pip install
    my-tool` then `import my_tool` is this rule and not a coincidence.
    """
    return project.name.replace("-", "_").replace(".", "_").lower()


def scaffold(project, root=None, force=False):
    """Write the package layout the project describes. Returns what it wrote.

    A file that is already there is left alone. The alternative is a generator
    that silently replaces somebody's module with a one line stub the first
    time they run it twice, and `force=True` is how a caller says they meant
    that.
    """
    root = Path(root) if root is not None else project.root
    directory = root / package_name(project)
    directory.mkdir(parents=True, exist_ok=True)

    wanted = [(directory / "__init__.py", f'__version__ = "{project.version}"\n')]
    if project.scripts:
        target = project.scripts[sorted(project.scripts)[0]]
        wanted.append((directory / "__main__.py", main_module_source(target)))

    written = []
    for path, text in wanted:
        if path.exists() and not force:
            continue
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written

VERSION_PATTERN = re.compile(
    r"""
    ^\s*v?
    (?:(?P<epoch>\d+)!)?                     # 1!2.0 sorts above every 2.0
    (?P<release>\d+(?:\.\d+)*)
    (?:[-_.]?(?P<pre_l>a|b|c|rc|alpha|beta|pre|preview)[-_.]?(?P<pre_n>\d+)?)?
    (?P<post>-(?P<post_n1>\d+)|[-_.]?(?P<post_l>post|rev|r)[-_.]?(?P<post_n2>\d+)?)?
    (?P<dev>[-_.]?dev[-_.]?(?P<dev_n>\d+)?)?
    (?:\+(?P<local>[a-z0-9]+(?:[-_.][a-z0-9]+)*))?
    \s*$
    """,
    re.VERBOSE | re.IGNORECASE,
)

PRE_NAMES = {"alpha": "a", "beta": "b", "c": "rc", "pre": "rc", "preview": "rc"}


class InvalidVersion(ProjectError):
    """A version string PEP 440 does not describe."""


@functools.total_ordering
class Version:
    """A version that sorts the way the specification says it should.

    Reading one is the easy half. The ordering is where the rules live: a dev
    release comes before its own pre-releases, a pre-release comes before the
    release it leads to, and a post-release comes after it. Written out that is
    1.0.dev1 < 1.0a1 < 1.0 < 1.0.post1, which is not what a plain string
    comparison gives you and not what a tuple of integers gives you either.
    """

    def __init__(self, text):
        match = VERSION_PATTERN.match(str(text))
        if match is None:
            raise InvalidVersion(f"{text!r} is not a valid version")
        parts = match.groupdict()
        self.text = str(text).strip()
        self.epoch = int(parts["epoch"] or 0)
        self.release = tuple(int(n) for n in parts["release"].split("."))
        self.pre = self._pre(parts)
        self.post = self._segment(parts["post"], parts["post_n1"], parts["post_n2"])
        self.dev = self._segment(parts["dev"], parts["dev_n"])
        self.local = self._local(parts["local"])

    @staticmethod
    def _local(text):
        """A local label is dot separated, and a hyphen or underscore is a dot."""
        if not text:
            return ()
        return tuple(text.lower().replace("-", ".").replace("_", ".").split("."))

    @staticmethod
    def _pre(parts):
        if parts["pre_l"] is None:
            return None
        letter = parts["pre_l"].lower()
        return PRE_NAMES.get(letter, letter), int(parts["pre_n"] or 0)

    @staticmethod
    def _segment(present, *numbers):
        """A segment may be written with a number, without one, or not at all.

        `1.0.post1`, `1.0.post` and `1.0` are three different answers, and the
        middle one means post-release zero rather than no post-release.
        """
        if present is None:
            return None
        for number in numbers:
            if number is not None:
                return int(number)
        return 0

    @property
    def base(self):
        """The release numbers alone, which is what a wildcard compares against."""
        return self.release

    @property
    def is_prerelease(self):
        return self.pre is not None or self.dev is not None

    def _key(self):
        """One tuple that sorts correctly, so the comparisons are one line each.

        Each segment becomes a small tuple whose first number is its rank, so
        plain tuple comparison does the work and there are no sentinel objects
        to explain. A dev release with no pre-release ranks below every
        pre-release, and a release with neither ranks above them all.
        """
        release = self.release
        while len(release) > 1 and release[-1] == 0:
            release = release[:-1]
        if self.pre is not None:
            pre = (1, *self.pre)
        elif self.dev is not None:
            pre = (0,)
        else:
            pre = (2,)
        post = (0,) if self.post is None else (1, self.post)
        dev = (1,) if self.dev is None else (0, self.dev)
        local = (1, self.local) if self.local else (0,)
        return self.epoch, release, pre, post, dev, local

    def __eq__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() == other._key()

    def __lt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() < other._key()

    def __hash__(self):
        return hash(self._key())

    def __repr__(self):
        return f"Version({self.text!r})"

    def __str__(self):
        return self.text

SPECIFIER_PATTERN = re.compile(r"^\s*(===|==|!=|~=|<=|>=|<|>)\s*([^\s,]+)\s*$")

DEFAULT_PYTHONS = ("3.9", "3.10", "3.11", "3.12", "3.13", "3.14")


class Specifier:
    """One comparison out of a requirement, such as `>=3.11` or `==1.4.*`."""

    def __init__(self, text):
        match = SPECIFIER_PATTERN.match(text)
        if match is None:
            raise ProjectError(f"{text!r} is not a version specifier")
        self.operator, self.value = match.group(1), match.group(2)
        self.text = f"{self.operator}{self.value}"
        self.wildcard = self.value.endswith(".*")
        if self.wildcard and self.operator not in ("==", "!="):
            raise ProjectError(f"{self.text!r}: only == and != may take a wildcard")
        if self.operator == "===":
            self.version = None
            return
        self.version = Version(self.value[:-2] if self.wildcard else self.value)
        if self.operator == "~=" and len(self.version.release) < 2:
            raise ProjectError(
                f"{self.text!r}: ~= needs at least two release segments, because "
                f"it means 'this series', and one number does not name a series"
            )

    @staticmethod
    def _padded(release, length):
        """Release numbers padded with zeros, because 1 and 1.0 are one version."""
        return (tuple(release) + (0,) * length)[:length]

    def matches(self, version):
        """Whether `version` satisfies this one comparison."""
        version = version if isinstance(version, Version) else Version(version)
        if self.operator == "===":
            return str(version) == self.value
        if self.wildcard:
            prefix = self.version.release
            same = self._padded(version.release, len(prefix)) == prefix
            return same if self.operator == "==" else not same
        if self.operator == "~=":
            # Compatible release: at least this version, and inside the series
            # named by everything but its last number. ~=1.4.2 is >=1.4.2 and
            # ==1.4.*, which is the pair of rules people mean by "compatible".
            series = self.version.release[:-1]
            return (version >= self.version
                    and self._padded(version.release, len(series)) == series)
        comparisons = {
            "==": version == self.version,
            "!=": version != self.version,
            "<": version < self.version,
            "<=": version <= self.version,
            ">": version > self.version,
            ">=": version >= self.version,
        }
        return comparisons[self.operator]

    def __contains__(self, version):
        return self.matches(version)

    def __repr__(self):
        return f"Specifier({self.text!r})"


class SpecifierSet:
    """Every comparison in one requirement, all of which have to hold."""

    def __init__(self, text=""):
        self.specifiers = [
            Specifier(part) for part in str(text).split(",") if part.strip()
        ]

    @property
    def allows_prereleases(self):
        """Whether a pre-release can satisfy this set.

        PEP 440's rule, and the one that surprises people: `>=1.0` does not
        match `2.0a1`. An installer will not hand you a pre-release unless you
        asked for one, and asking means naming one in the specifier.
        """
        return any(
            s.version is not None and s.version.is_prerelease for s in self.specifiers
        )

    def matches(self, version):
        """Whether `version` satisfies all of them."""
        version = version if isinstance(version, Version) else Version(version)
        if version.is_prerelease and not self.allows_prereleases:
            return False
        return all(specifier.matches(version) for specifier in self.specifiers)

    def __contains__(self, version):
        return self.matches(version)

    def __len__(self):
        return len(self.specifiers)

    def __repr__(self):
        return f"SpecifierSet({','.join(s.text for s in self.specifiers)!r})"


def python_matrix(project, candidates=DEFAULT_PYTHONS):
    """The Python versions this project says it runs on.

    This is where the previous stage pays for itself. Sorted as strings, "3.9"
    comes after "3.10", so a matrix built on string comparison quietly drops
    the newest interpreters or keeps one it should not.
    """
    allowed = SpecifierSet(project.requires_python)
    return [text for text in candidates if allowed.matches(text)]


def python_classifiers(project, candidates=DEFAULT_PYTHONS):
    """The classifiers PyPI shows, derived rather than typed out by hand."""
    return [
        f"Programming Language :: Python :: {text}"
        for text in python_matrix(project, candidates)
    ]


NAME_PATTERN = re.compile(r"^([a-z0-9]|[a-z0-9][a-z0-9._-]*[a-z0-9])$", re.IGNORECASE)

METADATA_VERSION = "2.1"


def normalise_name(name):
    """The one spelling of a distribution name, per PEP 503.

    Runs of hyphens, underscores and dots all become a single hyphen, and the
    whole thing is lowercased. It is why `pip install Flask-SQLAlchemy`,
    `flask_sqlalchemy` and `flask.sqlalchemy` reach the same project.
    """
    if not NAME_PATTERN.match(str(name)):
        raise ProjectError(
            f"{name!r} is not a usable distribution name: it has to start and "
            f"end with a letter or digit, and hold only letters, digits, and "
            f"the separators - _ ."
        )
    return re.sub(r"[-_.]+", "-", str(name)).lower()


def wheel_escape(name):
    """A normalised name with hyphens turned into underscores.

    A wheel filename is read by splitting on hyphens, so the name cannot
    contain one. This is not the same transformation as the importable package
    name, even though it usually lands on the same string.
    """
    return normalise_name(name).replace("-", "_")


def version_escape(version):
    """A version with every run of non-alphanumerics collapsed to one underscore.

    PEP 427, and the same reason the name is escaped. A wheel filename is read
    by splitting it on hyphens into five fields, and `1.0-1` is a perfectly
    legal post-release with a hyphen sitting in the middle of it.
    """
    return re.sub(r"[^\w\d.]+", "_", str(version))


def wheel_stem(project):
    """The escaped name and version, which every wheel artefact starts with."""
    return (f"{wheel_escape(project.name)}-"
            f"{version_escape(Version(project.version))}")


def wheel_filename(project, python_tag="py3", abi_tag="none", platform_tag="any"):
    """`{name}-{version}-{python}-{abi}-{platform}.whl`, the five fields.

    Pure Python with no compiled parts is `py3-none-any`, which means any
    Python 3, no particular ABI, any platform. A wheel with C in it names the
    interpreter and the platform it was built for, which is why there are
    dozens of files behind one release of numpy and one behind most tools.
    """
    return f"{wheel_stem(project)}-{python_tag}-{abi_tag}-{platform_tag}.whl"


def dist_info_dir(project):
    """The `.dist-info` directory inside the wheel, which holds the metadata."""
    return f"{wheel_stem(project)}.dist-info"


def metadata_text(project, candidates=DEFAULT_PYTHONS):
    """The METADATA file: headers, a blank line, then the description.

    The format is the one email uses, which is not a coincidence. It was
    already specified, already had a parser in the standard library, and the
    people writing the first packaging specs took it rather than inventing one.
    """
    lines = [
        f"Metadata-Version: {METADATA_VERSION}",
        f"Name: {normalise_name(project.name)}",
        f"Version: {Version(project.version)}",
    ]
    if project.description:
        lines.append(f"Summary: {project.description}")
    if project.requires_python:
        SpecifierSet(project.requires_python)
        lines.append(f"Requires-Python: {project.requires_python}")
    lines.extend(f"Classifier: {text}" for text in
                 python_classifiers(project, candidates))
    lines.extend(f"Requires-Dist: {text}" for text in project.dependencies)
    return "\n".join(lines) + "\n\n"


REPRODUCIBLE_DATE = (1980, 1, 1, 0, 0, 0)


def wheel_text(tag="py3-none-any"):
    """The WHEEL file, which says how the archive itself is put together."""
    raise NotImplementedError


def record_hash(data):
    """`sha256=` and the digest in base64 without padding, per PEP 376."""
    raise NotImplementedError


def record_text(entries):
    """The RECORD file: one CSV row of name, hash and size per file."""
    raise NotImplementedError


def collect_sources(project, root=None):
    """Every file of the package, as (name inside the wheel, bytes), sorted."""
    raise NotImplementedError


def build_wheel(project, outdir="dist", root=None, tag="py3-none-any"):
    """Write the wheel and return where it landed."""
    raise NotImplementedError
~~~

~~~tests
import base64
import csv
import email
import hashlib
import io
import zipfile
from pathlib import Path


def write(name, text):
    Path(name).parent.mkdir(parents=True, exist_ok=True)
    Path(name).write_text(text, encoding="utf-8")


write("app/pyproject.toml", """
[project]
name = "My-Tool"
version = "1.0"
description = "does a thing"
requires-python = ">=3.13"
dependencies = ["rich>=13"]
[project.scripts]
mytool = "my_tool.cli:main"
""")
project = load_project("app")

# stage six still holds
assert wheel_filename(project) == "my_tool-1.0-py3-none-any.whl"
assert email.message_from_string(metadata_text(project))["Name"] == "my-tool"

# WHEEL says how the archive is put together
text = wheel_text()
assert email.message_from_string(text)["Wheel-Version"] == "1.0"
assert email.message_from_string(text)["Tag"] == "py3-none-any"
assert email.message_from_string(wheel_text("cp313-cp313-linux_x86_64"))["Tag"] == (
    "cp313-cp313-linux_x86_64"
)
assert __version__ in text

# a RECORD hash is base64 without the padding
digest = record_hash(b"hello")
assert digest.startswith("sha256=")
assert not digest.endswith("=")
assert digest == "sha256=" + base64.urlsafe_b64encode(
    hashlib.sha256(b"hello").digest()
).decode().rstrip("=")
assert len(digest) == len("sha256=") + 43
assert record_hash(b"") != record_hash(b"x")

# and RECORD is CSV that csv can read back
rows = list(csv.reader(io.StringIO(record_text([("a.py", b"x"), ("b.py", b"yy")]))))
assert rows == [["a.py", record_hash(b"x"), "1"], ["b.py", record_hash(b"yy"), "2"]]

# collecting sources takes the package and nothing else
scaffold(project)
write("app/my_tool/cli.py", "def main():\n    return 0\n")
Path("app/my_tool/__pycache__").mkdir(exist_ok=True)
Path("app/my_tool/__pycache__/cli.pyc").write_bytes(b"compiled")
write("app/README.md", "not part of the package")

names = [name for name, _ in collect_sources(project)]
assert names == ["my_tool/__init__.py", "my_tool/__main__.py", "my_tool/cli.py"], names
assert names == sorted(names), "sorted, so the archive is stable"

write("nopkg/pyproject.toml", '[project]\nname = "nopkg"\nversion = "1"\n')
try:
    collect_sources(load_project("nopkg"))
except ProjectError as exc:
    assert "no package directory" in str(exc)
else:
    raise AssertionError("a project with no package should not build")

# now the wheel itself
path = build_wheel(project, "app/dist")
assert path == Path("app/dist/my_tool-1.0-py3-none-any.whl"), path
assert path.is_file()
assert zipfile.is_zipfile(path), "a wheel is a zip, and nothing more exotic"

with zipfile.ZipFile(path) as archive:
    inside = archive.namelist()
    assert "my_tool/cli.py" in inside
    assert "my_tool/__main__.py" in inside
    assert "my_tool-1.0.dist-info/METADATA" in inside
    assert "my_tool-1.0.dist-info/WHEEL" in inside
    assert "my_tool-1.0.dist-info/entry_points.txt" in inside
    assert "my_tool-1.0.dist-info/RECORD" in inside
    assert not any("__pycache__" in name for name in inside)
    assert "README.md" not in inside

    # RECORD is last, because it is written once everything else is known
    assert inside[-1] == "my_tool-1.0.dist-info/RECORD"

    # the metadata inside is the metadata the project declares
    parsed = email.message_from_bytes(archive.read("my_tool-1.0.dist-info/METADATA"))
    assert parsed["Name"] == "my-tool"
    assert parsed["Version"] == "1.0"
    assert parsed.get_all("Requires-Dist") == ["rich>=13"]

    scripts = archive.read("my_tool-1.0.dist-info/entry_points.txt").decode()
    assert scripts == "[console_scripts]\nmytool = my_tool.cli:main\n"

    # every row in RECORD names a file that is there and hashes to what it says
    rows = list(csv.reader(io.StringIO(
        archive.read("my_tool-1.0.dist-info/RECORD").decode()
    )))
    listed = {row[0] for row in rows}
    assert listed == set(inside), listed.symmetric_difference(inside)
    for name, digest, size in rows:
        if name.endswith("/RECORD"):
            assert digest == "" and size == "", "RECORD cannot hash itself"
            continue
        data = archive.read(name)
        assert digest == record_hash(data), name
        assert int(size) == len(data), name

    # and every entry carries the same fixed timestamp
    stamps = {entry.date_time for entry in archive.infolist()}
    assert stamps == {REPRODUCIBLE_DATE}, stamps

# the same source builds the same bytes, which is the whole point
again = build_wheel(project, "app/dist2")
assert again.read_bytes() == path.read_bytes(), "the build is not reproducible"

# a project with no scripts carries no entry points file
write("plain/pyproject.toml", '[project]\nname = "plain"\nversion = "2.0"\n')
plain = load_project("plain")
scaffold(plain)
with zipfile.ZipFile(build_wheel(plain, "plain/dist")) as archive:
    assert not any(name.endswith("entry_points.txt") for name in archive.namelist())
    assert "plain-2.0.dist-info/RECORD" in archive.namelist()
    assert "plain/__init__.py" in archive.namelist()
~~~

~~~solution
import argparse
import base64
import csv
import functools
import hashlib
import io
import re
import sys
import tomllib
import zipfile
from dataclasses import dataclass, field
from pathlib import Path


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")

    matrix = commands.add_parser("matrix", help="the Pythons this project supports")
    matrix.add_argument("path", nargs="?", default=".",
                        help="the directory holding pyproject.toml")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


def cmd_matrix(args, out):
    """Print the Python versions the project supports, one per line."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    supported = python_matrix(project)
    if not supported:
        print(f"pkgit: {project.requires_python!r} matches no known Python", file=out)
        return 1
    for text in supported:
        print(text, file=out)
    return 0


COMMANDS = {"info": cmd_info, "matrix": cmd_matrix}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)


MAIN_TEMPLATE = """\
import sys

from {module} import {attribute}

if __name__ == "__main__":
    sys.exit({attribute}())
"""

SCRIPT_TEMPLATE = """\
import sys

from {module} import {attribute}

sys.exit({attribute}())
"""


def split_entry_point(target):
    """`"module:attribute"` as a pair, or a ProjectError saying what is wrong."""
    module, separator, attribute = target.partition(":")
    if not separator or not module or not attribute:
        raise ProjectError(f"{target!r} does not name a function as module:function")
    if not all(part.isidentifier() for part in module.split(".")):
        raise ProjectError(f"{target!r}: {module!r} is not a module path")
    if not all(part.isidentifier() for part in attribute.split(".")):
        raise ProjectError(f"{target!r}: {attribute!r} is not an attribute name")
    return module, attribute


def main_module_source(target):
    """The `__main__.py` that makes `python -m <package>` work.

    Every line earns its place. The guard is unit 29's: a module run as a
    program has `__name__` set to "__main__" and a module imported by something
    else does not, so the import above it costs nothing to whoever imports the
    package. `sys.exit` is what turns the number `main` returns into the number
    the shell sees, which is the reason `main` returns one.
    """
    module, attribute = split_entry_point(target)
    return MAIN_TEMPLATE.format(module=module, attribute=attribute)


def console_script_source(target):
    """What an installer writes for a console script, near enough.

    The `pkgit` command on somebody's PATH is a small Python file that imports
    the function the entry point names and exits with what it returns. The same
    lines as `__main__.py` without the guard, because a script is run and never
    imported, so there is nothing for a guard to protect against.
    """
    module, attribute = split_entry_point(target)
    return SCRIPT_TEMPLATE.format(module=module, attribute=attribute)


def entry_points_metadata(project):
    """The `entry_points.txt` a wheel carries, in the format the spec asks for."""
    if not project.scripts:
        return ""
    lines = ["[console_scripts]"]
    for command, target in sorted(project.scripts.items()):
        split_entry_point(target)
        lines.append(f"{command} = {target}")
    return "\n".join(lines) + "\n"


def package_name(project):
    """The importable name for a distribution name.

    A distribution is named with hyphens and a package is named with
    underscores, because a hyphen is not valid in an identifier. `pip install
    my-tool` then `import my_tool` is this rule and not a coincidence.
    """
    return project.name.replace("-", "_").replace(".", "_").lower()


def scaffold(project, root=None, force=False):
    """Write the package layout the project describes. Returns what it wrote.

    A file that is already there is left alone. The alternative is a generator
    that silently replaces somebody's module with a one line stub the first
    time they run it twice, and `force=True` is how a caller says they meant
    that.
    """
    root = Path(root) if root is not None else project.root
    directory = root / package_name(project)
    directory.mkdir(parents=True, exist_ok=True)

    wanted = [(directory / "__init__.py", f'__version__ = "{project.version}"\n')]
    if project.scripts:
        target = project.scripts[sorted(project.scripts)[0]]
        wanted.append((directory / "__main__.py", main_module_source(target)))

    written = []
    for path, text in wanted:
        if path.exists() and not force:
            continue
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written

VERSION_PATTERN = re.compile(
    r"""
    ^\s*v?
    (?:(?P<epoch>\d+)!)?                     # 1!2.0 sorts above every 2.0
    (?P<release>\d+(?:\.\d+)*)
    (?:[-_.]?(?P<pre_l>a|b|c|rc|alpha|beta|pre|preview)[-_.]?(?P<pre_n>\d+)?)?
    (?P<post>-(?P<post_n1>\d+)|[-_.]?(?P<post_l>post|rev|r)[-_.]?(?P<post_n2>\d+)?)?
    (?P<dev>[-_.]?dev[-_.]?(?P<dev_n>\d+)?)?
    (?:\+(?P<local>[a-z0-9]+(?:[-_.][a-z0-9]+)*))?
    \s*$
    """,
    re.VERBOSE | re.IGNORECASE,
)

PRE_NAMES = {"alpha": "a", "beta": "b", "c": "rc", "pre": "rc", "preview": "rc"}


class InvalidVersion(ProjectError):
    """A version string PEP 440 does not describe."""


@functools.total_ordering
class Version:
    """A version that sorts the way the specification says it should.

    Reading one is the easy half. The ordering is where the rules live: a dev
    release comes before its own pre-releases, a pre-release comes before the
    release it leads to, and a post-release comes after it. Written out that is
    1.0.dev1 < 1.0a1 < 1.0 < 1.0.post1, which is not what a plain string
    comparison gives you and not what a tuple of integers gives you either.
    """

    def __init__(self, text):
        match = VERSION_PATTERN.match(str(text))
        if match is None:
            raise InvalidVersion(f"{text!r} is not a valid version")
        parts = match.groupdict()
        self.text = str(text).strip()
        self.epoch = int(parts["epoch"] or 0)
        self.release = tuple(int(n) for n in parts["release"].split("."))
        self.pre = self._pre(parts)
        self.post = self._segment(parts["post"], parts["post_n1"], parts["post_n2"])
        self.dev = self._segment(parts["dev"], parts["dev_n"])
        self.local = self._local(parts["local"])

    @staticmethod
    def _local(text):
        """A local label is dot separated, and a hyphen or underscore is a dot."""
        if not text:
            return ()
        return tuple(text.lower().replace("-", ".").replace("_", ".").split("."))

    @staticmethod
    def _pre(parts):
        if parts["pre_l"] is None:
            return None
        letter = parts["pre_l"].lower()
        return PRE_NAMES.get(letter, letter), int(parts["pre_n"] or 0)

    @staticmethod
    def _segment(present, *numbers):
        """A segment may be written with a number, without one, or not at all.

        `1.0.post1`, `1.0.post` and `1.0` are three different answers, and the
        middle one means post-release zero rather than no post-release.
        """
        if present is None:
            return None
        for number in numbers:
            if number is not None:
                return int(number)
        return 0

    @property
    def base(self):
        """The release numbers alone, which is what a wildcard compares against."""
        return self.release

    @property
    def is_prerelease(self):
        return self.pre is not None or self.dev is not None

    def _key(self):
        """One tuple that sorts correctly, so the comparisons are one line each.

        Each segment becomes a small tuple whose first number is its rank, so
        plain tuple comparison does the work and there are no sentinel objects
        to explain. A dev release with no pre-release ranks below every
        pre-release, and a release with neither ranks above them all.
        """
        release = self.release
        while len(release) > 1 and release[-1] == 0:
            release = release[:-1]
        if self.pre is not None:
            pre = (1, *self.pre)
        elif self.dev is not None:
            pre = (0,)
        else:
            pre = (2,)
        post = (0,) if self.post is None else (1, self.post)
        dev = (1,) if self.dev is None else (0, self.dev)
        local = (1, self.local) if self.local else (0,)
        return self.epoch, release, pre, post, dev, local

    def __eq__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() == other._key()

    def __lt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() < other._key()

    def __hash__(self):
        return hash(self._key())

    def __repr__(self):
        return f"Version({self.text!r})"

    def __str__(self):
        return self.text

SPECIFIER_PATTERN = re.compile(r"^\s*(===|==|!=|~=|<=|>=|<|>)\s*([^\s,]+)\s*$")

DEFAULT_PYTHONS = ("3.9", "3.10", "3.11", "3.12", "3.13", "3.14")


class Specifier:
    """One comparison out of a requirement, such as `>=3.11` or `==1.4.*`."""

    def __init__(self, text):
        match = SPECIFIER_PATTERN.match(text)
        if match is None:
            raise ProjectError(f"{text!r} is not a version specifier")
        self.operator, self.value = match.group(1), match.group(2)
        self.text = f"{self.operator}{self.value}"
        self.wildcard = self.value.endswith(".*")
        if self.wildcard and self.operator not in ("==", "!="):
            raise ProjectError(f"{self.text!r}: only == and != may take a wildcard")
        if self.operator == "===":
            self.version = None
            return
        self.version = Version(self.value[:-2] if self.wildcard else self.value)
        if self.operator == "~=" and len(self.version.release) < 2:
            raise ProjectError(
                f"{self.text!r}: ~= needs at least two release segments, because "
                f"it means 'this series', and one number does not name a series"
            )

    @staticmethod
    def _padded(release, length):
        """Release numbers padded with zeros, because 1 and 1.0 are one version."""
        return (tuple(release) + (0,) * length)[:length]

    def matches(self, version):
        """Whether `version` satisfies this one comparison."""
        version = version if isinstance(version, Version) else Version(version)
        if self.operator == "===":
            return str(version) == self.value
        if self.wildcard:
            prefix = self.version.release
            same = self._padded(version.release, len(prefix)) == prefix
            return same if self.operator == "==" else not same
        if self.operator == "~=":
            # Compatible release: at least this version, and inside the series
            # named by everything but its last number. ~=1.4.2 is >=1.4.2 and
            # ==1.4.*, which is the pair of rules people mean by "compatible".
            series = self.version.release[:-1]
            return (version >= self.version
                    and self._padded(version.release, len(series)) == series)
        comparisons = {
            "==": version == self.version,
            "!=": version != self.version,
            "<": version < self.version,
            "<=": version <= self.version,
            ">": version > self.version,
            ">=": version >= self.version,
        }
        return comparisons[self.operator]

    def __contains__(self, version):
        return self.matches(version)

    def __repr__(self):
        return f"Specifier({self.text!r})"


class SpecifierSet:
    """Every comparison in one requirement, all of which have to hold."""

    def __init__(self, text=""):
        self.specifiers = [
            Specifier(part) for part in str(text).split(",") if part.strip()
        ]

    @property
    def allows_prereleases(self):
        """Whether a pre-release can satisfy this set.

        PEP 440's rule, and the one that surprises people: `>=1.0` does not
        match `2.0a1`. An installer will not hand you a pre-release unless you
        asked for one, and asking means naming one in the specifier.
        """
        return any(
            s.version is not None and s.version.is_prerelease for s in self.specifiers
        )

    def matches(self, version):
        """Whether `version` satisfies all of them."""
        version = version if isinstance(version, Version) else Version(version)
        if version.is_prerelease and not self.allows_prereleases:
            return False
        return all(specifier.matches(version) for specifier in self.specifiers)

    def __contains__(self, version):
        return self.matches(version)

    def __len__(self):
        return len(self.specifiers)

    def __repr__(self):
        return f"SpecifierSet({','.join(s.text for s in self.specifiers)!r})"


def python_matrix(project, candidates=DEFAULT_PYTHONS):
    """The Python versions this project says it runs on.

    This is where the previous stage pays for itself. Sorted as strings, "3.9"
    comes after "3.10", so a matrix built on string comparison quietly drops
    the newest interpreters or keeps one it should not.
    """
    allowed = SpecifierSet(project.requires_python)
    return [text for text in candidates if allowed.matches(text)]


def python_classifiers(project, candidates=DEFAULT_PYTHONS):
    """The classifiers PyPI shows, derived rather than typed out by hand."""
    return [
        f"Programming Language :: Python :: {text}"
        for text in python_matrix(project, candidates)
    ]


NAME_PATTERN = re.compile(r"^([a-z0-9]|[a-z0-9][a-z0-9._-]*[a-z0-9])$", re.IGNORECASE)

METADATA_VERSION = "2.1"


def normalise_name(name):
    """The one spelling of a distribution name, per PEP 503.

    Runs of hyphens, underscores and dots all become a single hyphen, and the
    whole thing is lowercased. It is why `pip install Flask-SQLAlchemy`,
    `flask_sqlalchemy` and `flask.sqlalchemy` reach the same project.
    """
    if not NAME_PATTERN.match(str(name)):
        raise ProjectError(
            f"{name!r} is not a usable distribution name: it has to start and "
            f"end with a letter or digit, and hold only letters, digits, and "
            f"the separators - _ ."
        )
    return re.sub(r"[-_.]+", "-", str(name)).lower()


def wheel_escape(name):
    """A normalised name with hyphens turned into underscores.

    A wheel filename is read by splitting on hyphens, so the name cannot
    contain one. This is not the same transformation as the importable package
    name, even though it usually lands on the same string.
    """
    return normalise_name(name).replace("-", "_")


def version_escape(version):
    """A version with every run of non-alphanumerics collapsed to one underscore.

    PEP 427, and the same reason the name is escaped. A wheel filename is read
    by splitting it on hyphens into five fields, and `1.0-1` is a perfectly
    legal post-release with a hyphen sitting in the middle of it.
    """
    return re.sub(r"[^\w\d.]+", "_", str(version))


def wheel_stem(project):
    """The escaped name and version, which every wheel artefact starts with."""
    return (f"{wheel_escape(project.name)}-"
            f"{version_escape(Version(project.version))}")


def wheel_filename(project, python_tag="py3", abi_tag="none", platform_tag="any"):
    """`{name}-{version}-{python}-{abi}-{platform}.whl`, the five fields.

    Pure Python with no compiled parts is `py3-none-any`, which means any
    Python 3, no particular ABI, any platform. A wheel with C in it names the
    interpreter and the platform it was built for, which is why there are
    dozens of files behind one release of numpy and one behind most tools.
    """
    return f"{wheel_stem(project)}-{python_tag}-{abi_tag}-{platform_tag}.whl"


def dist_info_dir(project):
    """The `.dist-info` directory inside the wheel, which holds the metadata."""
    return f"{wheel_stem(project)}.dist-info"


def metadata_text(project, candidates=DEFAULT_PYTHONS):
    """The METADATA file: headers, a blank line, then the description.

    The format is the one email uses, which is not a coincidence. It was
    already specified, already had a parser in the standard library, and the
    people writing the first packaging specs took it rather than inventing one.
    """
    lines = [
        f"Metadata-Version: {METADATA_VERSION}",
        f"Name: {normalise_name(project.name)}",
        f"Version: {Version(project.version)}",
    ]
    if project.description:
        lines.append(f"Summary: {project.description}")
    if project.requires_python:
        SpecifierSet(project.requires_python)
        lines.append(f"Requires-Python: {project.requires_python}")
    lines.extend(f"Classifier: {text}" for text in
                 python_classifiers(project, candidates))
    lines.extend(f"Requires-Dist: {text}" for text in project.dependencies)
    return "\n".join(lines) + "\n\n"

WHEEL_TEMPLATE = """\
Wheel-Version: 1.0
Generator: pkgit {version}
Root-Is-Purelib: true
Tag: {tag}
"""

# A zip stores a timestamp per entry, and a timestamp is the clock leaking into
# the output. Everything is stamped with the earliest a zip can hold, so the
# same source builds the same bytes on any machine on any day.
REPRODUCIBLE_DATE = (1980, 1, 1, 0, 0, 0)


def wheel_text(tag="py3-none-any"):
    """The WHEEL file, which says how the archive itself is put together."""
    return WHEEL_TEMPLATE.format(version=__version__, tag=tag)


def record_hash(data):
    """`sha256=` and the digest in base64 without padding, per PEP 376."""
    digest = hashlib.sha256(data).digest()
    return "sha256=" + base64.urlsafe_b64encode(digest).decode().rstrip("=")


def record_text(entries):
    """The RECORD file: one CSV row of name, hash and size per file.

    RECORD cannot carry its own hash, because writing the hash in would change
    the file the hash was taken of. Its own row is the name and two empty
    fields, which is what the specification asks for.
    """
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    for name, data in entries:
        writer.writerow([name, record_hash(data), len(data)])
    return out.getvalue()


def collect_sources(project, root=None):
    """Every file of the package, as (name inside the wheel, bytes), sorted."""
    root = Path(root) if root is not None else project.root
    package = root / package_name(project)
    if not package.is_dir():
        raise ProjectError(
            f"no package directory at {package}: a wheel needs something to hold"
        )
    found = [
        (path.relative_to(root).as_posix(), path.read_bytes())
        for path in sorted(package.rglob("*"))
        if path.is_file() and "__pycache__" not in path.parts
    ]
    if not found:
        raise ProjectError(f"{package} has no files in it")
    return found


def build_wheel(project, outdir="dist", root=None, tag="py3-none-any"):
    """Write the wheel and return where it landed.

    A wheel is a zip with three things agreed on: the layout, the names in the
    `.dist-info` directory, and the filename. There is no build step for pure
    Python, which is why a wheel installs by being unpacked.

    Every entry is stamped with one fixed date and written in sorted order, so
    building the same source twice gives identical bytes. A build that embeds
    the clock cannot be compared against the one somebody else made from the
    same commit, which is the whole point of a reproducible build.
    """
    root = Path(root) if root is not None else project.root
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    info = dist_info_dir(project)

    payload = collect_sources(project, root)
    payload.append((f"{info}/METADATA", metadata_text(project).encode()))
    payload.append((f"{info}/WHEEL", wheel_text(tag).encode()))
    if project.scripts:
        payload.append(
            (f"{info}/entry_points.txt", entry_points_metadata(project).encode())
        )
    payload.sort()
    payload.append(
        (f"{info}/RECORD", (record_text(payload) + f"{info}/RECORD,,\n").encode())
    )

    path = outdir / wheel_filename(project, *tag.split("-"))
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in payload:
            entry = zipfile.ZipInfo(name, date_time=REPRODUCIBLE_DATE)
            entry.external_attr = 0o644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data)
    return path
~~~

## Reading one back, and the command that ties it together

A build tool that cannot check its own output is half a tool. This stage reads
a wheel the way an installer would and reports everything wrong with it.

The rule for the return value is worth stating. `check_wheel` gives back a list
of problems rather than raising on the first one, because somebody fixing a
wheel wants to see all of them and fix them together. A checker that stops at
the first mistake is a tripwire.

That rule holds all the way down, and it is easy to break by accident. Every
field read out of the archive is somebody else's bytes, so anything that parses
one has to be ready for it to be nonsense. A `Version:` header that is not a
version and a `Name:` that is not a name both go in the list. Letting either of
them raise turns the promise into a traceback and hides whatever else was
wrong.

What it looks for is what actually goes wrong. A file whose bytes no longer
match the hash RECORD wrote for it. A file smuggled into the archive that
RECORD never mentioned. A METADATA version that disagrees with the filename,
which happens the moment somebody edits one and not the other. And a path with
`..` in it, which would unpack outside the directory it was pointed at, because
an archive is somebody else's data and unpacking one is trusting it.

`--strict` is separate on purpose. A wheel with no Summary is not invalid, it
is just going to look bare on PyPI, so it belongs behind a flag rather than in
the same list as a broken hash.

Then `build` and `check` join `info` and `matrix`, and the tool is finished:
eight stages on, it can build a wheel of itself and pass its own check.

@goal `check_wheel` finds what is wrong, and `build` and `check` are commands.

~~~starter
import argparse
import base64
import csv
import email
import functools
import hashlib
import io
import re
import sys
import tomllib
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")

    matrix = commands.add_parser("matrix", help="the Pythons this project supports")
    matrix.add_argument("path", nargs="?", default=".",
                        help="the directory holding pyproject.toml")

    build = commands.add_parser("build", help="build a wheel and check it")
    build.add_argument("path", nargs="?", default=".",
                       help="the directory holding pyproject.toml")
    build.add_argument("-o", "--out", default="dist", help="where to put the wheel")
    build.add_argument("--strict", action="store_true",
                       help="complain about metadata that is missing but allowed")

    check = commands.add_parser("check", help="check a wheel that already exists")
    check.add_argument("wheel", help="the .whl to look at")
    check.add_argument("--strict", action="store_true",
                       help="complain about metadata that is missing but allowed")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


def cmd_matrix(args, out):
    """Print the Python versions the project supports, one per line."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    supported = python_matrix(project)
    if not supported:
        print(f"pkgit: {project.requires_python!r} matches no known Python", file=out)
        return 1
    for text in supported:
        print(text, file=out)
    return 0


def cmd_build(args, out):
    """Build the wheel, then check what was built. Returns the exit code."""
    raise NotImplementedError


def cmd_check(args, out):
    """Check a wheel that already exists. Returns the exit code."""
    raise NotImplementedError


COMMANDS = {"info": cmd_info, "matrix": cmd_matrix,
            "build": cmd_build, "check": cmd_check}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)


MAIN_TEMPLATE = """\
import sys

from {module} import {attribute}

if __name__ == "__main__":
    sys.exit({attribute}())
"""

SCRIPT_TEMPLATE = """\
import sys

from {module} import {attribute}

sys.exit({attribute}())
"""


def split_entry_point(target):
    """`"module:attribute"` as a pair, or a ProjectError saying what is wrong."""
    module, separator, attribute = target.partition(":")
    if not separator or not module or not attribute:
        raise ProjectError(f"{target!r} does not name a function as module:function")
    if not all(part.isidentifier() for part in module.split(".")):
        raise ProjectError(f"{target!r}: {module!r} is not a module path")
    if not all(part.isidentifier() for part in attribute.split(".")):
        raise ProjectError(f"{target!r}: {attribute!r} is not an attribute name")
    return module, attribute


def main_module_source(target):
    """The `__main__.py` that makes `python -m <package>` work.

    Every line earns its place. The guard is unit 29's: a module run as a
    program has `__name__` set to "__main__" and a module imported by something
    else does not, so the import above it costs nothing to whoever imports the
    package. `sys.exit` is what turns the number `main` returns into the number
    the shell sees, which is the reason `main` returns one.
    """
    module, attribute = split_entry_point(target)
    return MAIN_TEMPLATE.format(module=module, attribute=attribute)


def console_script_source(target):
    """What an installer writes for a console script, near enough.

    The `pkgit` command on somebody's PATH is a small Python file that imports
    the function the entry point names and exits with what it returns. The same
    lines as `__main__.py` without the guard, because a script is run and never
    imported, so there is nothing for a guard to protect against.
    """
    module, attribute = split_entry_point(target)
    return SCRIPT_TEMPLATE.format(module=module, attribute=attribute)


def entry_points_metadata(project):
    """The `entry_points.txt` a wheel carries, in the format the spec asks for."""
    if not project.scripts:
        return ""
    lines = ["[console_scripts]"]
    for command, target in sorted(project.scripts.items()):
        split_entry_point(target)
        lines.append(f"{command} = {target}")
    return "\n".join(lines) + "\n"


def package_name(project):
    """The importable name for a distribution name.

    A distribution is named with hyphens and a package is named with
    underscores, because a hyphen is not valid in an identifier. `pip install
    my-tool` then `import my_tool` is this rule and not a coincidence.
    """
    return project.name.replace("-", "_").replace(".", "_").lower()


def scaffold(project, root=None, force=False):
    """Write the package layout the project describes. Returns what it wrote.

    A file that is already there is left alone. The alternative is a generator
    that silently replaces somebody's module with a one line stub the first
    time they run it twice, and `force=True` is how a caller says they meant
    that.
    """
    root = Path(root) if root is not None else project.root
    directory = root / package_name(project)
    directory.mkdir(parents=True, exist_ok=True)

    wanted = [(directory / "__init__.py", f'__version__ = "{project.version}"\n')]
    if project.scripts:
        target = project.scripts[sorted(project.scripts)[0]]
        wanted.append((directory / "__main__.py", main_module_source(target)))

    written = []
    for path, text in wanted:
        if path.exists() and not force:
            continue
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written

VERSION_PATTERN = re.compile(
    r"""
    ^\s*v?
    (?:(?P<epoch>\d+)!)?                     # 1!2.0 sorts above every 2.0
    (?P<release>\d+(?:\.\d+)*)
    (?:[-_.]?(?P<pre_l>a|b|c|rc|alpha|beta|pre|preview)[-_.]?(?P<pre_n>\d+)?)?
    (?P<post>-(?P<post_n1>\d+)|[-_.]?(?P<post_l>post|rev|r)[-_.]?(?P<post_n2>\d+)?)?
    (?P<dev>[-_.]?dev[-_.]?(?P<dev_n>\d+)?)?
    (?:\+(?P<local>[a-z0-9]+(?:[-_.][a-z0-9]+)*))?
    \s*$
    """,
    re.VERBOSE | re.IGNORECASE,
)

PRE_NAMES = {"alpha": "a", "beta": "b", "c": "rc", "pre": "rc", "preview": "rc"}


class InvalidVersion(ProjectError):
    """A version string PEP 440 does not describe."""


@functools.total_ordering
class Version:
    """A version that sorts the way the specification says it should.

    Reading one is the easy half. The ordering is where the rules live: a dev
    release comes before its own pre-releases, a pre-release comes before the
    release it leads to, and a post-release comes after it. Written out that is
    1.0.dev1 < 1.0a1 < 1.0 < 1.0.post1, which is not what a plain string
    comparison gives you and not what a tuple of integers gives you either.
    """

    def __init__(self, text):
        match = VERSION_PATTERN.match(str(text))
        if match is None:
            raise InvalidVersion(f"{text!r} is not a valid version")
        parts = match.groupdict()
        self.text = str(text).strip()
        self.epoch = int(parts["epoch"] or 0)
        self.release = tuple(int(n) for n in parts["release"].split("."))
        self.pre = self._pre(parts)
        self.post = self._segment(parts["post"], parts["post_n1"], parts["post_n2"])
        self.dev = self._segment(parts["dev"], parts["dev_n"])
        self.local = self._local(parts["local"])

    @staticmethod
    def _local(text):
        """A local label is dot separated, and a hyphen or underscore is a dot."""
        if not text:
            return ()
        return tuple(text.lower().replace("-", ".").replace("_", ".").split("."))

    @staticmethod
    def _pre(parts):
        if parts["pre_l"] is None:
            return None
        letter = parts["pre_l"].lower()
        return PRE_NAMES.get(letter, letter), int(parts["pre_n"] or 0)

    @staticmethod
    def _segment(present, *numbers):
        """A segment may be written with a number, without one, or not at all.

        `1.0.post1`, `1.0.post` and `1.0` are three different answers, and the
        middle one means post-release zero rather than no post-release.
        """
        if present is None:
            return None
        for number in numbers:
            if number is not None:
                return int(number)
        return 0

    @property
    def base(self):
        """The release numbers alone, which is what a wildcard compares against."""
        return self.release

    @property
    def is_prerelease(self):
        return self.pre is not None or self.dev is not None

    def _key(self):
        """One tuple that sorts correctly, so the comparisons are one line each.

        Each segment becomes a small tuple whose first number is its rank, so
        plain tuple comparison does the work and there are no sentinel objects
        to explain. A dev release with no pre-release ranks below every
        pre-release, and a release with neither ranks above them all.
        """
        release = self.release
        while len(release) > 1 and release[-1] == 0:
            release = release[:-1]
        if self.pre is not None:
            pre = (1, *self.pre)
        elif self.dev is not None:
            pre = (0,)
        else:
            pre = (2,)
        post = (0,) if self.post is None else (1, self.post)
        dev = (1,) if self.dev is None else (0, self.dev)
        local = (1, self.local) if self.local else (0,)
        return self.epoch, release, pre, post, dev, local

    def __eq__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() == other._key()

    def __lt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() < other._key()

    def __hash__(self):
        return hash(self._key())

    def __repr__(self):
        return f"Version({self.text!r})"

    def __str__(self):
        return self.text

SPECIFIER_PATTERN = re.compile(r"^\s*(===|==|!=|~=|<=|>=|<|>)\s*([^\s,]+)\s*$")

DEFAULT_PYTHONS = ("3.9", "3.10", "3.11", "3.12", "3.13", "3.14")


class Specifier:
    """One comparison out of a requirement, such as `>=3.11` or `==1.4.*`."""

    def __init__(self, text):
        match = SPECIFIER_PATTERN.match(text)
        if match is None:
            raise ProjectError(f"{text!r} is not a version specifier")
        self.operator, self.value = match.group(1), match.group(2)
        self.text = f"{self.operator}{self.value}"
        self.wildcard = self.value.endswith(".*")
        if self.wildcard and self.operator not in ("==", "!="):
            raise ProjectError(f"{self.text!r}: only == and != may take a wildcard")
        if self.operator == "===":
            self.version = None
            return
        self.version = Version(self.value[:-2] if self.wildcard else self.value)
        if self.operator == "~=" and len(self.version.release) < 2:
            raise ProjectError(
                f"{self.text!r}: ~= needs at least two release segments, because "
                f"it means 'this series', and one number does not name a series"
            )

    @staticmethod
    def _padded(release, length):
        """Release numbers padded with zeros, because 1 and 1.0 are one version."""
        return (tuple(release) + (0,) * length)[:length]

    def matches(self, version):
        """Whether `version` satisfies this one comparison."""
        version = version if isinstance(version, Version) else Version(version)
        if self.operator == "===":
            return str(version) == self.value
        if self.wildcard:
            prefix = self.version.release
            same = self._padded(version.release, len(prefix)) == prefix
            return same if self.operator == "==" else not same
        if self.operator == "~=":
            # Compatible release: at least this version, and inside the series
            # named by everything but its last number. ~=1.4.2 is >=1.4.2 and
            # ==1.4.*, which is the pair of rules people mean by "compatible".
            series = self.version.release[:-1]
            return (version >= self.version
                    and self._padded(version.release, len(series)) == series)
        comparisons = {
            "==": version == self.version,
            "!=": version != self.version,
            "<": version < self.version,
            "<=": version <= self.version,
            ">": version > self.version,
            ">=": version >= self.version,
        }
        return comparisons[self.operator]

    def __contains__(self, version):
        return self.matches(version)

    def __repr__(self):
        return f"Specifier({self.text!r})"


class SpecifierSet:
    """Every comparison in one requirement, all of which have to hold."""

    def __init__(self, text=""):
        self.specifiers = [
            Specifier(part) for part in str(text).split(",") if part.strip()
        ]

    @property
    def allows_prereleases(self):
        """Whether a pre-release can satisfy this set.

        PEP 440's rule, and the one that surprises people: `>=1.0` does not
        match `2.0a1`. An installer will not hand you a pre-release unless you
        asked for one, and asking means naming one in the specifier.
        """
        return any(
            s.version is not None and s.version.is_prerelease for s in self.specifiers
        )

    def matches(self, version):
        """Whether `version` satisfies all of them."""
        version = version if isinstance(version, Version) else Version(version)
        if version.is_prerelease and not self.allows_prereleases:
            return False
        return all(specifier.matches(version) for specifier in self.specifiers)

    def __contains__(self, version):
        return self.matches(version)

    def __len__(self):
        return len(self.specifiers)

    def __repr__(self):
        return f"SpecifierSet({','.join(s.text for s in self.specifiers)!r})"


def python_matrix(project, candidates=DEFAULT_PYTHONS):
    """The Python versions this project says it runs on.

    This is where the previous stage pays for itself. Sorted as strings, "3.9"
    comes after "3.10", so a matrix built on string comparison quietly drops
    the newest interpreters or keeps one it should not.
    """
    allowed = SpecifierSet(project.requires_python)
    return [text for text in candidates if allowed.matches(text)]


def python_classifiers(project, candidates=DEFAULT_PYTHONS):
    """The classifiers PyPI shows, derived rather than typed out by hand."""
    return [
        f"Programming Language :: Python :: {text}"
        for text in python_matrix(project, candidates)
    ]


NAME_PATTERN = re.compile(r"^([a-z0-9]|[a-z0-9][a-z0-9._-]*[a-z0-9])$", re.IGNORECASE)

METADATA_VERSION = "2.1"


def normalise_name(name):
    """The one spelling of a distribution name, per PEP 503.

    Runs of hyphens, underscores and dots all become a single hyphen, and the
    whole thing is lowercased. It is why `pip install Flask-SQLAlchemy`,
    `flask_sqlalchemy` and `flask.sqlalchemy` reach the same project.
    """
    if not NAME_PATTERN.match(str(name)):
        raise ProjectError(
            f"{name!r} is not a usable distribution name: it has to start and "
            f"end with a letter or digit, and hold only letters, digits, and "
            f"the separators - _ ."
        )
    return re.sub(r"[-_.]+", "-", str(name)).lower()


def wheel_escape(name):
    """A normalised name with hyphens turned into underscores.

    A wheel filename is read by splitting on hyphens, so the name cannot
    contain one. This is not the same transformation as the importable package
    name, even though it usually lands on the same string.
    """
    return normalise_name(name).replace("-", "_")


def version_escape(version):
    """A version with every run of non-alphanumerics collapsed to one underscore.

    PEP 427, and the same reason the name is escaped. A wheel filename is read
    by splitting it on hyphens into five fields, and `1.0-1` is a perfectly
    legal post-release with a hyphen sitting in the middle of it.
    """
    return re.sub(r"[^\w\d.]+", "_", str(version))


def wheel_stem(project):
    """The escaped name and version, which every wheel artefact starts with."""
    return (f"{wheel_escape(project.name)}-"
            f"{version_escape(Version(project.version))}")


def wheel_filename(project, python_tag="py3", abi_tag="none", platform_tag="any"):
    """`{name}-{version}-{python}-{abi}-{platform}.whl`, the five fields.

    Pure Python with no compiled parts is `py3-none-any`, which means any
    Python 3, no particular ABI, any platform. A wheel with C in it names the
    interpreter and the platform it was built for, which is why there are
    dozens of files behind one release of numpy and one behind most tools.
    """
    return f"{wheel_stem(project)}-{python_tag}-{abi_tag}-{platform_tag}.whl"


def dist_info_dir(project):
    """The `.dist-info` directory inside the wheel, which holds the metadata."""
    return f"{wheel_stem(project)}.dist-info"


def metadata_text(project, candidates=DEFAULT_PYTHONS):
    """The METADATA file: headers, a blank line, then the description.

    The format is the one email uses, which is not a coincidence. It was
    already specified, already had a parser in the standard library, and the
    people writing the first packaging specs took it rather than inventing one.
    """
    lines = [
        f"Metadata-Version: {METADATA_VERSION}",
        f"Name: {normalise_name(project.name)}",
        f"Version: {Version(project.version)}",
    ]
    if project.description:
        lines.append(f"Summary: {project.description}")
    if project.requires_python:
        SpecifierSet(project.requires_python)
        lines.append(f"Requires-Python: {project.requires_python}")
    lines.extend(f"Classifier: {text}" for text in
                 python_classifiers(project, candidates))
    lines.extend(f"Requires-Dist: {text}" for text in project.dependencies)
    return "\n".join(lines) + "\n\n"

WHEEL_TEMPLATE = """\
Wheel-Version: 1.0
Generator: pkgit {version}
Root-Is-Purelib: true
Tag: {tag}
"""

# A zip stores a timestamp per entry, and a timestamp is the clock leaking into
# the output. Everything is stamped with the earliest a zip can hold, so the
# same source builds the same bytes on any machine on any day.
REPRODUCIBLE_DATE = (1980, 1, 1, 0, 0, 0)


def wheel_text(tag="py3-none-any"):
    """The WHEEL file, which says how the archive itself is put together."""
    return WHEEL_TEMPLATE.format(version=__version__, tag=tag)


def record_hash(data):
    """`sha256=` and the digest in base64 without padding, per PEP 376."""
    digest = hashlib.sha256(data).digest()
    return "sha256=" + base64.urlsafe_b64encode(digest).decode().rstrip("=")


def record_text(entries):
    """The RECORD file: one CSV row of name, hash and size per file.

    RECORD cannot carry its own hash, because writing the hash in would change
    the file the hash was taken of. Its own row is the name and two empty
    fields, which is what the specification asks for.
    """
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    for name, data in entries:
        writer.writerow([name, record_hash(data), len(data)])
    return out.getvalue()


def collect_sources(project, root=None):
    """Every file of the package, as (name inside the wheel, bytes), sorted."""
    root = Path(root) if root is not None else project.root
    package = root / package_name(project)
    if not package.is_dir():
        raise ProjectError(
            f"no package directory at {package}: a wheel needs something to hold"
        )
    found = [
        (path.relative_to(root).as_posix(), path.read_bytes())
        for path in sorted(package.rglob("*"))
        if path.is_file() and "__pycache__" not in path.parts
    ]
    if not found:
        raise ProjectError(f"{package} has no files in it")
    return found


def build_wheel(project, outdir="dist", root=None, tag="py3-none-any"):
    """Write the wheel and return where it landed.

    A wheel is a zip with three things agreed on: the layout, the names in the
    `.dist-info` directory, and the filename. There is no build step for pure
    Python, which is why a wheel installs by being unpacked.

    Every entry is stamped with one fixed date and written in sorted order, so
    building the same source twice gives identical bytes. A build that embeds
    the clock cannot be compared against the one somebody else made from the
    same commit, which is the whole point of a reproducible build.
    """
    root = Path(root) if root is not None else project.root
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    info = dist_info_dir(project)

    payload = collect_sources(project, root)
    payload.append((f"{info}/METADATA", metadata_text(project).encode()))
    payload.append((f"{info}/WHEEL", wheel_text(tag).encode()))
    if project.scripts:
        payload.append(
            (f"{info}/entry_points.txt", entry_points_metadata(project).encode())
        )
    payload.sort()
    payload.append(
        (f"{info}/RECORD", (record_text(payload) + f"{info}/RECORD,,\n").encode())
    )

    path = outdir / wheel_filename(project, *tag.split("-"))
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in payload:
            entry = zipfile.ZipInfo(name, date_time=REPRODUCIBLE_DATE)
            entry.external_attr = 0o644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data)
    return path


def check_wheel(path, strict=False):
    """Everything wrong with a built wheel, as a list of sentences."""
    raise NotImplementedError
~~~

~~~tests
import csv
import io
import zipfile
from pathlib import Path


def write(name, text):
    Path(name).parent.mkdir(parents=True, exist_ok=True)
    Path(name).write_text(text, encoding="utf-8")


def run(argv):
    out = io.StringIO()
    return main(argv, out), out.getvalue()


write("app/pyproject.toml", """
[project]
name = "pkgit"
version = "0.1.0"
description = "a packaging tool that can package itself"
requires-python = ">=3.13"
dependencies = ["rich>=13"]
[project.scripts]
pkgit = "pkgit.cli:main"
""")
project = load_project("app")
scaffold(project)
write("app/pkgit/cli.py", "def main():\n    return 0\n")

# stage seven still holds
built = build_wheel(project, "app/dist")
assert built.name == "pkgit-0.1.0-py3-none-any.whl"
assert build_wheel(project, "app/again").read_bytes() == built.read_bytes()

# a wheel this tool built has nothing wrong with it, even under strict
assert check_wheel(built) == []
assert check_wheel(built, strict=True) == [], check_wheel(built, strict=True)

# and the commands say so
code, text = run(["build", "app", "-o", "app/out"])
assert code == 0, text
assert "pkgit-0.1.0-py3-none-any.whl" in text

code, text = run(["check", "app/out/pkgit-0.1.0-py3-none-any.whl"])
assert code == 0 and "fine" in text

# the things that are wrong, each found on its own
assert check_wheel("app/missing.whl") == ["app/missing.whl is not a file"]

# the filename is checked before the contents, because the contents are read
# using what the filename claims
notazip = "app/notazip-1.0-py3-none-any.whl"
Path(notazip).write_bytes(b"this is not a zip file at all")
problems = check_wheel(notazip)
assert any("not a zip" in p for p in problems), problems

Path("app/wrongname.whl").write_bytes(built.read_bytes())
problems = check_wheel("app/wrongname.whl")
assert any("five fields" in p for p in problems), problems
assert check_wheel("app/wrongname.whl") == problems, "the check does not depend on order"


def rebuild(where, edit):
    """A copy of the good wheel with one thing changed, for the checker to find.

    Each copy keeps the real filename and goes in its own directory, because
    the checker reads the name to know what the contents should say.
    """
    with zipfile.ZipFile(built) as source:
        entries = edit([(n, source.read(n)) for n in source.namelist()])
    target = Path("app") / where / built.name
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w") as out:
        for name, data in entries:
            out.writestr(name, data)
    return target


info = "pkgit-0.1.0.dist-info"

# a file changed after RECORD was written
damaged = rebuild("damaged", lambda e: [
    (n, b"def main():\n    return 99\n" if n == "pkgit/cli.py" else d) for n, d in e
])
problems = check_wheel(damaged)
assert any("does not match its hash" in p for p in problems), problems

# a file smuggled in without being listed
extra = rebuild("extra", lambda e: [*e, ("pkgit/sneaky.py", b"print('hi')\n")])
problems = check_wheel(extra)
assert any("not in RECORD" in p and "sneaky" in p for p in problems), problems

# a file RECORD claims and the wheel does not have
gone = rebuild("gone", lambda e: [x for x in e if x[0] != "pkgit/cli.py"])
problems = check_wheel(gone)
assert any("in RECORD and not in the wheel" in p for p in problems), problems

# metadata that disagrees with the filename
lied = rebuild("lied", lambda e: [
    (n, d.replace(b"Version: 0.1.0", b"Version: 9.9.9") if n.endswith("METADATA") else d)
    for n, d in e
])
problems = check_wheel(lied)
assert any("9.9.9" in p and "filename" in p for p in problems), problems

# a path that would unpack outside where it was told to
escaping = rebuild("escape", lambda e: [*e, ("../../etc/passwd", b"no")])
problems = check_wheel(escaping)
assert any("outside the target directory" in p for p in problems), problems

# no metadata at all
empty = rebuild("empty", lambda e: [
    (n, d) for n, d in e if not n.startswith(info)
])
problems = check_wheel(empty)
assert any("dist-info" in p for p in problems), problems

# RECORD claiming a hash for itself, which cannot be true
def claim_own_hash(entries):
    rows = record_text([(n, d) for n, d in entries if not n.endswith("/RECORD")])
    invented = (rows + f"{info}/RECORD,sha256=invented,10\n").encode()
    return [(n, invented if n.endswith("/RECORD") else d) for n, d in entries]


selfish = rebuild("selfish", claim_own_hash)
problems = check_wheel(selfish)
assert any("hash for itself" in p for p in problems), problems

# metadata inside a wheel is somebody else's bytes, so unreadable fields are
# reported like everything else rather than raising out of a function that
# promised a list
def corrupt(entries):
    return [
        (n, d.replace(b"Version: 0.1.0", b"Version: nope").replace(
            b"Name: pkgit", b"Name: -bad-") if n.endswith("METADATA") else d)
        for n, d in entries
    ]


lying = rebuild("lies", corrupt)
problems = check_wheel(lying)
assert any("Version is not a version" in p for p in problems), problems
assert any("Name is not a usable name" in p for p in problems), problems
assert len(problems) >= 3, "and the hash mismatch as well, rather than stopping"

# which means the command reports rather than showing somebody a traceback
code, text = run(["check", str(lying)])
assert code == 1
assert text.startswith("pkgit: ")
assert "Traceback" not in text

# a project whose version carries a hyphen builds a wheel its own check accepts
write("post/pyproject.toml", '[project]\nname = "post"\nversion = "1.0-1"\n')
posted = load_project("post")
scaffold(posted)
code, text = run(["build", "post", "-o", "post/dist"])
assert code == 0, text
assert "post-1.0_1-py3-none-any.whl" in text, text

# strict finds what is allowed but unwise
write("thin/pyproject.toml", '[project]\nname = "thin"\nversion = "1.0"\n')
thin = load_project("thin")
scaffold(thin)
thin_wheel = build_wheel(thin, "thin/dist")
assert check_wheel(thin_wheel) == [], "nothing here is actually wrong"
problems = check_wheel(thin_wheel, strict=True)
assert any("Summary" in p for p in problems), problems
assert any("Requires-Python" in p for p in problems), problems

# it does get classifiers, because saying nothing about requires-python is
# saying it runs on all of them, and the matrix turns that into the list
assert not any("classifiers" in p for p in problems), problems
assert python_matrix(thin) == list(DEFAULT_PYTHONS)

# and a strict build reports them, with a non-zero code, having still built
code, text = run(["build", "thin", "-o", "thin/out", "--strict"])
assert code == 1, text
assert "Summary" in text
assert Path("thin/out/thin-1.0-py3-none-any.whl").is_file(), "it still built the wheel"

code, text = run(["build", "thin", "-o", "thin/out2"])
assert code == 0, text

# a project that cannot be read fails before anything is written
code, text = run(["build", "nowhere"])
assert code == 1 and "no pyproject.toml" in text
assert not Path("dist").exists()

# a broken wheel fails the check command with a code somebody can act on
code, text = run(["check", str(damaged)])
assert code == 1
assert "does not match its hash" in text

# every command from every stage is still there
for command in ("info", "matrix", "build", "check"):
    assert command in COMMANDS
assert run(["info", "app"])[0] == 0
assert run(["matrix", "app"])[1].split() == ["3.13", "3.14"]

# and the last thing: the tool builds a wheel of itself, and passes its own check
rows = list(csv.reader(io.StringIO(
    zipfile.ZipFile(built).read(f"{info}/RECORD").decode()
)))
assert len(rows) == len(zipfile.ZipFile(built).namelist())
assert check_wheel(built, strict=True) == []
~~~

~~~solution
import argparse
import base64
import csv
import email
import functools
import hashlib
import io
import re
import sys
import tomllib
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath


class ProjectError(Exception):
    """A pyproject.toml that cannot be built from, and why."""


@dataclass
class Project:
    """The parts of [project] that a build actually needs.

    Everything else in the table is real metadata and belongs on the wheel, but
    a builder that cannot find a name and a version has nothing to build.
    """

    name: str
    version: str
    description: str = ""
    requires_python: str = ""
    dependencies: list = field(default_factory=list)
    scripts: dict = field(default_factory=dict)
    root: Path = field(default_factory=Path)


def load_project(root="."):
    """Read and check the pyproject.toml in `root`.

    Every failure raises ProjectError with the reason. A build tool that raises
    KeyError at somebody is telling them about its own source rather than about
    their file.
    """
    root = Path(root)
    path = root / "pyproject.toml"
    if not path.is_file():
        raise ProjectError(f"no pyproject.toml in {root}")
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProjectError(f"{path} is not valid TOML: {exc}") from exc

    table = raw.get("project")
    if table is None:
        raise ProjectError(f"{path} has no [project] table")
    if not isinstance(table, dict):
        raise ProjectError(f"{path}: [project] is not a table")

    dynamic = table.get("dynamic", [])
    for name in ("name", "version"):
        if name in dynamic:
            raise ProjectError(
                f"{path}: {name} is declared dynamic, which means a backend "
                f"computes it, and this one does not"
            )
        if name not in table:
            raise ProjectError(f"{path}: [project] has no {name}")
        if not isinstance(table[name], str):
            raise ProjectError(f"{path}: [project] {name} must be a string")

    dependencies = table.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ProjectError(f"{path}: dependencies must be a list")
    if not all(isinstance(item, str) for item in dependencies):
        raise ProjectError(f"{path}: every dependency must be a string")

    scripts = table.get("scripts", {})
    if not isinstance(scripts, dict):
        raise ProjectError(f"{path}: [project.scripts] must be a table")
    for command, target in scripts.items():
        if not isinstance(target, str) or ":" not in target:
            raise ProjectError(
                f"{path}: script {command!r} is {target!r}, and a script has to "
                f"name a function as module:function"
            )

    return Project(
        name=table["name"],
        version=table["version"],
        description=table.get("description", ""),
        requires_python=table.get("requires-python", ""),
        dependencies=dependencies,
        scripts=scripts,
        root=root,
    )


__version__ = "0.1.0"


def build_parser():
    """The command line as a value, so it can be read and tested without running.

    Keeping this separate from `main` is what lets a test ask what the parser
    accepts rather than what happens when the whole tool runs.
    """
    parser = argparse.ArgumentParser(
        prog="pkgit", description="Build and check Python wheels."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="command")

    info = commands.add_parser("info", help="show what a project declares")
    info.add_argument("path", nargs="?", default=".",
                      help="the directory holding pyproject.toml")

    matrix = commands.add_parser("matrix", help="the Pythons this project supports")
    matrix.add_argument("path", nargs="?", default=".",
                        help="the directory holding pyproject.toml")

    build = commands.add_parser("build", help="build a wheel and check it")
    build.add_argument("path", nargs="?", default=".",
                       help="the directory holding pyproject.toml")
    build.add_argument("-o", "--out", default="dist", help="where to put the wheel")
    build.add_argument("--strict", action="store_true",
                       help="complain about metadata that is missing but allowed")

    check = commands.add_parser("check", help="check a wheel that already exists")
    check.add_argument("wheel", help="the .whl to look at")
    check.add_argument("--strict", action="store_true",
                       help="complain about metadata that is missing but allowed")
    return parser


def load_or_report(path, out):
    """The project at `path`, or None having already said why not.

    Every command starts this way, and the three of them agreeing on the
    wording is the difference between a tool and three tools in a trench coat.
    """
    try:
        return load_project(path)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return None


def cmd_info(args, out):
    """Print what the project declares, and return the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    print(f"name            {project.name}", file=out)
    print(f"version         {project.version}", file=out)
    if project.description:
        print(f"description     {project.description}", file=out)
    if project.requires_python:
        print(f"requires-python {project.requires_python}", file=out)
    for dependency in project.dependencies:
        print(f"dependency      {dependency}", file=out)
    for command, target in project.scripts.items():
        print(f"script          {command} = {target}", file=out)
    return 0


def cmd_matrix(args, out):
    """Print the Python versions the project supports, one per line."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    supported = python_matrix(project)
    if not supported:
        print(f"pkgit: {project.requires_python!r} matches no known Python", file=out)
        return 1
    for text in supported:
        print(text, file=out)
    return 0


def cmd_build(args, out):
    """Build the wheel, then check what was built. Returns the exit code."""
    project = load_or_report(args.path, out)
    if project is None:
        return 1
    try:
        path = build_wheel(project, args.out)
    except ProjectError as exc:
        print(f"pkgit: {exc}", file=out)
        return 1
    problems = check_wheel(path, strict=args.strict)
    print(path, file=out)
    for problem in problems:
        print(f"pkgit: {path.name}: {problem}", file=out)
    return 1 if problems else 0


def cmd_check(args, out):
    """Check a wheel that already exists. Returns the exit code."""
    problems = check_wheel(args.wheel, strict=args.strict)
    for problem in problems:
        print(f"pkgit: {problem}", file=out)
    if not problems:
        print(f"{args.wheel}: fine", file=out)
    return 1 if problems else 0


COMMANDS = {"info": cmd_info, "matrix": cmd_matrix,
            "build": cmd_build, "check": cmd_check}


def main(argv=None, out=None):
    """Run one command and return the exit code it wants.

    `argv` is a parameter so a test can pass a list, and defaults to None
    because that is what makes argparse read sys.argv when a person runs it.

    Returning the code rather than calling sys.exit is the whole reason this
    can be tested. Exiting is the caller's job, which is what __main__.py is
    for, and it is one line.
    """
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args, sys.stdout if out is None else out)


MAIN_TEMPLATE = """\
import sys

from {module} import {attribute}

if __name__ == "__main__":
    sys.exit({attribute}())
"""

SCRIPT_TEMPLATE = """\
import sys

from {module} import {attribute}

sys.exit({attribute}())
"""


def split_entry_point(target):
    """`"module:attribute"` as a pair, or a ProjectError saying what is wrong."""
    module, separator, attribute = target.partition(":")
    if not separator or not module or not attribute:
        raise ProjectError(f"{target!r} does not name a function as module:function")
    if not all(part.isidentifier() for part in module.split(".")):
        raise ProjectError(f"{target!r}: {module!r} is not a module path")
    if not all(part.isidentifier() for part in attribute.split(".")):
        raise ProjectError(f"{target!r}: {attribute!r} is not an attribute name")
    return module, attribute


def main_module_source(target):
    """The `__main__.py` that makes `python -m <package>` work.

    Every line earns its place. The guard is unit 29's: a module run as a
    program has `__name__` set to "__main__" and a module imported by something
    else does not, so the import above it costs nothing to whoever imports the
    package. `sys.exit` is what turns the number `main` returns into the number
    the shell sees, which is the reason `main` returns one.
    """
    module, attribute = split_entry_point(target)
    return MAIN_TEMPLATE.format(module=module, attribute=attribute)


def console_script_source(target):
    """What an installer writes for a console script, near enough.

    The `pkgit` command on somebody's PATH is a small Python file that imports
    the function the entry point names and exits with what it returns. The same
    lines as `__main__.py` without the guard, because a script is run and never
    imported, so there is nothing for a guard to protect against.
    """
    module, attribute = split_entry_point(target)
    return SCRIPT_TEMPLATE.format(module=module, attribute=attribute)


def entry_points_metadata(project):
    """The `entry_points.txt` a wheel carries, in the format the spec asks for."""
    if not project.scripts:
        return ""
    lines = ["[console_scripts]"]
    for command, target in sorted(project.scripts.items()):
        split_entry_point(target)
        lines.append(f"{command} = {target}")
    return "\n".join(lines) + "\n"


def package_name(project):
    """The importable name for a distribution name.

    A distribution is named with hyphens and a package is named with
    underscores, because a hyphen is not valid in an identifier. `pip install
    my-tool` then `import my_tool` is this rule and not a coincidence.
    """
    return project.name.replace("-", "_").replace(".", "_").lower()


def scaffold(project, root=None, force=False):
    """Write the package layout the project describes. Returns what it wrote.

    A file that is already there is left alone. The alternative is a generator
    that silently replaces somebody's module with a one line stub the first
    time they run it twice, and `force=True` is how a caller says they meant
    that.
    """
    root = Path(root) if root is not None else project.root
    directory = root / package_name(project)
    directory.mkdir(parents=True, exist_ok=True)

    wanted = [(directory / "__init__.py", f'__version__ = "{project.version}"\n')]
    if project.scripts:
        target = project.scripts[sorted(project.scripts)[0]]
        wanted.append((directory / "__main__.py", main_module_source(target)))

    written = []
    for path, text in wanted:
        if path.exists() and not force:
            continue
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written

VERSION_PATTERN = re.compile(
    r"""
    ^\s*v?
    (?:(?P<epoch>\d+)!)?                     # 1!2.0 sorts above every 2.0
    (?P<release>\d+(?:\.\d+)*)
    (?:[-_.]?(?P<pre_l>a|b|c|rc|alpha|beta|pre|preview)[-_.]?(?P<pre_n>\d+)?)?
    (?P<post>-(?P<post_n1>\d+)|[-_.]?(?P<post_l>post|rev|r)[-_.]?(?P<post_n2>\d+)?)?
    (?P<dev>[-_.]?dev[-_.]?(?P<dev_n>\d+)?)?
    (?:\+(?P<local>[a-z0-9]+(?:[-_.][a-z0-9]+)*))?
    \s*$
    """,
    re.VERBOSE | re.IGNORECASE,
)

PRE_NAMES = {"alpha": "a", "beta": "b", "c": "rc", "pre": "rc", "preview": "rc"}


class InvalidVersion(ProjectError):
    """A version string PEP 440 does not describe."""


@functools.total_ordering
class Version:
    """A version that sorts the way the specification says it should.

    Reading one is the easy half. The ordering is where the rules live: a dev
    release comes before its own pre-releases, a pre-release comes before the
    release it leads to, and a post-release comes after it. Written out that is
    1.0.dev1 < 1.0a1 < 1.0 < 1.0.post1, which is not what a plain string
    comparison gives you and not what a tuple of integers gives you either.
    """

    def __init__(self, text):
        match = VERSION_PATTERN.match(str(text))
        if match is None:
            raise InvalidVersion(f"{text!r} is not a valid version")
        parts = match.groupdict()
        self.text = str(text).strip()
        self.epoch = int(parts["epoch"] or 0)
        self.release = tuple(int(n) for n in parts["release"].split("."))
        self.pre = self._pre(parts)
        self.post = self._segment(parts["post"], parts["post_n1"], parts["post_n2"])
        self.dev = self._segment(parts["dev"], parts["dev_n"])
        self.local = self._local(parts["local"])

    @staticmethod
    def _local(text):
        """A local label is dot separated, and a hyphen or underscore is a dot."""
        if not text:
            return ()
        return tuple(text.lower().replace("-", ".").replace("_", ".").split("."))

    @staticmethod
    def _pre(parts):
        if parts["pre_l"] is None:
            return None
        letter = parts["pre_l"].lower()
        return PRE_NAMES.get(letter, letter), int(parts["pre_n"] or 0)

    @staticmethod
    def _segment(present, *numbers):
        """A segment may be written with a number, without one, or not at all.

        `1.0.post1`, `1.0.post` and `1.0` are three different answers, and the
        middle one means post-release zero rather than no post-release.
        """
        if present is None:
            return None
        for number in numbers:
            if number is not None:
                return int(number)
        return 0

    @property
    def base(self):
        """The release numbers alone, which is what a wildcard compares against."""
        return self.release

    @property
    def is_prerelease(self):
        return self.pre is not None or self.dev is not None

    def _key(self):
        """One tuple that sorts correctly, so the comparisons are one line each.

        Each segment becomes a small tuple whose first number is its rank, so
        plain tuple comparison does the work and there are no sentinel objects
        to explain. A dev release with no pre-release ranks below every
        pre-release, and a release with neither ranks above them all.
        """
        release = self.release
        while len(release) > 1 and release[-1] == 0:
            release = release[:-1]
        if self.pre is not None:
            pre = (1, *self.pre)
        elif self.dev is not None:
            pre = (0,)
        else:
            pre = (2,)
        post = (0,) if self.post is None else (1, self.post)
        dev = (1,) if self.dev is None else (0, self.dev)
        local = (1, self.local) if self.local else (0,)
        return self.epoch, release, pre, post, dev, local

    def __eq__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() == other._key()

    def __lt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self._key() < other._key()

    def __hash__(self):
        return hash(self._key())

    def __repr__(self):
        return f"Version({self.text!r})"

    def __str__(self):
        return self.text

SPECIFIER_PATTERN = re.compile(r"^\s*(===|==|!=|~=|<=|>=|<|>)\s*([^\s,]+)\s*$")

DEFAULT_PYTHONS = ("3.9", "3.10", "3.11", "3.12", "3.13", "3.14")


class Specifier:
    """One comparison out of a requirement, such as `>=3.11` or `==1.4.*`."""

    def __init__(self, text):
        match = SPECIFIER_PATTERN.match(text)
        if match is None:
            raise ProjectError(f"{text!r} is not a version specifier")
        self.operator, self.value = match.group(1), match.group(2)
        self.text = f"{self.operator}{self.value}"
        self.wildcard = self.value.endswith(".*")
        if self.wildcard and self.operator not in ("==", "!="):
            raise ProjectError(f"{self.text!r}: only == and != may take a wildcard")
        if self.operator == "===":
            self.version = None
            return
        self.version = Version(self.value[:-2] if self.wildcard else self.value)
        if self.operator == "~=" and len(self.version.release) < 2:
            raise ProjectError(
                f"{self.text!r}: ~= needs at least two release segments, because "
                f"it means 'this series', and one number does not name a series"
            )

    @staticmethod
    def _padded(release, length):
        """Release numbers padded with zeros, because 1 and 1.0 are one version."""
        return (tuple(release) + (0,) * length)[:length]

    def matches(self, version):
        """Whether `version` satisfies this one comparison."""
        version = version if isinstance(version, Version) else Version(version)
        if self.operator == "===":
            return str(version) == self.value
        if self.wildcard:
            prefix = self.version.release
            same = self._padded(version.release, len(prefix)) == prefix
            return same if self.operator == "==" else not same
        if self.operator == "~=":
            # Compatible release: at least this version, and inside the series
            # named by everything but its last number. ~=1.4.2 is >=1.4.2 and
            # ==1.4.*, which is the pair of rules people mean by "compatible".
            series = self.version.release[:-1]
            return (version >= self.version
                    and self._padded(version.release, len(series)) == series)
        comparisons = {
            "==": version == self.version,
            "!=": version != self.version,
            "<": version < self.version,
            "<=": version <= self.version,
            ">": version > self.version,
            ">=": version >= self.version,
        }
        return comparisons[self.operator]

    def __contains__(self, version):
        return self.matches(version)

    def __repr__(self):
        return f"Specifier({self.text!r})"


class SpecifierSet:
    """Every comparison in one requirement, all of which have to hold."""

    def __init__(self, text=""):
        self.specifiers = [
            Specifier(part) for part in str(text).split(",") if part.strip()
        ]

    @property
    def allows_prereleases(self):
        """Whether a pre-release can satisfy this set.

        PEP 440's rule, and the one that surprises people: `>=1.0` does not
        match `2.0a1`. An installer will not hand you a pre-release unless you
        asked for one, and asking means naming one in the specifier.
        """
        return any(
            s.version is not None and s.version.is_prerelease for s in self.specifiers
        )

    def matches(self, version):
        """Whether `version` satisfies all of them."""
        version = version if isinstance(version, Version) else Version(version)
        if version.is_prerelease and not self.allows_prereleases:
            return False
        return all(specifier.matches(version) for specifier in self.specifiers)

    def __contains__(self, version):
        return self.matches(version)

    def __len__(self):
        return len(self.specifiers)

    def __repr__(self):
        return f"SpecifierSet({','.join(s.text for s in self.specifiers)!r})"


def python_matrix(project, candidates=DEFAULT_PYTHONS):
    """The Python versions this project says it runs on.

    This is where the previous stage pays for itself. Sorted as strings, "3.9"
    comes after "3.10", so a matrix built on string comparison quietly drops
    the newest interpreters or keeps one it should not.
    """
    allowed = SpecifierSet(project.requires_python)
    return [text for text in candidates if allowed.matches(text)]


def python_classifiers(project, candidates=DEFAULT_PYTHONS):
    """The classifiers PyPI shows, derived rather than typed out by hand."""
    return [
        f"Programming Language :: Python :: {text}"
        for text in python_matrix(project, candidates)
    ]


NAME_PATTERN = re.compile(r"^([a-z0-9]|[a-z0-9][a-z0-9._-]*[a-z0-9])$", re.IGNORECASE)

METADATA_VERSION = "2.1"


def normalise_name(name):
    """The one spelling of a distribution name, per PEP 503.

    Runs of hyphens, underscores and dots all become a single hyphen, and the
    whole thing is lowercased. It is why `pip install Flask-SQLAlchemy`,
    `flask_sqlalchemy` and `flask.sqlalchemy` reach the same project.
    """
    if not NAME_PATTERN.match(str(name)):
        raise ProjectError(
            f"{name!r} is not a usable distribution name: it has to start and "
            f"end with a letter or digit, and hold only letters, digits, and "
            f"the separators - _ ."
        )
    return re.sub(r"[-_.]+", "-", str(name)).lower()


def wheel_escape(name):
    """A normalised name with hyphens turned into underscores.

    A wheel filename is read by splitting on hyphens, so the name cannot
    contain one. This is not the same transformation as the importable package
    name, even though it usually lands on the same string.
    """
    return normalise_name(name).replace("-", "_")


def version_escape(version):
    """A version with every run of non-alphanumerics collapsed to one underscore.

    PEP 427, and the same reason the name is escaped. A wheel filename is read
    by splitting it on hyphens into five fields, and `1.0-1` is a perfectly
    legal post-release with a hyphen sitting in the middle of it.
    """
    return re.sub(r"[^\w\d.]+", "_", str(version))


def wheel_stem(project):
    """The escaped name and version, which every wheel artefact starts with."""
    return (f"{wheel_escape(project.name)}-"
            f"{version_escape(Version(project.version))}")


def wheel_filename(project, python_tag="py3", abi_tag="none", platform_tag="any"):
    """`{name}-{version}-{python}-{abi}-{platform}.whl`, the five fields.

    Pure Python with no compiled parts is `py3-none-any`, which means any
    Python 3, no particular ABI, any platform. A wheel with C in it names the
    interpreter and the platform it was built for, which is why there are
    dozens of files behind one release of numpy and one behind most tools.
    """
    return f"{wheel_stem(project)}-{python_tag}-{abi_tag}-{platform_tag}.whl"


def dist_info_dir(project):
    """The `.dist-info` directory inside the wheel, which holds the metadata."""
    return f"{wheel_stem(project)}.dist-info"


def metadata_text(project, candidates=DEFAULT_PYTHONS):
    """The METADATA file: headers, a blank line, then the description.

    The format is the one email uses, which is not a coincidence. It was
    already specified, already had a parser in the standard library, and the
    people writing the first packaging specs took it rather than inventing one.
    """
    lines = [
        f"Metadata-Version: {METADATA_VERSION}",
        f"Name: {normalise_name(project.name)}",
        f"Version: {Version(project.version)}",
    ]
    if project.description:
        lines.append(f"Summary: {project.description}")
    if project.requires_python:
        SpecifierSet(project.requires_python)
        lines.append(f"Requires-Python: {project.requires_python}")
    lines.extend(f"Classifier: {text}" for text in
                 python_classifiers(project, candidates))
    lines.extend(f"Requires-Dist: {text}" for text in project.dependencies)
    return "\n".join(lines) + "\n\n"

WHEEL_TEMPLATE = """\
Wheel-Version: 1.0
Generator: pkgit {version}
Root-Is-Purelib: true
Tag: {tag}
"""

# A zip stores a timestamp per entry, and a timestamp is the clock leaking into
# the output. Everything is stamped with the earliest a zip can hold, so the
# same source builds the same bytes on any machine on any day.
REPRODUCIBLE_DATE = (1980, 1, 1, 0, 0, 0)


def wheel_text(tag="py3-none-any"):
    """The WHEEL file, which says how the archive itself is put together."""
    return WHEEL_TEMPLATE.format(version=__version__, tag=tag)


def record_hash(data):
    """`sha256=` and the digest in base64 without padding, per PEP 376."""
    digest = hashlib.sha256(data).digest()
    return "sha256=" + base64.urlsafe_b64encode(digest).decode().rstrip("=")


def record_text(entries):
    """The RECORD file: one CSV row of name, hash and size per file.

    RECORD cannot carry its own hash, because writing the hash in would change
    the file the hash was taken of. Its own row is the name and two empty
    fields, which is what the specification asks for.
    """
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    for name, data in entries:
        writer.writerow([name, record_hash(data), len(data)])
    return out.getvalue()


def collect_sources(project, root=None):
    """Every file of the package, as (name inside the wheel, bytes), sorted."""
    root = Path(root) if root is not None else project.root
    package = root / package_name(project)
    if not package.is_dir():
        raise ProjectError(
            f"no package directory at {package}: a wheel needs something to hold"
        )
    found = [
        (path.relative_to(root).as_posix(), path.read_bytes())
        for path in sorted(package.rglob("*"))
        if path.is_file() and "__pycache__" not in path.parts
    ]
    if not found:
        raise ProjectError(f"{package} has no files in it")
    return found


def build_wheel(project, outdir="dist", root=None, tag="py3-none-any"):
    """Write the wheel and return where it landed.

    A wheel is a zip with three things agreed on: the layout, the names in the
    `.dist-info` directory, and the filename. There is no build step for pure
    Python, which is why a wheel installs by being unpacked.

    Every entry is stamped with one fixed date and written in sorted order, so
    building the same source twice gives identical bytes. A build that embeds
    the clock cannot be compared against the one somebody else made from the
    same commit, which is the whole point of a reproducible build.
    """
    root = Path(root) if root is not None else project.root
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    info = dist_info_dir(project)

    payload = collect_sources(project, root)
    payload.append((f"{info}/METADATA", metadata_text(project).encode()))
    payload.append((f"{info}/WHEEL", wheel_text(tag).encode()))
    if project.scripts:
        payload.append(
            (f"{info}/entry_points.txt", entry_points_metadata(project).encode())
        )
    payload.sort()
    payload.append(
        (f"{info}/RECORD", (record_text(payload) + f"{info}/RECORD,,\n").encode())
    )

    path = outdir / wheel_filename(project, *tag.split("-"))
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in payload:
            entry = zipfile.ZipInfo(name, date_time=REPRODUCIBLE_DATE)
            entry.external_attr = 0o644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data)
    return path


def _record_rows(text):
    """RECORD as rows, refusing anything that is not three fields."""
    rows = []
    for row in csv.reader(io.StringIO(text)):
        if not row:
            continue
        if len(row) != 3:
            raise ProjectError(f"RECORD row {row!r} does not have three fields")
        rows.append(row)
    return rows


def check_wheel(path, strict=False):
    """Everything wrong with a built wheel, as a list of sentences.

    An empty list means it is fine. Returning problems rather than raising on
    the first one is what lets a person fix all of them in one go, which is the
    difference between a checker and a tripwire.
    """
    path = Path(path)
    problems = []
    if not path.is_file():
        return [f"{path} is not a file"]
    if not path.name.endswith(".whl"):
        problems.append(f"{path.name} does not end in .whl")

    fields = path.name.removesuffix(".whl").split("-")
    if len(fields) != 5:
        return [*problems, f"{path.name} does not have the five fields of a wheel"]
    name, version = fields[0], fields[1]

    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        return [*problems, f"{path.name} is not a zip file: {exc}"]

    with archive:
        names = archive.namelist()
        for entry in names:
            if entry.startswith("/") or ".." in PurePosixPath(entry).parts:
                problems.append(f"{entry} would unpack outside the target directory")

        infos = {n.split("/")[0] for n in names if n.split("/")[0].endswith(".dist-info")}
        expected = f"{name}-{version}.dist-info"
        if expected not in infos:
            problems.append(f"no {expected} in the archive, only {sorted(infos)}")
            return problems
        if len(infos) > 1:
            problems.append(f"more than one dist-info directory: {sorted(infos)}")

        problems += _check_metadata(archive, names, expected, name, version, strict)
        problems += _check_record(archive, names, expected)
    return problems


def _check_metadata(archive, names, info, name, version, strict):
    """METADATA and WHEEL: present, parseable, and saying the right things."""
    problems = []
    if f"{info}/WHEEL" not in names:
        problems.append(f"no {info}/WHEEL")
    elif not email.message_from_bytes(archive.read(f"{info}/WHEEL"))["Wheel-Version"]:
        problems.append("WHEEL has no Wheel-Version")

    if f"{info}/METADATA" not in names:
        return [*problems, f"no {info}/METADATA"]

    metadata = email.message_from_bytes(archive.read(f"{info}/METADATA"))
    for header in ("Metadata-Version", "Name", "Version"):
        if not metadata[header]:
            problems.append(f"METADATA has no {header}")
    # Everything below this point is somebody else's bytes. A checker that
    # raises on the first unreadable field is a checker that cannot report the
    # second one, and this one promised a list.
    if metadata["Name"]:
        try:
            escaped = wheel_escape(metadata["Name"])
        except ProjectError as exc:
            problems.append(f"METADATA Name is not a usable name: {exc}")
        else:
            if escaped != name:
                problems.append(
                    f"METADATA says the name is {metadata['Name']!r} and the "
                    f"filename says {name!r}"
                )
    if metadata["Version"]:
        try:
            declared = version_escape(Version(metadata["Version"]))
        except InvalidVersion as exc:
            problems.append(f"METADATA Version is not a version: {exc}")
        else:
            if declared != version:
                problems.append(
                    f"METADATA says version {metadata['Version']!r} and the "
                    f"filename says {version!r}"
                )
    if metadata["Requires-Python"]:
        try:
            SpecifierSet(metadata["Requires-Python"])
        except ProjectError as exc:
            problems.append(f"Requires-Python is not a specifier: {exc}")

    if strict:
        if not metadata["Summary"]:
            problems.append("no Summary, so PyPI will show the project with no blurb")
        if not metadata["Requires-Python"]:
            problems.append("no Requires-Python, so old interpreters will try it")
        if not metadata.get_all("Classifier"):
            problems.append("no classifiers")
    return problems


def _check_record(archive, names, info):
    """RECORD: lists exactly what is here, and the hashes are the real ones."""
    if f"{info}/RECORD" not in names:
        return [f"no {info}/RECORD"]
    try:
        rows = _record_rows(archive.read(f"{info}/RECORD").decode("utf-8"))
    except (ProjectError, UnicodeDecodeError) as exc:
        return [f"RECORD cannot be read: {exc}"]

    problems = []
    # A set, and made once. The membership test below runs per row and there is
    # about one row per file, so scanning a list here made checking a wheel
    # quadratic in the number of files in it.
    held = set(names)
    listed = {row[0] for row in rows}
    for missing in sorted(held - listed):
        problems.append(f"{missing} is in the wheel and not in RECORD")
    for extra in sorted(listed - held):
        problems.append(f"{extra} is in RECORD and not in the wheel")

    for entry, digest, size in rows:
        if entry == f"{info}/RECORD":
            if digest or size:
                problems.append("RECORD lists a hash for itself, which cannot be right")
            continue
        if entry not in held:
            continue
        data = archive.read(entry)
        if digest != record_hash(data):
            problems.append(f"{entry} does not match its hash in RECORD")
        elif size != str(len(data)):
            problems.append(f"{entry} is {len(data)} bytes and RECORD says {size}")
    return problems
~~~
