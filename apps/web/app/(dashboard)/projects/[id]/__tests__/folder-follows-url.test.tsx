/**
 * The folder shown follows the URL's `folder` parameter.
 *
 * The page read the parameter once, on mount, and the tree moved the URL with
 * history.replaceState behind the router's back. A breadcrumb back to a
 * parent folder, or to the project, changed the URL through the router and
 * nothing else: the grid stayed where it was. The tree now goes through the
 * router, and the folder in view is read from the URL alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const project = { id: 'p1', name: 'Launch film', is_public: false }

const { state, routerReplace } = vi.hoisted(() => ({
  state: { query: '' },
  routerReplace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'p1' }),
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock('swr', () => ({
  default: (key: string | null) => ({
    data: typeof key !== 'string' ? undefined
      : key === '/projects/p1' ? project
      : key === '/projects/p1/members' ? [{ user_id: 'u1', role: 'owner' }]
      : key.startsWith('/projects/p1/assets') ? []
      : key.startsWith('/projects/p1/folders') ? []
      : undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
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
vi.mock('@/stores/breadcrumb-store', () => ({ useBreadcrumbStore: storeHook({ setExtraCrumbs: vi.fn(), setLabel: vi.fn() }) }))
vi.mock('@/hooks/use-comments', () => ({
  useComments: () => ({ comments: [], resolveComment: vi.fn(), deleteComment: vi.fn(), addReaction: vi.fn(), removeReaction: vi.fn(), createComment: vi.fn() }),
}))
vi.mock('@/hooks/use-folders', () => ({
  useFolders: () => ({
    tree: [], mutateTree: vi.fn(), createFolder: vi.fn(), renameFolder: vi.fn(), moveFolder: vi.fn(),
    deleteFolder: vi.fn(), moveAsset: vi.fn(), bulkMove: vi.fn(), restoreAsset: vi.fn(), restoreFolder: vi.fn(),
  }),
  useTrash: () => ({ trash: undefined, mutateTrash: vi.fn() }),
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
  AssetGrid: ({ currentFolderId }: { currentFolderId?: string | null }) => (
    <div data-testid="shown-folder">{currentFolderId ?? 'root'}</div>
  ),
}))
vi.mock('@/components/review/comment-panel', () => ({ CommentPanel: () => null }))
vi.mock('@/components/projects/folder-tree', () => ({
  FolderTree: ({ onSelectFolder }: { onSelectFolder: (id: string | null) => void }) => (
    <button onClick={() => onSelectFolder('f-sub')}>open sub from tree</button>
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
  routerReplace.mockReset()
})

describe('the folder in view', () => {
  it('follows a change of the ?folder parameter, as a breadcrumb makes', async () => {
    state.query = 'folder=f-sub'
    const { rerender } = render(page())
    expect(screen.getByTestId('shown-folder')).toHaveTextContent('f-sub')

    state.query = 'folder=f-parent'
    rerender(page())
    await waitFor(() => expect(screen.getByTestId('shown-folder')).toHaveTextContent('f-parent'))

    state.query = ''
    rerender(page())
    await waitFor(() => expect(screen.getByTestId('shown-folder')).toHaveTextContent('root'))
  })

  it('moves the URL through the router when the tree picks a folder', async () => {
    // The router is what changes the URL; the view follows it, as above.
    routerReplace.mockImplementation((url: string) => {
      state.query = url.split('?')[1] ?? ''
    })
    const { rerender } = render(page())
    expect(screen.getByTestId('shown-folder')).toHaveTextContent('root')

    fireEvent.click(screen.getByText('open sub from tree'))
    expect(routerReplace).toHaveBeenCalledWith('/projects/p1?folder=f-sub', { scroll: false })
    rerender(page())
    await waitFor(() => expect(screen.getByTestId('shown-folder')).toHaveTextContent('f-sub'))
  })
})
