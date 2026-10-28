import { describe, it, expect } from 'vitest'
import { projectUrl } from '../project-url'

describe('projectUrl', () => {
  it('is the bare project page with nothing set', () => {
    expect(projectUrl('p1', {})).toBe('/projects/p1')
    expect(projectUrl('p1', { folder: null, status: null })).toBe('/projects/p1')
  })

  it('carries the folder, the status, or both, folder first', () => {
    expect(projectUrl('p1', { folder: 'f1' })).toBe('/projects/p1?folder=f1')
    expect(projectUrl('p1', { status: 's1' })).toBe('/projects/p1?status=s1')
    expect(projectUrl('p1', { folder: 'f1', status: 's1' })).toBe('/projects/p1?folder=f1&status=s1')
  })
})
