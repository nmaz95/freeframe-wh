/**
 * The breadcrumb trail: labels from the route, registered names for UUID
 * segments, and no href for a section that only redirects (Settings).
 */
import { describe, it, expect } from 'vitest'
import { buildBreadcrumbs } from '../breadcrumbs'

const PID = '11111111-1111-4111-8111-111111111111'

describe('buildBreadcrumbs', () => {
  it('titles a project by its registered label and skips structural segments', () => {
    expect(buildBreadcrumbs(`/projects/${PID}/assets/22222222-2222-4222-8222-222222222222`, { [PID]: 'F8 bulk' })).toEqual([
      { label: 'Projects', href: '/projects' },
      { label: 'F8 bulk', href: `/projects/${PID}` },
    ])
  })

  it('gives the Settings section no href: it has no page of its own', () => {
    expect(buildBreadcrumbs('/settings/profile', {})).toEqual([
      { label: 'Settings', href: '' },
      { label: 'Profile', href: '/settings/profile' },
    ])
  })

  it('lets a registered href win over the path', () => {
    expect(buildBreadcrumbs(`/projects/${PID}`, { [PID]: 'F8' }, { [PID]: `/projects/${PID}?folder=f1` })).toEqual([
      { label: 'Projects', href: '/projects' },
      { label: 'F8', href: `/projects/${PID}?folder=f1` },
    ])
  })
})
