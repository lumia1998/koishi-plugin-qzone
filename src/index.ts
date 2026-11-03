import { resolve } from 'node:path'

import { Context, h } from 'koishi'
import type { Bot, Session } from 'koishi'

import { registerChatLunaTools } from './chatluna'
import { Config as ConfigSchema } from './config'
import type { Config as QzonePluginConfig } from './config'
import { DEFAULT_QZONE_SETTINGS } from './defaults'
import { formatPost } from './formatter'
import type { Post, RangeSelection } from './types'
import { createRepository, defineDatabaseModel } from './repository'
import { QzoneService } from './service'
import { SnowLumaBackend } from './snowluma/backend'
import { SnowLumaClient } from './snowluma/client'
import type { OneBotRequestTarget } from './snowluma/client'
import {
  detectImageMimeType,
  detectVideoMimeType,
  SafeImageDownloader,
  SafeVideoDownloader,
} from './qzone/image'
import { QzoneImageCache } from './qzone/image-cache'
import {
  collectImageSources,
  findMentionedUser,
  parsePostReference,
  parseRange,
} from './utils'

export const name = 'qzone'
export const inject = { required: ['chatluna'], optional: ['database'] }
export const Config = ConfigSchema
export interface Config extends QzonePluginConfig {}
export { createQzoneToolDefinitions, registerChatLunaTools } from './chatluna'
export { SnowLumaBackend } from './snowluma/backend'
export { SnowLumaActionError, SnowLumaClient, SnowLumaTimeoutError } from './snowluma/client'
export { QzoneService } from './service'
export type { QzoneBackend, QzoneLoginInfo } from './backend'
export type { Comment, Post } from './types'

type OneBotBot = Bot & OneBotRequestTarget

function findOneBotBot(ctx: Context, selfId: string): OneBotBot | undefined {
  return Array.from(ctx.bots as Iterable<Bot>).find(
    (bot) => bot.platform === 'onebot' && String(bot.selfId) === selfId,
  ) as OneBotBot | undefined
}

function sessionCacheKey(session: Session): string {
  return [session.platform, session.selfId, session.guildId, session.channelId, session.userId].join(':')
}

async function sendPosts(
  session: Session,
  posts: Post[],
  imageCache: QzoneImageCache,
  videoCache: QzoneImageCache,
  logger: import('koishi').Logger,
): Promise<void> {
  if (!posts.length) {
    await session.send('查询结果为空。')
    return
  }
  for (const [index, post] of posts.entries()) {
    await session.send(formatPost(post, index))
    for (const source of post.images.slice(0, DEFAULT_QZONE_SETTINGS.maxImages)) {
      try {
        const data = await imageCache.getBytes(source)
        const mimeType = detectImageMimeType(data, source)
        if (!mimeType) throw new Error('无法识别图片格式')
        await session.send(h.image(data, mimeType))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('[qzone] 图片发送失败：%s', message)
      }
    }
    for (const source of post.videos.slice(0, DEFAULT_QZONE_SETTINGS.maxVideos)) {
      try {
        const data = await videoCache.getBytes(source)
        const mimeType = detectVideoMimeType(data, source)
        if (!mimeType) throw new Error('无法识别视频格式')
        await session.send(h.video(data, mimeType))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('[qzone] 视频发送失败：%s', message)
      }
    }
  }
}

export function apply(ctx: Context, config: QzonePluginConfig): void {
  defineDatabaseModel(ctx)

  const baseDir = (ctx as Context & { baseDir?: string }).baseDir || process.cwd()
  const logger = ctx.logger('qzone')
  const repository = createRepository(ctx)
  const client = new SnowLumaClient({
    selfId: config.onebotSelfId,
    resolveBot: () => findOneBotBot(ctx, config.onebotSelfId),
    timeoutMs: DEFAULT_QZONE_SETTINGS.actionTimeoutMs,
    writeTimeoutMs: DEFAULT_QZONE_SETTINGS.writeTimeoutMs,
    logger,
    debugLogging: config.debugLogging,
  })
  const backend = new SnowLumaBackend(client, {
    feedPageSize: DEFAULT_QZONE_SETTINGS.feedPageSize,
    maxFeedPages: DEFAULT_QZONE_SETTINGS.maxFeedPages,
    detailCommentLimit: DEFAULT_QZONE_SETTINGS.detailCommentLimit,
  })

  const commandImageCache = new QzoneImageCache({
    directory: resolve(baseDir, DEFAULT_QZONE_SETTINGS.imageCachePath),
    ttlMs: DEFAULT_QZONE_SETTINGS.imageCacheTtlSeconds * 1000,
    cleanupIntervalMs: DEFAULT_QZONE_SETTINGS.imageCacheCleanupIntervalSeconds * 1000,
    maxImages: DEFAULT_QZONE_SETTINGS.maxImages,
    maxBytes: DEFAULT_QZONE_SETTINGS.maxImageBytes,
    maxTotalBytes: DEFAULT_QZONE_SETTINGS.maxImageBytes,
    downloader: new SafeImageDownloader({
      allowedHosts: [...DEFAULT_QZONE_SETTINGS.allowedImageHosts],
      maxBytes: DEFAULT_QZONE_SETTINGS.maxImageBytes,
      timeoutMs: DEFAULT_QZONE_SETTINGS.timeoutMs,
    }),
    logger,
  })
  const modelImageCache = new QzoneImageCache({
    directory: resolve(baseDir, DEFAULT_QZONE_SETTINGS.modelImageCachePath),
    ttlMs: DEFAULT_QZONE_SETTINGS.imageCacheTtlSeconds * 1000,
    cleanupIntervalMs: DEFAULT_QZONE_SETTINGS.imageCacheCleanupIntervalSeconds * 1000,
    maxImages: DEFAULT_QZONE_SETTINGS.maxModelImages,
    maxBytes: DEFAULT_QZONE_SETTINGS.maxModelImageBytes,
    maxTotalBytes: DEFAULT_QZONE_SETTINGS.maxModelImageTotalBytes,
    downloader: new SafeImageDownloader({
      allowedHosts: [...DEFAULT_QZONE_SETTINGS.allowedImageHosts],
      maxBytes: DEFAULT_QZONE_SETTINGS.maxModelImageBytes,
      timeoutMs: DEFAULT_QZONE_SETTINGS.timeoutMs,
    }),
    logger,
  })
  const videoCache = new QzoneImageCache({
    directory: resolve(baseDir, DEFAULT_QZONE_SETTINGS.videoCachePath),
    ttlMs: DEFAULT_QZONE_SETTINGS.imageCacheTtlSeconds * 1000,
    cleanupIntervalMs: DEFAULT_QZONE_SETTINGS.imageCacheCleanupIntervalSeconds * 1000,
    maxImages: DEFAULT_QZONE_SETTINGS.maxVideos,
    maxBytes: DEFAULT_QZONE_SETTINGS.maxVideoBytes,
    maxTotalBytes: DEFAULT_QZONE_SETTINGS.maxVideoBytes,
    downloader: new SafeVideoDownloader({
      allowedHosts: [...DEFAULT_QZONE_SETTINGS.allowedImageHosts],
      maxBytes: DEFAULT_QZONE_SETTINGS.maxVideoBytes,
      timeoutMs: DEFAULT_QZONE_SETTINGS.timeoutMs,
    }),
    logger,
  })
  const service = new QzoneService(backend, repository, {
    maxImages: DEFAULT_QZONE_SETTINGS.maxImages,
    loginInfoTtlMs: DEFAULT_QZONE_SETTINGS.loginInfoTtlMs,
    logger,
    publishImages: {
      allowedHosts: [...DEFAULT_QZONE_SETTINGS.allowedImageHosts],
      maxImages: DEFAULT_QZONE_SETTINGS.maxImages,
      maxBytes: DEFAULT_QZONE_SETTINGS.maxImageBytes,
      maxTotalBytes: DEFAULT_QZONE_SETTINGS.maxPublishTotalBytes,
    },
  })
  const recentPosts = new Map<string, Post[]>()
  registerChatLunaTools(ctx, service, config, modelImageCache)

  async function resolveCommandPost(session: Session, reference = '0'): Promise<Post> {
    const normalized = reference.trim()
    if (/^\d+$/.test(normalized)) {
      const cached = recentPosts.get(sessionCacheKey(session)) || []
      const index = Number(normalized)
      if (cached[index]) return cached[index]
      throw new Error(`动态序号 ${index} 不在最近查询结果中`)
    }
    return service.resolvePost(parsePostReference(normalized))
  }

  ctx.command('qzone.status', '查看 QQ 空间登录状态', {
    authority: 1,
  }).alias('空间状态').action(async () => {
    const status = await service.getStatus()
    return `QQ 空间已连接：${status.nickname || status.uin} (${status.uin})，后端：${status.source}`
  })

  ctx.command('qzone.feed [range:string]', '查看 QQ 空间动态', {
    authority: 1,
  }).alias('看说说')
    .option('user', '-u <user:string> 指定 QQ 号')
    .option('detail', '-d 获取完整评论')
    .action(async ({ session, options }, range) => {
      if (!session) return
      const selection: RangeSelection = parseRange(range, DEFAULT_QZONE_SETTINGS.defaultFeedCount)
      const target = options?.user || findMentionedUser(session)
      if (target && !/^\d+$/.test(target)) return 'QQ 号必须为纯数字。'
      const posts = await service.queryFeeds({
        targetId: target,
        offset: selection.offset,
        limit: selection.limit,
        withDetail: options?.detail,
      })
      recentPosts.set(sessionCacheKey(session), posts)
      await sendPosts(session, posts, commandImageCache, videoCache, logger)
    })

  ctx.command('qzone.like [reference:string]', '点赞动态，默认最近查询的第 0 条', {
    authority: 1,
  }).alias('赞说说').action(async ({ session }, reference) => {
    if (!session) return
    const post = await resolveCommandPost(session, reference)
    await service.like(post)
    return `已点赞 ${post.name || post.uin} 的动态 #${post.id || post.tid}。`
  })

  ctx.command('qzone.unlike [reference:string]', '取消点赞动态，默认最近查询的第 0 条', {
    authority: 1,
  }).alias('取消赞说说').action(async ({ session }, reference) => {
    if (!session) return
    const post = await resolveCommandPost(session, reference)
    await service.unlike(post)
    return `已取消点赞 ${post.name || post.uin} 的动态 #${post.id || post.tid}。`
  })

  ctx.command('qzone.comment <reference:string> [content:text]', '评论动态，可附带图片', {
    authority: 1,
  }).alias('评论说说').action(async ({ session }, reference, content) => {
    if (!session) return
    const post = await resolveCommandPost(session, reference)
    await service.comment(post, content || '', collectImageSources(session), {
      allowLocalFiles: true,
    })
    return `已评论 ${post.name || post.uin} 的动态。`
  })

  ctx.command('qzone.reply <reference:string> <commentIndex:number> <content:text>', '回复动态评论', {
    authority: 1,
  }).alias('回复评论').action(async ({ session }, reference, commentIndex, content) => {
    if (!session) return
    const post = await resolveCommandPost(session, reference)
    await service.reply(post, commentIndex, content)
    return '回复已发送。'
  })

  ctx.command('qzone.publish [content:text]', '发布 QQ 空间说说', {
    authority: 3,
  }).alias('发说说').action(async ({ session }, content) => {
    if (!session) return
    const post = await service.publish(content || '', collectImageSources(session), {
      allowLocalFiles: true,
    })
    return `说说已发布：#${post.id || post.tid}`
  })

  ctx.command('qzone.delete <reference:string>', '删除当前账号发布的说说', {
    authority: 3,
  }).alias('删说说').action(async ({ session }, reference) => {
    if (!session) return
    const post = await resolveCommandPost(session, reference)
    await service.delete(post)
    return '说说已删除。'
  })

  ctx.on('dispose', async () => {
    recentPosts.clear()
    await Promise.all([
      commandImageCache.dispose(),
      modelImageCache.dispose(),
      videoCache.dispose(),
    ])
  })
}
