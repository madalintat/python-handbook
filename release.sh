#!/usr/bin/env bash
# Every check this project has, in one command.
#
#   ./release.sh --check        everything that runs offline
#   ./release.sh --check --net  the above, plus every starter and solution
#                               compiled and run past ruff, mypy and CPython
set -uo pipefail
cd "$(dirname "$0")"

fail=0
step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
note() { if [ "$1" -eq 0 ]; then printf '   \033[32mok\033[0m\n'; else printf '   \033[31mFAILED\033[0m\n'; fail=1; fi; }

step "content -> data"
python3 build.py; note $?

step "data/ is not stale"
if [ -d .git ]; then
  git diff --quiet -- data/ && echo "   data/ matches content/" || {
    echo "   data/ is out of date; commit the rebuilt JSON with your content change"; fail=1; }
else
  echo "   not a git repository, skipping"
fi

step "python tokenizer"
node test_frontend.mjs; note $?

step "vim mode"
vimout=$(node test_vim.mjs); rc=$?
echo "$vimout" | tail -1
note $rc

# One interpreter for every content file: build.py --check per file meant fifty
# starts, each re-importing the whole module and its tables. --check on an
# exercise already runs the vocabulary gate, so there is no second step.
step "every content file parses, and no exercise runs ahead of the reader"
python3 - <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, ".")
import build

bad = 0
for kind, parse in (("units", build.parse_unit), ("ex", build.parse_exercises),
                    ("drills", build.parse_drills), ("gloss", build.parse_gloss),
                    ("projects", build.parse_project)):
    for f in sorted((Path("content") / kind).glob("*.md")):
        try:
            parse(f)
        except SystemExit as e:
            print(f"   {f}: {e}"); bad += 1
            continue
        if kind == "ex":
            for problem in build.gate(f):
                print(f"   VOCABULARY {problem}"); bad += 1
print(f"   {bad} problems")
sys.exit(1 if bad else 0)
PY
note $?

if [ "${*}" != "${*/--net/}" ]; then
  step "every starter and solution, against all three judges"
  python3 build.py --validate; note $?
fi

printf '\n'
if [ "$fail" -eq 0 ]; then printf '\033[32mall checks passed\033[0m\n'; else printf '\033[31mchecks failed\033[0m\n'; fi
exit "$fail"
