'use client'

import * as React from 'react'
import { Bell, X, Settings } from 'lucide-react'
import Link from 'next/link'
import { withBasePath } from '@/lib/base-path'
import { useNotificationStore } from '@/stores/notification-store'
import { formatRelativeTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { notificationTarget } from '@/lib/notification-target'
import { getNotificationText, notificationIcons, notificationIconClass, notificationIconStyle } from './notification-text'
import type { Notification } from '@/types'

function NotificationItem({ notification, onClose }: { notification: Notification; onClose: () => void }) {
  const { markAsRead } = useNotificationStore()
  const Icon = notificationIcons[notification.type]
  const { title, subtitle } = getNotificationText(notification)

  function handleClick() {
    if (!notification.read) markAsRead(notification.id)
    const target = notificationTarget(notification)
    if (!target) return
    if (target.kind === 'external') window.open(target.url, '_blank', 'noopener')
    else window.location.href = withBasePath(target.href)
    onClose()
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-bg-hover',
        !notification.read && 'bg-bg-secondary',
      )}
    >
      <div
        className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-0.5', notificationIconClass(notification))}
        style={notificationIconStyle(notification)}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <p className="text-sm text-text-primary font-medium">{title}</p>
        {subtitle && (
          <p className="text-xs text-text-secondary line-clamp-2">{subtitle}</p>
        )}
        <p className="text-2xs text-text-tertiary mt-0.5">{formatRelativeTime(notification.created_at)}</p>
      </div>
      {!notification.read && (
        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />
      )}
    </button>
  )
}

interface NotificationDrawerProps {
  open: boolean
  onClose: () => void
  /** Whether the sidebar is the 52px rail or expanded to 220px. The drawer
   *  opens against its right edge, so it has to know which. */
  railCollapsed: boolean
  /** The phone shell has no rail: the drawer opens from the screen's own
   *  left edge and takes the width, up to a phablet's worth. */
  fullWidth?: boolean
}

export function NotificationDrawer({ open, onClose, railCollapsed, fullWidth = false }: NotificationDrawerProps) {
  const { notifications, isLoading, fetchNotifications, markAllRead, unreadCount } =
    useNotificationStore()
  const [tab, setTab] = React.useState<'all' | 'unread'>('all')

  React.useEffect(() => {
    if (open) fetchNotifications()
  }, [open, fetchNotifications])

  const filtered = tab === 'unread' ? notifications.filter((n) => !n.read) : notifications

  if (!open) return null

  return (
    <>
      {/* Backdrop — offset to not cover sidebar. Both widths are spelled out
          because Tailwind only generates classes it can find whole. The
          expanded offset is gated at `md` so a phone keeps the drawer on screen. */}
      <div
        className={cn(
          'fixed top-0 right-0 bottom-0 z-40',
          fullWidth ? 'left-0' : 'left-[52px]',
          !railCollapsed && !fullWidth && 'md:left-[220px]',
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          'fixed left-safe top-0 z-50 h-full border-r border-border bg-bg-primary shadow-2xl flex flex-col pb-safe animate-in slide-in-from-left-2 duration-150',
          fullWidth ? '[--ff-left:0px] w-full max-w-[420px]' : '[--ff-left:52px] w-[380px]',
          !railCollapsed && !fullWidth && 'md:[--ff-left:220px]',
        )}
      >
        {/* The status bar's band, in the drawer's own colour (standalone on a
            phone draws the page under it). Zero height anywhere else. */}
        <div aria-hidden="true" className="pt-safe shrink-0" />
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
          <span className="text-sm font-semibold text-text-primary">Notifications</span>
          <div className="flex items-center gap-1">
            <Link
              href="/settings/notifications"
              onClick={onClose}
              className="flex items-center justify-center h-7 w-7 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
              title="Notification settings"
            >
              <Settings className="h-4 w-4" />
            </Link>
            <button
              onClick={onClose}
              className="flex items-center justify-center h-7 w-7 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabs + Mark all read */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTab('all')}
              className={cn(
                'text-sm font-medium transition-colors',
                tab === 'all' ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary',
              )}
            >
              All
            </button>
            <button
              onClick={() => setTab('unread')}
              className={cn(
                'text-sm font-medium transition-colors',
                tab === 'unread' ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary',
              )}
            >
              Unread
            </button>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs text-text-tertiary hover:text-text-primary transition-colors"
            >
              Mark all as read
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-bg-secondary" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <div className="h-14 w-14 rounded-full bg-bg-tertiary flex items-center justify-center mb-3">
                <Bell className="h-7 w-7 text-text-tertiary" />
              </div>
              <p className="text-sm font-medium text-text-primary">No Updates Yet</p>
              <p className="text-xs text-text-tertiary mt-1">New activity on your account will show here.</p>
            </div>
          ) : (
            <div className="p-1 space-y-0.5">
              {filtered.map((notification) => (
                <NotificationItem key={notification.id} notification={notification} onClose={onClose} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
