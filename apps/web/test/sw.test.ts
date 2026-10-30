/**
 * public/sw.js, loaded into a fake worker global: it always shows a
 * notification for a push (Safari revokes silent subscriptions), opens the
 * payload's URL on click, and registers no fetch handler (no caching, ever).
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

function loadWorker() {
  const handlers: Record<string, (event: unknown) => void> = {}
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const focus = vi.fn().mockResolvedValue(undefined)
  const navigate = vi.fn().mockResolvedValue(undefined)
  const openWindow = vi.fn().mockResolvedValue(undefined)
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      handlers[type] = fn
    },
    skipWaiting: vi.fn(),
    registration: { scope: 'https://ff.example/', showNotification },
    clients: { claim: vi.fn().mockResolvedValue(undefined), matchAll: vi.fn().mockResolvedValue([{ focus, navigate }]), openWindow },
    location: { href: 'https://ff.example/sw.js', origin: 'https://ff.example' },
  }
  const code = readFileSync(join(__dirname, '..', 'public', 'sw.js'), 'utf8')
  vm.runInNewContext(code, { self, URL })
  return { handlers, showNotification, focus, navigate, openWindow }
}

const waited = async (event: { waitUntil: ReturnType<typeof vi.fn> }) => Promise.all(event.waitUntil.mock.calls.map((c) => c[0]))

describe('the push service worker', () => {
  it('registers push, click, install, activate and message, and no fetch handler', () => {
    const { handlers } = loadWorker()
    expect(Object.keys(handlers).sort()).toEqual(['activate', 'install', 'message', 'notificationclick', 'push'])
    expect(handlers.fetch).toBeUndefined()
  })

  it('shows the payload as a notification, with its url and the app icon', async () => {
    const { handlers, showNotification } = loadWorker()
    const event = { data: { json: () => ({ title: 'Paola moved Spot to Approved', body: 'was Needs PM Review', url: 'https://ff.example/projects/p/assets/a', tag: 'n1' }) }, waitUntil: vi.fn() }
    handlers.push(event)
    await waited(event)
    expect(showNotification).toHaveBeenCalledWith('Paola moved Spot to Approved', expect.objectContaining({
      body: 'was Needs PM Review',
      tag: 'n1',
      data: { url: 'https://ff.example/projects/p/assets/a' },
      icon: 'https://ff.example/icons/icon-192.png',
    }))
  })

  it('still shows something for an empty or non-JSON push', async () => {
    const { handlers, showNotification } = loadWorker()
    const empty = { data: null, waitUntil: vi.fn() }
    handlers.push(empty)
    await waited(empty)
    expect(showNotification).toHaveBeenLastCalledWith('FreeFrame', expect.objectContaining({ body: '' }))
    const text = { data: { json: () => { throw new Error('nope') }, text: () => 'plain words' }, waitUntil: vi.fn() }
    handlers.push(text)
    await waited(text)
    expect(showNotification).toHaveBeenLastCalledWith('FreeFrame', expect.objectContaining({ body: 'plain words' }))
  })

  it('focuses an open window and navigates it to a same-origin url', async () => {
    const { handlers, focus, navigate, openWindow } = loadWorker()
    const event = { notification: { close: vi.fn(), data: { url: 'https://ff.example/projects/p?status=s' } }, waitUntil: vi.fn() }
    handlers.notificationclick(event)
    await waited(event)
    expect(event.notification.close).toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('https://ff.example/projects/p?status=s')
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('opens an outside url (a Drive file) in a new window', async () => {
    const { handlers, navigate, openWindow } = loadWorker()
    const event = { notification: { close: vi.fn(), data: { url: 'https://drive.google.com/file/d/x/view' } }, waitUntil: vi.fn() }
    handlers.notificationclick(event)
    await waited(event)
    expect(navigate).not.toHaveBeenCalled()
    expect(openWindow).toHaveBeenCalledWith('https://drive.google.com/file/d/x/view')
  })
})
