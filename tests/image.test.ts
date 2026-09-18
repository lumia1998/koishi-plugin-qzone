import { describe, expect, it } from 'vitest'

import {
  detectVideoMimeType,
  matchesAllowedHost,
  SafeImageDownloader,
  SafeVideoDownloader,
} from '../src/qzone/image'

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

describe('SafeVideoDownloader', () => {
  it('detects MP4 bytes before falling back to the source URL', () => {
    const mp4Header = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d,
    ])
    expect(detectVideoMimeType(mp4Header, 'https://a.qpic.cn/no-extension')).toBe('video/mp4')
  })

  it('accepts bounded video data URLs', async () => {
    const downloader = new SafeVideoDownloader({
      allowedHosts: [],
      maxBytes: 4,
      timeoutMs: 1000,
    })
    const result = await downloader.download('data:video/mp4;base64,AQIDBA==')
    expect([...result]).toEqual([1, 2, 3, 4])
  })

  it('rejects an image data URL', async () => {
    const downloader = new SafeVideoDownloader({
      allowedHosts: [],
      maxBytes: 4,
      timeoutMs: 1000,
    })
    await expect(downloader.download('data:image/png;base64,AQIDBA==')).rejects.toThrow('Data URL')
  })
})
