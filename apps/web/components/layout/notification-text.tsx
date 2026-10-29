import * as React from 'react'
import { AtSign, CheckCircle, CircleDot, CloudUpload, MessageSquare, UserCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { statusChangePayload, isBulkStatusChange, deliveryPayload } from '@/types'
import type { Notification, NotificationType } from '@/types'

export const notificationIcons: Record<NotificationType, React.ElementType> = {
  mention: AtSign,
  assignment: UserCheck,
  due_soon: UserCheck,
  comment: MessageSquare,
  approval: CheckCircle,
  status_change: CircleDot,
  delivery: CloudUpload,
}

/**
 * What a notification says, in one place: the drawer on the desktop rail and
 * the Notifications page the phone shell opens read the same sentence, with
 * the actor, the asset, a comment preview or the status names from the
 * payload. The server's push payload builder mirrors these strings.
 */
export function getNotificationText(n: Notification): { title: string; subtitle: string | null } {
  const actor = n.actor_name ? (n.actor_is_guest ? `${n.actor_name} (guest)` : n.actor_name) : 'Someone'
  const asset = n.asset_name || 'an asset'
  switch (n.type) {
    case 'mention':
      return { title: `${actor} mentioned you on ${asset}`, subtitle: n.comment_preview || null }
    case 'comment':
      return { title: `${actor} commented on ${asset}`, subtitle: n.comment_preview || null }
    case 'assignment':
      return { title: `${actor} assigned you to ${asset}`, subtitle: null }
    case 'approval':
      return { title: `${actor} updated approval on ${asset}`, subtitle: null }
    case 'due_soon':
      return { title: `${asset} is due soon`, subtitle: null }
    case 'status_change': {
      const p = statusChangePayload(n)
      const to = p?.status_name ?? 'a new status'
      if (p && isBulkStatusChange(p)) {
        const names = p.asset_names ?? []
        const more = (p.asset_count ?? 0) - names.length
        const subtitle = names.length ? names.join(', ') + (more > 0 ? `, and ${more} more` : '') : null
        return { title: `${actor} moved ${p.asset_count} assets to ${to}`, subtitle }
      }
      const from = p?.from_status_name
      return { title: `${actor} moved ${asset} to ${to}`, subtitle: from ? `was ${from}` : null }
    }
    case 'delivery': {
      const p = deliveryPayload(n)
      if (p?.status === 'failed') {
        return { title: `Delivery of ${asset} failed`, subtitle: p.error ?? null }
      }
      return { title: `${asset} delivered to ${p?.folder_name ?? 'Google Drive'}`, subtitle: p?.file_name ?? null }
    }
    default:
      return { title: 'New notification', subtitle: null }
  }
}

/** The icon badge's colours for a notification, by type (and by outcome for a delivery). */
export function notificationIconClass(n: Notification): string {
  return cn(
    n.type === 'mention' && 'bg-accent-muted text-text-primary',
    n.type === 'approval' && 'bg-status-success/15 text-status-success',
    n.type === 'comment' && 'bg-bg-tertiary text-text-secondary',
    (n.type === 'assignment' || n.type === 'due_soon') && 'bg-status-warning/15 text-status-warning',
    n.type === 'status_change' && 'bg-bg-tertiary',
    n.type === 'delivery' &&
      (deliveryPayload(n)?.status === 'failed'
        ? 'bg-status-error/15 text-status-error'
        : 'bg-status-success/15 text-status-success'),
  )
}

/** A status change wears its status's colour, which is not a theme token. */
export function notificationIconStyle(n: Notification): React.CSSProperties | undefined {
  const color = statusChangePayload(n)?.status_color
  return color ? { color } : undefined
}
