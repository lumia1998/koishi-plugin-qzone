import { describe, expect, it } from 'vitest'

import { matchesAllowedHost, SafeImageDownloader } from '../src/qzone/image'

describe('SafeImageDownloader', () => {
  it('matches exact and wildcard hosts without suffix confusion', () => {
    expect(matchesAllowedHost('a.qpic.cn', ['*.qpic.cn'])).toBe(true)
    expect(matchesAllowedHost('qpic.cn', ['*.qpic.cn'])).toBe(true)
    expect(matchesAllowedHost('qpic.cn.evil.test', ['*.qpic.cn'])).toBe(false)
  })

  it('accepts bounded image data URLs', async () => {
    const downloader = new SafeImageDownloader({
      allowedHosts: [],
      maxBytes: 4,
      timeoutMs: 1000,
    })
    const result = await downloader.download('data:image/png;base64,AQIDBA==')
    expect([...result]).toEqual([1, 2, 3, 4])
  })

  it('rejects oversized data URLs', async () => {
    const downloader = new SafeImageDownloader({
      allowedHosts: [],
      maxBytes: 3,
      timeoutMs: 1000,
    })
    await expect(downloader.download('data:image/png;base64,AQIDBA==')).rejects.toThrow('超过')
  })
})
