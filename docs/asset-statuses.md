# Asset statuses and pipeline roles

Where an asset is in your review pipeline, and who is told when it moves.

## Statuses

An instance has one ordered list of statuses, managed by a superadmin under
**Admin Dashboard → Statuses**. A fresh install starts with:

| Status | Default | Mirrors legacy `assets.status` |
|---|---|---|
| No Status | yes | `draft` |
| Needs PM Review | | |
| Needs Editor Changes | | |
| Needs HOS Approval | | |
| Client Review | | |
| Approved | | `approved` |
| Rejected | | `rejected` |

- **Default.** New uploads start in the default status, and **a new version
  of an existing asset puts it back there**, silently, so whoever takes the
  version on says where it stands. Exactly one status is the default; make
  another the default before deleting it.
- **Delete.** Assets in a deleted status move to the default.
- **Order.** The arrows set the pipeline order, which the sidebar, the menus
  and the *Status* sort use.
- **Colour.** Any `#rrggbb`. Shown as a dot on cards, a badge in the list view
  and a pill in the review header.
- **Filter.** The project sidebar's *Statuses* section filters the grid to
  the assets in that status **in the folder in view and every folder below
  it** (at the project root, the whole project). The folder cards are hidden
  while a filter is on and each asset names its folder instead, as
  "Client / Spot"; the count beside each status covers the same folders.
  The filter lives in the URL (`?status=`, next to `?folder=`), so a filtered
  view can be linked, survives a reload and stays on while you open folders
  from the tree or the breadcrumb; click the status again, or *Clear*, to
  drop it.

Reviewers and up change an asset's status from the card's ⋯ menu, the
right-click menu, the review header pill, or the *Fields* tab of the review
page or the project page's side panel. A confirmation names the move and who
it notifies; "Don't ask again" skips it for the rest of the browser session.
Viewers see the status but cannot change it. Share-link guests never see
statuses.

**Several at once.** Tick the cards (or press ⌘/Ctrl-A, *Select all* in the
selection bar, or the checkbox in the list view's header; *Deselect all*, the
✕ or Esc clear the selection), then *Change status* in the bar or in the
right-click menu of a selected item. One
confirmation names the count, one request moves them, and the people the
status notifies are told once (see below). Folders in the selection are
ignored: a status belongs to an asset. Assets already in that status are
left alone.

The legacy fixed enum column `assets.status` is kept for smart collections and
older clients, and is mirrored whenever an asset enters a status that names a
legacy value (the three above). `PATCH /assets/{id}` with `status` goes
through the same path as `PUT /assets/{id}/status`, so its notifications are
not bypassed.

## Who is notified

Each status has a rule applied when an asset is moved **to** it:

- the person who uploaded the asset (on by default),
- the asset's assignee,
- everyone holding any of the chosen **pipeline roles**.

The person making the change is never notified, nor is anyone who cannot see
the asset. Each recipient's *Settings → Notifications → Status Updates*
preference decides the channel: in-app and email (the default), in-app only,
or nothing.

In-app notifications read "Marco moved Spot 30s to Needs PM Review"; the email
says the same and links to the asset. Both snapshot the status name and colour
at the time, so renaming a status later does not rewrite history.

**Several assets at once.** When several assets are moved together, each
person hears once: one in-app notification and one email saying "Marco moved
12 assets to Needs PM Review", listing up to five names, and linking to the
project filtered on that status. Someone concerned with only one of the
assets gets the ordinary single-asset message. The grouped notification is
attached to the first of their assets, so it goes to the trash with it.

## Pipeline roles

A pipeline role is a named slot such as *PM*, *Editor*, *HOS* or *Client*
(the four an install starts with; rename or add yours under Admin Dashboard →
Statuses). Roles are instance-wide. **Who holds one is declared on each
asset**: the *Fields* tab of the review page, and the *Fields* tab of the
project page's side panel when a card is selected, show the asset's team per
role and let an editor or owner change it.

A project may also hold **defaults for new assets** (*Project settings →
People → Pipeline roles*, owner only). An asset that names nobody for a role
follows the project default for that role, and the panel says so ("project
default"). Picking someone on such a role copies the default and applies the
change to that asset only; "Use project default" hands the role back. This
fits a project used as a container for a whole company: set the usual PM
once, and name the editor and the social person video by video.

Only project members can hold a role in a project. Removing someone from a
project removes their roles in it; a deactivated user holds roles but is not
notified.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/statuses` | any signed-in user |
| POST / PATCH / DELETE | `/statuses`, `/statuses/{id}` | superadmin |
| PUT | `/statuses/reorder` | superadmin |
| GET | `/pipeline-roles` | any signed-in user |
| POST / PATCH / DELETE | `/pipeline-roles`, `/pipeline-roles/{id}` | superadmin |
| GET / PUT | `/projects/{id}/pipeline-assignments` | member / owner |
| GET / PUT | `/assets/{id}/pipeline-assignments` | asset access / editor |
| PUT | `/assets/{id}/status` | reviewer |
| PUT | `/assets/status` | reviewer |
| GET | `/projects/{id}/assets?folder_id=&include_subfolders=true&status_id=` | project visible |
| GET | `/projects/{id}/assets/status-counts?folder_id=` | project visible |

`PUT /assets/status` takes `{"asset_ids": [...], "status_id": "..."}` (up to
500 ids of one project; another project's id → 400, an unknown or trashed id
refuses the whole call with 404). Assets already in the status are untouched;
the response lists every asset in the order asked, and the project stream
carries one `asset_status_updated` per asset that moved.

`GET /projects/{id}/assets` takes `include_subfolders=true` (with `folder_id`,
also every folder below it; with `root`, the whole project) and `status_id`
(only that status; the default status also matches assets with none set).
`status-counts` returns `{"counts": {"<status_id>": n}}` for the folder and
every folder below it, with no entry for a status nothing is in; assets with
no status count towards the default.

`AssetResponse.status_id` names the asset's status (`null` reads as the
default). The project event stream emits `asset_status_updated`
(`asset_id`, `status_id`, `user_id`) on every change.
