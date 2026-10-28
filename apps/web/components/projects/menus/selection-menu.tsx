'use client'

import * as React from 'react'
import { Download, FolderInput, Share2, Trash2 } from 'lucide-react'
import { MenuAction, MenuLabel, MenuSeparator } from '@/components/shared/item-menu'
import { StatusSubmenu } from './status-menu'
import type { AssetStatusDef } from '@/types'

export interface SelectionActions {
  onShare?: () => void
  onDownload?: () => void
  onMove?: () => void
  onDelete?: () => void
  /** "Change status ▸" for the selected assets; absent when none is selected
   *  or the viewer may not change statuses. */
  statuses?: AssetStatusDef[]
  onSetStatus?: (status: AssetStatusDef) => void
}

/**
 * Right-click on an item inside a selection of several: the selection bar's
 * actions, for everything selected rather than the one item under the pointer.
 */
export function SelectionMenuItems({
  count, onShare, onDownload, onMove, onDelete, statuses, onSetStatus,
}: SelectionActions & { count: number }) {
  return (
    <>
      <MenuLabel>{count} items selected</MenuLabel>
      {onSetStatus && statuses && statuses.length > 0 && (
        <StatusSubmenu label="Change status" statuses={statuses} currentId={null} onPick={onSetStatus} />
      )}
      {onShare && (
        <MenuAction icon={Share2} onSelect={onShare}>
          Create Share Link
        </MenuAction>
      )}
      {onDownload && (
        <MenuAction icon={Download} onSelect={onDownload}>
          Download
        </MenuAction>
      )}
      {onMove && (
        <MenuAction icon={FolderInput} onSelect={onMove}>
          Move to…
        </MenuAction>
      )}
      {onDelete && (
        <>
          <MenuSeparator />
          <MenuAction icon={Trash2} onSelect={onDelete} danger>
            Delete
          </MenuAction>
        </>
      )}
    </>
  )
}
