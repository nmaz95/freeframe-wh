/**
 * The phone tab bar: the rail's five stops along the bottom edge.
 *
 * It marks the current page, shows the unread count on Notifications, opens
 * the command palette from Search, and steps aside while something else
 * (the asset grid's selection bar) claims the bottom edge through the mobile
 * shell store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { nav, stable } = vi.hoisted(() => ({
  nav: { pathname: '/projects/p1' },
  stable: { notifications: { unreadCount: 4, fetchNotifications: vi.fn() } },
}))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))
vi.mock('@/stores/notification-store', () => ({ useNotificationStore: () => stable.notifications }))
vi.mock('@/components/shared/avatar', () => ({ Avatar: () => <span data-testid="avatar" /> }))
vi.mock('@/components/layout/notification-drawer', () => ({
  NotificationDrawer: ({ open, fullWidth }: { open: boolean; fullWidth?: boolean }) =>
    open ? <div data-testid="drawer" data-full={String(fullWidth)} /> : null,
}))

import { MobileTabBar } from '../mobile-tab-bar'
import { useMobileShellStore } from '@/stores/mobile-shell-store'

beforeEach(() => {
  useMobileShellStore.setState({ tabBarClaims: 0 })
  nav.pathname = '/projects/p1'
})

describe('MobileTabBar', () => {
  it('has the five stops, marks the current one and shows the unread count', () => {
    render(<MobileTabBar onSearchOpen={() => {}} />)
    const bar = screen.getByRole('navigation', { name: 'Main' })
    expect(bar).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Uploads' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications, 4 unread' })).toHaveTextContent('4')
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/settings/profile')
    expect(stable.notifications.fetchNotifications).toHaveBeenCalled()
  })

  it('opens search from the Search stop and the full-width drawer from Notifications', async () => {
    const onSearchOpen = vi.fn()
    render(<MobileTabBar onSearchOpen={onSearchOpen} />)
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(onSearchOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('drawer')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Notifications, 4 unread' }))
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-full', 'true')
  })

  it('steps aside while the bottom edge is claimed, and comes back on release', () => {
    render(<MobileTabBar onSearchOpen={() => {}} />)
    const bar = screen.getByTestId('mobile-tab-bar')
    expect(bar).not.toHaveAttribute('aria-hidden')
    let release: () => void = () => {}
    act(() => {
      release = useMobileShellStore.getState().claimTabBar()
    })
    expect(bar).toHaveAttribute('aria-hidden', 'true')
    expect(bar.className).toContain('pointer-events-none')
    act(() => {
      release()
      release() // a second release is a no-op, never a negative count
    })
    expect(bar).not.toHaveAttribute('aria-hidden')
    expect(useMobileShellStore.getState().tabBarClaims).toBe(0)
  })
})
