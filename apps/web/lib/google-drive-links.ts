/**
 * Links into Google Drive for a finished delivery. The file's link comes from
 * Drive itself (`web_view_link`); the folder's is built from the id the Picker
 * gave us, since Drive does not return one for a parent.
 */

export function driveFolderLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`
}

const LONG_SEGMENT = 12

/**
 * A Drive URL short enough to show under a name: host and path, with any long
 * id cut to its ends ("drive.google.com/file/d/1kLm…7Tz/view"). Anything that
 * is not a URL comes back as it is.
 */
export function shortDriveUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  const segments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((s) => (s.length > LONG_SEGMENT ? `${s.slice(0, 4)}…${s.slice(-3)}` : s))
  return segments.length ? `${parsed.host}/${segments.join('/')}` : parsed.host
}

/** "Consegne / Barilla" → the part to grey out and the folder's own name. */
export function splitFolderName(name: string): { prefix: string; title: string } {
  const at = name.lastIndexOf(' / ')
  if (at < 0) return { prefix: '', title: name }
  return { prefix: name.slice(0, at + 3), title: name.slice(at + 3) }
}
