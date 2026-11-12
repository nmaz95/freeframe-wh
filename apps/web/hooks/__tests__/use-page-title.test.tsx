/**
 * React 19 owns the metadata `<title>` and mounts it on its own schedule, so
 * the page title has to win whichever order the two land in. These tests play
 * the part of React: they remove, insert and rewrite `<title>` elements in
 * `<head>` the way it does on a client-side navigation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { usePageTitle } from '../use-page-title'
import { BrandingProvider } from '@/components/shared/branding-provider'
import { useBrandingStore } from '@/stores/branding-store'
import { makeInstanceBranding } from '@/test/branding-fixtures'

function Page({ title }: { title: string | null }) {
  usePageTitle(title)
  return null
}

function titleEls() {
  return Array.from(document.querySelectorAll('title'))
}

/** What React does for the metadata title: a fresh element, put ahead of the old one. */
function insertMetadataTitle(text: string) {
  const el = document.createElement('title')
  el.textContent = text
  document.head.insertBefore(el, document.head.firstChild)
  return el
}

/** MutationObserver callbacks run as microtasks. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('usePageTitle', () => {
  beforeEach(() => {
    document.head.querySelectorAll('title').forEach((el) => el.remove())
    useBrandingStore.setState({ loaded: false })
    insertMetadataTitle('FreeFrame')
  })

  afterEach(() => {
    document.head.querySelectorAll('title').forEach((el) => el.remove())
  })

  it('composes "Page – Org" and puts the org name back on unmount', () => {
    const { unmount } = render(<Page title="Projects" />)
    expect(document.title).toBe('Projects – FreeFrame')

    unmount()
    expect(document.title).toBe('FreeFrame')
  })

  it('uses the bare org name when there is no page title', () => {
    render(<Page title={null} />)
    expect(document.title).toBe('FreeFrame')
  })

  it('wins when React inserts the metadata title after the effect has run', async () => {
    render(<Page title="Projects" />)
    expect(document.title).toBe('Projects – FreeFrame')

    // The new element goes in ahead of the old one, so it is the one document.title reads.
    insertMetadataTitle('FreeFrame')
    await settle()

    expect(document.title).toBe('Projects – FreeFrame')
  })

  it('wins when React rewrites the text of the title it owns', async () => {
    render(<Page title="Projects" />)
    titleEls()[0].textContent = 'FreeFrame'
    await settle()

    expect(document.title).toBe('Projects – FreeFrame')
  })

  it('survives React removing and re-inserting the title more than once', async () => {
    render(<Page title="Projects" />)

    for (let i = 0; i < 3; i++) {
      titleEls().forEach((el) => el.remove())
      await settle()
      insertMetadataTitle('FreeFrame')
      await settle()
      expect(document.title).toBe('Projects – FreeFrame')
    }
    expect(titleEls()).toHaveLength(1)
  })

  it('does not create a title of its own while React has none, and writes into React’s when it arrives', async () => {
    // The window between React deleting the old title and inserting the new one:
    // the document.title setter would create an element React never removes.
    document.head.querySelectorAll('title').forEach((el) => el.remove())

    render(<Page title="Projects" />)
    expect(titleEls()).toHaveLength(0)

    const reactsTitle = insertMetadataTitle('FreeFrame')
    await settle()

    expect(titleEls()).toEqual([reactsTitle])
    expect(document.title).toBe('Projects – FreeFrame')
  })

  it('does not fight with itself: settling leaves the title alone', async () => {
    render(<Page title="Projects" />)
    const el = titleEls()[0]
    const seen: string[] = []
    new MutationObserver(() => seen.push(document.title)).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    })

    await settle()
    await settle()

    expect(seen).toEqual([])
  })

  it('stops holding the title once unmounted', async () => {
    const { unmount } = render(<Page title="Projects" />)
    unmount()

    insertMetadataTitle('Settings – FreeFrame')
    await settle()

    expect(document.title).toBe('Settings – FreeFrame')
  })

  it('follows a page title change on the same page', async () => {
    const { rerender } = render(<Page title="Review Project" />)
    expect(document.title).toBe('Review Project – FreeFrame')

    rerender(<Page title="Compare Test Video" />)
    await settle()

    expect(document.title).toBe('Compare Test Video – FreeFrame')
  })

  it('swaps the org suffix live when an admin renames the instance', async () => {
    useBrandingStore.getState().syncBranding(makeInstanceBranding({ org_name: 'Acme' }))
    render(
      <BrandingProvider initial={null}>
        <Page title="Projects" />
      </BrandingProvider>,
    )
    expect(document.title).toBe('Projects – Acme')

    act(() => {
      useBrandingStore.getState().syncBranding(makeInstanceBranding({ org_name: 'Globex' }))
    })
    await settle()
    expect(document.title).toBe('Projects – Globex')

    // And React's later title commit, still carrying the old server text, does not undo it.
    insertMetadataTitle('Acme')
    await settle()
    expect(document.title).toBe('Projects – Globex')
  })

  it('converges on a title the getter canonicalises (an asset name with a trailing space)', async () => {
    // `document.title` gives back stripped and collapsed ASCII whitespace, so a
    // written "Carron - Firenze  – FreeFrame" read back with one space and the
    // hold rewrote it on every mutation of <head> its own write caused: an
    // unbounded microtask loop that froze the tab. Counting the writes keeps
    // the test failing fast rather than hanging should it regress.
    const native = Object.getOwnPropertyDescriptor(Document.prototype, 'title')!
    let writes = 0
    Object.defineProperty(document, 'title', {
      configurable: true,
      get: () => native.get!.call(document),
      set: (value: string) => {
        if (++writes > 25) throw new Error('document.title written without end')
        native.set!.call(document, value)
      },
    })
    try {
      render(<Page title={'Carron - Firenze '} />)
      expect(document.title).toBe('Carron - Firenze – FreeFrame')

      // What a full load does after the effect: React re-inserts its metadata title.
      insertMetadataTitle('FreeFrame')
      await settle()
      await settle()
      expect(document.title).toBe('Carron - Firenze – FreeFrame')

      // What a dialog or a lazy chunk does: something else lands in <head>.
      document.head.appendChild(document.createElement('style'))
      await settle()
      await settle()
      expect(document.title).toBe('Carron - Firenze – FreeFrame')
      expect(writes).toBeLessThanOrEqual(3)
    } finally {
      delete (document as unknown as { title?: unknown }).title
    }
  })

  it('lets go rather than spin when a title never reads back as written', async () => {
    // A getter that canonicalises differently from `canonicalTitle` must cost
    // the page title, not the tab.
    const native = Object.getOwnPropertyDescriptor(Document.prototype, 'title')!
    let writes = 0
    Object.defineProperty(document, 'title', {
      configurable: true,
      get: () => native.get!.call(document).toLowerCase(),
      set: (value: string) => {
        if (++writes > 50) throw new Error('document.title written without end')
        native.set!.call(document, value)
      },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      render(<Page title="Projects" />)
      // The first write lands before the hold observes; the loop needs a later
      // change to <head>, as on a full load.
      insertMetadataTitle('FreeFrame')
      for (let i = 0; i < 15; i++) await settle()
      expect(writes).toBeLessThanOrEqual(12)
      expect(warn).toHaveBeenCalled()
      const before = writes
      document.head.appendChild(document.createElement('style'))
      await settle()
      expect(writes).toBe(before)
    } finally {
      warn.mockRestore()
      delete (document as unknown as { title?: unknown }).title
    }
  })
})
