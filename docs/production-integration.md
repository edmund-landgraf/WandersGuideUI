# Production checkout integrated onto main

The VPS checkout `docs/tool-directory-95` at `e6254923451be918edc1ca999b3bdd7d2869ac2a` diverges from `main` at `6bc09ff2fb4d5b5cf5ac2f78b4c959571985fd97`. Four commits on that branch are not in `main`. This branch replays them onto current `main` (`9245c1e6d69bee8f5fe5b247d723d7d41ca3103f`, which includes the merged Foundry import and read relay). The production branch was not moved.

| Production commit | What it keeps |
| --- | --- |
| `202d9872a7edb332ab92eca686bdaab20a396703` | Character menu is portaled to the viewport so it is not clipped. Sheet health uses a full-width temp HP control, shows `0` instead of `-`, and does not stretch the senses column. |
| `6c117e6e686539feb90fe761e825aac5b5f508d3` | Removing the GM's own character clears `campaign_id`. Someone else's character still uses `remove-from-campaign`. Adding a character to the encounter also updates the party. Art and portrait previews stay inside the viewport. |
| `2236dc37647798a759e03300fdd02d27b030c86c` | That kick reads `session?.user.id`, so a missing auth session does not throw while the module is built. |
| `e6254923451be918edc1ca999b3bdd7d2869ac2a` | Five NPC portraits under `public/portraits/`, listed in `src/utils/portrait-images.ts`. `vite build` links `dist/videos` to the repo `videos/` directory when that directory exists. `scripts/vps-pull-build.sh` runs `ln -sfn ../videos dist/videos` after the build. `public/serve.json` keeps `"symlinks": true`. |

`publicArtSrc` from later `main` stays on the sheet and the preview dialogs. The production patches had been written before that helper, and applying them unchanged would have stored and displayed the raw path again. The layout and menu changes were kept; the raw `src={url}` lines were not.

Foundry import and the read relay from the merged pull requests are still on this branch. The character upload menu and the sheet character menu are different controls. Nothing in these four commits removes Import from Foundry.

## Deploy

Do not deploy from this pull request until it is reviewed. `npm run build` rewrites `dist/`. The video symlink is created again at the end of that build when `videos/` exists, and `scripts/vps-pull-build.sh` creates it again with a relative link. `videos/` stays gitignored. Local `.env` files are not in this branch.

`docs/tool-directory-95` also carries the old history under `6bc09ff`. Those older commits are already ancestors of `main` or were superseded there. They were not copied again.
