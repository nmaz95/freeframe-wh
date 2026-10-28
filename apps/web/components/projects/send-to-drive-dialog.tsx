'use client'

import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import useSWR, { mutate as globalMutate } from 'swr'
import {
  AlertCircle, CheckCircle2, CloudUpload, ExternalLink, FileAudio, FileImage, FileVideo, Folder, FolderPlus, Images, Pencil, X,
  type LucideIcon,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatBytes } from '@/lib/utils'
import { withBasePath } from '@/lib/base-path'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusDot } from '@/components/shared/status-badge'
import { CopyButton } from '@/components/shared/copy-button'
import { driveFolderLink, shortDriveUrl, splitFolderName } from '@/lib/google-drive-links'
import { GOOGLE_STATUS_KEY } from '@/components/settings/google-drive-connection'
import { deliveriesKey, projectDeliveriesKey } from '@/components/projects/asset-deliveries-panel'
import { pickDriveFolder } from '@/lib/google-picker'
import { useSSE } from '@/hooks/use-sse'
import type { AssetResponse, AssetStatusDef, DriveDelivery, DriveFolder, GoogleDriveStatus, GooglePickerConfig } from '@/types'

const LAST_FOLDER_KEY = 'ff-last-drive-folder'

interface PickedFolder {
  id: string
  /** Its path below the deliveries folder, " / "-joined: "Barilla", or
   *  "Barilla / Spot" for a folder made here inside the picked one. */
  name: string
  /** The deliveries folder it sits in, for the "Consegne / Client" label. */
  root: string
  /** Only for a folder made here: the path of its parent, so a rename can
   *  rebuild `name`. */
  parentName?: string
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
  if (err && typeof err === 'object' && (err as { status?: number }).status === 429) {
    const wait = (err as { retryAfter?: number }).retryAfter
    return `Too many sends; try again in ${wait ?? 60}s`
  }
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

function fileIconFor(assetType: string): LucideIcon {
  switch (assetType) {
    case 'audio': return FileAudio
    case 'image': return FileImage
    case 'image_carousel': return Images
    default: return FileVideo
  }
}

const inFlight = (d: DriveDelivery) => d.status === 'queued' || d.status === 'uploading'

/** One link of a finished copy: name, short URL, open, copy. */
function DriveLinkRow({
  label, icon: Icon, prefix, title, href, what,
}: {
  /** Shown above the row; left out for one row of a list. */
  label?: string
  icon: LucideIcon
  prefix?: string
  title: string
  href: string
  /** "folder" / "file", for the buttons' names. */
  what: string
}) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-2xs font-medium uppercase tracking-wide text-text-tertiary">{label}</p>}
      <div className="flex items-center gap-2 rounded-md border border-border bg-bg-tertiary/40 px-3 py-2 text-sm">
        <Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
        <div className="min-w-0 flex-1">
          <p className="truncate">
            {prefix && <span className="text-text-tertiary">{prefix}</span>}
            <span className="font-medium text-text-primary">{title}</span>
          </p>
          <p className="truncate text-2xs text-text-tertiary">{shortDriveUrl(href)}</p>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${what} in Drive`}
          title={`Open ${what} in Drive`}
          className="shrink-0 rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <CopyButton text={href} label="Copy" aria-label={`Copy ${what} link`} className="shrink-0" />
      </div>
    </div>
  )
}

/** An inline one-field form: a folder's name, Enter or the button to confirm. */
function NameForm({
  icon: Icon, label, value, onChange, onSubmit, onCancel, submitLabel, busy,
}: {
  icon: LucideIcon
  label: string
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  submitLabel: string
  busy: boolean
}) {
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit() }}
    >
      <Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
      <Input aria-label={label} placeholder={label} value={value} onChange={(e) => onChange(e.target.value)} maxLength={255} autoFocus className="h-8" />
      <Button type="submit" size="sm" loading={busy} disabled={!value.trim()}>{submitLabel}</Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
    </form>
  )
}

/**
 * "Send to Google Drive": pick the client folder (the Picker, opened on the
 * deliveries folder), make a new folder inside it if needed, name the
 * file(s), send, follow the copies, and once they are there offer to move
 * the asset(s) to "Delivered". One asset or several: the same dialog.
 *
 * Not modal: the Picker is Google's iframe outside this dialog, and a modal
 * dialog would hold the page's pointer events and keep it from being clicked.
 */
export function SendToDriveDialog({
  assets,
  onOpenChange,
  statuses,
  statusFor,
  onMoveToStatus,
}: {
  /** The assets to send; empty keeps the dialog closed. All of one project. */
  assets: AssetResponse[]
  onOpenChange: (open: boolean) => void
  statuses: AssetStatusDef[]
  statusFor: (asset: AssetResponse) => AssetStatusDef | null
  /** Moves the assets without the usual confirmation: this dialog is the confirmation. */
  onMoveToStatus?: (assets: AssetResponse[], status: AssetStatusDef) => Promise<void>
}) {
  const open = assets.length > 0
  const projectId = assets[0]?.project_id ?? null
  const { data: google } = useSWR<GoogleDriveStatus>(open ? GOOGLE_STATUS_KEY : null, (k: string) => api.get<GoogleDriveStatus>(k))
  // The assets still to send: a refused one can be dropped, failed ones retried.
  const [targets, setTargets] = React.useState<AssetResponse[]>([])
  const [names, setNames] = React.useState<Record<string, string>>({})
  const [folder, setFolder] = React.useState<PickedFolder | null>(null)
  const [picking, setPicking] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [deliveryIds, setDeliveryIds] = React.useState<string[]>([])
  const [moving, setMoving] = React.useState(false)
  // Folders made in this dialog: the only ones it may rename (drive.file).
  const [createdIds, setCreatedIds] = React.useState<Set<string>>(() => new Set())
  const [newFolderOpen, setNewFolderOpen] = React.useState(false)
  const [newFolderName, setNewFolderName] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [renameName, setRenameName] = React.useState('')
  const [renaming, setRenaming] = React.useState(false)

  // Reset as the dialog opens, in the same render (see NameDialog).
  const openKey = assets.map((a) => a.id).join(',')
  const [seenKey, setSeenKey] = React.useState('')
  if (openKey !== seenKey) {
    setSeenKey(openKey)
    if (open) {
      setTargets(assets)
      setNames(Object.fromEntries(assets.map((a) => [a.id, defaultDriveFileName(a)])))
      setFolder(readLastFolder())
      setError(null)
      setDeliveryIds([])
      setSending(false)
      setMoving(false)
      setCreatedIds(new Set())
      setNewFolderOpen(false)
      setNewFolderName('')
      setRenameOpen(false)
    }
  }

  // The copies themselves, as one batch: the event stream nudges a refetch,
  // and the list polls on its own while any copy is in flight.
  const batchKey = open && projectId && deliveryIds.length > 0 ? projectDeliveriesKey(projectId, deliveryIds) : null
  const { data: deliveries, mutate: mutateDeliveries } = useSWR<DriveDelivery[]>(
    batchKey,
    (k: string) => api.get<DriveDelivery[]>(k),
    { refreshInterval: (latest) => (latest?.some(inFlight) ? 3000 : 0) },
  )
  const idSet = React.useMemo(() => new Set(deliveryIds), [deliveryIds])
  // Two uploads in parallel publish on every percent: one refetch per half second is plenty.
  const nudge = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (nudge.current) clearTimeout(nudge.current) }, [])
  useSSE(open ? projectId : null, {
    onDeliveryUpdated: (d) => {
      if (!idSet.has(d.delivery_id) || nudge.current) return
      nudge.current = setTimeout(() => { nudge.current = null; void mutateDeliveries() }, 500)
    },
  })
  const byAsset = React.useMemo(() => new Map((deliveries ?? []).map((d) => [d.asset_id, d])), [deliveries])

  const delivered = React.useMemo(() => statuses.find((s) => s.name.trim().toLowerCase() === 'delivered') ?? null, [statuses])
  const movable = React.useMemo(
    () => (delivered ? targets.filter((a) => byAsset.get(a.id)?.status === 'done' && statusFor(a)?.id !== delivered.id) : []),
    [delivered, targets, byAsset, statusFor],
  )
  const offerDelivered = !!(delivered && onMoveToStatus && movable.length > 0)

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
        setNewFolderOpen(false)
        setRenameOpen(false)
      }
    } catch (err) {
      setError(errorText(err, 'Could not open the folder picker'))
    } finally {
      setPicking(false)
    }
  }

  async function createFolder() {
    const name = newFolderName.trim()
    if (!folder || !name) return
    setCreating(true)
    setError(null)
    try {
      const created = await api.post<DriveFolder>('/integrations/google/folders', { parent_id: folder.id, name })
      const next: PickedFolder = { id: created.id, name: `${folder.name} / ${created.name}`, root: folder.root, parentName: folder.name }
      setFolder(next)
      rememberFolder(next)
      setCreatedIds((prev) => new Set(prev).add(next.id))
      setNewFolderOpen(false)
      setNewFolderName('')
    } catch (err) {
      setError(errorText(err, 'Could not create the folder'))
    } finally {
      setCreating(false)
    }
  }

  async function renameFolder() {
    const name = renameName.trim()
    if (!folder || !name) return
    setRenaming(true)
    setError(null)
    try {
      const renamed = await api.patch<DriveFolder>(`/integrations/google/folders/${folder.id}`, { name })
      const next: PickedFolder = { ...folder, name: folder.parentName ? `${folder.parentName} / ${renamed.name}` : renamed.name }
      setFolder(next)
      rememberFolder(next)
      setRenameOpen(false)
    } catch (err) {
      setError(errorText(err, 'Could not rename the folder'))
    } finally {
      setRenaming(false)
    }
  }

  async function send() {
    if (!projectId || !folder || targets.length === 0) return
    setSending(true)
    setError(null)
    try {
      const created = await api.post<DriveDelivery[]>(`/projects/${projectId}/deliveries`, {
        folder_id: folder.id,
        folder_name: folder.root ? `${folder.root} / ${folder.name}` : folder.name,
        items: targets.map((a) => ({ asset_id: a.id, file_name: (names[a.id] ?? '').trim() || undefined })),
      })
      setDeliveryIds(created.map((d) => d.id))
      for (const a of targets) void globalMutate(deliveriesKey(a.id))
    } catch (err) {
      setError(errorText(err, 'Could not start the copy'))
    } finally {
      setSending(false)
    }
  }

  async function moveToDelivered() {
    if (!delivered || !onMoveToStatus || movable.length === 0) return
    setMoving(true)
    try {
      await onMoveToStatus(movable, delivered)
      onOpenChange(false)
    } catch (err) {
      setError(errorText(err, 'Could not change the status'))
    } finally {
      setMoving(false)
    }
  }

  function retryFailed() {
    const failed = targets.filter((a) => byAsset.get(a.id)?.status === 'failed')
    if (failed.length > 0) setTargets(failed)
    setDeliveryIds([])
    setError(null)
  }

  const single = targets.length === 1 ? targets[0] : null
  const original = single?.latest_version?.files?.[0]
  const asEmail = google?.connected && google.email ? ` · as ${google.email}` : ''
  // A list shorter than the batch is one still being fetched, not a verdict.
  const phase: 'setup' | 'sending' | 'done' | 'failed' =
    deliveryIds.length === 0 ? 'setup'
      : !deliveries || deliveries.length < deliveryIds.length || deliveries.some(inFlight) ? 'sending'
        : deliveries.some((d) => d.status === 'done') ? 'done' : 'failed'
  const doneCount = (deliveries ?? []).filter((d) => d.status === 'done').length
  const failedRows = (deliveries ?? []).filter((d) => d.status === 'failed')
  const first = deliveries?.[0]
  const canSend = !!folder && targets.length > 0 && targets.every((a) => (names[a.id] ?? '').trim().length > 0)
  const canRename = !!folder && createdIds.has(folder.id)
  const leaf = folder?.name.split(' / ').pop() ?? ''

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

          {open && phase === 'setup' && (
            <>
              <Dialog.Title className="text-sm font-semibold text-text-primary">Send to Google Drive</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-tertiary">
                {single ? (
                  <>
                    {single.name}
                    {single.latest_version ? ` · v${single.latest_version.version_number}` : ''}
                    {original ? ` · original${original.file_size_bytes ? ` (${formatBytes(original.file_size_bytes)})` : ''}` : ''}
                  </>
                ) : (
                  `${targets.length} assets · the originals`
                )}
                {asEmail}
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
                      {canRename && !renameOpen && (
                        <button
                          type="button"
                          onClick={() => { setRenameName(leaf); setRenameOpen(true); setNewFolderOpen(false) }}
                          disabled={picking || sending || creating}
                          aria-label="Rename folder"
                          title="Rename this folder"
                          className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button type="button" onClick={chooseFolder} disabled={picking || sending || creating || renaming} className="text-xs text-accent hover:underline disabled:opacity-50">
                        {picking ? 'Opening…' : folder ? 'Change' : 'Choose folder'}
                      </button>
                    </div>
                    {renameOpen && folder ? (
                      <NameForm
                        icon={Pencil}
                        label="Folder name"
                        value={renameName}
                        onChange={setRenameName}
                        onSubmit={renameFolder}
                        onCancel={() => setRenameOpen(false)}
                        submitLabel="Rename"
                        busy={renaming}
                      />
                    ) : newFolderOpen && folder ? (
                      <NameForm
                        icon={FolderPlus}
                        label="New folder name"
                        value={newFolderName}
                        onChange={setNewFolderName}
                        onSubmit={createFolder}
                        onCancel={() => setNewFolderOpen(false)}
                        submitLabel="Create"
                        busy={creating}
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setNewFolderOpen(true)}
                          disabled={!folder || picking || sending}
                          className="inline-flex items-center gap-1 text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                        >
                          <FolderPlus className="h-3.5 w-3.5" />
                          New folder{folder ? ` inside ${leaf}` : ''}
                        </button>
                        {!folder && <span className="text-text-tertiary">· choose the parent folder first</span>}
                      </div>
                    )}
                  </div>

                  {single ? (
                    <div className="space-y-1.5">
                      <label htmlFor="drive-file-name" className="text-2xs font-medium uppercase tracking-wide text-text-tertiary">File name on Drive</label>
                      <Input
                        id="drive-file-name"
                        value={names[single.id] ?? ''}
                        onChange={(e) => setNames((prev) => ({ ...prev, [single.id]: e.target.value }))}
                        maxLength={500}
                      />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-2xs font-medium uppercase tracking-wide text-text-tertiary">File names on Drive</p>
                      <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                        {targets.map((a) => (
                          <li key={a.id} className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <Input
                                aria-label={`File name on Drive for ${a.name}`}
                                value={names[a.id] ?? ''}
                                onChange={(e) => setNames((prev) => ({ ...prev, [a.id]: e.target.value }))}
                                maxLength={500}
                                className="h-8"
                              />
                              <button
                                type="button"
                                onClick={() => setTargets((prev) => prev.filter((t) => t.id !== a.id))}
                                disabled={targets.length === 1 || sending}
                                aria-label={`Remove ${a.name}`}
                                title="Leave this asset out"
                                className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {a.latest_version && a.latest_version.processing_status !== 'ready' && (
                              <p className="text-2xs text-status-warning">{a.name}: latest version isn&apos;t ready yet, the newest ready one goes, or this asset is refused.</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {error && <p role="alert" className="text-xs text-status-error">{error}</p>}
                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button type="button" size="sm" onClick={send} loading={sending} disabled={!canSend}>
                      <CloudUpload className="h-3.5 w-3.5" />
                      {single ? 'Send' : `Send ${targets.length} files`}
                    </Button>
                  </div>
                </div>
              )}
              {!google && <p className="mt-4 text-xs text-text-tertiary">Checking your Google account…</p>}
            </>
          )}

          {open && phase === 'sending' && (
            <>
              <Dialog.Title className="text-sm font-semibold text-text-primary">Sending to Google Drive…</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-tertiary">
                {single ? `${first?.file_name ?? names[single.id]} → ` : `${targets.length} files → `}
                {first?.folder_name ?? (folder ? `${folder.root ? `${folder.root} / ` : ''}${folder.name}` : '')}
              </Dialog.Description>
              <ul className="mt-4 max-h-64 space-y-3 overflow-y-auto pr-1">
                {targets.map((a) => {
                  const d = byAsset.get(a.id)
                  const pct = d?.progress_percent ?? 0
                  const state = d?.status === 'done' ? 'Done' : d?.status === 'failed' ? 'Failed' : d?.status === 'uploading' ? `${pct}%` : 'Queued'
                  return (
                    <li key={a.id}>
                      {!single && (
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-text-primary">{d?.file_name ?? names[a.id]}</span>
                          <span className="shrink-0 text-text-tertiary">{state}</span>
                        </div>
                      )}
                      <div className="h-1.5 w-full overflow-hidden rounded bg-bg-tertiary" role="progressbar" aria-valuenow={d?.status === 'done' ? 100 : pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Copy progress: ${d?.file_name ?? names[a.id]}`}>
                        <div className={`h-full transition-[width] ${d?.status === 'failed' ? 'bg-status-error' : 'bg-accent'}`} style={{ width: `${d?.status === 'done' ? 100 : pct}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-xs text-text-tertiary">
                {single ? (first?.status === 'uploading' ? `${first.progress_percent}%` : 'Queued') : `${doneCount} of ${targets.length} done`}
                {' '}· the copies run on the server: you can close this window, we&apos;ll notify you when they&apos;re done.
              </p>
              <div className="mt-4 flex justify-end">
                <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
              </div>
            </>
          )}

          {open && phase === 'done' && (
            <>
              <Dialog.Title className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <CheckCircle2 className="h-4 w-4 text-status-success" />
                {failedRows.length === 0 ? 'Delivered to Google Drive' : `${doneCount} of ${targets.length} delivered`}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-tertiary">
                {single ? `${first?.file_name} is now in ${first?.folder_name}` : `${doneCount} file${doneCount === 1 ? '' : 's'} now in ${first?.folder_name}`}
                {asEmail}
              </Dialog.Description>
              {first && (
                <div className="mt-4 space-y-3">
                  <DriveLinkRow
                    label="Folder"
                    icon={Folder}
                    what="folder"
                    href={driveFolderLink(first.folder_id)}
                    {...splitFolderName(first.folder_name)}
                  />
                  {single ? (
                    first.web_view_link && (
                      <DriveLinkRow label="File" icon={fileIconFor(single.asset_type)} what="file" href={first.web_view_link} title={first.file_name} />
                    )
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-2xs font-medium uppercase tracking-wide text-text-tertiary">Files</p>
                      <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                        {targets.map((a) => {
                          const d = byAsset.get(a.id)
                          if (!d) return null
                          return (
                            <li key={a.id}>
                              {d.status === 'done' && d.web_view_link ? (
                                <DriveLinkRow icon={fileIconFor(a.asset_type)} what={`file ${d.file_name}`} href={d.web_view_link} title={d.file_name} />
                              ) : d.status === 'failed' ? (
                                <p className="flex items-center gap-2 rounded-md border border-status-error/40 px-3 py-2 text-xs text-status-error">
                                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate"><span className="font-medium">{d.file_name}</span> · {d.error ?? 'failed'}</span>
                                </p>
                              ) : (
                                <p className="truncate px-3 py-2 text-xs text-text-tertiary">{d.file_name}</p>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {offerDelivered && delivered ? (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-sm text-text-primary">
                    Also move {movable.length === 1 ? 'this asset' : `these ${movable.length} assets`} to <StatusDot color={delivered.color} /> <span className="font-medium">{delivered.name}</span>?
                  </p>
                  <p className="mt-0.5 text-xs text-text-tertiary">The people that status notifies will be told.</p>
                  {error && <p role="alert" className="mt-2 text-xs text-status-error">{error}</p>}
                  <div className="mt-3 flex justify-end gap-2">
                    {failedRows.length > 0 && (
                      <Button type="button" variant="ghost" size="sm" onClick={retryFailed}>Try the failed ones again</Button>
                    )}
                    <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Not now</Button>
                    <Button type="button" size="sm" onClick={moveToDelivered} loading={moving}>Change status</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex justify-end gap-2">
                  {failedRows.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={retryFailed}>Try the failed ones again</Button>
                  )}
                  <Button type="button" size="sm" onClick={() => onOpenChange(false)}>Done</Button>
                </div>
              )}
            </>
          )}

          {open && phase === 'failed' && (
            <>
              <Dialog.Title className="text-sm font-semibold text-status-error">
                {single ? 'The copy to Google Drive failed' : 'The copies to Google Drive failed'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-tertiary">
                {single ? (first?.error ?? 'Something went wrong.') : `${failedRows.length} file${failedRows.length === 1 ? '' : 's'} could not be copied.`}
              </Dialog.Description>
              {!single && (
                <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs text-status-error">
                  {failedRows.map((d) => <li key={d.id} className="truncate"><span className="font-medium">{d.file_name}</span> · {d.error ?? 'failed'}</li>)}
                </ul>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
                <Button type="button" size="sm" onClick={retryFailed}>
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
