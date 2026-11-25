#!/usr/bin/env bash
set -euo pipefail
cd /home/administrator/node-sites/WandersGuideUI

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
pm2 restart wgui --update-env
pm2 save

# wgui-ext handlers are bind-mounted into the functions container; a frontend-only
# rebuild leaves find-encounter copy mode and art rehost stale on the API host.
wg_dir="${WG_DIR:-/home/administrator/node-sites/wanderers-guide}"
if [ -f "$wg_dir/docker-compose.yml" ]; then
  WG_DIR="$wg_dir" node scripts/wgui-ext.mjs restart
fi
