'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { useNotificationStore } from '@/stores/notification-store'
import { usePageTitle } from '@/hooks/use-page-title'
import { formatRelativeTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { cn } from '@/lib/utils'
import { notificationTarget } from '@/lib/notification-target'
import {
  getNotificationText,
  notificationIcons,
  notificationIconClass,
  notificationIconStyle,
} from '@/components/layout/notification-text'
import type { Notification } from '@/types'

function NotificationItem({ notification }: { notification: Notification }) {
  const router = useRouter()
  const { markAsRead } = useNotificationStore()
  const Icon = notificationIcons[notification.type]
  const { title, subtitle } = getNotificationText(notification)

  // The same words and the same destination as the drawer: this page is the
  // phone shell's notification surface, where a drawer would cover the screen.
  function handleClick() {
    if (!notification.read) markAsRead(notification.id)
    const target = notificationTarget(notification)
    if (!target) return
    if (target.kind === 'external') window.open(target.url, '_blank', 'noopener')
    else router.push(target.href)
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-bg-hover active:bg-bg-hover',
        !notification.read && 'bg-bg-secondary',
      )}
    >
      <div
        className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', notificationIconClass(notification))}
        style={notificationIconStyle(notification)}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <p className="text-sm text-text-primary font-medium">{title}</p>
        {subtitle && <p className="text-xs text-text-secondary line-clamp-2">{subtitle}</p>}
        <p className="text-xs text-text-tertiary">{formatRelativeTime(notification.created_at)}</p>
      </div>

      {!notification.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
    </button>
  )
}

export default function NotificationsPage() {
  usePageTitle('Notifications')
  const { notifications, isLoading, fetchNotifications, markAllRead, unreadCount } =
    useNotificationStore()
  const [tab, setTab] = React.useState<'all' | 'unread'>('all')

  React.useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const shown = tab === 'unread' ? notifications.filter((n) => !n.read) : notifications

  return (
    <div className="p-6 phone:px-4 phone:pt-2 max-w-3xl space-y-5">
      {/* Header. On the phone the capsule already says "Notifications", so
          the title is kept for the desktop and the count for both. */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary phone:sr-only">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-text-secondary mt-0.5">
              {unreadCount} unread
            </p>
          )}
        </div>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={markAllRead}>
            Mark all read
          </Button>
        )}
      </div>

      <div role="tablist" aria-label="Notifications filter" className="flex gap-1 rounded-full bg-bg-secondary p-1 w-fit">
        {(['all', 'unread'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'h-9 rounded-full px-4 text-sm font-medium transition-colors',
              tab === t ? 'bg-bg-hover text-text-primary' : 'text-text-secondary',
            )}
          >
            {t === 'all' ? 'All' : 'Unread'}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      {isLoading ? (
        <div className="space-y-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-bg-secondary"
            />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={tab === 'unread' ? 'All caught up' : 'No Updates Yet'}
          description={tab === 'unread' ? 'Nothing unread.' : 'New activity on your account will show here.'}
        />
      ) : (
        <div className="space-y-0.5">
          {shown.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
            />
          ))}
        </div>
      )}
    </div>
  )
}
