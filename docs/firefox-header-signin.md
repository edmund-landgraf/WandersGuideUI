# Firefox header Sign in click

Local Wanderer's Guide (`http://localhost:5193`) serves the Docker frontend from `D:\repos\wanderers-guide`. A normal left-click on **Sign in | Register** did nothing in Firefox. Chrome was fine. Typing `http://localhost:5193/login` was fine. **Open in new tab** on that control was fine.

The route was never the problem. Firefox was not delivering the click.

## What you see when it is broken

- The header control is a real link (`href="/login"`). The context menu can open it.
- A left-click stays on the current page, usually `/characters`.
- The same click works in Chrome.
- Hard-refresh and `docker compose restart` do not help while the header still uses `backdrop-filter`. The browser is running the bundle that was baked into the frontend image. Source edits show up only after `docker compose up -d --build frontend`.

## Cause

`glassStyle()` in `frontend/src/utils/colors.ts` sets:

```css
backdrop-filter: var(--glass-backdrop-filter); /* blur(16px) saturate(1.4) */
```

Firefox does not reliably hit-test controls that are covered by, or are descendants of, an element with `backdrop-filter`. The click never reaches the link, so React's `onClick` and the browser's navigation both stay idle. **Open in new tab** still works because that action reads `href` and does not need the click event.

Two older shapes of the same bug:

1. A Mantine `ActionIcon` (`<button>`) nested inside the header control. Firefox often ignores the outer click. The icon has to be an SVG (`IconLogin2`), not another button.
2. The Experimental header inject nesting an `<a>` inside the Legacy Site control. That is a separate bug, documented in [local-upstream-patches.md](./local-upstream-patches.md). It is not the glass bug.

## What did not fix it

| Attempt | Why it failed |
| --- | --- |
| Leave `backdrop-filter` on the Sign in control and only swap the nested `ActionIcon` for an SVG | Firefox still will not click an element that has the filter. |
| Remove the filter from the control, keep it on `AppShell.Header` | The link is still inside the filtered header, so the click never arrives. |
| Move the filter onto a full-header layer with `pointer-events: none` | Firefox can ignore `pointer-events: none` on an element that has `backdrop-filter`. That layer still covers **Sign in** and still eats the click. Playwright's Firefox honored `pointer-events: none` and reported a pass. The installed Firefox did not. Do not trust that check for this bug. |
| `docker compose restart` without a frontend rebuild | The running image keeps the previous `dist/`. |

## The fix

The header must not use `backdrop-filter` at all. Keep the translucent fill so the bar still reads as a bar. Do not put a blur layer over the controls.

`frontend/src/nav/Layout.tsx`, `AppShell.Header`:

```tsx
<AppShell.Header
  h={50}
  zIndex={98}
  style={{
    backgroundColor: 'var(--glass-bg-color)',
    borderRadius: 0,
  }}
>
```

No `...glassStyle()`, no absolutely positioned blur sibling.

`frontend/src/nav/LoginButton.tsx`:

- One control: Mantine `UnstyledButton` with `component="a"` and `href="/login"`.
- Icon is `IconLogin2` (an SVG), not an `ActionIcon`.
- No `backdrop-filter` / `glassStyle()` on this control. A flat `rgba(255, 255, 255, 0.08)` background is enough.
- `onClick` calls `preventDefault()` and then the layout handler, which is `navigate('/login')`.

Search, sheets, and other panels can still call `glassStyle()`. This bug shows up when the filter covers a control the user must click. The header is that case.

## Ship it

From `D:\repos\wanderers-guide`:

```powershell
docker compose up -d --build frontend
```

Then reload `http://localhost:5193/characters` in Firefox. A left-click on **Sign in | Register** goes to `http://localhost:5193/login`. If the header is still frosted glass, that tab is on the previous image: hard-refresh after the frontend container has been recreated.

These edits are local to the Wanderer's Guide checkout. Do not commit them into Quzzar's repo unless you mean to send them upstream. This Wanders Guide UI repo only records the note.
