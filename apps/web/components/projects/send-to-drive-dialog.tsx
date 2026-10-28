'use client'

import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import useSWR, { mutate as globalMutate } from 'swr'
import { CheckCircle2, CloudUpload, ExternalLink, Folder, X } from 'lucide-react'
import { api } from '@/lib/api'
import { formatBytes } from '@/lib/utils'
import { withBasePath } from '@/lib/base-path'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusDot } from '@/components/shared/status-badge'
import { GOOGLE_STATUS_KEY } from '@/components/settings/google-drive-connection'
import { deliveriesKey } from '@/components/projects/asset-deliveries-panel'
import { pickDriveFolder } from '@/lib/google-picker'
import { useSSE } from '@/hooks/use-sse'
import type { AssetResponse, AssetStatusDef, DriveDelivery, GoogleDriveStatus, GooglePickerConfig } from '@/types'

const LAST_FOLDER_KEY = 'ff-last-drive-folder'

interface PickedFolder {
  id: string
  name: string
  /** The deliveries folder it sits in, for the "Consegne / Client" label. */
  root: string
}

function readLastFolder(): PickedFolder | null {
  try {
    const raw = localStorage.getItem(LAST_FOLDER_KEY)
    return raw ? (JSON.parse(raw) as PickedFolder) : null
  } catch {
    return null
  }
}

function rememberFolder(folder: PickedFolder) {
  try {
    localStorage.setItem(LAST_FOLDER_KEY, JSON.stringify(folder))
  } catch {
    // no storage: ask next time
  }
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** "Spot 30s v3.mov": the asset's name, its version, the original's extension. */
export function defaultDriveFileName(asset: AssetResponse): string {
  const version = asset.latest_version?.version_number
  const original = asset.latest_version?.files?.[0]?.original_filename ?? ''
  const ext = original.includes('.') ? original.slice(original.lastIndexOf('.')) : ''
  const stem = version ? `${asset.name} v${version}` : asset.name
  return stem.toLowerCase().endsWith(ext.toLowerCase()) ? stem : `${stem}${ext}`
}

/**
 * "Send to Google Drive": pick the client folder (the Picker, opened on the
 * deliveries folder), name the file, send, follow the copy, and once it is
 * there offer to move the asset to "Delivered".
 *
 * Not modal: the Picker is Google's iframe outside this dialog, and a modal
 * dialog would hold the page's pointer events and keep it from being clicked.
 */
export function SendToDriveDialog({
  asset,
  onOpenChange,
  statuses,
  statusFor,
  onMoveToStatus,
}: {
  asset: AssetResponse | null
  onOpenChange: (open: boolean) => void
  statuses: AssetStatusDef[]
  statusFor: (asset: AssetResponse) => AssetStatusDef | null
  /** Moves the asset without the usual confirmation: this dialog is the confirmation. */
  onMoveToStatus?: (asset: AssetResponse, status: AssetStatusDef) => Promise<void>
}) {
  const open = asset !== null
  const { data: google } = useSWR<GoogleDriveStatus>(open ? GOOGLE_STATUS_KEY : null, (k: string) => api.get<GoogleDriveStatus>(k))
  const [folder, setFolder] = React.useState<PickedFolder | null>(null)
  const [fileName, setFileName] = React.useState('')
  const [picking, setPicking] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [deliveryId, setDeliveryId] = React.useState<string | null>(null)
  const [moving, setMoving] = React.useState(false)

  // Reset as the dialog opens, in the same render (see NameDialog).
  const [wasOpen, setWasOpen] = React.useState(open)
  const [openedFor, setOpenedFor] = React.useState<string | null>(null)
  if (open !== wasOpen || (asset && asset.id !== openedFor)) {
    setWasOpen(open)
    setOpenedFor(asset?.id ?? null)
    if (asset) {
      setFolder(readLastFolder())
      setFileName(defaultDriveFileName(asset))
      setError(null)
      setDeliveryId(null)
      setSending(false)
      setMoving(false)
    }
  }

  // The copy itself, from the asset's delivery list: the event stream nudges a
  // refetch, and the list polls on its own while a copy is in flight.
  const listKey = asset ? deliveriesKey(asset.id) : null
  const { data: deliveries, mutate: mutateDeliveries } = useSWR<DriveDelivery[]>(
    deliveryId && listKey ? listKey : null,
    (k: string) => api.get<DriveDelivery[]>(k),
    { refreshInterval: (latest) => (latest?.some((d) => d.id === deliveryId && (d.status === 'queued' || d.status === 'uploading')) ? 3000 : 0) },
  )
  const delivery = deliveries?.find((d) => d.id === deliveryId) ?? null
  useSSE(open ? asset?.project_id : null, {
    onDeliveryUpdated: (d) => { if (d.delivery_id === deliveryId) void mutateDeliveries() },
  })

  const delivered = React.useMemo(() => statuses.find((s) => s.name.trim().toLowerCase() === 'delivered') ?? null, [statuses])
  const offerDelivered = !!(asset && delivered && onMoveToStatus && statusFor(asset)?.id !== delivered.id)

  async function chooseFolder() {
    setPicking(true)
    setError(null)
    try {
      const cfg = await api.get<GooglePickerConfig>('/integrations/google/picker')
      const picked = await pickDriveFolder({
        accessToken: cfg.access_token,
        apiKey: cfg.api_key,
        appId: cfg.app_id,
        parentId: cfg.root_folder_id,
        title: `Choose the client folder in ${cfg.root_folder_name ?? 'the deliveries folder'}`,
      })
      if (picked) {
        const next = { id: picked.id, name: picked.name, root: cfg.root_folder_name ?? '' }
        setFolder(next)
        rememberFolder(next)
      }
    } catch (err) {
      setError(errorText(err, 'Could not open the folder picker'))
    } finally {
      setPicking(false)
    }
  }

  async function send() {
    if (!asset || !folder) return
    setSending(true)
    setError(null)
    try {
      const created = await api.post<DriveDelivery>(`/assets/${asset.id}/deliveries`, {
        folder_id: folder.id,
        folder_name: folder.root ? `${folder.root} / ${folder.name}` : folder.name,
        file_name: fileName.trim() || undefined,
      })
      setDeliveryId(created.id)
      void globalMutate(deliveriesKey(asset.id))
    } catch (err) {
      setError(errorText(err, 'Could not start the copy'))
    } finally {
      setSending(false)
    }
  }

  async function moveToDelivered() {
    if (!asset || !delivered || !onMoveToStatus) return
    setMoving(true)
    try {
      await onMoveToStatus(asset, delivered)
      onOpenChange(false)
    } catch (err) {
      setError(errorText(err, 'Could not change the status'))
    } finally {
      setMoving(false)
    }
  }

  const original = asset?.latest_version?.files?.[0]
  const phase: 'setup' | 'sending' | 'done' | 'failed' =
    !deliveryId ? 'setup' : delivery?.status === 'done' ? 'done' : delivery?.status === 'failed' ? 'failed' : 'sending'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal>
        {open && <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm pointer-events-none" />}
        <Dialog.Content
          data-testid="send-to-drive-dialog"
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-5 shadow-xl"
          // The Picker lives outside this dialog: a click on it must not close us.
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <Dialog.Close className="absolute right-3 top-3 text-text-tertiary hover:text-text-primary transition-colors" aria-label="Close">
            <X className="h-4 w-4" />
          </Dialog.Close>

          {asset && phase === 'setup' && (
            <>
              <Dialog.Title className="text-sm font-semibold text-text-primary">Send to Google Drive</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-tertiary">
                {asset.name}
                {asset.latest_version ? ` · v${asset.latest_version.version_number}` : ''}
                {original ? ` · original${original.file_size_bytes ? ` (${formatBytes(original.file_size_bytes)})` : ''}` : ''}
                {google?.connected && google.email ? ` · as ${google.email}` : ''}
              </Dialog.Description>

              {google && !google.enabled && (
                <p className="mt-4 text-xs text-status-warning">Google Drive is not configured on this instance yet. Ask an admin.</p>
              )}
              {google?.enabled && !google.connected && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-status-warning">Your Google account isn&apos;t connected yet.</p>
                  <Button size="sm" asChild>
                    <a href={withBasePath('/settings/profile')}>Connect Google Drive</a>
                  </Button>
                </div>
              )}
              {google?.enabled && google.connected && (
                <div className="mt-4 space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-2xs font-medium uppercase tracking-wide text-text-tertiary">Destination folder</p>
                    <div className="flex items-center gap-2 rounded-md border border-border bg-bg-tertiary/40 px-3 py-2 text-sm">
                      <Folder className="h-4 w-4 shrink-0 text-text-tertiary" />
                      {folder ? (
                        <span className="min-w-0 flex-1 truncate">
                          {folder.root && <span className="text-text-tertiary">{folder.root} / </span>}
                          <span className="font-medium text-text-primary">{folder.name}</span>
                        </span>
                      ) : (
                        <span className="flex-1 text-text-tertiary">No folder chosen</span>
                      )}
                      <button type="button" onClick={chooseFolder} disabled={picking || sending} className="text-xs text-accent hover:underline disabled:opacity-50">
                        {picking ? 'Opening…' : folder ? 'Change' : 'Choose folder'}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="drive-file-name" className="text-2xs font-medium uppercase tracking-wide text-text-tertiary">File name on Drive</label>
                    <Input id="drive-file-name" value={fileName} onChange={(e) => setFileName(e.target.value)} maxLength={500} />
                  </div>
                  {error && <p role="alert" className="text-xs text-status-error">{error}</p>}
                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button type="button" size="sm" onClick={send} loading={sending} disabled={!folder || !fileName.trim()}>
                      <CloudUpload className="h-3.5 w-3.5" />
                      Send
                    </Button>
                  </div>
                </div>
              )}
              {!google && <p className="mt-4 text-xs text-text-tertiary">Checking your Google account…</p>}
            </>
          )}

          {asset && phase === 'sending' && (
            <>
              <Dialog.Title className="text-sm font-semibold text-text-primary">Sending to Google Drive…</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-tertiary">
                {delivery?.file_name ?? fileName} → {delivery?.folder_name ?? folder?.name}
              </Dialog.Description>
              <div className="mt-4 h-1.5 w-full overflow-hidden rounded bg-bg-tertiary" role="progressbar" aria-valuenow={delivery?.progress_percent ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Copy progress">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${delivery?.progress_percent ?? 0}%` }} />
              </div>
              <p className="mt-2 text-xs text-text-tertiary">
                {delivery?.status === 'uploading' ? `${delivery.progress_percent}%` : 'Queued'} · the copy runs on the server: you can close this window, we&apos;ll notify you when it&apos;s done.
              </p>
              <div className="mt-4 flex justify-end">
                <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
              </div>
            </>
          )}

          {asset && phase === 'done' && (
            <>
              <Dialog.Title className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <CheckCircle2 className="h-4 w-4 text-status-success" /> Delivered to Google Drive
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-tertiary">
                {delivery?.file_name} is now in {delivery?.folder_name}
              </Dialog.Description>
              {delivery?.web_view_link && (
                <a href={delivery.web_view_link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-text-primary hover:border-border-focus">
                  <ExternalLink className="h-3.5 w-3.5" /> Open in Drive
                </a>
              )}
              {offerDelivered && delivered ? (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-sm text-text-primary">
                    Also move this asset to <StatusDot color={delivered.color} /> <span className="font-medium">{delivered.name}</span>?
                  </p>
                  <p className="mt-0.5 text-xs text-text-tertiary">The people that status notifies will be told.</p>
                  {error && <p role="alert" className="mt-2 text-xs text-status-error">{error}</p>}
                  <div className="mt-3 flex justify-end gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Not now</Button>
                    <Button type="button" size="sm" onClick={moveToDelivered} loading={moving}>Change status</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex justify-end">
                  <Button type="button" size="sm" onClick={() => onOpenChange(false)}>Done</Button>
                </div>
              )}
            </>
          )}

          {asset && phase === 'failed' && (
            <>
              <Dialog.Title className="text-sm font-semibold text-status-error">The copy to Google Drive failed</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-tertiary">{delivery?.error ?? 'Something went wrong.'}</Dialog.Description>
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
                <Button type="button" size="sm" onClick={() => { setDeliveryId(null); setError(null) }}>
                  Try again
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
