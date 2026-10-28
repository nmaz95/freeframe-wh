import { describe, it, expect } from 'vitest'
import { driveFolderLink, shortDriveUrl, splitFolderName } from '../google-drive-links'

describe('driveFolderLink', () => {
  it('points at the folder by id', () => {
    expect(driveFolderLink('1aB3cD')).toBe('https://drive.google.com/drive/folders/1aB3cD')
  })

  it('escapes an id that is not URL-safe', () => {
    expect(driveFolderLink('a/b c')).toBe('https://drive.google.com/drive/folders/a%2Fb%20c')
  })
})

describe('shortDriveUrl', () => {
  it('keeps host and path and cuts long ids to their ends', () => {
    expect(shortDriveUrl('https://drive.google.com/file/d/1kLmNoPqRsTuVwXyZ7Tz/view?usp=drivesdk'))
      .toBe('drive.google.com/file/d/1kLm…7Tz/view')
    expect(shortDriveUrl('https://drive.google.com/drive/folders/1aB3cDeFgHiJkLmNx9Q'))
      .toBe('drive.google.com/drive/folders/1aB3…x9Q')
  })

  it('leaves short segments whole and tolerates a bare host', () => {
    expect(shortDriveUrl('https://drive.google.com/drive/folders/short')).toBe('drive.google.com/drive/folders/short')
    expect(shortDriveUrl('https://drive.google.com/')).toBe('drive.google.com')
  })

  it('returns anything that is not a URL unchanged', () => {
    expect(shortDriveUrl('not a url')).toBe('not a url')
  })
})

describe('splitFolderName', () => {
  it('greys out the deliveries folder and keeps the client name', () => {
    expect(splitFolderName('Consegne / Barilla')).toEqual({ prefix: 'Consegne / ', title: 'Barilla' })
    expect(splitFolderName('Consegne / Sub / Barilla')).toEqual({ prefix: 'Consegne / Sub / ', title: 'Barilla' })
  })

  it('has no prefix for a bare name', () => {
    expect(splitFolderName('Barilla')).toEqual({ prefix: '', title: 'Barilla' })
  })
})
