/**
 * A status change names who moved what to where, from the payload the API
 * snapshotted when it happened, so a later rename does not rewrite it.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  it('a grouped move names the count and the first few assets, and opens the filtered project', () => {
    const onClose = vi.fn()
    state.notifications = [
      notification({
        payload: {
          status_id: 's2', status_name: 'Needs PM Review', status_color: '#3b82f6', from_status_name: null,
          asset_count: 12, asset_ids: ['a1', 'a2'], asset_names: ['Spot 30s', 'Reel 87', 'Reel 109', 'Reel 107', 'Reel 112'],
          project_id: 'p1',
        },
      }),
    ]
    const location = { href: '' }
    vi.stubGlobal('location', location)
    render(<NotificationDrawer open onClose={onClose} railCollapsed />)
    expect(screen.getByText('Marco moved 12 assets to Needs PM Review')).toBeInTheDocument()
    expect(screen.getByText('Spot 30s, Reel 87, Reel 109, Reel 107, Reel 112, and 7 more')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Marco moved 12 assets to Needs PM Review'))
    expect(location.href).toBe('/projects/p1?status=s2')
    expect(onClose).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('copes with a notification that carries no payload', () => {
    state.notifications = [notification({ actor_name: null, payload: null })]
    render(<NotificationDrawer open onClose={() => {}} railCollapsed />)
    expect(screen.getByText('Someone moved Spot 30s to a new status')).toBeInTheDocument()
  })
})
