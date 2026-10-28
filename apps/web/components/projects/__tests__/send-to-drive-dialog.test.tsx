/**
 * "Send to Google Drive": the folder comes from the Picker opened on the
 * deliveries folder (or is made inside the picked one, and can be renamed),
 * the copies are followed as one batch, and a finished copy shows the folder
 * and file links, each with Copy, and offers to move the asset(s) to
 * "Delivered". One asset or several: the same dialog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { AssetResponse, AssetStatusDef, DriveDelivery, GoogleDriveStatus } from '@/types'

const h = vi.hoisted(() => ({
  google: { enabled: true, connected: true, email: 'me@example.com', connected_at: null } as GoogleDriveStatus,
  deliveries: [] as DriveDelivery[],
}))
vi.mock('swr', () => ({
  default: (key: string | null) => ({
    data: key === '/integrations/google' ? h.google : key?.includes('/deliveries?ids=') ? h.deliveries : undefined,
    mutate: vi.fn(),
  }),
  mutate: vi.fn(),
}))
const get = vi.fn()
const post = vi.fn()
const patch = vi.fn()
vi.mock('@/lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a) } }))
const pick = vi.fn()
vi.mock('@/lib/google-picker', () => ({ pickDriveFolder: (...a: unknown[]) => pick(...a) }))
vi.mock('@/hooks/use-sse', () => ({ useSSE: () => ({ isConnected: false, lastEvent: null }) }))
const copied = vi.fn()
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<typeof import('@/lib/utils')>()), copyToClipboard: (t: string) => copied(t) }))

import { SendToDriveDialog, defaultDriveFileName } from '../send-to-drive-dialog'

class FakeApiError extends Error {
  status: number
  retryAfter?: number
  constructor(status: number, detail: string, retryAfter?: number) { super(detail); this.status = status; this.retryAfter = retryAfter }
}

const asset = {
  id: 'a1', project_id: 'p1', name: 'Spot 30s', description: null, asset_type: 'video', status: 'draft', status_id: 's0',
  rating: null, assignee_id: null, folder_id: null, due_date: null, keywords: [], created_by: 'u1',
  created_at: '', updated_at: '', deleted_at: null, thumbnail_url: null,
  latest_version: {
    id: 'v3', asset_id: 'a1', version_number: 3, processing_status: 'ready', created_by: 'u1', created_at: '', deleted_at: null,
    files: [{ id: 'f', version_id: 'v3', file_type: 'video', original_filename: 'spot_final.mov', mime_type: 'video/quicktime', file_size_bytes: 1800, s3_key_raw: 'raw/x', s3_key_processed: null, s3_key_thumbnail: null, width: null, height: null, duration_seconds: null, fps: null, sequence_order: null }],
  },
} as unknown as AssetResponse

const clipB = {
  ...asset, id: 'a2', name: 'Clip B',
  latest_version: { ...asset.latest_version, id: 'v1', asset_id: 'a2', version_number: 1, files: [{ ...asset.latest_version!.files![0], id: 'f2', version_id: 'v1', original_filename: 'clip_b.mp4' }] },
} as unknown as AssetResponse

function deliveryOf(a: AssetResponse, id: string, extra: Partial<DriveDelivery> = {}): DriveDelivery {
  return {
    id, asset_id: a.id, version_id: a.latest_version!.id, version_number: a.latest_version!.version_number, user_id: 'u1', user_name: 'Me',
    folder_id: 'f-barilla', folder_name: 'Consegne / Barilla', file_name: defaultDriveFileName(a), status: 'queued', progress_percent: 0,
    drive_file_id: null, web_view_link: null, error: null, created_at: '', updated_at: null, ...extra,
  }
}

const noStatus = { id: 's0', name: 'No Status', color: '#888', position: 0, is_default: true, notify_creator: true, notify_assignee: false, notify_role_ids: [], legacy_key: 'draft' } as AssetStatusDef
const delivered = { ...noStatus, id: 's9', name: 'Delivered', color: '#22c55e', is_default: false, legacy_key: null } as AssetStatusDef

function renderDialog(statuses: AssetStatusDef[] = [noStatus, delivered], onMoveToStatus = vi.fn().mockResolvedValue(undefined), assets: AssetResponse[] = [asset]) {
  const onOpenChange = vi.fn()
  const element = () => <SendToDriveDialog assets={assets} onOpenChange={onOpenChange} statuses={statuses} statusFor={() => noStatus} onMoveToStatus={onMoveToStatus} />
  const { rerender } = render(element())
  // The SWR mock reads `h.deliveries` on each render: a fresh element forces one.
  const refresh = () => rerender(element())
  return { onOpenChange, onMoveToStatus, refresh }
}

describe('defaultDriveFileName', () => {
  it('names the file after the asset, its version and the original extension', () => {
    expect(defaultDriveFileName(asset)).toBe('Spot 30s v3.mov')
  })
})

describe('SendToDriveDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    h.google = { enabled: true, connected: true, email: 'me@example.com', connected_at: null }
    h.deliveries = []
    get.mockResolvedValue({ access_token: 'at', expires_in: 100, api_key: 'k', app_id: '1', root_folder_id: 'root-1', root_folder_name: 'Consegne' })
    pick.mockResolvedValue({ id: 'f-barilla', name: 'Barilla' })
    post.mockResolvedValue([{ id: 'd1', status: 'queued' }])
  })

  it('opens the picker on the deliveries folder and sends to the picked client folder', async () => {
    renderDialog()
    expect(screen.getByLabelText('File name on Drive')).toHaveValue('Spot 30s v3.mov')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

    fireEvent.click(screen.getByText('Choose folder'))
    await waitFor(() => expect(pick).toHaveBeenCalled())
    expect(pick.mock.calls[0][0]).toMatchObject({ accessToken: 'at', apiKey: 'k', appId: '1', parentId: 'root-1' })
    await screen.findByText('Barilla')
    expect(screen.getByText('Consegne /')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('File name on Drive'), { target: { value: 'Spot FINAL v3.mov' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/projects/p1/deliveries', {
        folder_id: 'f-barilla', folder_name: 'Consegne / Barilla', items: [{ asset_id: 'a1', file_name: 'Spot FINAL v3.mov' }],
      }),
    )
    expect(JSON.parse(localStorage.getItem('ff-last-drive-folder')!)).toMatchObject({ id: 'f-barilla', name: 'Barilla' })
  })

  it('shows the copy under way, then the link and the Delivered offer', async () => {
    const { onMoveToStatus, onOpenChange, refresh } = renderDialog()
    fireEvent.click(screen.getByText('Choose folder'))
    await screen.findByText('Barilla')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(post).toHaveBeenCalled())

    h.deliveries = [{ id: 'd1', asset_id: 'a1', version_id: 'v3', version_number: 3, user_id: 'u1', user_name: 'Me', folder_id: 'f-barilla', folder_name: 'Consegne / Barilla', file_name: 'Spot 30s v3.mov', status: 'uploading', progress_percent: 62, drive_file_id: null, web_view_link: null, error: null, created_at: '', updated_at: null }]
    refresh()
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '62'))

    h.deliveries = [{ ...h.deliveries[0], status: 'done', progress_percent: 100, web_view_link: 'https://drive.google.com/file/d/x/view' }]
    refresh()
    await waitFor(() => expect(screen.getByText('Delivered to Google Drive')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Open file in Drive' })).toHaveAttribute('href', 'https://drive.google.com/file/d/x/view')
    expect(screen.getByRole('link', { name: 'Open folder in Drive' })).toHaveAttribute('href', 'https://drive.google.com/drive/folders/f-barilla')
    expect(screen.getByText('drive.google.com/drive/folders/f-barilla')).toBeInTheDocument()
    expect(screen.getByText('drive.google.com/file/d/x/view')).toBeInTheDocument()
    expect(screen.getByText(/· as me@example.com/)).toBeInTheDocument()

    copied.mockResolvedValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Copy folder link' }))
    await waitFor(() => expect(copied).toHaveBeenCalledWith('https://drive.google.com/drive/folders/f-barilla'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy folder link' })).toHaveTextContent('Copied!'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy file link' }))
    await waitFor(() => expect(copied).toHaveBeenCalledWith('https://drive.google.com/file/d/x/view'))
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }))
    await waitFor(() => expect(onMoveToStatus).toHaveBeenCalledWith([asset], delivered))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('points to the profile when the account is not connected', () => {
    h.google = { enabled: true, connected: false, email: null, connected_at: null }
    renderDialog()
    expect(screen.getByText(/isn't connected yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect Google Drive' })).toHaveAttribute('href', '/settings/profile')
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  it('offers no status change when there is no Delivered status', async () => {
    const { refresh } = renderDialog([noStatus])
    fireEvent.click(screen.getByText('Choose folder'))
    await screen.findByText('Barilla')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    h.deliveries = [{ id: 'd1', asset_id: 'a1', version_id: 'v3', version_number: 3, user_id: 'u1', user_name: 'Me', folder_id: 'f', folder_name: 'Consegne / Barilla', file_name: 'Spot 30s v3.mov', status: 'done', progress_percent: 100, drive_file_id: 'x', web_view_link: 'https://d/x', error: null, created_at: '', updated_at: null }]
    refresh()
    await waitFor(() => expect(screen.getByText('Delivered to Google Drive')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Change status' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('shows the folder link alone when Drive gave no file link', async () => {
    const { refresh } = renderDialog()
    fireEvent.click(screen.getByText('Choose folder'))
    await screen.findByText('Barilla')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    h.deliveries = [{ id: 'd1', asset_id: 'a1', version_id: 'v3', version_number: 3, user_id: 'u1', user_name: 'Me', folder_id: 'f-barilla', folder_name: 'Consegne / Barilla', file_name: 'Spot 30s v3.mov', status: 'done', progress_percent: 100, drive_file_id: 'x', web_view_link: null, error: null, created_at: '', updated_at: null }]
    refresh()
    await waitFor(() => expect(screen.getByText('Delivered to Google Drive')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Open folder in Drive' })).toHaveAttribute('href', 'https://drive.google.com/drive/folders/f-barilla')
    expect(screen.getByText('Consegne /')).toBeInTheDocument()
    expect(screen.getByText('Barilla')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open file in Drive' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy file link' })).not.toBeInTheDocument()
  })
  it('sends several assets to one folder, a name each, and follows every copy', async () => {
    const { onMoveToStatus, refresh } = renderDialog(undefined, undefined, [asset, clipB])
    expect(screen.getByText(/2 assets · the originals/)).toBeInTheDocument()
    expect(screen.getByLabelText('File name on Drive for Spot 30s')).toHaveValue('Spot 30s v3.mov')
    expect(screen.getByLabelText('File name on Drive for Clip B')).toHaveValue('Clip B v1.mp4')
    expect(screen.getByRole('button', { name: 'Remove Spot 30s' })).toBeEnabled()
    fireEvent.click(screen.getByText('Choose folder'))
    await screen.findByText('Barilla')
    fireEvent.change(screen.getByLabelText('File name on Drive for Clip B'), { target: { value: 'B final.mp4' } })
    post.mockResolvedValue([deliveryOf(asset, 'd1'), deliveryOf(clipB, 'd2', { file_name: 'B final.mp4' })])
    fireEvent.click(screen.getByRole('button', { name: 'Send 2 files' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/projects/p1/deliveries', {
        folder_id: 'f-barilla', folder_name: 'Consegne / Barilla',
        items: [{ asset_id: 'a1', file_name: 'Spot 30s v3.mov' }, { asset_id: 'a2', file_name: 'B final.mp4' }],
      }),
    )

    h.deliveries = [deliveryOf(asset, 'd1', { status: 'uploading', progress_percent: 40 }), deliveryOf(clipB, 'd2', { file_name: 'B final.mp4' })]
    refresh()
    await waitFor(() => expect(screen.getAllByRole('progressbar')).toHaveLength(2))
    expect(screen.getByRole('progressbar', { name: 'Copy progress: Spot 30s v3.mov' })).toHaveAttribute('aria-valuenow', '40')
    expect(screen.getByText(/0 of 2 done/)).toBeInTheDocument()

    h.deliveries = [
      deliveryOf(asset, 'd1', { status: 'done', progress_percent: 100, web_view_link: 'https://drive.google.com/file/d/x1/view' }),
      deliveryOf(clipB, 'd2', { status: 'done', progress_percent: 100, file_name: 'B final.mp4', web_view_link: 'https://drive.google.com/file/d/x2/view' }),
    ]
    refresh()
    await waitFor(() => expect(screen.getByText('Delivered to Google Drive')).toBeInTheDocument())
    expect(screen.getByText(/2 files now in Consegne \/ Barilla/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open folder in Drive' })).toHaveAttribute('href', 'https://drive.google.com/drive/folders/f-barilla')
    expect(screen.getByRole('link', { name: 'Open file Spot 30s v3.mov in Drive' })).toHaveAttribute('href', 'https://drive.google.com/file/d/x1/view')
    expect(screen.getByRole('link', { name: 'Open file B final.mp4 in Drive' })).toHaveAttribute('href', 'https://drive.google.com/file/d/x2/view')
    expect(screen.getByRole('button', { name: 'Copy file B final.mp4 link' })).toBeInTheDocument()
    expect(screen.getByText(/Also move these 2 assets to/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }))
    await waitFor(() => expect(onMoveToStatus).toHaveBeenCalledWith([asset, clipB], delivered))
  })

  it('New folder waits for a parent, then creates under it and sends there', async () => {
    renderDialog()
    const newFolder = screen.getByRole('button', { name: /New folder/ })
    expect(newFolder).toBeDisabled()
    expect(screen.getByText(/choose the parent folder first/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Choose folder'))
    await screen.findByText('Barilla')
    fireEvent.click(screen.getByRole('button', { name: 'New folder inside Barilla' }))
    post.mockResolvedValueOnce({ id: 'f-new', name: 'Spot 30s', web_view_link: null })
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: ' Spot 30s ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/integrations/google/folders', { parent_id: 'f-barilla', name: 'Spot 30s' }))
    await screen.findByText('Barilla / Spot 30s')
    expect(screen.getByText('Consegne /')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('ff-last-drive-folder')!)).toMatchObject({ id: 'f-new', name: 'Barilla / Spot 30s', parentName: 'Barilla' })
    expect(screen.getByRole('button', { name: 'New folder inside Spot 30s' })).toBeEnabled()

    post.mockResolvedValueOnce([{ id: 'd1', status: 'queued' }])
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith('/projects/p1/deliveries', {
        folder_id: 'f-new', folder_name: 'Consegne / Barilla / Spot 30s', items: [{ asset_id: 'a1', file_name: 'Spot 30s v3.mov' }],
      }),
    )
  })

  it('renames a folder it just created, and only that one', async () => {
    renderDialog()
    fireEvent.click(screen.getByText('Choose folder'))
    await screen.findByText('Barilla')
    expect(screen.queryByRole('button', { name: 'Rename folder' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New folder inside Barilla' }))
    post.mockResolvedValueOnce({ id: 'f-new', name: 'Spot', web_view_link: null })
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'Spot' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByText('Barilla / Spot')

    fireEvent.click(screen.getByRole('button', { name: 'Rename folder' }))
    expect(screen.getByLabelText('Folder name')).toHaveValue('Spot')
    patch.mockResolvedValueOnce({ id: 'f-new', name: 'Final', web_view_link: null })
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Final' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/integrations/google/folders/f-new', { name: 'Final' }))
    await screen.findByText('Barilla / Final')
    expect(JSON.parse(localStorage.getItem('ff-last-drive-folder')!)).toMatchObject({ id: 'f-new', name: 'Barilla / Final' })

    // Picking another folder: not one made here, so no rename.
    pick.mockResolvedValue({ id: 'f-other', name: 'Mulino' })
    fireEvent.click(screen.getByText('Change'))
    await screen.findByText('Mulino')
    expect(screen.queryByRole('button', { name: 'Rename folder' })).not.toBeInTheDocument()
  })

  it('shows which copies failed and offers to try those again', async () => {
    const { onMoveToStatus, refresh } = renderDialog(undefined, undefined, [asset, clipB])
    fireEvent.click(screen.getByText('Choose folder'))
    await screen.findByText('Barilla')
    post.mockResolvedValue([deliveryOf(asset, 'd1'), deliveryOf(clipB, 'd2')])
    fireEvent.click(screen.getByRole('button', { name: 'Send 2 files' }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    h.deliveries = [
      deliveryOf(asset, 'd1', { status: 'done', progress_percent: 100, web_view_link: 'https://d/x1' }),
      deliveryOf(clipB, 'd2', { status: 'failed', error: 'Drive refused the upload: quota' }),
    ]
    refresh()
    await waitFor(() => expect(screen.getByText('1 of 2 delivered')).toBeInTheDocument())
    expect(screen.getByText(/Drive refused the upload: quota/)).toBeInTheDocument()
    expect(screen.getByText(/Also move this asset to/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }))
    await waitFor(() => expect(onMoveToStatus).toHaveBeenCalledWith([asset], delivered))

    fireEvent.click(screen.getByRole('button', { name: 'Try the failed ones again' }))
    // Back in setup, with only Clip B left.
    expect(screen.getByLabelText('File name on Drive')).toHaveValue('Clip B v1.mp4')
    expect(screen.queryByLabelText('File name on Drive for Spot 30s')).not.toBeInTheDocument()
  })

  it('tells about the asset the server refused and lets it be removed', async () => {
    renderDialog(undefined, undefined, [asset, clipB])
    fireEvent.click(screen.getByText('Choose folder'))
    await screen.findByText('Barilla')
    post.mockRejectedValueOnce(new FakeApiError(409, 'Clip B: Asset version is not ready yet'))
    fireEvent.click(screen.getByRole('button', { name: 'Send 2 files' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('Clip B: Asset version is not ready yet')

    fireEvent.click(screen.getByRole('button', { name: 'Remove Clip B' }))
    post.mockRejectedValueOnce(new FakeApiError(429, 'Too many requests', 42))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many sends; try again in 42s'))

    post.mockResolvedValueOnce([deliveryOf(asset, 'd1')])
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith('/projects/p1/deliveries', expect.objectContaining({ items: [{ asset_id: 'a1', file_name: 'Spot 30s v3.mov' }] })),
    )
    // The batch is not back yet: the copy shows as under way, not as failed.
    await screen.findByText('Sending to Google Drive…')
  })
})
