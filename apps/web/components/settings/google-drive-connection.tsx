'use client'

import * as React from 'react'
import useSWR from 'swr'
import { useSearchParams } from 'next/navigation'
import { CloudUpload } from 'lucide-react'
import { api } from '@/lib/api'
import { redirectTo } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { GoogleDriveStatus } from '@/types'

export const GOOGLE_STATUS_KEY = '/integrations/google'

const RETURN_REASONS: Record<string, string> = {
  denied: 'Google sign-in was cancelled.',
  state: 'The sign-in link had expired. Try again.',
  no_refresh_token: 'Google did not hand over an offline token. Try again and approve every permission.',
  google: 'Google refused the sign-in. Try again.',
  user: 'This account cannot connect Google Drive.',
  not_configured: 'Google Drive is not configured on this instance.',
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** Settings → Profile: the user's Google account for "Send to Google Drive". */
export function GoogleDriveConnection() {
  const searchParams = useSearchParams()
  const { data, error, mutate } = useSWR<GoogleDriveStatus>(GOOGLE_STATUS_KEY, (k: string) => api.get<GoogleDriveStatus>(k))
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false)

  // Back from Google: say how it went and drop the query from the URL.
  React.useEffect(() => {
    const result = searchParams.get('google')
    if (!result) return
    if (result === 'connected') setMessage({ kind: 'ok', text: 'Google Drive connected.' })
    else setMessage({ kind: 'error', text: RETURN_REASONS[searchParams.get('reason') ?? ''] ?? 'Could not connect Google Drive.' })
    void mutate()
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('google')
      url.searchParams.delete('reason')
      window.history.replaceState(window.history.state, '', url.toString())
    } catch {
      // leave the URL as it is
    }
  }, [searchParams, mutate])

  async function connect() {
    setBusy(true)
    setMessage(null)
    try {
      const { url } = await api.post<{ url: string }>('/integrations/google/authorize')
      redirectTo(url)
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err, 'Could not start the Google sign-in') })
      setBusy(false)
    }
  }

  async function disconnect() {
    await api.delete('/integrations/google')
    await mutate()
    setMessage({ kind: 'ok', text: 'Google Drive disconnected.' })
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">Google Drive</h2>
      <p className="text-xs text-text-tertiary">
        Send finished assets straight to a Drive folder, as yourself. FreeFrame only gets access to
        the folders you pick and the files it creates there.
      </p>
      {error && <p role="alert" className="text-xs text-status-error">Could not load the Google Drive status.</p>}
      {data && !data.enabled && (
        <p className="text-xs text-text-tertiary">
          Not available: an admin has to configure the Google keys for this instance first.
        </p>
      )}
      {data?.enabled && !data.connected && (
        <Button size="sm" onClick={connect} loading={busy}>
          <CloudUpload className="h-3.5 w-3.5" />
          Connect Google Drive
        </Button>
      )}
      {data?.enabled && data.connected && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-tertiary/40 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-text-primary">{data.email}</p>
            <p className="text-2xs text-text-tertiary">
              Connected{data.connected_at ? ` · ${new Date(data.connected_at).toLocaleDateString()}` : ''}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setConfirmDisconnect(true)}>
            Disconnect
          </Button>
        </div>
      )}
      {message && (
        <p role={message.kind === 'error' ? 'alert' : undefined} className={message.kind === 'error' ? 'text-xs text-status-error' : 'text-xs text-status-success'}>
          {message.text}
        </p>
      )}
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Google Drive?"
        description="Deliveries already made stay on Drive. You can connect again at any time."
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={disconnect}
      />
    </section>
  )
}
