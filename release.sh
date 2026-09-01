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

# No separate parse step: `python3 build.py` above already parses every content
# file, runs the vocabulary gate and refuses a half-written unit. A second loop
# here was a hand-copy of build.py's own kind-to-parser dispatch.

if [ "${*}" != "${*/--net/}" ]; then
  step "every starter and solution, against all three judges"
  python3 build.py --validate; note $?
fi

printf '\n'
if [ "$fail" -eq 0 ]; then printf '\033[32mall checks passed\033[0m\n'; else printf '\033[31mchecks failed\033[0m\n'; fi
exit "$fail"
