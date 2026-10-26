'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Check, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/shared/avatar'
import { usePipelineRoles } from '@/hooks/use-asset-statuses'
import type { ProjectMember, RoleAssignmentEntry, RoleAssignments, User } from '@/types'

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function toMap(entries: RoleAssignmentEntry[] | undefined): Map<string, string[]> {
  return new Map((entries ?? []).map((e) => [e.role_id, e.user_ids]))
}

function toEntries(map: Map<string, string[]>): RoleAssignmentEntry[] {
  return Array.from(map, ([role_id, user_ids]) => ({ role_id, user_ids })).filter((e) => e.user_ids.length > 0)
}

/**
 * Who holds each pipeline role: the project's defaults (`scope: project`,
 * owner only) or one asset's overrides (`scope: asset`, editor and up). An
 * override row left empty falls back to the project default, which is shown
 * greyed under it. Each toggle saves at once.
 */
export function PipelineRolesPanel({
  projectId,
  assetId,
  members,
  users,
  canEdit,
  compact,
}: {
  projectId: string
  /** With an asset, the panel edits that asset's overrides. */
  assetId?: string
  members: ProjectMember[]
  users: Record<string, User | undefined>
  canEdit: boolean
  /** Tighter rows, for the review sidebar. */
  compact?: boolean
}) {
  const { roles } = usePipelineRoles()
  const key = assetId ? `/assets/${assetId}/pipeline-assignments` : `/projects/${projectId}/pipeline-assignments`
  const { data, error, mutate } = useSWR<RoleAssignments>(key, (k: string) => api.get<RoleAssignments>(k))
  const [saving, setSaving] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)

  if (roles.length === 0) return null

  const scopeEntries = assetId ? data?.overrides : data?.project_defaults
  const current = toMap(scopeEntries)
  const defaults = toMap(data?.project_defaults)

  async function toggle(roleId: string, userId: string) {
    if (!data) return
    const next = new Map(current)
    const holders = new Set(next.get(roleId) ?? [])
    if (holders.has(userId)) holders.delete(userId)
    else holders.add(userId)
    next.set(roleId, Array.from(holders))
    setSaving(`${roleId}:${userId}`)
    setSaveError(null)
    try {
      const saved = await api.put<RoleAssignments>(key, { assignments: toEntries(next) })
      await mutate(saved, { revalidate: false })
    } catch (err) {
      setSaveError(errorText(err, 'Could not save'))
    } finally {
      setSaving(null)
    }
  }

  const memberRows = members
    .map((m) => ({ id: m.user_id, user: users[m.user_id] }))
    .sort((a, b) => (a.user?.name ?? '').localeCompare(b.user?.name ?? ''))

  return (
    <div className={cn('space-y-3', compact ? 'text-xs' : 'text-sm')}>
      {error && <p role="alert" className="text-xs text-status-error">Could not load roles: {errorText(error, 'request failed')}</p>}
      {saveError && <p role="alert" className="text-xs text-status-error">{saveError}</p>}
      {roles.map((role) => {
        const holders = new Set(current.get(role.id) ?? [])
        const fallback = assetId && holders.size === 0 ? defaults.get(role.id) ?? [] : []
        return (
          <div key={role.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className={cn('font-medium text-text-primary', compact ? 'text-xs' : 'text-sm')}>{role.name}</span>
              {fallback.length > 0 && (
                <span className="text-2xs text-text-tertiary">
                  project default: {fallback.map((id) => users[id]?.name ?? '—').join(', ')}
                </span>
              )}
            </div>
            {canEdit ? (
              <div className="flex flex-wrap gap-1">
                {memberRows.map(({ id, user }) => {
                  const on = holders.has(id)
                  const busy = saving === `${role.id}:${id}`
                  return (
                    <button
                      key={id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`${user?.name ?? id} holds ${role.name}`}
                      disabled={!data || saving !== null}
                      onClick={() => toggle(role.id, id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-60',
                        on
                          ? 'border-accent bg-accent-muted text-text-primary'
                          : 'border-border text-text-secondary hover:border-border-focus hover:text-text-primary',
                      )}
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : on ? (
                        <Check className="h-3 w-3 text-accent" />
                      ) : (
                        <Avatar name={user?.name ?? '?'} src={user?.avatar_url} color={user?.avatar_color} size="sm" />
                      )}
                      <span className="max-w-[140px] truncate">{user?.name ?? user?.email ?? 'Member'}</span>
                    </button>
                  )
                })}
                {memberRows.length === 0 && <span className="text-xs text-text-tertiary">No members yet.</span>}
              </div>
            ) : (
              <p className="text-text-secondary">
                {holders.size > 0
                  ? Array.from(holders).map((id) => users[id]?.name ?? '—').join(', ')
                  : fallback.length > 0
                    ? fallback.map((id) => users[id]?.name ?? '—').join(', ')
                    : <span className="text-text-tertiary">Nobody</span>}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
