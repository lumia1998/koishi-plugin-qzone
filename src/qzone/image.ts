import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { isIP } from 'node:net'
import type { LookupFunction } from 'node:net'

import { Agent, fetch as undiciFetch } from 'undici'
import type { Dispatcher } from 'undici'

type FetchInit = RequestInit & { dispatcher?: Dispatcher }
type FetchLike = (input: string | URL | Request, init?: FetchInit) => Promise<Response>

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true
  const [a, b] = parts
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && parts[2] === 100)
    || (a === 203 && b === 0 && parts[2] === 113)
    || a >= 224
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
  if (mapped) return isPrivateIpv4(mapped[1])
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff')
    || normalized.startsWith('2001:db8:')
}

export function matchesAllowedHost(hostname: string, patterns: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return patterns.some((rawPattern) => {
    const pattern = rawPattern.trim().toLowerCase().replace(/\.$/, '')
    if (!pattern) return false
    if (!pattern.startsWith('*.')) return host === pattern
    const suffix = pattern.slice(2)
    return host === suffix || host.endsWith(`.${suffix}`)
  })
}

export function detectImageMimeType(data: Uint8Array, source = ''): string | undefined {
  if (data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
    return 'image/png'
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg'
  }
  if (data.length >= 6) {
    const header = Buffer.from(data.subarray(0, 6)).toString('ascii')
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif'
  }
  if (data.length >= 12) {
    const header = Buffer.from(data.subarray(0, 12)).toString('ascii')
    if (header.slice(0, 4) === 'RIFF' && header.slice(8, 12) === 'WEBP') {
      return 'image/webp'
    }
    if (header.slice(4, 12) === 'ftypavif' || header.slice(4, 12) === 'ftypavis') {
      return 'image/avif'
    }
  }
  if (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d) return 'image/bmp'

  try {
    const extension = new URL(source).pathname.split('.').pop()?.toLowerCase()
    return {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      avif: 'image/avif',
      bmp: 'image/bmp',
    }[extension || '']
  } catch {
    return undefined
  }
}

export function detectVideoMimeType(data: Uint8Array, source = ''): string | undefined {
  if (data.length >= 12) {
    const header = Buffer.from(data.subarray(0, 12)).toString('ascii')
    if (header.slice(4, 8) === 'ftyp') {
      return header.slice(8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4'
    }
  }
  if (data.length >= 4) {
    const header = Buffer.from(data.subarray(0, 4)).toString('ascii')
    if (header === 'OggS') return 'video/ogg'
    if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
      return 'video/webm'
    }
  }

  try {
    const extension = new URL(source).pathname.split('.').pop()?.toLowerCase()
    return {
      mp4: 'video/mp4',
      m4v: 'video/x-m4v',
      mov: 'video/quicktime',
      webm: 'video/webm',
      ogv: 'video/ogg',
      ogg: 'video/ogg',
    }[extension || '']
  } catch {
    return undefined
  }
}

async function validateRemoteUrl(url: URL, allowedHosts: string[]): Promise<LookupAddress[]> {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`不支持的媒体协议：${url.protocol}`)
  }
  if (url.username || url.password) throw new Error('媒体 URL 不允许携带用户信息')
  if (!matchesAllowedHost(url.hostname, allowedHosts)) {
    throw new Error(`媒体域名不在白名单：${url.hostname}`)
  }

  if (isIP(url.hostname)) {
    if (isPrivateIpv4(url.hostname) || isPrivateIpv6(url.hostname)) {
      throw new Error('媒体 URL 指向私网地址')
    }
    return [{ address: url.hostname, family: isIP(url.hostname) }]
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (!addresses.length) throw new Error('媒体域名没有可用地址')
  if (addresses.some(({ address, family }) => family === 4
    ? isPrivateIpv4(address)
    : isPrivateIpv6(address))) {
    throw new Error('媒体域名解析到私网地址')
  }
  return addresses
}

function createPinnedAgent(addresses: LookupAddress[]): Agent {
  let cursor = 0
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, addresses)
      return
    }
    const selected = addresses[cursor++ % addresses.length]
    callback(null, selected.address, selected.family)
  }
  return new Agent({ connect: { lookup: pinnedLookup } })
}

async function readLimited(response: Response, maxBytes: number, label: string): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > maxBytes) throw new Error(`${label}超过 ${maxBytes} 字节限制`)
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`${label}超过 ${maxBytes} 字节限制`)
    }
    chunks.push(value)
  }

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export interface ImageDownloaderOptions {
  allowedHosts: string[]
  maxBytes: number
  timeoutMs: number
  fetch?: typeof globalThis.fetch
}

interface SafeMediaDownloaderOptions extends ImageDownloaderOptions {
  kind: 'image' | 'video'
}

class SafeMediaDownloader {
  private readonly fetchImpl: FetchLike
  private readonly injectedFetch: boolean

  constructor(private readonly options: SafeMediaDownloaderOptions) {
    this.injectedFetch = Boolean(options.fetch)
    this.fetchImpl = (options.fetch || undiciFetch) as unknown as FetchLike
  }

  async download(source: string): Promise<Uint8Array> {
    if (source.startsWith('data:')) return this.decodeDataUrl(source)
    let url = new URL(source)
    if (url.protocol === 'http:') url = new URL(source.replace(/^http:/, 'https:'))

    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const addresses = await validateRemoteUrl(url, this.options.allowedHosts)
      const dispatcher = this.injectedFetch ? undefined : createPinnedAgent(addresses)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs)
      try {
        const response = await this.fetchImpl(url, {
          signal: controller.signal,
          redirect: 'manual',
          headers: { Accept: `${this.options.kind}/*` },
          dispatcher,
        })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) throw new Error(`${this.label}重定向缺少 Location`)
          url = new URL(location, url)
          continue
        }
        if (!response.ok) throw new Error(`${this.label}下载失败：HTTP ${response.status}`)
        const contentType = response.headers.get('content-type') || ''
        if (contentType && !contentType.toLowerCase().startsWith(`${this.options.kind}/`)) {
          throw new Error(`${this.label}响应类型异常：${contentType}`)
        }
        return await readLimited(response, this.options.maxBytes, this.label)
      } finally {
        clearTimeout(timeout)
        await dispatcher?.close()
      }
    }
    throw new Error(`${this.label}重定向次数过多`)
  }

  private decodeDataUrl(source: string): Uint8Array {
    const maximumEncodedLength = Math.ceil(this.options.maxBytes / 3) * 4 + 4
    if (source.length > maximumEncodedLength + 128) {
      throw new Error(`${this.label}超过 ${this.options.maxBytes} 字节限制`)
    }
    const match = new RegExp(`^data:${this.options.kind}/[a-z0-9.+-]+;base64,([a-z0-9+/=\\s]+)$`, 'i').exec(source)
    if (!match) throw new Error(`仅支持 base64 ${this.label} Data URL`)
    const encoded = match[1].replace(/\s/g, '')
    if (encoded.length > maximumEncodedLength) {
      throw new Error(`${this.label}超过 ${this.options.maxBytes} 字节限制`)
    }
    const data = Buffer.from(encoded, 'base64')
    if (data.byteLength > this.options.maxBytes) {
      throw new Error(`${this.label}超过 ${this.options.maxBytes} 字节限制`)
    }
    return data
  }

  private get label(): string {
    return this.options.kind === 'image' ? '图片' : '视频'
  }
}

export class SafeImageDownloader {
  private readonly downloader: SafeMediaDownloader

  constructor(options: ImageDownloaderOptions) {
    this.downloader = new SafeMediaDownloader({ ...options, kind: 'image' })
  }

  download(source: string): Promise<Uint8Array> {
    return this.downloader.download(source)
  }
}

export class SafeVideoDownloader {
  private readonly downloader: SafeMediaDownloader

  constructor(options: ImageDownloaderOptions) {
    this.downloader = new SafeMediaDownloader({ ...options, kind: 'video' })
  }

  download(source: string): Promise<Uint8Array> {
    return this.downloader.download(source)
  }
}
