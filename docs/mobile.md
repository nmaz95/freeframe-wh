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
the Apple meta tags, and the icons live in `apps/web/public/icons`. The service
worker (`apps/web/public/sw.js`) exists only for push notifications: it has no
fetch handler and caches nothing, so a deploy is never served stale.

## The phone shell

Below `md` the rail and the header give way to:

- **A tab bar** along the bottom edge: Search (the command palette), Projects
  (the centre stop, raised, in the accent colour), Notifications (with the
  unread count; opens the Notifications page, not the rail's drawer) and
  Profile. A pill slides to the current stop as the route changes. It steps
  aside while the asset grid's selection bar is up, so the two never stack.
  Uploads are started from the project page; the uploads panel opens by itself
  when one starts, full width on a phone.
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
- **Settings** show their tabs as a row of chips above the page instead of the
  224px column. The capsule's back arrow skips a section that only redirects
  (Settings lands on the Admin tab for a superadmin) and goes to Projects.
- **Menus stay on the screen.** Dropdowns are capped at the room left below
  their trigger and scroll there, with the status bar and the tab bar bands
  kept clear; the folder menu opens on the first level and each subfolder
  level opens from its chevron.
- **Under the status bar.** The app runs under the status bar when installed
  (`black-translucent`), so every surface anchored to the top edge (the review
  and share top bars, the notification drawer, the uploads panel, the compare
  overlay) starts with a band the height of `env(safe-area-inset-top)` in its
  own colour.

## Sizing against real devices

Open `/device` on the phone (no link leads there): it shows the viewport in
CSS px, the scale, the orientation, the four safe-area insets, whether the
app runs standalone, and the user agent, with a Copy button. Rotate the phone
and read it again. Those numbers, not data sheets, are what the shell is
checked against (the Playwright audit in the repo's scratch tooling emulates
them by overriding the `*-safe` utilities).

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

## Push notifications

Push mirrors the in-app notifications (the bell): a status change, a comment
or a mention, an assignment, an approval, a Drive delivery, a due date. It
reaches every device the user turned it on in, and it follows the choices
under Settings → Notifications: a type set to *All Off* is never pushed
(*In-app only* still is, since push is the in-app notification on the lock
screen). Each push opens what the bell would: the asset with the comment
focused, the project filtered on a bulk status, the file on Drive.

### Admin setup

The instance needs a VAPID key pair, generated once:

```bash
docker compose exec api python -c "import base64; from cryptography.hazmat.primitives.asymmetric import ec; from cryptography.hazmat.primitives import serialization as s; k=ec.generate_private_key(ec.SECP256R1()); b=lambda x: base64.urlsafe_b64encode(x).rstrip(b'=').decode(); print('VAPID_PUBLIC_KEY='+b(k.public_key().public_bytes(s.Encoding.X962, s.PublicFormat.UncompressedPoint))); print('VAPID_PRIVATE_KEY='+b(k.private_numbers().private_value.to_bytes(32,'big')))"
```

Put the two lines in the environment with `VAPID_SUBJECT=mailto:you@example.com`
(or an `https://` URL), then restart `api` and `email_worker` (push rides the
`email_low` queue, so no new service). All three or none: the api refuses to
start on a half-set trio or a malformed key. Do not rotate the keys casually:
every device subscribed so far stops receiving pushes until its user turns
push off and on again. The app must be served over HTTPS.

### For each person

Open Settings → Profile → *Push notifications* and *Turn on for this device*;
the browser asks for permission once. On iPhone and iPad this works only from
the app installed on the home screen (iOS 16.4 or later), not from a Safari
tab; the card says so. Android and desktop browsers work from the browser too.
*Turn off* on the same card removes the device. The card lists how many
devices are on.

### How it works

`POST /me/push/subscriptions` stores the browser's subscription (one row per
browser, `push_subscriptions`); `GET /me/push` lists this user's devices and
hands the public key out; `DELETE /me/push/subscriptions/{id}` removes one.
Every place that writes a `Notification` row calls
`services.push_service.notify_push` after its commit, which queues
`tasks.push_tasks.send_push_notification` per row. The task reads the user's
preference for the type, builds the words and the URL (the same as the web
app's `notification-text` and `notification-target`), and sends one Web Push
per device with `pywebpush`. A 404 or 410 from the push service deletes the
device's row; 429 and 5xx are retried three times; any other 4xx is noted on
the row (`last_failed_at`) and logged. Due-date reminders are pushed once a
day per asset, although the reminder row is written hourly.

### Troubleshooting

- The card says "an admin has to set the push keys": `VAPID_*` are not all set.
- The button never appears on an iPhone: the app is open in Safari, not from
  the home screen.
- Permission is blocked: iOS Settings → Notifications → the app, or the
  browser's site settings; then reopen the card.
- A device disappears from the list: the push service revoked it (the app was
  removed, or the keys changed). Turn it on again.
- Nothing arrives: check `email_worker`'s log for `push to … failed`.
