/**
 * The browser side of Web Push: what this browser can do, the worker's URL
 * and scope under a base path, the key conversion, and the subscribe call's
 * order (permission first, inside the gesture).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  pushSupport,
  urlBase64ToUint8Array,
  registerPushServiceWorker,
  subscribeToPush,
  unsubscribeFromPush,
  PushPermissionDenied,
} from '../push'

// A 65-byte uncompressed P-256 point (0x04 + 64 bytes), as base64url without padding.
const PUB = btoa(String.fromCharCode(4, ...new Array(64).fill(7))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const originalBase = process.env.NEXT_PUBLIC_BASE_PATH

function stubBrowser(over: {
  ua?: string
  standalone?: boolean
  secure?: boolean
  push?: boolean
  touchMac?: boolean
} = {}) {
  Object.defineProperty(navigator, 'userAgent', { value: over.ua ?? 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130', configurable: true })
  Object.defineProperty(navigator, 'platform', { value: over.touchMac ? 'MacIntel' : 'Linux x86_64', configurable: true })
  Object.defineProperty(navigator, 'maxTouchPoints', { value: over.touchMac ? 5 : 0, configurable: true })
  Object.defineProperty(navigator, 'standalone', { value: over.standalone ?? false, configurable: true })
  Object.defineProperty(window, 'isSecureContext', { value: over.secure ?? true, configurable: true })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('standalone') ? !!over.standalone : false, addEventListener() {}, removeEventListener() {} }))
  if (over.push === false) {
    // @ts-expect-error test stub
    delete window.PushManager
  } else {
    vi.stubGlobal('PushManager', class {})
  }
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') })
}

function stubServiceWorker() {
  const subscribe = vi.fn().mockResolvedValue({ toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }) })
  const existing = { endpoint: 'https://push.example/1', unsubscribe: vi.fn().mockResolvedValue(true) }
  const registration = { pushManager: { subscribe, getSubscription: vi.fn().mockResolvedValue(existing) } }
  const register = vi.fn().mockResolvedValue(registration)
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register, ready: Promise.resolve(registration), getRegistration: vi.fn().mockResolvedValue(registration) },
    configurable: true,
  })
  return { register, subscribe, existing }
}

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_PATH
})
afterEach(() => {
  vi.unstubAllGlobals()
  if (originalBase === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH
  else process.env.NEXT_PUBLIC_BASE_PATH = originalBase
})

describe('urlBase64ToUint8Array', () => {
  it('decodes an unpadded base64url VAPID key to its 65 bytes', () => {
    const bytes = urlBase64ToUint8Array(PUB)
    expect(bytes.length).toBe(65)
    expect(bytes[0]).toBe(4)
  })
})

describe('pushSupport', () => {
  it('is ok in a secure browser with a PushManager', () => {
    stubBrowser()
    stubServiceWorker()
    expect(pushSupport()).toBe('ok')
  })
  it('asks for the installed app on an iPhone in Safari, before anything else', () => {
    stubBrowser({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', push: false })
    expect(pushSupport()).toBe('ios_not_installed')
  })
  it('is ok on an iPhone running the installed app', () => {
    stubBrowser({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', standalone: true })
    stubServiceWorker()
    expect(pushSupport()).toBe('ok')
  })
  it('treats a touch Mac (an iPad in desktop mode) as iOS', () => {
    stubBrowser({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605', touchMac: true, push: false })
    expect(pushSupport()).toBe('ios_not_installed')
  })
  it('names an insecure page and a browser without push', () => {
    stubBrowser({ secure: false })
    expect(pushSupport()).toBe('insecure')
    stubBrowser({ push: false })
    expect(pushSupport()).toBe('unsupported')
  })
})

describe('the worker and the subscription', () => {
  it('registers /sw.js at the root scope, both under the base path', async () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/freeframe'
    stubBrowser()
    const { register } = stubServiceWorker()
    await registerPushServiceWorker()
    expect(register).toHaveBeenCalledWith('/freeframe/sw.js', { scope: '/freeframe/' })
  })

  it('asks for permission first, then subscribes with the key as bytes', async () => {
    stubBrowser()
    const { subscribe } = stubServiceWorker()
    const json = await subscribeToPush(PUB)
    expect(Notification.requestPermission).toHaveBeenCalled()
    const arg = subscribe.mock.calls[0][0]
    expect(arg.userVisibleOnly).toBe(true)
    expect(arg.applicationServerKey).toBeInstanceOf(Uint8Array)
    expect(json.endpoint).toBe('https://push.example/1')
  })

  it('throws PushPermissionDenied and never subscribes when permission is refused', async () => {
    stubBrowser()
    const { subscribe } = stubServiceWorker()
    ;(Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue('denied')
    await expect(subscribeToPush(PUB)).rejects.toBeInstanceOf(PushPermissionDenied)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('unsubscribes the existing subscription and returns its endpoint', async () => {
    stubBrowser()
    const { existing } = stubServiceWorker()
    expect(await unsubscribeFromPush()).toBe('https://push.example/1')
    expect(existing.unsubscribe).toHaveBeenCalled()
  })
})
