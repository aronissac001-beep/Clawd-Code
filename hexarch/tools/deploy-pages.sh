#!/usr/bin/env bash
# Publish the arcade to the gh-pages branch (GitHub Pages: https://aronissac001-beep.github.io/Clawd-Code/).
# The hub menu (docs/index.html) goes to the site root; each built game docs/<game>/index.html to /<game>/.
# Usage: hexarch/tools/deploy-pages.sh "message"
set -euo pipefail
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
GAMES=${GAMES:-"hexarch starwake kessa exodus"}  # e.g. GAMES=kessa to publish one game; the others on the site stay as they are
WT=$(mktemp -d)
MSG=${1:-"Update arcade"}
SHA=$(git -C "$ROOT" rev-parse --short HEAD)
git -C "$ROOT" fetch -q origin gh-pages
git -C "$ROOT" worktree add -q --detach "$WT" origin/gh-pages
for g in $GAMES; do
  # publish the committed build, never uncommitted work in progress
  if git -C "$ROOT" cat-file -e "HEAD:docs/$g/index.html" 2>/dev/null; then mkdir -p "$WT/$g"; git -C "$ROOT" show "HEAD:docs/$g/index.html" > "$WT/$g/index.html"; echo "  $g"; fi
done
git -C "$ROOT" show HEAD:docs/index.html > "$WT/index.html"; git -C "$ROOT" show HEAD:docs/arcade-icon.png > "$WT/arcade-icon.png"; touch "$WT/.nojekyll"
cd "$WT"
git add -A
if git diff --cached --quiet; then echo "gh-pages already up to date"; else
  git commit -q -m "$MSG" -m "Built from $(git -C "$ROOT" branch --show-current) at $SHA." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hUWmDFq7Pz7QKqMNh6So5"
  for i in 1 2 3 4; do git push -q origin HEAD:gh-pages && break || sleep $((2**i)); done
  echo "pushed gh-pages $(git rev-parse --short HEAD)"
fi
cd "$ROOT"; git worktree remove --force "$WT"
