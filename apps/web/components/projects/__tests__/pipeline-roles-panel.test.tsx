/**
 * An asset's team per pipeline role: what it resolves to, and how a change
 * applies to that asset only while the project default stays where it was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ProjectMember, RoleAssignments, User } from '@/types'

const h = vi.hoisted(() => ({
  assignments: { project_defaults: [], overrides: [] } as RoleAssignments,
  mutate: vi.fn(),
}))
vi.mock('swr', () => ({
  default: (key: string) => ({ data: key.includes('pipeline-assignments') ? h.assignments : undefined, mutate: h.mutate }),
  mutate: vi.fn(),
}))
vi.mock('@/hooks/use-asset-statuses', () => ({
  usePipelineRoles: () => ({ roles: [{ id: 'r-pm', name: 'PM' }, { id: 'r-ed', name: 'Editor' }], isLoading: false }),
}))
const put = vi.fn()
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), put: (...a: unknown[]) => put(...a) } }))

import { PipelineRolesPanel } from '../pipeline-roles-panel'

const users: Record<string, User> = Object.fromEntries(
  [
    ['u-nico', 'Nicolò Mazzurco'],
    ['u-giac', 'Giacomo Alioto'],
    ['u-alice', 'Alice Mazza'],
  ].map(([id, name]) => [
    id,
    { id, name, email: `${id}@t.local`, avatar_url: null, avatar_color: null, status: 'active', is_superadmin: false, email_verified: true, preferences: {}, created_at: '', deleted_at: null } as User,
  ]),
)
const members: ProjectMember[] = Object.keys(users).map((id) => ({
  id: `m-${id}`, project_id: 'p1', user_id: id, role: 'editor', invited_by: null, invited_at: null, deleted_at: null,
}))

function renderAsset(canEdit = true) {
  return render(<PipelineRolesPanel projectId="p1" assetId="a1" members={members} users={users} canEdit={canEdit} />)
}

describe('PipelineRolesPanel on an asset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    put.mockImplementation((_url: string, body: { assignments: RoleAssignments['overrides'] }) =>
      Promise.resolve({ project_defaults: h.assignments.project_defaults, overrides: body.assignments }),
    )
    h.assignments = {
      project_defaults: [{ role_id: 'r-pm', user_ids: ['u-nico'] }],
      overrides: [],
    }
  })

  it('shows the project default as the PM, and says where it comes from', () => {
    renderAsset()
    const pm = screen.getByTestId('role-PM')
    expect(within(pm).getByText('project default')).toBeInTheDocument()
    expect(within(pm).getByRole('checkbox', { name: 'Nicolò Mazzurco is PM (project default)' })).toHaveAttribute('aria-checked', 'true')
    expect(within(pm).getByRole('checkbox', { name: 'Giacomo Alioto is PM' })).toHaveAttribute('aria-checked', 'false')
    expect(within(pm).queryByText('Use project default')).not.toBeInTheDocument()
  })

  it('picking someone copies the default and applies the change to this asset', async () => {
    renderAsset()
    fireEvent.click(within(screen.getByTestId('role-PM')).getByRole('checkbox', { name: 'Giacomo Alioto is PM' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/assets/a1/pipeline-assignments', {
        assignments: [{ role_id: 'r-pm', user_ids: ['u-nico', 'u-giac'] }],
      }),
    )
    expect(h.mutate).toHaveBeenCalled()
  })

  it('a role set on the asset offers to go back to the project default', async () => {
    h.assignments = {
      project_defaults: [{ role_id: 'r-pm', user_ids: ['u-nico'] }],
      overrides: [{ role_id: 'r-pm', user_ids: ['u-giac'] }, { role_id: 'r-ed', user_ids: ['u-alice'] }],
    }
    renderAsset()
    const pm = screen.getByTestId('role-PM')
    expect(within(pm).getByRole('checkbox', { name: 'Giacomo Alioto is PM' })).toHaveAttribute('aria-checked', 'true')
    expect(within(pm).getByRole('checkbox', { name: 'Nicolò Mazzurco is PM' })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(within(pm).getByRole('button', { name: 'Use project default' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/assets/a1/pipeline-assignments', {
        assignments: [{ role_id: 'r-ed', user_ids: ['u-alice'] }],
      }),
    )
  })

  it('a role with no default and nobody named reads Nobody when read-only', () => {
    renderAsset(false)
    expect(within(screen.getByTestId('role-PM')).getByText('Nicolò Mazzurco')).toBeInTheDocument()
    expect(within(screen.getByTestId('role-PM')).getByText('(project default)')).toBeInTheDocument()
    expect(within(screen.getByTestId('role-Editor')).getByText('Nobody')).toBeInTheDocument()
  })
})

describe('PipelineRolesPanel on a project', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    put.mockResolvedValue({ project_defaults: [], overrides: [] })
    h.assignments = { project_defaults: [{ role_id: 'r-pm', user_ids: ['u-nico'] }], overrides: [] }
  })

  it('edits the defaults themselves, with no default marker', async () => {
    render(<PipelineRolesPanel projectId="p1" members={members} users={users} canEdit />)
    const pm = screen.getByTestId('role-PM')
    expect(within(pm).queryByText('project default')).not.toBeInTheDocument()
    fireEvent.click(within(pm).getByRole('checkbox', { name: 'Nicolò Mazzurco is PM' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/projects/p1/pipeline-assignments', { assignments: [] }),
    )
  })
})
