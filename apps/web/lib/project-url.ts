/**
 * The project page's URL for a folder and a status filter. The URL is the one
 * source of truth for both, so every writer (the tree, the breadcrumb, the
 * sidebar's statuses) builds it here and never drops the other parameter.
 */
export function projectUrl(
  projectId: string,
  view: { folder?: string | null; status?: string | null },
): string {
  const params = new URLSearchParams()
  if (view.folder) params.set('folder', view.folder)
  if (view.status) params.set('status', view.status)
  const query = params.toString()
  return query ? `/projects/${projectId}?${query}` : `/projects/${projectId}`
}
