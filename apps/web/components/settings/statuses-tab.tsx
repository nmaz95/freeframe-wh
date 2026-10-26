"use client";

import * as React from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusDot } from "@/components/shared/status-badge";
import { STATUSES_KEY, ROLES_KEY } from "@/hooks/use-asset-statuses";
import type { AssetStatusDef, PipelineRole } from "@/types";

const HEX = /^#[0-9A-Fa-f]{6}$/;
const NEW_COLOR = "#3b82f6";

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface StatusDraft {
  name: string;
  color: string;
  notify_creator: boolean;
  notify_assignee: boolean;
  notify_role_ids: string[];
}

function draftOf(s?: AssetStatusDef): StatusDraft {
  return {
    name: s?.name ?? "",
    color: s?.color ?? NEW_COLOR,
    notify_creator: s?.notify_creator ?? true,
    notify_assignee: s?.notify_assignee ?? false,
    notify_role_ids: s?.notify_role_ids ?? [],
  };
}

/** The form for one status: its name and colour, and who a move to it tells. */
function StatusForm({
  initial,
  roles,
  saving,
  error,
  onSave,
  onCancel,
  submitLabel,
}: {
  initial: StatusDraft;
  roles: PipelineRole[];
  saving: boolean;
  error: string | null;
  onSave: (draft: StatusDraft) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [draft, setDraft] = React.useState<StatusDraft>(initial);
  const valid = draft.name.trim().length > 0 && HEX.test(draft.color.trim());

  function toggleRole(id: string) {
    setDraft((d) => ({
      ...d,
      notify_role_ids: d.notify_role_ids.includes(id)
        ? d.notify_role_ids.filter((r) => r !== id)
        : [...d.notify_role_ids, id],
    }));
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-bg-tertiary/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !saving) onSave({ ...draft, name: draft.name.trim(), color: draft.color.trim() });
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label="Status name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Needs PM Review"
          maxLength={60}
          className="flex-1"
          autoFocus
        />
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Status color"
            value={HEX.test(draft.color) ? draft.color : NEW_COLOR}
            onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            className="h-9 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
          />
          <Input
            aria-label="Status color hex"
            value={draft.color}
            onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            maxLength={7}
            className="w-28 font-mono text-sm"
          />
        </div>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Notify on change</legend>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={draft.notify_creator}
            onChange={(e) => setDraft({ ...draft, notify_creator: e.target.checked })}
          />
          Whoever uploaded the asset
        </label>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={draft.notify_assignee}
            onChange={(e) => setDraft({ ...draft, notify_assignee: e.target.checked })}
          />
          The asset&apos;s assignee
        </label>
        {roles.map((r) => (
          <label key={r.id} className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={draft.notify_role_ids.includes(r.id)}
              onChange={() => toggleRole(r.id)}
            />
            Everyone holding the <span className="font-medium text-text-primary">{r.name}</span> role
          </label>
        ))}
        {roles.length === 0 && (
          <p className="text-xs text-text-tertiary">Add pipeline roles below to notify by role.</p>
        )}
      </fieldset>

      {error && <p role="alert" className="text-xs text-status-error">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={saving} disabled={!valid}>
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function StatusRow({
  status,
  roles,
  index,
  count,
  onEdit,
  onDelete,
  onMove,
  onMakeDefault,
  busy,
}: {
  status: AssetStatusDef;
  roles: PipelineRole[];
  index: number;
  count: number;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onMakeDefault: () => void;
  busy: boolean;
}) {
  const who = [
    status.notify_creator ? "uploader" : null,
    status.notify_assignee ? "assignee" : null,
    ...status.notify_role_ids.map((id) => roles.find((r) => r.id === id)?.name ?? null),
  ].filter(Boolean);
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="flex flex-col">
        <button
          type="button"
          aria-label={`Move ${status.name} up`}
          disabled={busy || index === 0}
          onClick={() => onMove(-1)}
          className="text-text-tertiary hover:text-text-primary disabled:opacity-30"
        >
          <ArrowUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label={`Move ${status.name} down`}
          disabled={busy || index === count - 1}
          onClick={() => onMove(1)}
          className="text-text-tertiary hover:text-text-primary disabled:opacity-30"
        >
          <ArrowDown className="h-3 w-3" />
        </button>
      </div>
      <StatusDot color={status.color} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">{status.name}</span>
          {status.is_default && (
            <span className="rounded-full bg-accent-muted px-1.5 py-0.5 text-2xs font-medium text-text-primary">
              Default
            </span>
          )}
        </div>
        <p className="truncate text-xs text-text-tertiary">
          {who.length > 0 ? `Notifies: ${who.join(", ")}` : "Notifies nobody"}
        </p>
      </div>
      {!status.is_default && (
        <button
          type="button"
          onClick={onMakeDefault}
          disabled={busy}
          className="text-xs text-text-tertiary hover:text-text-primary disabled:opacity-50"
        >
          Make default
        </button>
      )}
      <button
        type="button"
        aria-label={`Edit ${status.name}`}
        onClick={onEdit}
        disabled={busy}
        className="rounded p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={`Delete ${status.name}`}
        onClick={onDelete}
        disabled={busy || status.is_default}
        title={status.is_default ? "Make another status the default first" : undefined}
        className="rounded p-1 text-text-tertiary hover:bg-status-error/10 hover:text-status-error disabled:opacity-30"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function RolesSection({ roles, onChanged }: { roles: PipelineRole[]; onChanged: () => void }) {
  const [adding, setAdding] = React.useState("");
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<PipelineRole | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      return true;
    } catch (err) {
      setError(errorText(err, "Could not save"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Pipeline roles</h2>
        <p className="text-xs text-text-tertiary mt-0.5">
          Named slots a status can notify. Who holds each is set per project (Project settings → People)
          and can be overridden on a single asset.
        </p>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border bg-bg-secondary">
        {roles.map((r) => (
          <li key={r.id} className="flex items-center gap-2 px-3 py-2">
            {editing?.id === r.id ? (
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const name = editing.name.trim();
                  if (!name) return;
                  if (await run(() => api.patch(`/pipeline-roles/${r.id}`, { name }))) setEditing(null);
                }}
              >
                <Input
                  aria-label={`Rename ${r.name}`}
                  value={editing.name}
                  onChange={(e) => setEditing({ id: r.id, name: e.target.value })}
                  maxLength={60}
                  className="flex-1"
                  autoFocus
                />
                <Button type="submit" size="sm" loading={busy} disabled={!editing.name.trim()}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </form>
            ) : (
              <>
                <span className="flex-1 text-sm text-text-primary">{r.name}</span>
                <button
                  type="button"
                  aria-label={`Rename ${r.name}`}
                  onClick={() => setEditing({ id: r.id, name: r.name })}
                  disabled={busy}
                  className="rounded p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${r.name}`}
                  onClick={() => setRemoving(r)}
                  disabled={busy}
                  className="rounded p-1 text-text-tertiary hover:bg-status-error/10 hover:text-status-error"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </li>
        ))}
        {roles.length === 0 && <li className="px-3 py-3 text-sm text-text-tertiary">No roles yet.</li>}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = adding.trim();
          if (!name) return;
          if (await run(() => api.post("/pipeline-roles", { name }))) setAdding("");
        }}
      >
        <Input
          aria-label="New role name"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="e.g. Colorist"
          maxLength={60}
          className="flex-1 max-w-xs"
        />
        <Button type="submit" size="sm" variant="secondary" loading={busy} disabled={!adding.trim()}>
          <Plus className="h-3.5 w-3.5" />
          Add role
        </Button>
      </form>
      {error && <p role="alert" className="text-xs text-status-error">{error}</p>}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={`Delete the ${removing?.name ?? ""} role?`}
        description="Statuses stop notifying it and nobody holds it any more, in any project."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!removing) return;
          if (await run(() => api.delete(`/pipeline-roles/${removing.id}`))) setRemoving(null);
        }}
      />
    </section>
  );
}

/** Admin Dashboard → Statuses: the instance's asset statuses and pipeline roles. */
export function StatusesTab() {
  const { data: statuses, mutate: mutateStatuses } = useSWR<AssetStatusDef[]>(
    STATUSES_KEY,
    () => api.get<AssetStatusDef[]>(STATUSES_KEY),
  );
  const { data: roles, mutate: mutateRoles } = useSWR<PipelineRole[]>(
    ROLES_KEY,
    () => api.get<PipelineRole[]>(ROLES_KEY),
  );
  const [creating, setCreating] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<AssetStatusDef | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);

  const list = statuses ?? [];

  async function save(draft: StatusDraft, id: string | null) {
    setBusy(true);
    setFormError(null);
    try {
      if (id) await api.patch(`/statuses/${id}`, draft);
      else await api.post("/statuses", draft);
      await mutateStatuses();
      setCreating(false);
      setEditingId(null);
    } catch (err) {
      setFormError(errorText(err, "Could not save this status"));
    } finally {
      setBusy(false);
    }
  }

  async function listAction(action: () => Promise<unknown>) {
    setBusy(true);
    setListError(null);
    try {
      await action();
      await mutateStatuses();
      return true;
    } catch (err) {
      setListError(errorText(err, "Could not update statuses"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, dir: -1 | 1) {
    const ids = list.map((s) => s.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void listAction(() => api.put("/statuses/reorder", { ids }));
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Asset statuses</h2>
            <p className="text-xs text-text-tertiary mt-0.5">
              Where an asset is in your pipeline. New uploads start in the default. Reviewers and up can
              move an asset; each move notifies who the status says, in the app and by email.
            </p>
          </div>
          {!creating && (
            <Button size="sm" variant="secondary" onClick={() => { setCreating(true); setEditingId(null); setFormError(null); }} disabled={busy}>
              <Plus className="h-3.5 w-3.5" />
              New status
            </Button>
          )}
        </div>

        {creating && (
          <StatusForm
            initial={draftOf()}
            roles={roles ?? []}
            saving={busy}
            error={formError}
            submitLabel="Create"
            onSave={(d) => void save(d, null)}
            onCancel={() => { setCreating(false); setFormError(null); }}
          />
        )}

        {listError && <p role="alert" className="text-xs text-status-error">{listError}</p>}

        <ul className="divide-y divide-border rounded-xl border border-border bg-bg-secondary">
          {list.map((s, i) =>
            editingId === s.id ? (
              <li key={s.id} className="p-2">
                <StatusForm
                  initial={draftOf(s)}
                  roles={roles ?? []}
                  saving={busy}
                  error={formError}
                  submitLabel="Save"
                  onSave={(d) => void save(d, s.id)}
                  onCancel={() => { setEditingId(null); setFormError(null); }}
                />
              </li>
            ) : (
              <StatusRow
                key={s.id}
                status={s}
                roles={roles ?? []}
                index={i}
                count={list.length}
                busy={busy}
                onEdit={() => { setEditingId(s.id); setCreating(false); setFormError(null); }}
                onDelete={() => setRemoving(s)}
                onMove={(dir) => move(i, dir)}
                onMakeDefault={() => void listAction(() => api.patch(`/statuses/${s.id}`, { is_default: true }))}
              />
            ),
          )}
          {statuses && list.length === 0 && (
            <li className="px-3 py-3 text-sm text-text-tertiary">No statuses yet.</li>
          )}
        </ul>
      </section>

      <RolesSection
        roles={roles ?? []}
        onChanged={() => {
          void mutateRoles();
          void mutateStatuses();
          void globalMutate(ROLES_KEY);
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={`Delete "${removing?.name ?? ""}"?`}
        description={`Assets in it move to the default status (${list.find((s) => s.is_default)?.name ?? "the default"}).`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!removing) return;
          if (await listAction(() => api.delete(`/statuses/${removing.id}`))) setRemoving(null);
        }}
      />
    </div>
  );
}
