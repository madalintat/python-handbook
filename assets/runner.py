"""What it means to run a reader's code. One definition, executed by both judges.

The browser runs this inside Pyodide with `runPython`, then calls `run_json`.
`build.py --validate` runs it as a subprocess, feeding it JSON on stdin. Anything
that differed between the two -- the filenames a traceback names, the line
numbers it reports, how an exception is spelled -- would mean the validator was
not judging the artefact the reader actually runs.
"""

import io
import json
import sys
import traceback

SOURCE_NAME = "your_code.py"
TESTS_NAME = "hidden_tests.py"

# Runaway recursion is an ordinary mistake, and in the browser it is a fatal one:
# Python frames sit on the WebAssembly stack, so hitting CPython's default limit
# of 1000 overruns that stack first. Pyodide then reports "already fatally failed"
# and every later run in the tab is dead until the reader reloads. A lower limit
# makes Python raise RecursionError while there is still stack left, so the
# mistake reads as a verdict instead of breaking the page. It has to be low
# enough to leave room for the frames Pyodide itself is holding, and high enough
# for any recursion this book asks anyone to write.
RECURSION_LIMIT = 300


def run(src, tests):
    """Execute the reader's code and then the hidden tests, in one namespace.

    The two are compiled separately so that each starts at line 1, which is what
    the reader sees in the editor. Returns a plain dict: whether it passed, what
    it printed, and how it failed.
    """
    ns = {"__name__": "__main__"}

    def _ph_import():
        """Re-run the reader's code as an import, for exercises about import time.

        `run` executes it the way `python your_code.py` does, so __name__ is
        "__main__". A test that needs to know what an import would do calls this.
        """
        module = {"__name__": "your_code"}
        exec(compile(src, SOURCE_NAME, "exec"), module)
        return module

    ns["_ph_import"] = _ph_import

    # Everything the `finally` puts back is captured before the `try` opens, and
    # nothing between here and the `try` can raise. Setting the recursion limit
    # cannot: it raises when the current stack is already deeper than the new
    # limit, which the browser's suspending entry path makes reachable, and if
    # that happened out here the `finally` would never run and stdout would stay
    # redirected for the rest of the session.
    captured = io.StringIO()
    real_stdout = sys.stdout
    real_limit = sys.getrecursionlimit()
    # The offline judge forks a process per run and the browser reuses one
    # interpreter for the whole session, so anything a run leaves in sys.modules
    # would be invisible offline and permanent in the tab. An exercise that
    # shadows a standard library module is doing exactly that on purpose.
    real_modules = dict(sys.modules)
    try:
        sys.stdout = captured
        sys.setrecursionlimit(RECURSION_LIMIT)
        exec(compile(src, SOURCE_NAME, "exec"), ns)
        exec(compile(tests, TESTS_NAME, "exec"), ns)
        return {"ok": True, "out": captured.getvalue(), "exc": None, "msg": "", "tb": ""}
    except BaseException as exc:
        # tb_next drops this function's own frame, so the reader sees their code
        # at the top of the traceback rather than the harness.
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__.tb_next))
        return {"ok": False, "out": captured.getvalue(),
                "exc": type(exc).__name__, "msg": str(exc), "tb": tb}
    finally:
        sys.stdout = real_stdout
        sys.setrecursionlimit(real_limit)
        # clear-and-update rather than a diff: it is shorter, it also restores
        # anything the run deleted, and it keeps the same dict object, which is
        # what the import machinery holds a reference to.
        sys.modules.clear()
        sys.modules.update(real_modules)


def run_json(src, tests):
    """`run`, as a JSON string. The browser crosses the language boundary here."""
    return json.dumps(run(src, tests))


# An explicit flag rather than a bare __main__ guard: Pyodide executes this file
# with __name__ set to "__main__", so the guard alone would make the browser
# block reading a stdin that is never going to arrive.
if __name__ == "__main__" and sys.argv[1:2] == ["--stdin"]:
    payload = json.load(sys.stdin)
    json.dump(run(payload["src"], payload["tests"]), sys.stdout)
