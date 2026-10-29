/**
 * The phone shell in the dashboard layout: the capsule header and the tab bar
 * are rendered on an ordinary dashboard route and not on the asset viewer,
 * which carries its own chrome; the rail and header stay mounted for CSS to
 * pick between the two shells.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let pathname = '/projects/p1'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
vi.mock('@/stores/auth-store', () => ({ useAuthStore: () => ({ fetchUser: vi.fn() }) }))
vi.mock('@/stores/upload-store', () => ({
  useUploadStore: (sel: (s: unknown) => unknown) => sel({ fetchHistory: vi.fn(), panelOpen: false }),
}))
vi.mock('@/hooks/use-upload-leave-guard', () => ({ useUploadLeaveGuard: () => {} }))
vi.mock('@/components/layout/sidebar', () => ({ Sidebar: () => <div data-testid="rail" /> }))
vi.mock('@/components/layout/header', () => ({ Header: () => <div data-testid="header" /> }))
vi.mock('@/components/layout/mobile-header', () => ({ MobileHeader: () => <div data-testid="mobile-header" /> }))
vi.mock('@/components/layout/mobile-tab-bar', () => ({ MobileTabBar: () => <nav data-testid="mobile-tab-bar" />, TAB_BAR_PX: 64 }))
vi.mock('@/components/layout/command-palette', () => ({ CommandPalette: () => null }))
vi.mock('@/components/layout/uploads-panel', () => ({ UploadsPanel: () => null }))
vi.mock('@/components/layout/upload-sse-bridge', () => ({ UploadSSEBridge: () => null }))
vi.mock('@/components/layout/keyboard-shortcuts', () => ({ KeyboardShortcuts: () => null }))
vi.mock('@/components/shared/powered-by-badge', () => ({ PoweredByBadge: () => null }))

import DashboardLayout from '../layout'

describe('the dashboard layout and the phone shell', () => {
  it('renders both shells on a dashboard route and leaves CSS to pick one', () => {
    pathname = '/projects/p1'
    render(<DashboardLayout><div>page</div></DashboardLayout>)
    expect(screen.getByTestId('rail')).toBeInTheDocument()
    expect(screen.getByTestId('header')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-header')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-tab-bar')).toBeInTheDocument()
    // the rail's wrapper hides below md, the tab bar's above it
    expect(screen.getByTestId('rail').parentElement?.className).toContain('max-md:hidden')
    expect(screen.getByTestId('mobile-tab-bar').parentElement?.className).toContain('md:hidden')
  })

  it('renders neither header nor tab bar on the asset viewer', () => {
    pathname = '/projects/p1/assets/a1'
    render(<DashboardLayout><div>page</div></DashboardLayout>)
    expect(screen.queryByTestId('header')).toBeNull()
    expect(screen.queryByTestId('mobile-header')).toBeNull()
    expect(screen.queryByTestId('mobile-tab-bar')).toBeNull()
  })
})
