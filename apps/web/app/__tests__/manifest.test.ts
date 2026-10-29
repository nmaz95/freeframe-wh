/**
 * The web app manifest: installed under the instance's own name, with its
 * own Apple icon when an admin uploaded one, and the product's icons for the
 * sizes Android needs. Paths carry the base path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ branding: null as null | { org_name: string; apple_icon_url: string | null } }))
vi.mock('@/lib/branding-server', () => ({ getServerBranding: async () => state.branding }))
vi.mock('@/lib/branding-logo', () => ({
  logoUrlFromApi: (url: string | null) => (url ? `http://api.test${url}` : null),
}))

import manifest from '../manifest'

beforeEach(() => {
  state.branding = null
  delete process.env.NEXT_PUBLIC_BASE_PATH
})

describe('manifest', () => {
  it('is a standalone app named FreeFrame by default, with the generated icons', async () => {
    const m = await manifest()
    expect(m.name).toBe('FreeFrame')
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('/projects')
    expect(m.icons?.map((i) => i.src)).toEqual(['/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'])
    expect(m.icons?.find((i) => i.purpose === 'maskable')?.sizes).toBe('512x512')
  })

  it('takes the instance name and Apple icon from branding', async () => {
    state.branding = { org_name: 'WowProduction Review', apple_icon_url: '/instance/branding/logo/apple-icon?v=1' }
    const m = await manifest()
    expect(m.name).toBe('WowProduction Review')
    expect(m.short_name).toBe('WowProductio')
    expect(m.icons?.[0]).toMatchObject({ src: 'http://api.test/instance/branding/logo/apple-icon?v=1', sizes: '180x180' })
  })

  it('prefixes every path with the base path', async () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/freeframe'
    const m = await manifest()
    expect(m.start_url).toBe('/freeframe/projects')
    expect(m.scope).toBe('/freeframe/')
    expect(m.icons?.[0].src).toBe('/freeframe/icons/icon-192.png')
  })
})
