/**
 * The Google Picker, loaded on demand and opened on one folder.
 *
 * Google's script is fetched the first time a picker is wanted, never on
 * page load. The picker itself is Google's UI in an iframe: it lists the
 * user's Drive as Google renders it, pre-positioned on the folder we name,
 * and hands back what was picked. Under the drive.file scope that pick is
 * also what grants the app access to upload into the folder.
 */

const SCRIPT_SRC = 'https://apis.google.com/js/api.js'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface PickedFolder {
  id: string
  name: string
}

export interface PickFolderOptions {
  accessToken: string
  apiKey: string
  /** The Cloud project number; the Picker needs it for drive.file access grants. */
  appId: string
  /** The folder to open on. */
  parentId: string
  title?: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type GoogleNamespace = {
  picker: any
}

declare global {
  interface Window {
    gapi?: { load: (name: string, cb: () => void) => void }
    google?: GoogleNamespace
  }
}

let loading: Promise<void> | null = null

/** Resolves once `window.google.picker` is there. */
export function loadPickerApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'))
  if (window.google?.picker) return Promise.resolve()
  if (loading) return loading
  loading = new Promise<void>((resolve, reject) => {
    const onApiLoad = () => {
      if (!window.gapi) {
        reject(new Error('Google API loader did not initialise'))
        return
      }
      window.gapi.load('picker', () => resolve())
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      if (window.gapi) onApiLoad()
      else existing.addEventListener('load', onApiLoad, { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = onApiLoad
    script.onerror = () => {
      loading = null
      reject(new Error('Could not load the Google Picker'))
    }
    document.head.appendChild(script)
  })
  return loading
}

/**
 * Open the picker on `parentId` showing only folders; resolves with the
 * picked folder, or null when the user closed it.
 */
export async function pickDriveFolder(opts: PickFolderOptions): Promise<PickedFolder | null> {
  await loadPickerApi()
  const picker = window.google!.picker
  return new Promise<PickedFolder | null>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
      .setParent(opts.parentId)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME)
      .setMode(picker.DocsViewMode.LIST)
    const built = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(opts.accessToken)
      .setDeveloperKey(opts.apiKey)
      .setAppId(opts.appId)
      .setOrigin(window.location.origin)
      .setTitle(opts.title ?? 'Choose a folder')
      .setCallback((data: any) => {
        const action = data?.[picker.Response.ACTION]
        if (action === picker.Action.PICKED) {
          const doc = data[picker.Response.DOCUMENTS]?.[0]
          resolve(doc ? { id: String(doc[picker.Document.ID]), name: String(doc[picker.Document.NAME] ?? '') } : null)
        } else if (action === picker.Action.CANCEL) {
          resolve(null)
        }
      })
      .build()
    built.setVisible(true)
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */
