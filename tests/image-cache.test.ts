import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { QzoneImageCache } from '../src/qzone/image-cache'

const pngHeader = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

describe('QzoneImageCache', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true,
    })))
  })

  it('caches validated image bytes and returns multimodal content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qzone-image-cache-'))
    directories.push(directory)
    const downloader = {
      download: vi.fn(async () => pngHeader),
    }
    const cache = new QzoneImageCache({
      directory,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      cleanupIntervalMs: 0,
      maxImages: 9,
      maxBytes: 1024,
      maxTotalBytes: 1024,
      downloader,
    })

    try {
      const source = 'https://a.qpic.cn/image.jpg'
      const bytes = await cache.getBytes(source)
      const first = await cache.createContent([source])
      const second = await cache.createContent([source])

      expect(first).toEqual([{
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,iVBORw0KGgo=',
          detail: 'low',
        },
      }])
      expect(second).toEqual(first)
      expect(bytes).toEqual(pngHeader)
      expect(downloader.download).toHaveBeenCalledOnce()
      expect((await readdir(directory)).some((name) => name.endsWith('.img'))).toBe(true)
    } finally {
      await cache.dispose()
    }
  })
})
