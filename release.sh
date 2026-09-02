#!/usr/bin/env bash
# Every check this project has, in one command.
#
#   ./release.sh --check          everything that runs offline
#   ./release.sh --check --net    the above, plus every starter and solution
#                                 compiled and run past ruff, mypy and CPython
#   ./release.sh --check --browser  the above, plus the same exercises judged in
#                                 a real browser, every route at every width in
#                                 both themes, and every control pressed.
#                                 Needs a server on 8848 and the ego-browser CLI.
set -uo pipefail
cd "$(dirname "$0")"

fail=0

# Each qa-*.sh owns its own output format and exits on its own verdict, so
# these are ordinary steps.
browser_step() {
  step "$1"
  "$2" | grep -E "^ *FAIL|: [0-9]+ problems$|^[A-Z].*problems$"
  note "${PIPESTATUS[0]}"
}

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

step "contrast, every ink on every ground"
node test_contrast.mjs; note $?

step "focus mode, against every real stage"
node test_focus.mjs; note $?

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

if [ "${*}" != "${*/--browser/}" ]; then
  if ! curl -fsS -o /dev/null http://127.0.0.1:8848/; then
    step "in a browser"
    echo "   no server on 8848; run: python3 -m http.server 8848"
    fail=1
  else
    browser_step "every starter, judged in the browser" ./qa-browser.sh

    # A starter fails on its first stub, so the sweep above can pass without a
    # project's real code ever having run inside Pyodide. This is the half
    # where a divergence lives: event loops, clocks, recursion and the cycle
    # collector all behave differently under WebAssembly.
    browser_step "every project solution, run in the browser" ./qa-solutions.sh

    browser_step "every route, at every width, in both themes" ./qa-views.sh

    browser_step "every control" ./qa-controls.sh
  fi
fi

printf '\n'
if [ "$fail" -eq 0 ]; then printf '\033[32mall checks passed\033[0m\n'; else printf '\033[31mchecks failed\033[0m\n'; fi
exit "$fail"
