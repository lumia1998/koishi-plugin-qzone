import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('published package metadata', () => {
  it('exports package.json for the Koishi local plugin scanner', () => {
    const manifestPath = require.resolve('koishi-plugin-qzone/package.json')
    const manifest = require(manifestPath) as { name?: string, version?: string }

    expect(manifest.name).toBe('koishi-plugin-qzone')
    expect(manifest.version).toMatch(/^0\.0\.1(?:-|$)/)
  })
})
