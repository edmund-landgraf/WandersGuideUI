#!/usr/bin/env bash
set -euo pipefail
cd /home/administrator/node-sites/WandersGuideUI
# SQL migrations are never applied implicitly. Deploy required migrations before --with-edge.
with_edge=0
case "${1:-}" in
  "") ;;
  --with-edge) with_edge=1 ;;
  *) echo "Usage: $0 [--with-edge]" >&2; exit 2 ;;
esac
if [ "$#" -gt 1 ]; then echo "Usage: $0 [--with-edge]" >&2; exit 2; fi

files=(
  docs/local-upstream-patches.md
  index.html
  scripts/wgui-ext.mjs
  src/pages/phase1/tactics/tactics-turns.test.ts
  src/pages/phase1/tactics/tactics-turns.ts
  tsconfig.path.json
)

stashed=0
if ! git diff --quiet -- "${files[@]}" || ! git diff --cached --quiet -- "${files[@]}"; then
  git stash push -m "vps-local" -- "${files[@]}"
  stashed=1
fi

gitignore_copy=""
if ! git diff --quiet -- .gitignore || ! git diff --cached --quiet -- .gitignore; then
  gitignore_copy="$(mktemp)"
  cp .gitignore "$gitignore_copy"
  git checkout -- .gitignore
fi

git pull --rebase origin main

if [ -n "$gitignore_copy" ]; then
  cp "$gitignore_copy" .gitignore
  rm -f "$gitignore_copy"
fi

if [ "$stashed" = 1 ]; then
  git stash pop
fi

npm install
npm run build
# Videos are gitignored and stay outside dist/. `serve -s` only sees files under dist/.
ln -sfn ../videos dist/videos
if [ "$with_edge" = 1 ]; then
  # Fail closed if the overlay cannot be restarted; never report a complete API deploy.
  npm run stack:restart
else
  echo "Frontend-only deployment. For edge changes, apply required SQL first and run with --with-edge."
fi
pm2 restart wgui --update-env
pm2 save
