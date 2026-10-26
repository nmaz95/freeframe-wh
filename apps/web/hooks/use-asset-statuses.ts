'use client'

import * as React from 'react'
import useSWR from 'swr'
import { api } from '@/lib/api'
import type { AssetStatusDef, PipelineRole } from '@/types'

const STATUSES_KEY = '/statuses'
const ROLES_KEY = '/pipeline-roles'

type HasStatus = { status_id?: string | null }

/**
 * The instance's asset statuses, in pipeline order, and how to read an
 * asset's. One request shared by every card, menu and badge on the page.
 */
export function useAssetStatuses() {
  const { data, error, isLoading, mutate } = useSWR<AssetStatusDef[]>(
    STATUSES_KEY,
    (key: string) => api.get<AssetStatusDef[]>(key),
  )
  const statuses = React.useMemo(() => data ?? [], [data])
  const byId = React.useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])
  const defaultStatus = React.useMemo(() => statuses.find((s) => s.is_default) ?? null, [statuses])

  /** An asset's status; a missing or unknown id reads as the default. */
  const statusFor = React.useCallback(
    (asset: HasStatus): AssetStatusDef | null =>
      (asset.status_id ? byId.get(asset.status_id) : undefined) ?? defaultStatus,
    [byId, defaultStatus],
  )

  /** Where an asset's status sits in the pipeline; unknown ones sort last. */
  const rankOf = React.useCallback(
    (asset: HasStatus): number => {
      const s = statusFor(asset)
      return s ? s.position : Number.MAX_SAFE_INTEGER
    },
    [statusFor],
  )

  return { statuses, byId, defaultStatus, statusFor, rankOf, isLoading, error, mutate }
}

export function usePipelineRoles() {
  const { data, error, isLoading, mutate } = useSWR<PipelineRole[]>(
    ROLES_KEY,
    (key: string) => api.get<PipelineRole[]>(key),
  )
  return { roles: React.useMemo(() => data ?? [], [data]), error, isLoading, mutate }
}

export { STATUSES_KEY, ROLES_KEY }
