import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Notification } from '@/types'

const state = vi.hoisted(() => ({ notifications: [] as unknown[] }))
vi.mock('@/stores/notification-store', () => ({
  useNotificationStore: () => ({
    notifications: state.notifications, isLoading: false, fetchNotifications: vi.fn(), markAllRead: vi.fn(), markAsRead: vi.fn(), unreadCount: 0,
  }),
}))

import { NotificationDrawer } from '@/components/layout/notification-drawer'

function notification(over: Partial<Notification>): Notification {
  return {
    id: 'n1', user_id: 'u1', comment_id: null, asset_id: 'a1', type: 'delivery', read: true,
    created_at: new Date().toISOString(), asset_name: 'Spot 30s', actor_name: 'Me', comment_preview: null, project_id: 'p1', ...over,
  }
}

describe('NotificationDrawer: deliveries', () => {
  it('names the folder and opens the file on Drive', () => {
    state.notifications = [notification({ payload: { delivery_id: 'd', status: 'done', folder_name: 'Consegne / Barilla', file_name: 'Spot 30s v3.mov', web_view_link: 'https://drive.google.com/file/d/x/view', error: null } })]
    const open = vi.fn()
    vi.stubGlobal('open', open)
    render(<NotificationDrawer open onClose={() => {}} railCollapsed />)
    expect(screen.getByText('Spot 30s delivered to Consegne / Barilla')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Spot 30s delivered to Consegne / Barilla'))
    expect(open).toHaveBeenCalledWith('https://drive.google.com/file/d/x/view', '_blank', 'noopener')
    vi.unstubAllGlobals()
  })

  it('says why a copy failed', () => {
    state.notifications = [notification({ payload: { delivery_id: 'd', status: 'failed', folder_name: 'Consegne / Barilla', file_name: 'x', web_view_link: null, error: 'Google account disconnected' } })]
    render(<NotificationDrawer open onClose={() => {}} railCollapsed />)
    expect(screen.getByText('Delivery of Spot 30s failed')).toBeInTheDocument()
    expect(screen.getByText('Google account disconnected')).toBeInTheDocument()
  })
})
