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
node test_vim.mjs | tail -1
node test_vim.mjs | grep -q "0 failed"; note $?

step "every content file parses"
parsefail=0
for f in content/units/*.md content/ex/*.md content/drills/*.md content/gloss/*.md content/projects/*.md; do
  [ -e "$f" ] || continue
  out=$(python3 build.py --check "$f" 2>&1) || { echo "   $f: $out"; parsefail=1; }
done
note $parsefail

step "no exercise uses a construct the reader has not met"
python3 - <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, ".")
import build
problems = [p for f in sorted(Path("content/ex").glob("*.md")) for p in build.gate(f)]
for p in problems:
    print("  " + p)
print(f"   {len(problems)} vocabulary violations")
sys.exit(1 if problems else 0)
PY
note $?

if [ "${*}" != "${*/--net/}" ]; then
  step "every starter and solution, against all three judges"
  python3 build.py --validate; note $?
fi

printf '\n'
if [ "$fail" -eq 0 ]; then printf '\033[32mall checks passed\033[0m\n'; else printf '\033[31mchecks failed\033[0m\n'; fi
exit "$fail"
