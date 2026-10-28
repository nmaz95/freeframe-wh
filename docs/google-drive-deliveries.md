# Google Drive deliveries ("Send to Google Drive")

Copy an asset's original from FreeFrame straight into a Google Drive folder,
as the person sending it. Built for a studio that files every finished job
under a shared "Deliveries" folder with one subfolder per client.

## How it works

- Each person connects **their own Google account** once (Settings → Profile
  → Google Drive). FreeFrame keeps the refresh token Google issues, encrypted
  at rest, and asks for `drive.file` only: it can see the folders people pick
  and the files it creates, nothing else.
- An admin names the **deliveries folder** once (Admin Dashboard → Instance
  settings → Google Drive deliveries), picking it from their own Drive. Its
  subfolders are the clients.
- On an asset, **Send to Google Drive…** (the card's ⋯ menu, the right-click
  menu, the review page's top bar, or the Fields panel) opens the Google
  Picker on the deliveries folder; pick the client, check the file name
  (`Asset name v3.mov` by default), send. Owners and editors can send.
- **Several at once:** tick the assets in the project grid and use **Send to
  Drive** on the selection bar (or the selection's right-click menu). One
  folder for all of them, a file name each (the default for every asset, and a
  ✕ to leave one out), one request. Folders ticked alongside are left out.
  The dialog follows every copy, lists each file's link when done, points out
  the ones that failed with a *Try the failed ones again*, and offers to move
  the delivered assets to "Delivered" together. Every file still gets its own
  notification. A batch is up to 100 assets; the server refuses the whole
  batch, naming the asset, when one of them has no ready version.
- **New folder:** the Google Picker cannot create folders, so the dialog does.
  Pick the parent first (any folder reachable in the Picker, at any depth),
  then **New folder inside …** makes one there and selects it as the
  destination; the pencil renames a folder made in that dialog session. With
  `drive.file` FreeFrame can only create inside a folder this account picked
  in the Picker (or made here), which is why the parent has to be picked
  first and why the deliveries folder itself is not a parent unless it was
  picked; Drive allows two folders of the same name side by side, and
  FreeFrame does not check for that.
- The copy runs on the server (the `delivery_worker` service) straight from
  storage to Drive, so it does not depend on the sender's browser or
  connection and works for files of any size. The dialog follows it; the
  sender gets an in-app notification with the link when it is done or if it
  failed, and the Fields panel keeps the history of every copy.
- When the copy is done, the dialog shows two links, each with **Copy**: the
  Drive folder the file went to and the file itself (the file's link is the one
  Drive returns; the folder's is built from the folder's id). They are there
  to paste into a mail or a chat. The dialog then offers to move the asset to
  a status named **Delivered**, if one exists (Admin Dashboard → Statuses).
  That move is a normal status change: the people the status notifies are told.

## Setting it up (Google Cloud Console)

1. Create a project (or use an existing one). Enable the **Google Drive API**
   and the **Google Picker API**.
2. **OAuth consent screen**: user type *External*, publishing status *In
   production*, scopes `openid`, `email` and
   `https://www.googleapis.com/auth/drive.file`. These scopes are
   non-sensitive, so Google asks for no verification, and a published app's
   refresh tokens do not expire after a week as a *Testing* app's do.
   *External* lets people from more than one Workspace domain connect.
3. **OAuth client**, type *Web application*, with the authorised redirect URI
   `https://<your FreeFrame host>/api/integrations/google/callback`
   (exactly that; behind the bundled proxy the API lives under `/api`).
4. **API key** for the Picker, restricted to the Google Picker API and to the
   HTTP referrers `https://<your FreeFrame host>/*` and
   `https://docs.google.com/*`. The key is only used by the Picker in the
   browser; every call to Drive is made server-side with the user's token.
5. Note the project **number** (not the id): the Picker needs it to grant the
   app access to the folders people pick.

Then set, in the API's environment (`.env.prod`):

```
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://<your FreeFrame host>/api/integrations/google/callback
GOOGLE_API_KEY=...
GOOGLE_APP_ID=<project number>
DELIVERY_CONCURRENCY=2
```

Restart the stack. The profile page shows "Connect Google Drive" once all
five are set; until then the feature is off and says so.

## Operational notes

- Tokens are encrypted with a key derived from `JWT_SECRET`. Rotating that
  secret invalidates every stored Google token; people are asked to reconnect
  the next time they send.
- Disconnecting revokes the token at Google and deletes it here. Copies
  already on Drive stay there.
- A delivery row is purged with its asset. The worker retries network
  failures three times, then records the failure on the row and notifies the
  sender; a dead Google grant fails at once with "reconnect".

## API

| Method | Path | Who |
|---|---|---|
| GET | `/integrations/google` | any signed-in user: `{enabled, connected, email}` |
| POST | `/integrations/google/authorize` | any signed-in user: `{url}` to send the browser to |
| GET | `/integrations/google/callback` | Google's redirect (no bearer; single-use state) |
| DELETE | `/integrations/google` | the user: revoke and forget |
| GET | `/integrations/google/picker[?scope=root]` | connected user: a short-lived access token plus the Picker's key, app id and root folder (`scope=root` is for admins choosing that folder) |
| GET | `/assets/{id}/deliveries` | asset access: the history |
| POST | `/assets/{id}/deliveries` | editor: `{folder_id, folder_name, file_name?, version_id?}` → queued delivery |
| POST | `/projects/{id}/deliveries` | editor: `{folder_id, folder_name, items: [{asset_id, file_name?, version_id?}]}` (1–100) → the queued deliveries in that order; all or none (404 for an asset not in the project, 409 naming an asset without a ready version) |
| GET | `/projects/{id}/deliveries?ids=a,b,c` | project member: those deliveries (up to 100) in the order asked, for a dialog following a batch |
| POST | `/integrations/google/folders` | connected user: `{parent_id, name}` → `{id, name, web_view_link}`; 409 when Drive cannot see the parent for this account |
| PATCH | `/integrations/google/folders/{id}` | connected user: `{name}` → the folder; renames only what this app may touch |
| PUT | `/instance/settings` | admin: `drive_root_folder_id`, `drive_root_folder_name` |

The project event stream emits `delivery_updated` (`delivery_id`, `asset_id`,
`user_id`, `status`, `percent`) as a copy progresses.
