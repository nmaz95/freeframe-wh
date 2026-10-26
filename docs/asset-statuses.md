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

Reviewers and up change an asset's status from the card's ⋯ menu, the
right-click menu, the review header pill, or the *Fields* tab of the review
page or the project page's side panel. A confirmation names the move and who
it notifies; "Don't ask again" skips it for the rest of the browser session.
Viewers see the status but cannot change it. Share-link guests never see
statuses.

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

`AssetResponse.status_id` names the asset's status (`null` reads as the
default). The project event stream emits `asset_status_updated`
(`asset_id`, `status_id`, `user_id`) on every change.
