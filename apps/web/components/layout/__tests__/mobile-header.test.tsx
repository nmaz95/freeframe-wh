/**
 * The phone header capsule: titled by the last breadcrumb, with the way back
 * to the crumb before it, and a slot pages fill through a portal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const nav = vi.hoisted(() => ({ pathname: '/projects' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

import { MobileHeader, MobileHeaderSlot } from '../mobile-header'
import { useBreadcrumbStore } from '@/stores/breadcrumb-store'

beforeEach(() => {
  useBreadcrumbStore.setState({ labels: {}, extraCrumbs: [], hrefs: {} })
})

describe('MobileHeader', () => {
  it('shows the current page and no back link at the top level', () => {
    nav.pathname = '/projects'
    render(<MobileHeader onSearchOpen={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Projects')
    expect(screen.queryByRole('link', { name: /Back to/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
  })

  it('titles a project by its registered label and links back to the list', () => {
    nav.pathname = '/projects/11111111-1111-4111-8111-111111111111'
    useBreadcrumbStore.setState({ labels: { '11111111-1111-4111-8111-111111111111': 'F8 bulk' } })
    render(<MobileHeader onSearchOpen={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('F8 bulk')
    expect(screen.getByRole('link', { name: 'Back to Projects' })).toHaveAttribute('href', '/projects')
  })

  it('goes back to Projects from a settings tab, skipping the section that only redirects', () => {
    nav.pathname = '/settings/profile'
    render(<MobileHeader onSearchOpen={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Profile')
    expect(screen.getByRole('link', { name: 'Back to Projects' })).toHaveAttribute('href', '/projects')
  })

  it('renders a page’s row inside the capsule through the slot', () => {
    nav.pathname = '/projects'
    render(
      <>
        <MobileHeader onSearchOpen={() => {}} />
        <MobileHeaderSlot>
          <div data-testid="chips">chips</div>
        </MobileHeaderSlot>
      </>,
    )
    const header = screen.getByTestId('mobile-header')
    expect(header).toContainElement(screen.getByTestId('chips'))
  })
})
