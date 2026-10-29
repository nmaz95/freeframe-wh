import { deliveryPayload, isBulkStatusChange, statusChangePayload } from '@/types'
import type { Notification } from '@/types'

/** Where a notification takes you: a route inside the app, a URL outside it, or nowhere. */
export type NotificationTarget =
  | { kind: 'route'; href: string }
  | { kind: 'external'; url: string }
  | null

/**
 * The one place that decides what a notification opens, shared by the drawer
 * on the desktop rail, the Notifications page the phone shell uses, and the
 * service worker's push payload builder on the server (which mirrors it).
 *
 * In order: a finished Drive delivery opens the file on Drive; a grouped
 * status change opens the project filtered on that status; anything else
 * opens the asset, with the comment focused when there is one.
 */
export function notificationTarget(n: Notification): NotificationTarget {
  const delivery = deliveryPayload(n)
  if (delivery?.status === 'done' && delivery.web_view_link) {
    return { kind: 'external', url: delivery.web_view_link }
  }
  const bulk = statusChangePayload(n)
  if (bulk && isBulkStatusChange(bulk) && n.project_id) {
    return { kind: 'route', href: `/projects/${n.project_id}?status=${bulk.status_id}` }
  }
  if (n.project_id && n.asset_id) {
    const qs = n.comment_id ? `?commentId=${n.comment_id}` : ''
    return { kind: 'route', href: `/projects/${n.project_id}/assets/${n.asset_id}${qs}` }
  }
  return null
}
