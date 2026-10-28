/**
 * The sidebar's status filter lives in the URL (`?status=`), next to the
 * folder, and the page reads both from there.
 *
 * The filter used to be local state seeded once from the URL and written with
 * history.replaceState, behind the router's back: a click changed the URL and
 * nothing else. Now a click goes through the router, keeps the folder, and
 * the list it asks for covers the folder and every folder below it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const project = { id: 'p1', name: 'Launch film', is_public: false }
const statuses = [
  { id: 's0', name: 'No Status', color: '#888888', position: 0, is_default: true, notify_creator: true, notify_assignee: false, notify_role_ids: [] },
  { id: 's1', name: 'Approved', color: '#22c55e', position: 1, is_default: false, notify_creator: true, notify_assignee: false, notify_role_ids: [] },
]

const { state, routerReplace, keys } = vi.hoisted(() => ({
  state: { query: '' },
  routerReplace: vi.fn(),
  keys: [] as string[],
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'p1' }),
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (typeof key === 'string') keys.push(key)
    return {
      data: typeof key !== 'string' ? undefined
        : key === '/projects/p1' ? project
        : key === '/statuses' ? statuses
        : key === '/projects/p1/members' ? [{ user_id: 'u1', role: 'owner' }]
        : key.startsWith('/projects/p1/assets/status-counts') ? { counts: { s1: 2 } }
        : key.startsWith('/projects/p1/assets') ? []
        : key.startsWith('/projects/p1/folders') ? []
        : undefined,
      isLoading: false,
      mutate: vi.fn(),
    }
  },
  mutate: vi.fn(),
}))
const { storeHook } = vi.hoisted(() => ({
  storeHook: (s: Record<string, unknown>) =>
    (selector?: (x: Record<string, unknown>) => unknown) =>
      (typeof selector === 'function' ? selector(s) : s),
}))
vi.mock('@/stores/auth-store', () => ({ useAuthStore: storeHook({ user: { id: 'u1', name: 'Someone' } }) }))
vi.mock('@/stores/view-store', () => ({
  useViewStore: storeHook({ rightPanelOpen: false, sortKey: 'custom', sortDirection: 'asc', viewMode: 'grid' }),
}))
vi.mock('@/stores/breadcrumb-store', () => ({ useBreadcrumbStore: storeHook({ setExtraCrumbs: vi.fn(), setLabel: vi.fn(), setHref: vi.fn() }) }))
vi.mock('@/hooks/use-comments', () => ({
  useComments: () => ({ comments: [], resolveComment: vi.fn(), deleteComment: vi.fn(), addReaction: vi.fn(), removeReaction: vi.fn(), createComment: vi.fn() }),
}))
vi.mock('@/hooks/use-folders', () => ({
  useFolders: () => ({
    tree: [], mutateTree: vi.fn(), createFolder: vi.fn(), renameFolder: vi.fn(), moveFolder: vi.fn(),
    deleteFolder: vi.fn(), moveAsset: vi.fn(), bulkMove: vi.fn(), restoreAsset: vi.fn(), restoreFolder: vi.fn(),
  }),
  useTrash: () => ({ trash: { assets: [], folders: [] }, mutateTrash: vi.fn() }),
}))
vi.mock('@/hooks/use-share-links', () => ({
  useShareLinks: () => ({ shareLinks: [], toggleEnabled: vi.fn(), deleteShareLink: vi.fn(), createFolderShare: vi.fn(), mutateShareLinks: vi.fn() }),
}))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => undefined }))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  api: { get: vi.fn().mockResolvedValue([]), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
}))
vi.mock('@/components/projects/asset-grid', () => ({
  AssetGrid: ({ currentFolderId, statusFilter }: { currentFolderId?: string | null; statusFilter?: string | null }) => (
    <div>
      <div data-testid="shown-folder">{currentFolderId ?? 'root'}</div>
      <div data-testid="shown-status">{statusFilter ?? 'all'}</div>
    </div>
  ),
}))
vi.mock('@/components/review/comment-panel', () => ({ CommentPanel: () => null }))
vi.mock('@/components/projects/folder-tree', () => ({
  FolderTree: ({ onSelectFolder, onShowTrash }: { onSelectFolder: (id: string | null) => void; onShowTrash: () => void }) => (
    <div>
      <button onClick={() => onSelectFolder('f-sub')}>open sub from tree</button>
      <button onClick={onShowTrash}>open trash</button>
    </div>
  ),
}))
vi.mock('@/components/projects/share-links-table', () => ({ ShareLinksTable: () => null }))
vi.mock('@/components/projects/share-link-detail', () => ({ ShareLinkContent: () => null, ShareLinkSettingsPanel: () => null }))
vi.mock('@/components/projects/share-create-dialog', () => ({ ShareCreateDialog: () => null }))

import ProjectDetailPage from '../page'
import { ToastProvider } from '@/components/shared/toast'

function page() {
  return (
    <ToastProvider>
      <ProjectDetailPage />
    </ToastProvider>
  )
}

beforeEach(() => {
  state.query = ''
  keys.length = 0
  routerReplace.mockReset()
  // The router is what changes the URL; the page follows it on the next render.
  routerReplace.mockImplementation((url: string) => {
    state.query = url.split('?')[1] ?? ''
  })
})

describe('the status filter', () => {
  it('is read from the URL, next to the folder', () => {
    state.query = 'status=s1'
    const { rerender } = render(page())
    expect(screen.getByTestId('shown-status')).toHaveTextContent('s1')
    expect(screen.getByTestId('shown-folder')).toHaveTextContent('root')

    state.query = 'folder=f1&status=s1'
    rerender(page())
    expect(screen.getByTestId('shown-status')).toHaveTextContent('s1')
    expect(screen.getByTestId('shown-folder')).toHaveTextContent('f1')

    state.query = ''
    rerender(page())
    expect(screen.getByTestId('shown-status')).toHaveTextContent('all')
  })

  it('is written through the router, keeping the folder, and lists the whole subtree', async () => {
    state.query = 'folder=f1'
    const { rerender } = render(page())

    fireEvent.click(screen.getByRole('radio', { name: /Approved/ }))
    expect(routerReplace).toHaveBeenCalledWith('/projects/p1?folder=f1&status=s1', { scroll: false })
    rerender(page())
    await waitFor(() => expect(screen.getByTestId('shown-status')).toHaveTextContent('s1'))
    expect(keys).toContain('/projects/p1/assets?folder_id=f1&include_subfolders=true&status_id=s1')
    // The sidebar's count comes from the subtree endpoint for that folder.
    expect(keys).toContain('/projects/p1/assets/status-counts?folder_id=f1')
    expect(screen.getByRole('radio', { name: /Approved/ })).toHaveTextContent('2')

    // The same status again clears it; so does Clear.
    fireEvent.click(screen.getByRole('radio', { name: /Approved/ }))
    expect(routerReplace).toHaveBeenLastCalledWith('/projects/p1?folder=f1', { scroll: false })
    rerender(page())
    fireEvent.click(screen.getByRole('radio', { name: /Approved/ }))
    rerender(page())
    fireEvent.click(screen.getByText('Clear'))
    expect(routerReplace).toHaveBeenLastCalledWith('/projects/p1?folder=f1', { scroll: false })
  })

  it('survives a folder change made from the tree', () => {
    state.query = 'status=s1'
    render(page())
    fireEvent.click(screen.getByText('open sub from tree'))
    expect(routerReplace).toHaveBeenCalledWith('/projects/p1?folder=f-sub&status=s1', { scroll: false })
  })

  it('a status in the URL brings the grid back from the trash view', async () => {
    const { rerender } = render(page())
    fireEvent.click(screen.getByText('open trash'))
    await waitFor(() => expect(screen.queryByTestId('shown-status')).toBeNull())

    state.query = 'status=s1'
    rerender(page())
    await waitFor(() => expect(screen.getByTestId('shown-status')).toHaveTextContent('s1'))
  })
})
