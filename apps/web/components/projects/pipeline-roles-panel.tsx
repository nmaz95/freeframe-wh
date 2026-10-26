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
 * Who holds each pipeline role, and so who a status change notifies.
 *
 * With an `assetId` this is the asset's own team: each role shows the people
 * it resolves to right now. Those come from the asset itself when it names
 * anyone, and from the project's defaults otherwise, marked as such. Picking
 * someone on a role that still follows the default copies the default and
 * applies the change to this asset only; "Use project default" hands the role
 * back. Without an `assetId` the panel edits the project's defaults, which
 * new assets start from. Every click saves at once.
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
  /** With an asset, the panel edits that asset's own team. */
  assetId?: string
  members: ProjectMember[]
  users: Record<string, User | undefined>
  canEdit: boolean
  /** Tighter rows, for a side panel. */
  compact?: boolean
}) {
  const { roles } = usePipelineRoles()
  const key = assetId ? `/assets/${assetId}/pipeline-assignments` : `/projects/${projectId}/pipeline-assignments`
  const { data, error, mutate } = useSWR<RoleAssignments>(key, (k: string) => api.get<RoleAssignments>(k))
  const [saving, setSaving] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)

  if (roles.length === 0) return null

  const defaults = toMap(data?.project_defaults)
  const overrides = toMap(assetId ? data?.overrides : undefined)
  // The project scope edits the defaults themselves.
  const own = assetId ? overrides : defaults

  const nameOf = (id: string) => users[id]?.name ?? users[id]?.email ?? 'Member'

  /** What a role resolves to here, and where that comes from. */
  function resolve(roleId: string): { holders: string[]; fromDefault: boolean } {
    const mine = own.get(roleId) ?? []
    if (!assetId || mine.length > 0) return { holders: mine, fromDefault: false }
    return { holders: defaults.get(roleId) ?? [], fromDefault: true }
  }

  async function save(next: Map<string, string[]>, marker: string) {
    setSaving(marker)
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

  function toggle(roleId: string, userId: string) {
    if (!data) return
    const { holders } = resolve(roleId)
    const set = new Set(holders)
    if (set.has(userId)) set.delete(userId)
    else set.add(userId)
    const next = new Map(own)
    next.set(roleId, Array.from(set))
    void save(next, `${roleId}:${userId}`)
  }

  function resetToDefault(roleId: string) {
    if (!data) return
    const next = new Map(own)
    next.delete(roleId)
    void save(next, `${roleId}:reset`)
  }

  const memberRows = members
    .map((m) => ({ id: m.user_id, user: users[m.user_id] }))
    .sort((a, b) => (a.user?.name ?? '').localeCompare(b.user?.name ?? ''))

  return (
    <div className={cn('space-y-3', compact ? 'text-xs' : 'text-sm')}>
      {error && <p role="alert" className="text-xs text-status-error">Could not load roles: {errorText(error, 'request failed')}</p>}
      {saveError && <p role="alert" className="text-xs text-status-error">{saveError}</p>}
      {roles.map((role) => {
        const { holders, fromDefault } = resolve(role.id)
        const holderSet = new Set(holders)
        const overridden = !!assetId && (own.get(role.id)?.length ?? 0) > 0
        return (
          <div key={role.id} className="space-y-1" data-testid={`role-${role.name}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={cn('font-medium text-text-primary', compact ? 'text-xs' : 'text-sm')}>{role.name}</span>
              {assetId && fromDefault && holders.length > 0 && (
                <span className="text-2xs text-text-tertiary">project default</span>
              )}
              {overridden && canEdit && (
                <button
                  type="button"
                  onClick={() => resetToDefault(role.id)}
                  disabled={!data || saving !== null}
                  className="text-2xs text-text-tertiary hover:text-text-primary underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {saving === `${role.id}:reset` ? 'Saving…' : 'Use project default'}
                </button>
              )}
              {overridden && !canEdit && <span className="text-2xs text-text-tertiary">set on this asset</span>}
            </div>
            {canEdit ? (
              <div className="flex flex-wrap gap-1">
                {memberRows.map(({ id, user }) => {
                  const on = holderSet.has(id)
                  const busy = saving === `${role.id}:${id}`
                  return (
                    <button
                      key={id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`${nameOf(id)} is ${role.name}${on && fromDefault ? ' (project default)' : ''}`}
                      disabled={!data || saving !== null}
                      onClick={() => toggle(role.id, id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-60',
                        on && !fromDefault && 'border-accent bg-accent-muted text-text-primary',
                        on && fromDefault && 'border-dashed border-accent bg-accent-muted/60 text-text-primary',
                        !on && 'border-border text-text-secondary hover:border-border-focus hover:text-text-primary',
                      )}
                      title={on && fromDefault ? 'From the project default' : undefined}
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : on ? (
                        <Check className="h-3 w-3 text-accent" />
                      ) : (
                        <Avatar name={user?.name ?? '?'} src={user?.avatar_url} color={user?.avatar_color} size="sm" />
                      )}
                      <span className="max-w-[140px] truncate">{nameOf(id)}</span>
                    </button>
                  )
                })}
                {memberRows.length === 0 && <span className="text-xs text-text-tertiary">No members yet.</span>}
              </div>
            ) : (
              <p className="text-text-secondary">
                {holders.length > 0 ? (
                  <>
                    {holders.map(nameOf).join(', ')}
                    {fromDefault && <span className="text-text-tertiary"> (project default)</span>}
                  </>
                ) : (
                  <span className="text-text-tertiary">Nobody</span>
                )}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
