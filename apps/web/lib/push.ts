import { withBasePath } from '@/lib/base-path'

/**
 * Web Push from the browser's side: whether this browser can do it, the
 * service worker that shows the notifications, and the subscribe and
 * unsubscribe calls. The server side (the VAPID keys, the device list) is
 * behind /me/push.
 */

export type PushSupport = 'ok' | 'unsupported' | 'ios_not_installed' | 'insecure'

export const SW_URL = () => withBasePath('/sw.js')
export const SW_SCOPE = () => withBasePath('/')

function isIos(): boolean {
  const ua = navigator.userAgent || ''
  return /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
  } catch {
    // no matchMedia
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/**
 * What this browser can do. iOS is checked first: Safari in a tab has no
 * PushManager at all, and "install it to the home screen" is the useful
 * answer there, not "unsupported".
 */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  if (isIos() && !isStandalone()) return 'ios_not_installed'
  if (!window.isSecureContext) return 'insecure'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ok'
}

/** Registers the push worker (idempotent) and waits until it is active.
 *  Called when the card mounts, so the later click only asks permission
 *  and subscribes, inside the user gesture Safari requires. */
export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(SW_URL(), { scope: SW_SCOPE() })
  return navigator.serviceWorker.ready
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE())
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

/** A VAPID public key as the server hands it (base64url, no padding) to the
 *  bytes `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(key: string): Uint8Array {
  const padded = key + '='.repeat((4 - (key.length % 4)) % 4)
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export class PushPermissionDenied extends Error {
  constructor() {
    super('Notifications are blocked for this app')
    this.name = 'PushPermissionDenied'
  }
}

/** Asks for permission (must run inside a user gesture) and subscribes.
 *  Returns the subscription as JSON, which is what POST /me/push/subscriptions takes. */
export async function subscribeToPush(publicKey: string): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new PushPermissionDenied()
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  })
  return sub.toJSON()
}

/** Drops the browser's subscription; returns the endpoint it had, if any. */
export async function unsubscribeFromPush(): Promise<string | null> {
  const sub = await getPushSubscription()
  if (!sub) return null
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  return endpoint
}
