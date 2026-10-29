/**
 * The phone tab bar: four stops along the bottom edge, Projects raised in the
 * middle. One pill slides to the current stop as the route changes, the
 * Notifications stop is a link to the page (not the rail's drawer), Search
 * opens the command palette, and the bar steps aside while the asset grid's
 * selection bar claims the bottom edge.
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

import { MobileTabBar, activeStopFor } from '../mobile-tab-bar'
import { useMobileShellStore } from '@/stores/mobile-shell-store'

beforeEach(() => {
  useMobileShellStore.setState({ tabBarClaims: 0 })
  nav.pathname = '/projects/p1'
})

describe('activeStopFor', () => {
  it('maps routes to stops and the open palette to Search', () => {
    expect(activeStopFor('/projects', false)).toBe('projects')
    expect(activeStopFor('/projects/p1/assets/a1', false)).toBe('projects')
    expect(activeStopFor('/notifications', false)).toBe('notifications')
    expect(activeStopFor('/settings/profile', false)).toBe('profile')
    expect(activeStopFor('/settings/admin', false)).toBe('profile')
    expect(activeStopFor('/device', false)).toBeNull()
    expect(activeStopFor('/projects', true)).toBe('search')
  })
})

describe('MobileTabBar', () => {
  it('has the four stops, Projects current and raised, and the unread count', () => {
    render(<MobileTabBar onSearchOpen={() => {}} />)
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-active', 'projects')
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Notifications, 4 unread' })).toHaveAttribute('href', '/notifications')
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/settings/profile')
    expect(screen.queryByRole('button', { name: /Uploads/ })).toBeNull()
    expect(stable.notifications.fetchNotifications).toHaveBeenCalled()
  })

  it('slides the pill to the current stop as the route changes', () => {
    const { rerender } = render(<MobileTabBar onSearchOpen={() => {}} />)
    const pill = screen.getByTestId('tab-indicator')
    expect(pill.style.transform).toBe('translateX(100%)')
    nav.pathname = '/notifications'
    rerender(<MobileTabBar onSearchOpen={() => {}} />)
    expect(pill.style.transform).toBe('translateX(200%)')
    expect(screen.getByRole('link', { name: 'Notifications, 4 unread' })).toHaveAttribute('aria-current', 'page')
    nav.pathname = '/device'
    rerender(<MobileTabBar onSearchOpen={() => {}} />)
    expect(pill.className).toContain('opacity-0')
  })

  it('opens the palette from Search and marks it current while it is open', async () => {
    const onSearchOpen = vi.fn()
    const { rerender } = render(<MobileTabBar onSearchOpen={onSearchOpen} />)
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(onSearchOpen).toHaveBeenCalledTimes(1)
    rerender(<MobileTabBar onSearchOpen={onSearchOpen} searchOpen />)
    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('tab-indicator').style.transform).toBe('translateX(0%)')
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
    act(() => {
      release()
      release()
    })
    expect(bar).not.toHaveAttribute('aria-hidden')
    expect(useMobileShellStore.getState().tabBarClaims).toBe(0)
  })
})
