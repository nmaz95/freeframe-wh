'use client'

import { useEffect } from 'react'
import { useBranding } from '@/components/shared/branding-provider'

/**
 * What `document.title` gives back for `title`.
 *
 * The getter strips and collapses ASCII whitespace (HTML, "document.title"),
 * while the setter writes the string as given. An asset named with a trailing
 * space ("Carron - Firenze ") therefore made a title with two spaces before
 * the dash that never read back equal to what was written, and every write
 * below is a mutation of `<head>` that re-runs the hold: an unbounded loop of
 * microtasks that froze the tab (Chrome's RESULT_CODE_HUNG) the moment
 * anything else touched `<head>` -- React re-inserting its metadata title on
 * a full load, the style a dialog injects, the script of a lazily loaded
 * chunk. Comparing and writing the canonical form is what makes it converge.
 */
export function canonicalTitle(title: string): string {
  return title.replace(/[\t\n\f\r ]+/g, ' ').trim()
}

/**
 * Write `title` to the tab, but only into a `<title>` that already exists.
 *
 * With none in `<head>`, the `document.title` setter creates a plain one that
 * React does not know about. It is never removed, and it ends up as a second
 * `<title>` next to React's own, which is exactly what happens in the window
 * described on `holdDocumentTitle`.
 *
 * Returns whether it wrote.
 */
function writeTitle(title: string): boolean {
  const wanted = canonicalTitle(title)
  if (!document.querySelector('title') || document.title === wanted) return false
  document.title = wanted
  return true
}

/**
 * How many writes in a row the hold may make without once finding the title
 * equal before it gives up. Two is the most a converging hold ever needs (one
 * for React's fresh element, one for its rewrite of the text); the ceiling is
 * there so that a browser whose getter canonicalises differently from
 * `canonicalTitle` costs a lost page title, never a frozen tab.
 */
const MAX_WRITES_IN_A_ROW = 10

/**
 * Keep the tab on `title` for as long as the returned cleanup has not run.
 *
 * The title from `generateMetadata` (the org name) is a React 19 hoistable
 * `<title>`, and React mounts it on its own schedule, not the page's. On every
 * client-side navigation it deletes the old element, builds a new one with the
 * metadata text and inserts it into `<head>` ahead of the old one (and, under
 * Next 16's hidden-then-revealed metadata boundary, removes and re-inserts it
 * once more). `document.title` reads and writes the FIRST `<title>` in the
 * document, so whenever that insertion lands after the page's effect has run,
 * the metadata title wins and the page title is lost. Measured on the sign-in
 * redirect and, in `next dev`, on later client navigations. On Next 14 / React
 * 18 the single write held (one `<title>`, stable).
 *
 * No single write can be ordered against that, so this re-applies the title
 * whenever `<head>` changes. It converges: a write only happens while the title
 * differs from what the getter gives back (the canonical form, see
 * `canonicalTitle`), and the write itself then finds it equal. It also holds
 * off while no `<title>` exists, since React is about to insert one and we
 * write into it then (see `writeTitle`). Should it ever not converge, the
 * hold lets go after `MAX_WRITES_IN_A_ROW` rather than spin.
 */
function holdDocumentTitle(title: string) {
  let writesInARow = 0
  const observer = new MutationObserver(() => apply())
  const apply = () => {
    if (!writeTitle(title)) {
      writesInARow = 0
      return
    }
    if (++writesInARow >= MAX_WRITES_IN_A_ROW) {
      observer.disconnect()
      console.warn('usePageTitle: the title never read back as written; letting it go', title)
    }
  }
  apply()
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })
  return () => observer.disconnect()
}

export function usePageTitle(title: string | null | undefined) {
  const orgName = useBranding().orgName || 'FreeFrame'

  useEffect(() => {
    const release = holdDocumentTitle(title ? `${title} – ${orgName}` : orgName)
    return () => {
      release()
      writeTitle(orgName)
    }
  }, [title, orgName])
}
