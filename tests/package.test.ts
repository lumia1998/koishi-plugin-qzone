import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('published package metadata', () => {
  it('exports package.json for the Koishi local plugin scanner', () => {
    const manifestPath = require.resolve('koishi-plugin-qzone/package.json')
    const manifest = require(manifestPath) as {
      name?: string
      version?: string
      exports?: Record<string, unknown>
    }

    expect(manifest.name).toBe('koishi-plugin-qzone')
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    expect(manifest.exports?.['./package.json']).toBe('./package.json')
  })
})
