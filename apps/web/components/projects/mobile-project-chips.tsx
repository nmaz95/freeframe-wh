'use client'

import * as React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import { menuContentClass, menuItemClass } from '@/components/shared/item-menu'
import { StatusDot } from '@/components/shared/status-badge'
import type { AssetStatusDef, FolderTreeNode } from '@/types'

interface MobileProjectChipsProps {
  projectName: string
  tree: FolderTreeNode[]
  currentFolderId: string | null
  onSelectFolder: (folderId: string | null) => void
  statuses: AssetStatusDef[]
  /** Status id → number of assets in view with it (the sidebar's counts). */
  counts: Record<string, number>
  statusFilter: string | null
  onStatusFilter: (statusId: string | null) => void
  className?: string
}

interface FlatFolder {
  id: string
  name: string
  depth: number
}

/** The tree as the rows of one menu, parents before children, indented by depth. */
export function flattenFolders(tree: FolderTreeNode[], depth = 0): FlatFolder[] {
  const out: FlatFolder[] = []
  for (const node of tree) {
    out.push({ id: node.id, name: node.name, depth })
    if (node.children.length > 0) out.push(...flattenFolders(node.children, depth + 1))
  }
  return out
}

const chipClass =
  'inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors active:scale-[0.97]'
const chipOff = 'border-white/10 bg-white/[0.06] text-text-secondary'
const chipOn = 'border-accent/50 bg-accent/20 text-text-primary'

/**
 * The project page's left column, as one scrolling row of chips: the folder
 * you are in (a menu of the whole tree) and the status filter with its
 * counts. Below `lg` that column is not rendered at all, which on a phone or
 * a tablet left folders unreachable and the status filter invisible.
 *
 * It renders twice on purpose: inside the phone header's capsule below `md`
 * (through MobileHeaderSlot) and inline above the grid between `md` and `lg`.
 * Both drive the same URL-backed state as the column does.
 */
export function MobileProjectChips({
  projectName,
  tree,
  currentFolderId,
  onSelectFolder,
  statuses,
  counts,
  statusFilter,
  onStatusFilter,
  className,
}: MobileProjectChipsProps) {
  const folders = React.useMemo(() => flattenFolders(tree), [tree])
  const current = folders.find((f) => f.id === currentFolderId)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div
      data-testid="mobile-project-chips"
      className={cn('flex items-center gap-2 overflow-x-auto px-1.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
    >
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button type="button" aria-label="Folder" className={cn(chipClass, chipOff, 'max-w-[55%]')}>
            <Folder className="h-[15px] w-[15px] shrink-0" />
            <span className="truncate">{current ? current.name : projectName}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={6} className={cn(menuContentClass, 'max-h-[60vh] overflow-y-auto')}>
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => onSelectFolder(null)}
              aria-current={currentFolderId === null ? 'true' : undefined}
            >
              <span className="w-4 shrink-0">{currentFolderId === null && <Check className="h-4 w-4" />}</span>
              <span className="truncate">{projectName}</span>
            </DropdownMenu.Item>
            {folders.map((f) => (
              <DropdownMenu.Item
                key={f.id}
                className={menuItemClass}
                onSelect={() => onSelectFolder(f.id)}
                aria-current={f.id === currentFolderId ? 'true' : undefined}
                style={{ paddingLeft: `${10 + f.depth * 14}px` }}
              >
                <span className="w-4 shrink-0">{f.id === currentFolderId && <Check className="h-4 w-4" />}</span>
                <Folder className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                <span className="truncate">{f.name}</span>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {statuses.length > 0 && (
        <div role="radiogroup" aria-label="Filter by status" className="flex items-center gap-2">
          <button
            type="button"
            role="radio"
            aria-checked={statusFilter === null}
            onClick={() => onStatusFilter(null)}
            className={cn(chipClass, statusFilter === null ? chipOn : chipOff)}
          >
            All
            {total > 0 && <span className="tabular-nums opacity-70">{total}</span>}
          </button>
          {statuses.map((s) => {
            const active = statusFilter === s.id
            const count = counts[s.id] ?? 0
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onStatusFilter(active ? null : s.id)}
                className={cn(chipClass, active ? chipOn : chipOff)}
              >
                <StatusDot color={s.color} size="sm" />
                {s.name}
                {count > 0 && <span className="tabular-nums opacity-70">{count}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
