/**
 * The folder and status chips that stand in for the project page's left
 * column where it is not rendered. They drive the same two callbacks.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MobileProjectChips, flattenFolders } from '../mobile-project-chips'
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
      { id: 'f1', name: 'Spot ottobre', depth: 0 },
      { id: 'f2', name: 'Social', depth: 1 },
      { id: 'f3', name: 'Archivio', depth: 0 },
    ])
  })
})

describe('MobileProjectChips', () => {
  it('names the project at the root and the folder inside one', () => {
    renderChips()
    expect(screen.getByRole('button', { name: 'Folder' })).toHaveTextContent('F8 bulk')
  })

  it('names the current folder and picks another from the menu', async () => {
    const { onSelectFolder } = renderChips({ currentFolderId: 'f1' })
    const folder = screen.getByRole('button', { name: 'Folder' })
    expect(folder).toHaveTextContent('Spot ottobre')
    await userEvent.click(folder)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'F8 bulk',
      'Spot ottobre',
      'Social',
      'Archivio',
    ])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Social' }))
    expect(onSelectFolder).toHaveBeenCalledWith('f2')
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
