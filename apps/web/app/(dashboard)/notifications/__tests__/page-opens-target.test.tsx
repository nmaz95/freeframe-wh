/**
 * The Notifications page is the phone shell's notification surface: it says
 * what the drawer says and opens what the drawer opens (the asset with the
 * comment focused, the project filtered on a bulk status, the Drive file),
 * with an All / Unread filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { nav, store } = vi.hoisted(() => ({
  nav: { push: vi.fn() },
  store: {
    notifications: [] as unknown[],
    isLoading: false,
    unreadCount: 2,
    fetchNotifications: vi.fn(),
    markAllRead: vi.fn(),
    markAsRead: vi.fn(),
  },
}))
vi.mock('next/navigation', () => ({ useRouter: () => nav }))
vi.mock('@/stores/notification-store', () => ({ useNotificationStore: () => store }))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => {} }))

import NotificationsPage from '../page'

const base = { user_id: 'u1', comment_id: null, read: false, created_at: '2026-10-29T10:00:00Z', actor_name: 'Paola PM', comment_preview: null, project_id: 'p1' }

beforeEach(() => {
  vi.clearAllMocks()
  store.notifications = [
    { ...base, id: 'n1', type: 'comment', asset_id: 'a1', asset_name: 'Spot 30s', comment_id: 'c1', comment_preview: 'Il logo entra troppo presto' },
    { ...base, id: 'n2', type: 'status_change', asset_id: 'a1', asset_name: 'Spot 30s', read: true,
      payload: { status_id: 's1', status_name: 'Approved', status_color: '#34d399', from_status_name: null, asset_count: 3, asset_ids: ['a1', 'a2', 'a3'], asset_names: ['Spot 30s', 'Reel 2', 'Reel 3'], project_id: 'p1' } },
    { ...base, id: 'n3', type: 'delivery', asset_id: 'a1', asset_name: 'Spot 30s',
      payload: { delivery_id: 'd1', status: 'done', folder_name: 'Consegne / Barilla', file_name: 'Spot 30s v1.mp4', web_view_link: 'https://drive.google.com/file/d/x/view', error: null } },
  ]
})

describe('NotificationsPage', () => {
  it('says what the drawer says, and the unread filter hides the read ones', async () => {
    render(<NotificationsPage />)
    expect(store.fetchNotifications).toHaveBeenCalled()
    expect(screen.getByText('Paola PM commented on Spot 30s')).toBeInTheDocument()
    expect(screen.getByText('Il logo entra troppo presto')).toBeInTheDocument()
    expect(screen.getByText('Paola PM moved 3 assets to Approved')).toBeInTheDocument()
    expect(screen.getByText('Spot 30s delivered to Consegne / Barilla')).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('tablist')).getByRole('tab', { name: 'Unread' }))
    expect(screen.queryByText('Paola PM moved 3 assets to Approved')).toBeNull()
    expect(screen.getByText('Paola PM commented on Spot 30s')).toBeInTheDocument()
  })

  it('opens the asset with the comment focused, marking it read', async () => {
    render(<NotificationsPage />)
    await userEvent.click(screen.getByText('Paola PM commented on Spot 30s'))
    expect(store.markAsRead).toHaveBeenCalledWith('n1')
    expect(nav.push).toHaveBeenCalledWith('/projects/p1/assets/a1?commentId=c1')
  })

  it('opens the project filtered on a bulk status change, without marking a read one again', async () => {
    render(<NotificationsPage />)
    await userEvent.click(screen.getByText('Paola PM moved 3 assets to Approved'))
    expect(store.markAsRead).not.toHaveBeenCalled()
    expect(nav.push).toHaveBeenCalledWith('/projects/p1?status=s1')
  })

  it('opens a finished delivery on Drive, outside the app', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<NotificationsPage />)
    await userEvent.click(screen.getByText('Spot 30s delivered to Consegne / Barilla'))
    expect(open).toHaveBeenCalledWith('https://drive.google.com/file/d/x/view', '_blank', 'noopener')
    expect(nav.push).not.toHaveBeenCalled()
    open.mockRestore()
  })
})
