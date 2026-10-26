import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { AssetStatusDef, PipelineRole } from '@/types'

const h = vi.hoisted(() => ({
  statuses: [] as AssetStatusDef[],
  roles: [] as PipelineRole[],
  mutate: vi.fn(),
}))
vi.mock('swr', () => ({
  default: (key: string) => ({
    data: key === '/statuses' ? h.statuses : key === '/pipeline-roles' ? h.roles : undefined,
    mutate: h.mutate,
  }),
  mutate: vi.fn(),
}))
const post = vi.fn().mockResolvedValue({})
const patch = vi.fn().mockResolvedValue({})
const put = vi.fn().mockResolvedValue({})
const del = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}))

import { StatusesTab } from '../statuses-tab'

function status(over: Partial<AssetStatusDef>): AssetStatusDef {
  return {
    id: 's',
    name: 'S',
    color: '#3b82f6',
    position: 0,
    is_default: false,
    notify_creator: true,
    notify_assignee: false,
    notify_role_ids: [],
    legacy_key: null,
    ...over,
  }
}

describe('StatusesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.roles = [{ id: 'r-pm', name: 'PM' }]
    h.statuses = [
      status({ id: 's-none', name: 'No Status', position: 0, is_default: true }),
      status({ id: 's-pm', name: 'Needs PM Review', position: 1, notify_role_ids: ['r-pm'] }),
    ]
  })

  it('lists the statuses in order and says who each one notifies', () => {
    render(<StatusesTab />)
    const items = screen.getAllByRole('listitem')
    expect(within(items[0]).getByText('No Status')).toBeInTheDocument()
    expect(within(items[0]).getByText('Default')).toBeInTheDocument()
    expect(within(items[1]).getByText('Notifies: uploader, PM')).toBeInTheDocument()
  })

  it('creates a status with its notification rule', async () => {
    render(<StatusesTab />)
    fireEvent.click(screen.getByRole('button', { name: /new status/i }))
    fireEvent.change(screen.getByLabelText('Status name'), { target: { value: ' Client Review ' } })
    fireEvent.change(screen.getByLabelText('Status color hex'), { target: { value: '#db2777' } })
    fireEvent.click(screen.getByLabelText(/everyone holding the/i))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/statuses', {
        name: 'Client Review',
        color: '#db2777',
        notify_creator: true,
        notify_assignee: false,
        notify_role_ids: ['r-pm'],
      }),
    )
    expect(h.mutate).toHaveBeenCalled()
  })

  it('will not create a status with a bad colour', () => {
    render(<StatusesTab />)
    fireEvent.click(screen.getByRole('button', { name: /new status/i }))
    fireEvent.change(screen.getByLabelText('Status name'), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText('Status color hex'), { target: { value: 'red' } })
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    expect(post).not.toHaveBeenCalled()
  })

  it('reorders by swapping with the neighbour', async () => {
    render(<StatusesTab />)
    fireEvent.click(screen.getByRole('button', { name: 'Move Needs PM Review up' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/statuses/reorder', { ids: ['s-pm', 's-none'] }))
  })

  it('keeps the default status from being deleted and lets another take over', async () => {
    render(<StatusesTab />)
    expect(screen.getByRole('button', { name: 'Delete No Status' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Make default' }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/statuses/s-pm', { is_default: true }))
  })

  it('deletes a status after confirming, naming where its assets go', async () => {
    render(<StatusesTab />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Needs PM Review' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/move to the default status \(No Status\)/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(del).toHaveBeenCalledWith('/statuses/s-pm'))
  })

  it('adds a pipeline role', async () => {
    render(<StatusesTab />)
    fireEvent.change(screen.getByLabelText('New role name'), { target: { value: 'Colorist' } })
    fireEvent.click(screen.getByRole('button', { name: /add role/i }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/pipeline-roles', { name: 'Colorist' }))
  })
})
