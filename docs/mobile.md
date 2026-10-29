# FreeFrame on a phone

FreeFrame installs as a web app and carries a phone shell below the `md`
breakpoint (768 px). Nothing changes for a tablet or a desktop browser.

## Installing it

Open the instance in Safari (iPhone) or Chrome (Android), then **Share → Add to
Home Screen** (Safari) or **Install app** (Chrome). The icon takes the
instance's name and, when an admin uploaded one, its Apple icon
(Admin Dashboard → Branding). Opened from the home screen it runs in its own
window without the browser's bars, under the status bar, and lands on the
projects list.

What it needs on the server: nothing. `apps/web/app/manifest.ts` serves the
manifest at `/manifest.webmanifest` (base path included), the root layout emits
the Apple meta tags, and the icons live in `apps/web/public/icons`. There is no
service worker on purpose: nothing works offline, and a cached app shell would
serve a stale build after a deploy.

## The phone shell

Below `md` the rail and the header give way to:

- **A tab bar** along the bottom edge: Projects, Search (the command palette),
  Uploads (raised, in the accent colour; the uploads panel with the count of
  files on their way), Notifications (with the unread count; opens the drawer
  full width) and Profile. It steps aside while the asset grid's selection bar
  is up, so the two never stack.
- **A capsule header** floating over the page: the current page's name (the
  last breadcrumb), the way back, and search. On a project page the capsule
  also carries the **folder and status chips**: a menu of the whole folder tree
  and the status filter with its counts, the same URL-backed state as the
  desktop's left column, which is not rendered below `lg`. Between `md` and
  `lg` the chips sit inline above the grid instead.
- **The project toolbar wraps** rather than clipping, so Share, New Folder and
  Upload stay reachable.
- **The review page** keeps the title row and adds a second row with the
  status (which the title row gave up below `sm`) and the asset's name in
  full. The comment sheet opens at half height on a portrait phone, in the
  heavier glass, with a grabber; it still drops to its peek band on a swipe
  down. A landscape phone keeps comments beside the media, as before.
- **The share pages** get the same sheet behaviour for a client on a phone.

## The materials

Two utilities in `globals.css`, used only on floating chrome (never on content):

| Class | For | Blur | Ground (dark) |
|---|---|---|---|
| `ff-glass` | tab bar, capsule header, selection bar | 20 px, saturate 180 % | `rgba(32,32,42,.62)` |
| `ff-glass-heavy` | the comment sheet, docked panels | 20 px, saturate 160 % | `rgba(17,17,23,.84)` |

Blur stays at 20 px because Safari pays for every blurred pixel on every
frame. Both become near-solid, blur off, under `prefers-reduced-transparency`
and `prefers-contrast: more`, and fall back to solid colours where
`backdrop-filter` is missing. The light theme has its own values.

## Layout classes

`hooks/use-mobile-shell.ts` names the three classes from the two media
queries the review screen already switches on, so the shell and the review
page never disagree about what a phone is: phone (below `md`), phone held
sideways (same, landscape), and everything above `md`, which keeps the desktop
layout. Safe areas come from `viewport-fit=cover` and the `*-safe` utilities;
`.pb-tabbar` is the room a scrolling page leaves for the tab bar.
