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

async function validateRemoteUrl(url: URL, allowedHosts: string[]): Promise<LookupAddress[]> {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`不支持的图片协议：${url.protocol}`)
  }
  if (url.username || url.password) throw new Error('图片 URL 不允许携带用户信息')
  if (!matchesAllowedHost(url.hostname, allowedHosts)) {
    throw new Error(`图片域名不在白名单：${url.hostname}`)
  }

  if (isIP(url.hostname)) {
    if (isPrivateIpv4(url.hostname) || isPrivateIpv6(url.hostname)) {
      throw new Error('图片 URL 指向私网地址')
    }
    return [{ address: url.hostname, family: isIP(url.hostname) }]
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (!addresses.length) throw new Error('图片域名没有可用地址')
  if (addresses.some(({ address, family }) => family === 4
    ? isPrivateIpv4(address)
    : isPrivateIpv6(address))) {
    throw new Error('图片域名解析到私网地址')
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

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > maxBytes) throw new Error(`图片超过 ${maxBytes} 字节限制`)
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
      throw new Error(`图片超过 ${maxBytes} 字节限制`)
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

export class SafeImageDownloader {
  private readonly fetchImpl: FetchLike
  private readonly injectedFetch: boolean

  constructor(private readonly options: ImageDownloaderOptions) {
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
          headers: { Accept: 'image/*' },
          dispatcher,
        })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) throw new Error('图片重定向缺少 Location')
          url = new URL(location, url)
          continue
        }
        if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`)
        const contentType = response.headers.get('content-type') || ''
        if (contentType && !contentType.toLowerCase().startsWith('image/')) {
          throw new Error(`图片响应类型异常：${contentType}`)
        }
        return await readLimited(response, this.options.maxBytes)
      } finally {
        clearTimeout(timeout)
        await dispatcher?.close()
      }
    }
    throw new Error('图片重定向次数过多')
  }

  private decodeDataUrl(source: string): Uint8Array {
    const maximumEncodedLength = Math.ceil(this.options.maxBytes / 3) * 4 + 4
    if (source.length > maximumEncodedLength + 128) {
      throw new Error(`图片超过 ${this.options.maxBytes} 字节限制`)
    }
    const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(source)
    if (!match) throw new Error('仅支持 base64 图片 Data URL')
    const encoded = match[1].replace(/\s/g, '')
    if (encoded.length > maximumEncodedLength) {
      throw new Error(`图片超过 ${this.options.maxBytes} 字节限制`)
    }
    const data = Buffer.from(encoded, 'base64')
    if (data.byteLength > this.options.maxBytes) {
      throw new Error(`图片超过 ${this.options.maxBytes} 字节限制`)
    }
    return data
  }
}
