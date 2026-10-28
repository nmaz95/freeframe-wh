import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AssetGrid } from '../asset-grid'
import type { Asset, AssetStatusDef, Folder } from '@/types'

// A status filter lists the folder and every folder below it as one flat
// list: the folder cards go, and each asset says where it sits.

vi.mock('@/stores/view-store', () => ({
  useViewStore: () => ({
    layout: 'grid',
    cardSize: 'M',
    aspectRatio: 'landscape',
    thumbnailScale: 'fill',
    showCardInfo: true,
    titleLines: '2',
    flattenFolders: false,
    showFileSize: true,
    showUploader: true,
    sortKey: 'custom',
    sortDirection: 'asc',
  }),
}))

const approved: AssetStatusDef = {
  id: 's1', name: 'Approved', color: '#22c55e', position: 1, is_default: false, legacy_key: null,
  notify_creator: true, notify_assignee: false, notify_role_ids: [],
}
const noStatus: AssetStatusDef = { ...approved, id: 's0', name: 'No Status', position: 0, is_default: true }
const statusFor = (a: Asset) => (a.status_id === 's1' ? approved : noStatus)

function makeAsset(n: number, status_id: string | null, folder_id: string | null): Asset {
  return {
    id: `a${n}`, project_id: 'p1', name: `Clip ${n}`, description: null, asset_type: 'video',
    status: 'draft', status_id, rating: null, assignee_id: null, folder_id, due_date: null,
    keywords: [], created_by: 'u1', created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z', deleted_at: null,
  }
}
const dailies: Folder = {
  id: 'f1', project_id: 'p1', parent_id: null, name: 'Dailies', created_by: 'u1',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', item_count: 1,
}
const assets = [makeAsset(1, 's1', 'f1'), makeAsset(2, null, 'f1'), makeAsset(3, 's1', null)]

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('the grid under a status filter', () => {
  it('shows the folders and every asset without one', () => {
    render(<AssetGrid assets={assets} folders={[dailies]} projectId="p1" statusFor={statusFor} />)
    expect(screen.getByText('Dailies')).toBeInTheDocument()
    expect(screen.getByText('Clip 1')).toBeInTheDocument()
    expect(screen.getByText('Clip 2')).toBeInTheDocument()
    expect(screen.queryByText(/Client \/ Dailies/)).toBeNull()
  })

  it('hides the folder cards, keeps the matching assets and names their folder', () => {
    render(
      <AssetGrid
        assets={assets}
        folders={[dailies]}
        projectId="p1"
        statusFor={statusFor}
        statusFilter="s1"
        folderPaths={{ f1: 'Client / Dailies' }}
      />,
    )
    expect(screen.queryByText('Dailies')).toBeNull()
    expect(screen.getByText('Clip 1')).toBeInTheDocument()
    expect(screen.queryByText('Clip 2')).toBeNull()
    expect(screen.getByText('Clip 3')).toBeInTheDocument()
    // Clip 1 sits in Dailies; Clip 3 at the root says nothing.
    expect(screen.getAllByText(/Client \/ Dailies/)).toHaveLength(1)
  })

  it('says so when nothing in the subtree has the status', () => {
    render(
      <AssetGrid assets={[]} folders={[dailies]} projectId="p1" statusFor={statusFor} statusFilter="s1" onUpload={vi.fn()} />,
    )
    expect(screen.getByText('No assets in this status')).toBeInTheDocument()
    expect(screen.queryByText('Upload')).toBeNull()
  })
})
