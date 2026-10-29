/**
 * The folder and status chips that stand in for the project page's left
 * column where it is not rendered. They drive the same two callbacks.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MobileProjectChips, flattenFolders, visibleFolders, ancestorsOf } from '../mobile-project-chips'
import type { AssetStatusDef, FolderTreeNode } from '@/types'

const tree: FolderTreeNode[] = [
  {
    id: 'f1',
    name: 'Spot ottobre',
    parent_id: null,
    item_count: 2,
    children: [{ id: 'f2', name: 'Social', parent_id: 'f1', item_count: 1, children: [] }],
  },
  { id: 'f3', name: 'Archivio', parent_id: null, item_count: 0, children: [] },
]
const statuses = [
  { id: 's1', name: 'Needs PM Review', color: '#60a5fa' },
  { id: 's2', name: 'Approved', color: '#34d399' },
] as AssetStatusDef[]

function renderChips(over: Partial<React.ComponentProps<typeof MobileProjectChips>> = {}) {
  const onSelectFolder = vi.fn()
  const onStatusFilter = vi.fn()
  render(
    <MobileProjectChips
      projectName="F8 bulk"
      tree={tree}
      currentFolderId={null}
      onSelectFolder={onSelectFolder}
      statuses={statuses}
      counts={{ s1: 1, s2: 2 }}
      statusFilter={null}
      onStatusFilter={onStatusFilter}
      {...over}
    />,
  )
  return { onSelectFolder, onStatusFilter }
}

describe('flattenFolders', () => {
  it('lists parents before children with their depth', () => {
    expect(flattenFolders(tree)).toEqual([
      { id: 'f1', name: 'Spot ottobre', depth: 0, hasChildren: true },
      { id: 'f2', name: 'Social', depth: 1, hasChildren: false },
      { id: 'f3', name: 'Archivio', depth: 0, hasChildren: false },
    ])
  })
})

describe('visibleFolders and ancestorsOf', () => {
  it('shows the first level until a parent is expanded', () => {
    expect(visibleFolders(tree, new Set()).map((f) => f.id)).toEqual(['f1', 'f3'])
    expect(visibleFolders(tree, new Set(['f1'])).map((f) => f.id)).toEqual(['f1', 'f2', 'f3'])
  })
  it('names the ancestors of a nested folder, and none for a root one or the root itself', () => {
    expect(ancestorsOf(tree, 'f2')).toEqual(['f1'])
    expect(ancestorsOf(tree, 'f3')).toEqual([])
    expect(ancestorsOf(tree, null)).toEqual([])
  })
})

describe('MobileProjectChips', () => {
  it('names the project at the root and the folder inside one', () => {
    renderChips()
    expect(screen.getByRole('button', { name: 'Folder' })).toHaveTextContent('F8 bulk')
  })

  it('opens on the first level only, expands a folder by its chevron, then picks a subfolder', async () => {
    const { onSelectFolder } = renderChips({ currentFolderId: 'f1' })
    const folder = screen.getByRole('button', { name: 'Folder' })
    expect(folder).toHaveTextContent('Spot ottobre')
    await userEvent.click(folder)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent?.replace(/Expand.*|Collapse.*/, ''))).toEqual([
      'F8 bulk',
      'Spot ottobre',
      'Archivio',
    ])
    await userEvent.click(within(menu).getByRole('button', { name: 'Expand Spot ottobre' }))
    expect(within(menu).getByRole('menuitem', { name: /Social/ })).toBeInTheDocument()
    expect(onSelectFolder).not.toHaveBeenCalled()
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Social/ }))
    expect(onSelectFolder).toHaveBeenCalledWith('f2')
  })

  it('starts with the current folder’s ancestors expanded', async () => {
    renderChips({ currentFolderId: 'f2' })
    expect(screen.getByRole('button', { name: 'Folder' })).toHaveTextContent('Social')
    await userEvent.click(screen.getByRole('button', { name: 'Folder' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /Social/ })).toHaveAttribute('aria-current', 'true')
    expect(within(menu).getByRole('button', { name: 'Collapse Spot ottobre' })).toBeInTheDocument()
  })

  it('shows the status counts, filters on a tap and clears on a second', async () => {
    const { onStatusFilter } = renderChips()
    const group = screen.getByRole('radiogroup', { name: 'Filter by status' })
    expect(within(group).getByRole('radio', { name: /^All/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(group).getByRole('radio', { name: /Approved/ })).toHaveTextContent('2')
    await userEvent.click(within(group).getByRole('radio', { name: /Needs PM Review/ }))
    expect(onStatusFilter).toHaveBeenCalledWith('s1')
  })

  it('a tap on the active status clears the filter', async () => {
    const { onStatusFilter } = renderChips({ statusFilter: 's1' })
    const chip = screen.getByRole('radio', { name: /Needs PM Review/ })
    expect(chip).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(chip)
    expect(onStatusFilter).toHaveBeenCalledWith(null)
  })
})
