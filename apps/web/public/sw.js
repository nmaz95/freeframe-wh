/*
 * FreeFrame's service worker: push notifications only.
 *
 * It handles `push` (show what the server sent) and `notificationclick`
 * (open what it points at). It has NO `fetch` handler and keeps NO cache, on
 * purpose: without a fetch handler the browser never routes a request through
 * this worker, so a stale app shell after a deploy cannot happen (the reason
 * app/manifest.ts went without a worker until push needed one).
 *
 * Plain JS, served as-is from /public; bump SW_VERSION when it changes so
 * the card's debug line and a test can tell which one is running.
 */
const SW_VERSION = '1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Control the open pages at once, so notificationclick can navigate them.
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  // Safari revokes a subscription whose pushes show nothing, so a
  // notification is shown whatever arrived, with a generic one as the floor.
  let payload = null
  try {
    payload = event.data ? event.data.json() : null
  } catch {
    payload = { title: 'FreeFrame', body: event.data ? event.data.text() : '' }
  }
  const title = (payload && payload.title) || 'FreeFrame'
  const options = {
    body: (payload && payload.body) || '',
    tag: (payload && payload.tag) || undefined,
    data: { url: (payload && payload.url) || null },
    icon: new URL('icons/icon-192.png', self.registration.scope).href,
    badge: new URL('icons/icon-192.png', self.registration.scope).href,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url
  if (!url) return
  event.waitUntil(
    (async () => {
      const sameOrigin = new URL(url, self.location.href).origin === self.location.origin
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (sameOrigin && windows.length > 0) {
        const client = windows[0]
        await client.focus()
        if ('navigate' in client) await client.navigate(url)
        return
      }
      // A link outside the app (a Drive file) opens on its own, as the drawer does.
      await self.clients.openWindow(url)
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'GET_VERSION') return
  // Answer on the port the page sent, if it sent one; else to the page itself.
  const target = (event.ports && event.ports[0]) || event.source
  if (target) target.postMessage({ type: 'VERSION', version: SW_VERSION })
})
