'use client'

import * as React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import { menuCollisionPadding, menuContentClass, menuItemClass } from '@/components/shared/item-menu'
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
  hasChildren: boolean
}

/** The whole tree as rows, parents before children, indented by depth. */
export function flattenFolders(tree: FolderTreeNode[], depth = 0): FlatFolder[] {
  const out: FlatFolder[] = []
  for (const node of tree) {
    out.push({ id: node.id, name: node.name, depth, hasChildren: node.children.length > 0 })
    if (node.children.length > 0) out.push(...flattenFolders(node.children, depth + 1))
  }
  return out
}

/** The rows the menu shows: the first level, plus the children of every
 *  folder in `expanded`. Subfolders open by hand, one level at a time. */
export function visibleFolders(tree: FolderTreeNode[], expanded: ReadonlySet<string>, depth = 0): FlatFolder[] {
  const out: FlatFolder[] = []
  for (const node of tree) {
    out.push({ id: node.id, name: node.name, depth, hasChildren: node.children.length > 0 })
    if (node.children.length > 0 && expanded.has(node.id)) out.push(...visibleFolders(node.children, expanded, depth + 1))
  }
  return out
}

/** The ids on the path from the root to `folderId`, the folder itself excluded. */
export function ancestorsOf(tree: FolderTreeNode[], folderId: string | null): string[] {
  return (folderId && pathTo(tree, folderId, [])) || []
}

function pathTo(tree: FolderTreeNode[], folderId: string, trail: string[]): string[] | null {
  for (const node of tree) {
    if (node.id === folderId) return trail
    const found = pathTo(node.children, folderId, [...trail, node.id])
    if (found) return found
  }
  return null
}

/** The RadioGroup value that means no status filter. */
const ALL = '__all__'

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
  const all = React.useMemo(() => flattenFolders(tree), [tree])
  const current = all.find((f) => f.id === currentFolderId)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const activeStatus = statusFilter ? statuses.find((s) => s.id === statusFilter) ?? null : null
  // The current folder's ancestors start open, so it is in view; the rest of
  // the tree stays folded until tapped. Reset when the folder changes.
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(ancestorsOf(tree, currentFolderId)))
  const [seenFolder, setSeenFolder] = React.useState(currentFolderId)
  if (seenFolder !== currentFolderId) {
    setSeenFolder(currentFolderId)
    setExpanded(new Set(ancestorsOf(tree, currentFolderId)))
  }
  const folders = visibleFolders(tree, expanded)
  // Which folder's chevron the pointer went down on. Radix fires the item's
  // `onSelect` for any click inside the item (it synthesises one on pointer
  // up), so the chevron cannot be told apart there by the event alone: the
  // flag turns that select into an expand and keeps the menu open.
  const expandIntent = React.useRef<string | null>(null)
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            // Radix may flip it above the chip on a short screen and shifts
            // it inside the viewport's sides; either way the content is
            // capped at the room left (menuContentClass) and scrolls.
            collisionPadding={menuCollisionPadding}
            className={cn(menuContentClass, 'min-w-[240px]')}
          >
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
                className={cn(menuItemClass, 'pr-1')}
                onSelect={(e) => {
                  if (expandIntent.current === f.id) {
                    e.preventDefault()
                    expandIntent.current = null
                    toggle(f.id)
                    return
                  }
                  onSelectFolder(f.id)
                }}
                aria-current={f.id === currentFolderId ? 'true' : undefined}
                style={{ paddingLeft: `${10 + f.depth * 14}px` }}
              >
                <span className="w-4 shrink-0">{f.id === currentFolderId && <Check className="h-4 w-4" />}</span>
                <Folder className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                <span className="truncate flex-1">{f.name}</span>
                {f.hasChildren && (
                  // Opens the level below without picking the folder or closing
                  // the menu (see `expandIntent`). A presentational control:
                  // the item's own select carries the action.
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={expanded.has(f.id) ? `Collapse ${f.name}` : `Expand ${f.name}`}
                    aria-expanded={expanded.has(f.id)}
                    // No preventDefault here: Radix composes the item's own click
                    // handler to skip a default-prevented event, which is how
                    // the first version of this never reached `onSelect`.
                    onPointerDown={() => {
                      expandIntent.current = f.id
                    }}
                    className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                  >
                    <ChevronRight className={cn('h-4 w-4 transition-transform', expanded.has(f.id) && 'rotate-90')} />
                  </button>
                )}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {statuses.length > 0 && (
        // One chip, one menu: the row of status chips had to be scrolled to
        // reach the later statuses. The chip names the active status (with
        // its dot) or "Status: All"; the menu lists every status with its
        // count, All first. Picking All clears the filter.
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="Filter by status"
              className={cn(chipClass, activeStatus ? chipOn : chipOff, 'max-w-[48%]')}
            >
              {activeStatus && <StatusDot color={activeStatus.color} size="sm" />}
              <span className="truncate">{activeStatus ? activeStatus.name : 'Status: All'}</span>
              <span className="tabular-nums opacity-70">{activeStatus ? counts[activeStatus.id] ?? 0 : total}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={6}
              collisionPadding={menuCollisionPadding}
              className={cn(menuContentClass, 'min-w-[240px]')}
            >
              <DropdownMenu.RadioGroup
                value={statusFilter ?? ALL}
                onValueChange={(v) => onStatusFilter(v === ALL ? null : v)}
                aria-label="Filter by status"
              >
                <DropdownMenu.RadioItem value={ALL} className={menuItemClass}>
                  <span className="w-4 shrink-0">
                    <DropdownMenu.ItemIndicator>
                      <Check className="h-4 w-4" />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  <span className="flex-1">All</span>
                  <span className="tabular-nums text-text-tertiary">{total}</span>
                </DropdownMenu.RadioItem>
                {statuses.map((s) => {
                  const count = counts[s.id] ?? 0
                  return (
                    <DropdownMenu.RadioItem key={s.id} value={s.id} className={menuItemClass}>
                      <span className="w-4 shrink-0">
                        <DropdownMenu.ItemIndicator>
                          <Check className="h-4 w-4" />
                        </DropdownMenu.ItemIndicator>
                      </span>
                      <StatusDot color={s.color} size="md" />
                      <span className="flex-1 truncate">{s.name}</span>
                      {count > 0 && <span className="tabular-nums text-text-tertiary">{count}</span>}
                    </DropdownMenu.RadioItem>
                  )
                })}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  )
}
