/**
 * Settings → Profile → Push notifications: one card, six states, driven by
 * what the instance (keys), the browser (support, permission) and the server
 * (this browser's row) say.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { PushStatus } from '@/types'

const h = vi.hoisted(() => ({
  status: { enabled: true, public_key: 'PUB', subscriptions: [] } as PushStatus,
  mutate: vi.fn(),
  support: 'ok' as 'ok' | 'unsupported' | 'ios_not_installed' | 'insecure',
  permission: 'default' as NotificationPermission,
  local: null as null | { endpoint: string; toJSON: () => { endpoint: string } },
  subscribeResult: { endpoint: 'https://push.example/this', keys: { p256dh: 'p', auth: 'a' } },
  denied: false,
}))
vi.mock('swr', () => ({ default: () => ({ data: h.status, mutate: h.mutate }), mutate: vi.fn() }))
const post = vi.fn()
const del = vi.fn()
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: (...a: unknown[]) => post(...a), delete: (...a: unknown[]) => del(...a) } }))
const unsubscribe = vi.fn()
vi.mock('@/lib/push', () => ({
  PushPermissionDenied: class PushPermissionDenied extends Error {},
  pushSupport: () => h.support,
  registerPushServiceWorker: vi.fn().mockResolvedValue(undefined),
  getPushSubscription: vi.fn(async () => h.local),
  subscribeToPush: vi.fn(async () => {
    if (h.denied) {
      const { PushPermissionDenied } = await import('@/lib/push')
      throw new PushPermissionDenied()
    }
    return h.subscribeResult
  }),
  unsubscribeFromPush: (...a: unknown[]) => unsubscribe(...a),
}))

import { PushNotificationsCard } from '../push-notifications-card'

beforeEach(() => {
  vi.clearAllMocks()
  h.status = { enabled: true, public_key: 'PUB', subscriptions: [] }
  h.support = 'ok'
  h.permission = 'default'
  h.local = null
  h.denied = false
  vi.stubGlobal('Notification', { get permission() { return h.permission } })
})

describe('PushNotificationsCard', () => {
  it('says the instance has no keys', async () => {
    h.status = { enabled: false, public_key: null, subscriptions: [] }
    render(<PushNotificationsCard />)
    expect(await screen.findByText(/an admin has to set the push keys/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Turn on/ })).toBeNull()
  })

  it('sends an iPhone in Safari to the home screen first', async () => {
    h.support = 'ios_not_installed'
    render(<PushNotificationsCard />)
    expect(await screen.findByText(/Add to\s+Home Screen/)).toBeInTheDocument()
  })

  it('explains a blocked permission', async () => {
    h.permission = 'denied'
    render(<PushNotificationsCard />)
    expect(await screen.findByText(/Notifications are blocked/)).toBeInTheDocument()
  })

  it('turns push on: subscribes, posts the subscription, refreshes', async () => {
    post.mockResolvedValue({ id: 's1' })
    render(<PushNotificationsCard />)
    const button = await screen.findByRole('button', { name: /Turn on for this device/ })
    fireEvent.click(button)
    await waitFor(() => expect(post).toHaveBeenCalledWith('/me/push/subscriptions', h.subscribeResult))
    await waitFor(() => expect(h.mutate).toHaveBeenCalled())
    expect(await screen.findByText(/are on for this device/)).toBeInTheDocument()
  })

  it('rolls the browser subscription back when the server refuses it', async () => {
    post.mockRejectedValue(new Error('Push notifications are not configured on this instance'))
    render(<PushNotificationsCard />)
    fireEvent.click(await screen.findByRole('button', { name: /Turn on for this device/ }))
    await waitFor(() => expect(unsubscribe).toHaveBeenCalled())
    expect(await screen.findByRole('alert')).toHaveTextContent('not configured')
  })

  it('shows the device as on and turns it off: unsubscribe, delete, refresh', async () => {
    h.local = { endpoint: 'https://push.example/this', toJSON: () => ({ endpoint: 'https://push.example/this' }) }
    h.status = { enabled: true, public_key: 'PUB', subscriptions: [{ id: 's1', endpoint: 'https://push.example/this', user_agent: 'x', created_at: null, last_used_at: null }] }
    del.mockResolvedValue(undefined)
    render(<PushNotificationsCard />)
    expect(await screen.findByText('On for this device')).toBeInTheDocument()
    expect(screen.getByText('On for 1 device.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(unsubscribe).toHaveBeenCalled())
    await waitFor(() => expect(del).toHaveBeenCalledWith('/me/push/subscriptions/s1'))
    expect(await screen.findByText(/are off for this device/)).toBeInTheDocument()
  })

  it('re-registers a local subscription the server no longer lists', async () => {
    h.local = { endpoint: 'https://push.example/this', toJSON: () => ({ endpoint: 'https://push.example/this' }) }
    post.mockResolvedValue({ id: 's2' })
    render(<PushNotificationsCard />)
    await waitFor(() => expect(post).toHaveBeenCalledWith('/me/push/subscriptions', { endpoint: 'https://push.example/this' }))
    await waitFor(() => expect(h.mutate).toHaveBeenCalled())
  })
})
