import type { MetadataRoute } from 'next'
import { getServerBranding } from '@/lib/branding-server'
import { logoUrlFromApi } from '@/lib/branding-logo'
import { withBasePath } from '@/lib/base-path'

/** The install-time colours. They match the dark theme's `--bg-primary`, which
 *  is what the splash and the standalone window show before any CSS lands. */
export const PWA_THEME_COLOR = '#0d0d10'

/**
 * The web app manifest, served at /manifest.webmanifest. It is what lets a
 * phone add FreeFrame to its home screen as an app: a name and icons for the
 * home screen, `standalone` so the installed app opens without the browser's
 * own chrome, and the colours of the window around it.
 *
 * Branded like the tab title: a white-labelled instance is installed under
 * its own name, with its own Apple icon when an admin uploaded one. The
 * generated icons under /icons are the product's own and stay as the sizes
 * Android needs (192, 512 and a maskable 512 with the safe-zone padding).
 *
 * No service worker goes with it on purpose: nothing here works offline, and
 * a cached app shell would serve a stale build after every deploy. Chrome has
 * not required one for installation since 2024, and iOS never did.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getServerBranding()
  const name = branding?.org_name || 'FreeFrame'
  const brandedIcon = logoUrlFromApi(branding?.apple_icon_url)
  const icons: MetadataRoute.Manifest['icons'] = [
    ...(brandedIcon ? [{ src: brandedIcon, sizes: '180x180', type: 'image/png' }] : []),
    { src: withBasePath('/icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
    { src: withBasePath('/icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
    { src: withBasePath('/icons/maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]
  return {
    id: withBasePath('/'),
    name,
    short_name: name.length > 12 ? name.slice(0, 12).trimEnd() : name,
    description: 'Collaborative media review and approval',
    start_url: withBasePath('/projects'),
    scope: withBasePath('/'),
    display: 'standalone',
    orientation: 'any',
    background_color: PWA_THEME_COLOR,
    theme_color: PWA_THEME_COLOR,
    icons,
  }
}
