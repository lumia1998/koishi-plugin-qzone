import { randomUUID, createHash } from 'node:crypto'
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'

import type { MessageContentComplex } from '@langchain/core/messages'
import type { Logger } from 'koishi'

import { detectImageMimeType } from './image'

interface ImageDownloader {
  download(source: string): Promise<Uint8Array>
}

export interface QzoneImageCacheOptions {
  directory: string
  ttlMs: number
  cleanupIntervalMs: number
  maxImages: number
  maxBytes: number
  maxTotalBytes: number
  downloader: ImageDownloader
  logger?: Logger
  now?: () => number
}

export class QzoneImageCache {
  private readonly now: () => number
  private readonly ready: Promise<void>
  private readonly inFlight = new Map<string, Promise<Uint8Array>>()
  private cleanupTimer?: ReturnType<typeof setInterval>

  constructor(private readonly options: QzoneImageCacheOptions) {
    this.now = options.now || Date.now
    this.ready = this.initialize()
  }

  async getDataUrl(source: string): Promise<string> {
    const data = await this.getBytes(source)
    return this.toDataUrl(data, source)
  }

  async getBytes(source: string): Promise<Uint8Array> {
    await this.ready
    if (!source || source.length > 2048) throw new Error('媒体地址过长')
    return this.load(source)
  }

  async createContent(sources: string[]): Promise<MessageContentComplex[]> {
    await this.ready
    const uniqueSources = [...new Set(sources)]
      .filter((source) => source.length > 0 && source.length <= 2048)
      .slice(0, Math.max(0, this.options.maxImages))
    const content: MessageContentComplex[] = []
    let totalBytes = 0

    for (const source of uniqueSources) {
      try {
        const data = await this.load(source)
        if (totalBytes + data.byteLength > this.options.maxTotalBytes) continue
        totalBytes += data.byteLength
        content.push({
          type: 'image_url',
          image_url: {
            url: this.toDataUrl(data, source),
            detail: 'low',
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.options.logger?.warn('[qzone] 图片未能传给 ChatLuna：%s', message)
      }
    }

    return content
  }

  async cleanup(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true })
    const entries = await readdir(this.options.directory, { withFileTypes: true })
    const cutoff = this.now() - Math.max(1, this.options.ttlMs)
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || (!entry.name.endsWith('.img') && !entry.name.endsWith('.tmp'))) return
      const path = join(this.options.directory, entry.name)
      try {
        const info = await stat(path)
        if (info.mtimeMs < cutoff) await rm(path, { force: true })
      } catch {
        // Another request may have replaced or removed the cache file.
      }
    }))
  }

  async dispose(): Promise<void> {
    await this.ready.catch(() => undefined)
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
  }

  private async initialize(): Promise<void> {
    await this.cleanup()
    if (this.options.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => {
        void this.cleanup().catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          this.options.logger?.warn('[qzone] 图片缓存清理失败：%s', message)
        })
      }, this.options.cleanupIntervalMs)
      if (typeof this.cleanupTimer.unref === 'function') this.cleanupTimer.unref()
    }
  }

  private async load(source: string): Promise<Uint8Array> {
    const existing = this.inFlight.get(source)
    if (existing) return existing
    const pending = this.loadOrDownload(source)
    this.inFlight.set(source, pending)
    try {
      return await pending
    } finally {
      if (this.inFlight.get(source) === pending) this.inFlight.delete(source)
    }
  }

  private async loadOrDownload(source: string): Promise<Uint8Array> {
    const path = this.cachePath(source)
    try {
      const info = await stat(path)
      if (info.size <= this.options.maxBytes
        && info.mtimeMs >= this.now() - Math.max(1, this.options.ttlMs)) {
        return new Uint8Array(await readFile(path))
      }
      await rm(path, { force: true })
    } catch {
      // Cache miss.
    }

    const data = await this.options.downloader.download(source)
    if (data.byteLength > this.options.maxBytes) {
      throw new Error(`图片超过 ${this.options.maxBytes} 字节限制`)
    }
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(this.options.directory, { recursive: true })
    try {
      await writeFile(temporary, data, { flag: 'wx', mode: 0o600 })
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    return data
  }

  private cachePath(source: string): string {
    const key = createHash('sha256').update(source).digest('hex')
    return join(this.options.directory, `${key}.img`)
  }

  private toDataUrl(data: Uint8Array, source: string): string {
    const mimeType = detectImageMimeType(data, source)
    if (!mimeType) throw new Error('无法识别图片格式')
    return `data:${mimeType};base64,${Buffer.from(data).toString('base64')}`
  }
}
