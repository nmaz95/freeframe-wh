'use client'

import * as React from 'react'
import useSWR from 'swr'
import { BellRing } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  PushPermissionDenied,
  getPushSubscription,
  pushSupport,
  registerPushServiceWorker,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSupport,
} from '@/lib/push'
import type { PushStatus, PushSubscriptionInfo } from '@/types'

export const PUSH_STATUS_KEY = '/me/push'

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * Settings → Profile: push notifications on this device. Push mirrors the
 * in-app notifications and follows the choices under Settings → Notifications
 * (All Off silences a type); this card only decides whether this browser is
 * one of the devices they go to.
 *
 * The worker is registered on mount, so the click does nothing but ask for
 * permission and subscribe, inside the user gesture Safari requires. A local
 * subscription the server no longer lists (a row a dead push removed, a
 * re-login) is sent again on its own.
 */
export function PushNotificationsCard() {
  const { data, error, mutate } = useSWR<PushStatus>(PUSH_STATUS_KEY, (k: string) => api.get<PushStatus>(k))
  const [support, setSupport] = React.useState<PushSupport | null>(null)
  const [permission, setPermission] = React.useState<NotificationPermission | null>(null)
  const [localEndpoint, setLocalEndpoint] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const s = pushSupport()
    // Reading the browser's state in an effect: it is an external system
    // (permission, the worker, the subscription), not React state.
    const apply = (next: { support: PushSupport; permission: NotificationPermission | null; endpoint: string | null }) => {
      if (cancelled) return
      setSupport(next.support)
      setPermission(next.permission)
      setLocalEndpoint(next.endpoint)
    }
    if (s !== 'ok') {
      apply({ support: s, permission: null, endpoint: null })
      return
    }
    ;(async () => {
      try {
        await registerPushServiceWorker()
        const sub = await getPushSubscription()
        apply({ support: 'ok', permission: Notification.permission, endpoint: sub?.endpoint ?? null })
      } catch {
        apply({ support: 'unsupported', permission: null, endpoint: null })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const serverRow: PushSubscriptionInfo | undefined = React.useMemo(
    () => (localEndpoint ? data?.subscriptions.find((s) => s.endpoint === localEndpoint) : undefined),
    [data, localEndpoint],
  )

  // A browser subscription the server does not know: re-register it quietly.
  React.useEffect(() => {
    if (!data?.enabled || !localEndpoint || serverRow || busy) return
    let cancelled = false
    ;(async () => {
      try {
        const sub = await getPushSubscription()
        if (!sub || cancelled) return
        await api.post('/me/push/subscriptions', sub.toJSON())
        if (!cancelled) await mutate()
      } catch {
        // the card still offers Enable; nothing to tell the user yet
      }
    })()
    return () => {
      cancelled = true
    }
  }, [data?.enabled, localEndpoint, serverRow, busy, mutate])

  async function enable() {
    if (!data?.public_key) return
    setBusy(true)
    setMessage(null)
    try {
      const json = await subscribeToPush(data.public_key)
      try {
        await api.post('/me/push/subscriptions', json)
      } catch (err) {
        // Do not leave the device half-enabled: the browser is subscribed but
        // the server would never push to it.
        try {
          await unsubscribeFromPush()
        } catch {
          // the server's refusal is the error worth showing
        }
        throw err
      }
      setLocalEndpoint(json.endpoint ?? null)
      setPermission('granted')
      await mutate()
      setMessage({ kind: 'ok', text: 'Push notifications are on for this device.' })
    } catch (err) {
      if (err instanceof PushPermissionDenied) setPermission('denied')
      else setMessage({ kind: 'error', text: errorText(err, 'Could not turn push notifications on') })
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setMessage(null)
    try {
      const id = serverRow?.id
      await unsubscribeFromPush()
      if (id) await api.delete(`/me/push/subscriptions/${id}`)
      setLocalEndpoint(null)
      await mutate()
      setMessage({ kind: 'ok', text: 'Push notifications are off for this device.' })
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err, 'Could not turn push notifications off') })
    } finally {
      setBusy(false)
    }
  }

  const deviceCount = data?.subscriptions.length ?? 0

  return (
    <section className="space-y-4" data-testid="push-card">
      <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">Push notifications</h2>
      <p className="text-xs text-text-tertiary">
        The same notifications as the bell, on this device even while the app is closed. They follow
        your choices under Settings → Notifications: a type set to All Off is never pushed.
      </p>
      {error && <p role="alert" className="text-xs text-status-error">Could not load the push status.</p>}
      {data && !data.enabled && (
        <p className="text-xs text-text-tertiary">
          Not available: an admin has to set the push keys for this instance first.
        </p>
      )}
      {data?.enabled && support === 'ios_not_installed' && (
        <p className="text-xs text-text-tertiary">
          On iPhone and iPad, push works only from the installed app: in Safari use Share → Add to
          Home Screen, open the app from there, and come back here.
        </p>
      )}
      {data?.enabled && support === 'insecure' && (
        <p className="text-xs text-text-tertiary">Push needs the app to be served over HTTPS.</p>
      )}
      {data?.enabled && support === 'unsupported' && (
        <p className="text-xs text-text-tertiary">This browser does not support push notifications.</p>
      )}
      {data?.enabled && support === 'ok' && permission === 'denied' && (
        <p className="text-xs text-text-tertiary">
          Notifications are blocked for this app. Allow them in the browser&apos;s site settings (on
          iPhone: Settings → Notifications → the app), then come back here.
        </p>
      )}
      {data?.enabled && support === 'ok' && permission !== 'denied' && serverRow && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-tertiary/40 px-3 py-2.5">
          <BellRing className="h-4 w-4 shrink-0 text-status-success" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-primary">On for this device</p>
            <p className="text-2xs text-text-tertiary">
              {serverRow.last_used_at ? `Last push ${new Date(serverRow.last_used_at).toLocaleString()}` : 'No push yet'}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={disable} loading={busy}>
            Turn off
          </Button>
        </div>
      )}
      {data?.enabled && support === 'ok' && permission !== 'denied' && !serverRow && (
        <Button size="sm" onClick={enable} loading={busy} disabled={!data.public_key}>
          <BellRing className="h-3.5 w-3.5" />
          Turn on for this device
        </Button>
      )}
      {data?.enabled && deviceCount > 0 && (
        <p className="text-2xs text-text-tertiary">
          On for {deviceCount} device{deviceCount === 1 ? '' : 's'}.
        </p>
      )}
      {message && (
        <p role={message.kind === 'error' ? 'alert' : undefined} className={message.kind === 'error' ? 'text-xs text-status-error' : 'text-xs text-status-success'}>
          {message.text}
        </p>
      )}
    </section>
  )
}
