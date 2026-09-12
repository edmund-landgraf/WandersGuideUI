# `/local`: VPS-only copies of upstream wanderers-guide patches

`/local/` is a **gitignored** scratch tree in this checkout. It holds files that belong to [wanderers-guide](https://github.com/wanderers-guide/wanderers-guide) on the amba VPS (`~/wanderers-guide`), not to Wanders Guide UI (this repo). Git never tracks them. The ignore rule is `/local/` in `.gitignore`.

Use it when you must change the old Docker frontend (or other upstream paths) **by hand** on `amba.wandersguide.site` because that source is not this git remote.

## Layout

Mirror the VPS repo under `local/wanderers-guide/`, same paths as `~/wanderers-guide`:

```
local/wanderers-guide/frontend/src/nav/LoginButton.tsx
```

On the VPS that file is:

```
~/wanderers-guide/frontend/src/nav/LoginButton.tsx
```

Keep the tree 1:1 so a drop-in replace is copy-paste, not path guessing.

## What it is not

- Not a submodule and not a second origin.
- Not a place to land WGUI features (`src/` here, `supabase/wgui-ext/` overlays, etc.).
- Not something to commit, PR, or push from this repo. Only the ignore rule is in git.

## Apply a patch on amba

1. Edit (or copy) the file under `local/wanderers-guide/...`.
2. On the VPS, overwrite the matching path. Do **not** `git commit` in `~/wanderers-guide` unless you intend to send it upstream.
3. Hide the dirty file from `git status` so pulls do not clobber it:

   ```bash
   cd ~/wanderers-guide
   git update-index --skip-worktree frontend/src/nav/LoginButton.tsx
   ```

4. Rebuild and restart the **frontend** Docker image. Source-only edits do not show on amba until that rebuild.

Do not deploy a service-worker kill-switch on that host. See [amba-oauth-pwa-incident.md](./amba-oauth-pwa-incident.md).

## This WGUI checkout

If you also keep a matching copy under `src/` (the tree still contains the old WG frontend), mark it skip-worktree so this repo stays clean:

```bash
git update-index --skip-worktree src/nav/LoginButton.tsx
```

Revert accidental WGUI diffs (`Layout.tsx`, etc.) unless they are real WGUI work.

## Current contents (machine-local)

As of the Firefox header login fix: `local/wanderers-guide/frontend/src/nav/LoginButton.tsx` is a drop-in for upstream. Same `onClick` as Layout; the login icon is an SVG, not a nested Mantine `ActionIcon` `<button>` (Firefox often ignores the outer click).
