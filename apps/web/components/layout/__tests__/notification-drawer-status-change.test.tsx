/**
 * A status change names who moved what to where, from the payload the API
 * snapshotted when it happened, so a later rename does not rewrite it.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Notification } from '@/types'

const state = vi.hoisted(() => ({ notifications: [] as unknown[] }))

vi.mock('@/stores/notification-store', () => ({
  useNotificationStore: () => ({
    notifications: state.notifications,
    isLoading: false,
    fetchNotifications: vi.fn(),
    markAllRead: vi.fn(),
    markAsRead: vi.fn(),
    unreadCount: 0,
  }),
}))

import { NotificationDrawer } from '@/components/layout/notification-drawer'

function notification(over: Partial<Notification>): Notification {
  return {
    id: 'n1',
    user_id: 'u1',
    comment_id: null,
    asset_id: 'a1',
    type: 'status_change',
    read: true,
    created_at: new Date().toISOString(),
    asset_name: 'Spot 30s',
    actor_name: 'Marco',
    comment_preview: null,
    project_id: 'p1',
    ...over,
  }
}

describe('NotificationDrawer: status change', () => {
  it('says who moved the asset where, and where it came from', () => {
    state.notifications = [
      notification({
        payload: { status_id: 's2', status_name: 'Needs PM Review', status_color: '#3b82f6', from_status_name: 'No Status' },
      }),
    ]
    render(<NotificationDrawer open onClose={() => {}} railCollapsed />)
    expect(screen.getByText('Marco moved Spot 30s to Needs PM Review')).toBeInTheDocument()
    expect(screen.getByText('was No Status')).toBeInTheDocument()
  })

  it('copes with a notification that carries no payload', () => {
    state.notifications = [notification({ actor_name: null, payload: null })]
    render(<NotificationDrawer open onClose={() => {}} railCollapsed />)
    expect(screen.getByText('Someone moved Spot 30s to a new status')).toBeInTheDocument()
  })
})
