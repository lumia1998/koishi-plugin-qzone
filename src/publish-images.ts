import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { matchesAllowedHost } from './qzone/image'

export interface PublishImageOptions {
  allowedHosts: string[]
  maxImages: number
  maxBytes: number
  maxTotalBytes: number
  allowLocalFiles?: boolean
}

function base64ByteLength(encoded: string): number {
  const clean = encoded.replace(/\s/g, '')
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
    throw new Error('图片 base64 数据格式无效')
  }
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(clean.length * 3 / 4) - padding)
}

function normalizeBase64(source: string): string {
  const encoded = source.slice('base64://'.length).replace(/\s/g, '')
  base64ByteLength(encoded)
  return `base64://${encoded}`
}

function dataUrlToBase64(source: string): string {
  const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(source)
  if (!match) throw new Error('仅支持 base64 编码的图片 Data URL')
  const encoded = match[1].replace(/\s/g, '')
  base64ByteLength(encoded)
  return `base64://${encoded}`
}

/**
 * 将命令 / ChatLuna 传入的图片统一转换为 SnowLuma 支持的
 * `http(s)://` 或 `base64://` 形式。
 *
 * 公网 URL 只允许插件白名单内的 QQ CDN 域名；SnowLuma 会在自己的
 * 进程内下载该 URL，因此这里必须先做域名限制，避免把内网地址交给后端。
 */
export async function preparePublishImages(
  sources: string[],
  options: PublishImageOptions,
): Promise<string[]> {
  const unique = [...new Set(sources.map((source) => source.trim()).filter(Boolean))]
  if (unique.length > options.maxImages) {
    throw new Error(`单次最多发布 ${options.maxImages} 张图片`)
  }

  let totalBytes = 0
  const images: string[] = []
  for (const source of unique) {
    if (source.startsWith('base64://')) {
      const image = normalizeBase64(source)
      totalBytes += base64ByteLength(image.slice('base64://'.length))
      images.push(image)
    } else if (source.startsWith('data:')) {
      const image = dataUrlToBase64(source)
      totalBytes += base64ByteLength(image.slice('base64://'.length))
      images.push(image)
    } else if (/^https?:\/\//i.test(source)) {
      const url = new URL(source)
      if (url.username || url.password) throw new Error('图片 URL 不允许携带用户信息')
      if (!matchesAllowedHost(url.hostname, options.allowedHosts)) {
        throw new Error(`图片域名不在白名单：${url.hostname}`)
      }
      // 与媒体下载器保持一致：QQ CDN 的 http 地址统一升级为 https。
      if (url.protocol === 'http:') url.protocol = 'https:'
      images.push(url.toString())
    } else {
      if (!options.allowLocalFiles) {
        throw new Error('发布图片仅支持 http(s) URL 或 base64 数据')
      }
      const path = source.startsWith('file:') ? fileURLToPath(source) : source
      if (!path || path.includes('\0')) throw new Error('图片路径无效')
      const info = await stat(path)
      if (!info.isFile()) throw new Error(`图片路径不是文件：${path}`)
      if (info.size > options.maxBytes) {
        throw new Error(`图片超过 ${options.maxBytes} 字节限制`)
      }
      const data = await readFile(path)
      if (data.byteLength > options.maxBytes) {
        throw new Error(`图片超过 ${options.maxBytes} 字节限制`)
      }
      totalBytes += data.byteLength
      images.push(`base64://${data.toString('base64')}`)
    }

    if (totalBytes > options.maxTotalBytes) {
      throw new Error(`发布图片总大小超过 ${options.maxTotalBytes} 字节限制`)
    }
  }

  return images
}
