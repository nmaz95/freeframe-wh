import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { GoogleDriveStatus } from '@/types'

const h = vi.hoisted(() => ({
  status: { enabled: true, connected: false, email: null, connected_at: null } as GoogleDriveStatus,
  params: new URLSearchParams(),
  mutate: vi.fn(),
}))
vi.mock('swr', () => ({ default: () => ({ data: h.status, mutate: h.mutate }), mutate: vi.fn() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => h.params }))
const post = vi.fn()
const del = vi.fn()
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: (...a: unknown[]) => post(...a), delete: (...a: unknown[]) => del(...a) } }))
const redirectTo = vi.fn()
vi.mock('@/lib/navigation', () => ({ redirectTo: (...a: unknown[]) => redirectTo(...a) }))

import { GoogleDriveConnection } from '../google-drive-connection'

describe('GoogleDriveConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.params = new URLSearchParams()
    h.status = { enabled: true, connected: false, email: null, connected_at: null }
  })

  it('sends the browser to the consent URL the API hands out', async () => {
    post.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' })
    render(<GoogleDriveConnection />)
    fireEvent.click(screen.getByRole('button', { name: /connect google drive/i }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/integrations/google/authorize'))
    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=x'))
  })

  it('shows the connected account and disconnects after confirming', async () => {
    h.status = { enabled: true, connected: true, email: 'me@wowproduction.it', connected_at: '2026-10-28T10:00:00Z' }
    del.mockResolvedValue(undefined)
    render(<GoogleDriveConnection />)
    expect(screen.getByText('me@wowproduction.it')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(del).toHaveBeenCalledWith('/integrations/google'))
  })

  it('reports the outcome when coming back from Google', () => {
    h.params = new URLSearchParams('google=error&reason=denied')
    render(<GoogleDriveConnection />)
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in was cancelled.')
    expect(h.mutate).toHaveBeenCalled()
  })

  it('explains when the instance has no Google keys', () => {
    h.status = { enabled: false, connected: false, email: null, connected_at: null }
    render(<GoogleDriveConnection />)
    expect(screen.getByText(/an admin has to configure/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument()
  })
})
