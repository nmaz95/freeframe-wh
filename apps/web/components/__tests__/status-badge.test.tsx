import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge, StatusDot, statusTint } from '@/components/shared/status-badge'

describe('StatusBadge', () => {
  it('shows the name and paints the dot with the status colour', () => {
    render(<StatusBadge status={{ name: 'Needs PM Review', color: '#3b82f6' }} />)
    expect(screen.getByText('Needs PM Review')).toBeInTheDocument()
    const badge = screen.getByTestId('status-badge')
    expect(badge.style.backgroundColor).toBe(statusTint('#3b82f6'))
    const dot = badge.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(dot.style.backgroundColor).toBe('rgb(59, 130, 246)')
  })

  it('tints with the theme surface rather than a transparent colour', () => {
    expect(statusTint('#ef4444')).toBe('color-mix(in srgb, #ef4444 18%, var(--bg-secondary))')
  })
})

describe('StatusDot', () => {
  it('names the status for assistive tech when given a title', () => {
    render(<StatusDot color="#22c55e" title="Approved" />)
    expect(screen.getByRole('img', { name: 'Approved' })).toBeInTheDocument()
  })
})
