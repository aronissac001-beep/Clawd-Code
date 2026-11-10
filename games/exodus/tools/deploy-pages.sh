#!/usr/bin/env bash
# Publish the built game to the gh-pages branch (GitHub Pages: https://aronissac001-beep.github.io/Clawd-Code/).
# Run from anywhere after `node hexarch/tools/build.mjs`. Usage: hexarch/tools/deploy-pages.sh "message"
set -euo pipefail
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
SRC="$ROOT/docs/hexarch/index.html"
WT=$(mktemp -d)
MSG=${1:-"Update Hexarch"}
SHA=$(git -C "$ROOT" rev-parse --short HEAD)
git -C "$ROOT" fetch -q origin gh-pages
git -C "$ROOT" worktree add -q --detach "$WT" origin/gh-pages
mkdir -p "$WT/hexarch"
cp "$SRC" "$WT/index.html"; cp "$SRC" "$WT/hexarch/index.html"; touch "$WT/.nojekyll"
cd "$WT"
git add -A
if git diff --cached --quiet; then echo "gh-pages already up to date"; else
  git commit -q -m "$MSG" -m "Built from $(git -C "$ROOT" branch --show-current) at $SHA." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hUWmDFq7Pz7QKqMNh6So5"
  for i in 1 2 3 4; do git push -q origin HEAD:gh-pages && break || sleep $((2**i)); done
  echo "pushed gh-pages $(git rev-parse --short HEAD)"
fi
cd "$ROOT"; git worktree remove --force "$WT"
